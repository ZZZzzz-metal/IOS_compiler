import { digest, TARGET } from './toolchain-engine.mjs';
import { ToolFileSystem } from './wasm-host.mjs';
import { parseClangDiagnostics } from './diagnostics.mjs';
import { validateCompletionRequest, completionPosition, completionContext, emptyCompletion } from './completion-source.mjs';
import { parseCompletionOutput } from './completion-output.mjs';
import { completionResourceIdentity, deriveCompletionCompiler } from './completion-semantics.mjs';

const encoder = new TextEncoder();
export const COMPLETION_RESOURCES = Object.freeze(['memfs', 'sysroot.tar', 'clang']);

export function validateCompletionLock(lock) {
  if (!lock || typeof lock.toolchainId !== 'string' || !lock.toolchainId || lock.vendorDirectory !== 'vendor/wasm-clang' || !Array.isArray(lock.files)) throw new Error('A trusted toolchain lock is required');
  for (const name of COMPLETION_RESOURCES) {
    const matches = lock.files.filter(file => file.filename === name);
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/u.test(matches[0].sha256) ||
        !Number.isSafeInteger(matches[0].byteLength) || matches[0].byteLength < 1) throw new Error(`Invalid completion resource lock: ${name}`);
  }
  completionResourceIdentity(lock);
}

// Cache these verified Modules, never an already-executed Clang instance. LLD is
// neither read nor compiled. The caller supplies the integrator's trusted lock.
export async function loadCompletionToolchain(lock, readResource, onProgress = () => {}) {
  validateCompletionLock(lock);
  const started = performance.now(), bytes = {};
  for (const name of COMPLETION_RESOURCES) {
    const entry = lock.files.find(file => file.filename === name);
    const value = await readResource(`${lock.vendorDirectory}/${name}`);
    if (!(value instanceof Uint8Array) || value.byteLength !== entry.byteLength || await digest(value) !== `sha256:${entry.sha256}`) throw new Error(`Completion integrity failed: ${name}`);
    bytes[name] = value;
    onProgress({ phase: 'completion-resource', name });
  }
  const identity = completionResourceIdentity(lock);
  bytes.clang = await deriveCompletionCompiler(bytes.clang);
  const modules = {};
  for (const name of ['memfs', 'clang']) modules[name] = await WebAssembly.compile(bytes[name]);
  return { lock, identity, modules, sysroot: bytes['sysroot.tar'], loadMs: performance.now() - started };
}

// Must run inside a terminable Worker. Clang execution is synchronous Wasm.
// Native output/arguments are returned separately for reproducible checks only.
export async function completeWithClang(request, toolchain) {
  const file = validateCompletionRequest(request), context = completionContext(file.text, request.offset);
  if (context.suppressed) return { result: emptyCompletion(request, 'succeeded', `suppressed-${context.reason}`), native: null };
  const started = performance.now(), position = completionPosition(file.text, request.offset);
  const fs = await ToolFileSystem.create(toolchain.modules.memfs);
  fs.loadTar(toolchain.sysroot);
  for (const file of request.snapshot.files) fs.put(`project/${file.path}`, encoder.encode(file.text));
  const argv = ['clang', '-cc1', '-fsyntax-only', '-triple', TARGET.targetTriple,
    '-main-file-name', request.snapshot.translationUnit.split('/').at(-1), '-disable-free', '-isysroot', '/',
    ...(request.language === 'cpp' ? ['-internal-isystem', '/include/c++/v1'] : []),
    '-internal-isystem', '/lib/clang/8.0.1/include', '-internal-isystem', '/include', '-I', '/project',
    '-ferror-limit', '20', '-fmessage-length', '0', '-std=' + request.standard,
    '-x', request.language === 'cpp' ? 'c++' : 'c',
    `-code-completion-at=/project/${request.sourcePath}:${position.line}:${position.byteColumn}`,
    `/project/${request.snapshot.translationUnit}`];
  const native = await fs.run(toolchain.modules.clang, argv);
  const parsed = parseCompletionOutput(native.stdout, context);
  const diagnostics = parseClangDiagnostics(native.stderr, request.snapshot);
  // A damaged prefix can still yield real candidates. With no candidates and a
  // nonzero exit, report failure instead of pretending native lookup succeeded.
  const succeeded = native.exitCode === 0 || parsed.items.length > 0;
  const result = { ...emptyCompletion(request, succeeded ? 'succeeded' : 'failed', succeeded ? undefined : 'clang-completion-exit', diagnostics),
    ...(succeeded ? parsed : {}), ...toolchain.identity };
  return { result, native: { argv, ...native, position }, metrics: { totalMs: performance.now() - started,
    filesystemLinearMemoryBytes: fs.exports.memory.buffer.byteLength, compilerLinearMemoryBytes: native.memoryBytes } };
}
