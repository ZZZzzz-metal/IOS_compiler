import { validateSnapshot, hashBytes } from './source.mjs';
import { parseClangDiagnostics } from './diagnostics.mjs';
import { ToolFileSystem } from './wasm-host.mjs';
import { inspectWasm, assertDebugSections } from './wasm-inspect.mjs';

export const TARGET = Object.freeze({
  targetTriple: 'wasm32-unknown-wasi', abi: 'wasi_unstable', addressBits: 32,
  endianness: 'little', artifactFormat: 'wasm-v1', debugInfoFormat: 'dwarf-4-embedded',
  requiredFeatures: ['mvp', 'mutable-globals'],
});
const encoder = new TextEncoder();
export async function digest(bytes) {
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function validateCompileInput(request) {
  if (!request?.requestId || typeof request.requestId !== 'string') throw new Error('requestId is required');
  validateSnapshot(request.snapshot);
  if (!(request.language === 'c' && request.standard === 'c11') && !(request.language === 'cpp' && request.standard === 'c++17')) throw new Error('Only C11/C++17 are supported by this compiler probe');
  if (!['run', 'debug'].includes(request.mode) || request.optimization !== 'O0') throw new Error('This compiler probe only builds O0 run/debug artifacts');
  if (request.snapshot.files.reduce((n, file) => n + encoder.encode(file.text).length, 0) > 1024 * 1024) throw new Error('Source snapshot exceeds the 1 MiB probe limit');
  for (const file of request.snapshot.files) {
    if (encoder.encode(`project/${file.path}`).length > 900) throw new Error('Source path exceeds toolchain limit');
  }
}

export async function loadToolchain(lock, readResource, onProgress = () => {}) {
  const started = performance.now();
  const bytes = {};
  for (const name of ['memfs', 'sysroot.tar', 'clang', 'lld']) {
    const entry = lock.files.find(file => file.filename === name);
    if (!entry) throw new Error(`Toolchain lock is missing ${name}`);
    const buffer = await readResource(`${lock.vendorDirectory}/${name}`);
    if (!(buffer instanceof Uint8Array) || buffer.byteLength !== entry.byteLength || await digest(buffer) !== `sha256:${entry.sha256}`) throw new Error(`Toolchain integrity failed: ${name}`);
    bytes[name] = buffer;
    onProgress({ phase: 'verified-resource', name });
  }
  const modules = {};
  for (const name of ['memfs', 'clang', 'lld']) modules[name] = await WebAssembly.compile(bytes[name]);
  return { lock, modules, sysroot: bytes['sysroot.tar'], loadMs: performance.now() - started };
}

// Each call has a fresh virtual filesystem and compiler instances. No failed/stale output survives.
// Run only inside a terminable worker; WebAssembly execution here is synchronous.
export async function compileArtifact(request, toolchain, onProgress = () => {}) {
  validateCompileInput(request);
  const started = performance.now();
  const fs = await ToolFileSystem.create(toolchain.modules.memfs);
  fs.loadTar(toolchain.sysroot);
  for (const file of request.snapshot.files) fs.put(`project/${file.path}`, encoder.encode(file.text));
  fs.directory('build');
  const compilerArguments = [
    '-cc1', '-emit-obj', '-triple', TARGET.targetTriple, '-main-file-name', request.snapshot.translationUnit.split('/').at(-1), '-disable-free', '-isysroot', '/',
    ...(request.language === 'cpp' ? ['-internal-isystem', '/include/c++/v1'] : []),
    '-internal-isystem', '/lib/clang/8.0.1/include', '-internal-isystem', '/include',
    '-I', '/project', '-O0', '-ferror-limit', '20', '-fmessage-length', '0',
    ...(request.mode === 'debug' ? ['-debug-info-kind=standalone', '-dwarf-version=4', '-debugger-tuning=lldb', '-fdebug-compilation-dir', '/project'] : []),
    '-std=' + request.standard, '-x', request.language === 'cpp' ? 'c++' : 'c',
    '-o', 'build/main.o', `/project/${request.snapshot.translationUnit}`,
  ];
  const linkerArguments = [
    '--no-threads', '--export-dynamic', '-z', 'stack-size=1048576', '--max-memory=268435456',
    '-Llib/wasm32-wasi', 'lib/wasm32-wasi/crt1.o', 'build/main.o',
    ...(request.language === 'cpp' ? ['-lc++', '-lc++abi'] : []),
    '-lc', '-lm', 'lib/clang/8.0.1/lib/wasi/libclang_rt.builtins-wasm32.a',
    '-o', 'build/main.wasm',
  ];
  onProgress({ phase: 'compiling', requestId: request.requestId });
  const compileStart = performance.now();
  const compiler = await fs.run(toolchain.modules.clang, ['clang', ...compilerArguments]);
  const compileMs = performance.now() - compileStart;
  let rawDiagnostics = compiler.stderr;
  if (compiler.exitCode !== 0) return {
    status: 'failed', requestId: request.requestId, sourceHash: request.snapshot.sourceHash,
    diagnostics: parseClangDiagnostics(rawDiagnostics, request.snapshot), reason: 'compiler-exit', rawDiagnostics,
  };
  const object = fs.get('build/main.o');
  onProgress({ phase: 'linking', requestId: request.requestId });
  const linkStart = performance.now();
  const linker = await fs.run(toolchain.modules.lld, ['wasm-ld', ...linkerArguments]);
  const linkMs = performance.now() - linkStart;
  rawDiagnostics += linker.stderr;
  if (linker.exitCode !== 0) return {
    status: 'failed', requestId: request.requestId, sourceHash: request.snapshot.sourceHash,
    diagnostics: parseClangDiagnostics(rawDiagnostics, request.snapshot), reason: 'linker-exit', rawDiagnostics,
  };
  const executable = fs.get('build/main.wasm');
  const wasm = inspectWasm(executable);
  if (request.mode === 'debug') assertDebugSections(wasm);
  const module = await WebAssembly.compile(executable);
  const imports = WebAssembly.Module.imports(module);
  if (imports.some(item => item.module !== 'wasi_unstable')) throw new Error('Unexpected program import ABI');
  const artifactHash = await digest(executable);
  const artifactId = `wasm-${artifactHash.slice(7)}`;
  // This evidence deliberately has no CompatibilityProfile/buildId. 1/3 must first supply
  // a trusted actual runtime/debugger combination to the production CompilerAdapter.
  return {
    status: 'compiled', requestId: request.requestId, sourceHash: request.snapshot.sourceHash,
    snapshotId: request.snapshot.snapshotId, artifactId, target: TARGET,
    language: { language: request.language, standard: request.standard }, mode: request.mode,
    compilerArguments, linkerArguments, sourceMappings: [],
    executable, object,
    executableRef: { id: artifactId, relativePath: `compiler-builds/${artifactId}/main.wasm`, sha256: artifactHash, byteLength: executable.length, mediaType: 'application/wasm', version: toolchain.lock.toolchainId },
    diagnostics: parseClangDiagnostics(rawDiagnostics, request.snapshot), rawDiagnostics,
    wasm: { ...wasm, imports },
    metrics: { loadMs: toolchain.loadMs, compileMs, linkMs, totalMs: performance.now() - started,
      observedLinearMemoryBytes: { compilerAfterExecution: compiler.memoryBytes, linkerAfterExecution: linker.memoryBytes, filesystem: fs.exports.memory.buffer.byteLength },
      memoryNote: 'Post-phase linear memory sizes; not process RSS, peak memory, or an iPad measurement.' },
    toolchainId: toolchain.lock.toolchainId,
    compilerResourceHash: `sha256:${toolchain.lock.files.find(f => f.filename === 'clang').sha256}`,
    linkerResourceHash: `sha256:${toolchain.lock.files.find(f => f.filename === 'lld').sha256}`,
    sysrootResourceHash: `sha256:${toolchain.lock.files.find(f => f.filename === 'sysroot.tar').sha256}`,
  };
}

export function evidenceJSON(evidence) {
  const { executable, object, ...metadata } = evidence;
  return { ...metadata, ...(object ? { objectSha256: hashBytes(object), objectByteLength: object.length } : {}) };
}
