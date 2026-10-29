// CC-20261029-02: exercise the pinned Clang's own completion frontend, without LLD.
// Run: node compiler/experiments/completion-2026-10-29/probe-native.mjs
// Each invocation creates a new evidence directory; previous results are never overwritten.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ToolFileSystem } from '../../src/wasm-host.mjs';
import { createSnapshot } from '../../src/source.mjs';
import { TARGET } from '../../src/toolchain-engine.mjs';

const encoder = new TextEncoder();
const compilerRoot = new URL('../../', import.meta.url);
const repositoryRoot = new URL('../', compilerRoot);
const evidenceRoot = new URL('evidence/completion-2026-10-29/native-probe/', compilerRoot);
const startedAt = new Date().toISOString();
const runId = `${startedAt.replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
const runDirectory = new URL(`${runId}/`, evidenceRoot);
await mkdir(runDirectory, { recursive: true });
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const json = (path, value) => writeFile(new URL(path, runDirectory), JSON.stringify(value, null, 2) + '\n');
const lockBytes = await readFile(new URL('resources/toolchain.lock.json', compilerRoot));
const lock = JSON.parse(lockBytes);
const verifiedResources = [];
const bytes = {};
const resourceLoadStart = performance.now();
// Deliberately avoid loadToolchain(), which also loads the unneeded LLD binary.
for (const name of ['memfs', 'clang', 'sysroot.tar']) {
  const entry = lock.files.find(file => file.filename === name);
  if (!entry) throw new Error(`Missing locked resource ${name}`);
  const resource = await readFile(new URL(`resources/${lock.vendorDirectory}/${name}`, compilerRoot));
  const sha256 = hash(resource);
  if (resource.length !== entry.byteLength || sha256 !== `sha256:${entry.sha256}`) {
    throw new Error(`Locked resource mismatch: ${name}`);
  }
  bytes[name] = resource;
  verifiedResources.push({ filename: name, byteLength: resource.length, sha256, expectedSha256: `sha256:${entry.sha256}`, verified: true });
}
const resourceReadAndHashMs = performance.now() - resourceLoadStart;
const moduleStart = performance.now();
const [memfs, clang] = await Promise.all([WebAssembly.compile(bytes.memfs), WebAssembly.compile(bytes.clang)]);
const wasmModuleCompileMs = performance.now() - moduleStart;
const hostSources = [];
for (const relativePath of ['src/wasm-host.mjs', 'src/source.mjs', 'src/toolchain-engine.mjs', 'experiments/completion-2026-10-29/probe-native.mjs']) {
  const content = await readFile(new URL(relativePath, compilerRoot));
  hostSources.push({ relativePath: `compiler/${relativePath}`, sha256: hash(content), byteLength: content.length });
}
const environment = {
  task: 'CC-20261029-02', startedAt, runId,
  scope: 'Desktop Node executes real pinned Wasm Clang frontend completion; no LLD, program execution, remote API, browser or iPad test.',
  platform: process.platform, architecture: process.arch, node: process.version,
  repositoryCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
  toolchainId: lock.toolchainId, lockSha256: hash(lockBytes), target: TARGET,
  verifiedResources, hostSources, resourceReadAndHashMs, wasmModuleCompileMs,
  resourcesExcluded: ['lld'], outputLimitBytes: 2 * 1024 * 1024,
  timingNote: 'completionMs includes a fresh Clang Wasm instance and frontend execution; filesystemSetupMs includes a fresh memfs and sysroot load. Shared resource read/hash and WebAssembly.compile are measured separately. Single observations are not an iPad latency claim.',
  memoryNote: 'Reported linear memory is measured after execution, not peak process RSS.',
};
await json('environment.json', environment);

async function observeTool(name, argv) {
  const fs = await ToolFileSystem.create(memfs, { outputLimit: environment.outputLimitBytes });
  const start = performance.now();
  const result = await fs.run(clang, argv);
  const observation = { argv, elapsedMs: performance.now() - start, ...result };
  await json(`${name}.json`, observation);
  await writeFile(new URL(`${name}.stdout.txt`, runDirectory), result.stdout);
  await writeFile(new URL(`${name}.stderr.txt`, runDirectory), result.stderr);
  return observation;
}
const version = await observeTool('version', ['clang', '--version']);
const help = await observeTool('cc1-help', ['clang', '-cc1', '-help']);

const cpp = (id, markedText, observations, extra = {}) => ({
  id, language: 'cpp', standard: 'c++17', translationUnit: 'main.cpp', targetPath: 'main.cpp',
  files: [{ path: 'main.cpp', role: 'user', markedText }], observations, ...extra,
});
const cases = [
  cpp('01-local-function-prefix', 'int alphaFunction(int x) { return x; }\nint main() { int alphaLocal = 1; al@; }\n', ['alphaFunction', 'alphaLocal', 'alignas']),
  cpp('02-struct-dot', 'struct Pair { int count; double length; void reset(int value); };\nint main() { Pair pair; pair.@; }\n', ['count', 'length', 'reset']),
  cpp('03-struct-arrow', 'struct Node { int value; Node* next; void advance(); };\nint main() { Node* pointer = nullptr; pointer->@; }\n', ['value', 'next', 'advance']),
  cpp('04-class-access-external', 'class Vault { int secret; void hidden(); public: int visible; void show(); };\nint main() { Vault vault; vault.@; }\n', ['secret', 'hidden', 'visible', 'show']),
  cpp('05-class-access-internal', 'class Vault { int secret; void hidden(); public: int visible; void show() { this->@; } };\n', ['secret', 'hidden', 'visible', 'show']),
  cpp('06-namespace-scope', 'namespace algo { int count; int compute(int); struct Thing {}; }\nint main() { algo::@; }\n', ['count', 'compute', 'Thing']),
  cpp('07-class-scope', 'struct Node { static int total; static int create(int); using Size = int; int member; };\nint main() { Node::@; }\n', ['total', 'create', 'Size', 'member']),
  cpp('08-vector-prefix', '#include <vector>\nint main() { std::vector<int> items; items.si@; }\n', ['size', 'size_type']),
  cpp('09-vector-members', '#include <vector>\nint main() { std::vector<int> items; items.@; }\n', ['size', 'push_back', 'begin', 'end', 'clear']),
  cpp('10-string-prefix', '#include <string>\nint main() { std::string word; word.sub@; }\n', ['substr']),
  cpp('11-string-members', '#include <string>\nint main() { std::string word; word.@; }\n', ['substr', 'size', 'c_str', 'append', 'find']),
  cpp('12-shadowed-variable', 'double sample = 0.5;\nint main() { int sample = 3; sam@; }\n', ['sample']),
  cpp('13-shadowed-object-not-a-record', 'struct Node { int value; };\nint main() { Node object; { int object = 3; object.@; } }\n', ['value']),
  cpp('14-unfinished-block', 'struct Node { int value; void advance(); };\nvoid solve() { Node node; if (true) { node.@', ['value', 'advance']),
  cpp('15-error-before-cursor', 'void solve() { UnknownType invalid; int alpha = 1; al@', ['alpha']),
  cpp('16-utf16-chinese-emoji', 'int alphaFunction();\nint main() { const char* text = "中文😀"; int alphaLocal = 1; al@; }\n', ['alphaFunction', 'alphaLocal']),
  {
    id: '17-driver-includes-user-local', language: 'cpp', standard: 'c++17', translationUnit: 'driver.cpp', targetPath: 'user.inc',
    files: [
      { path: 'driver.cpp', role: 'driver', markedText: '#include <vector>\n#include "user.inc"\nint main() { return solve(); }\n' },
      { path: 'user.inc', role: 'user', markedText: 'int solve() { const char* note = "中文😀"; int localCount = 7; loc@; return 0; }\n' },
    ], observations: ['localCount'],
  },
  {
    id: '18-driver-includes-user-member', language: 'cpp', standard: 'c++17', translationUnit: 'driver.cpp', targetPath: 'user.inc',
    files: [
      { path: 'driver.cpp', role: 'driver', markedText: '#include <vector>\n#include "user.inc"\nint main() { Solution solution; return solution.solve(); }\n' },
      { path: 'user.inc', role: 'user', markedText: 'class Solution { public: std::vector<int> values; int solve() { values.pu@; return 0; } };\n' },
    ], observations: ['push_back'],
  },
  {
    id: '19-c11-function-local', language: 'c', standard: 'c11', translationUnit: 'main.c', targetPath: 'main.c',
    files: [{ path: 'main.c', role: 'user', markedText: 'int alphaFunction(int n);\nint main(void) { int alphaLocal = 1; al@; }\n' }], observations: ['alphaFunction', 'alphaLocal'],
  },
  cpp('20-brief-comments', '/// Adds a number to the running total.\nint alphaFunction(int value);\nint main() { al@; }\n', ['alphaFunction'], { flags: ['-code-completion-brief-comments'] }),
  cpp('21-macros-disabled', '#define ALPHA_VALUE 42\nint main() { AL@; }\n', ['ALPHA_VALUE']),
  cpp('22-macros-enabled', '#define ALPHA_VALUE 42\nint main() { AL@; }\n', ['ALPHA_VALUE'], { flags: ['-code-completion-macros'] }),
  cpp('23-patterns-enabled', 'int main() { fo@; }\n', ['Pattern'], { flags: ['-code-completion-patterns'] }),
  cpp('24-fixits-enabled', 'struct Node { int value; };\nint main() { Node* node = nullptr; node.@; }\n', ['value'], { flags: ['-code-completion-with-fixits'] }),
  cpp('25-protected-external', 'class Base { protected: int protectedValue; void protectedMethod(); public: int publicValue; };\nclass Derived : public Base {};\nint main() { Derived value; value.@; }\n', ['protectedValue', 'protectedMethod', 'publicValue']),
  cpp('26-protected-derived-internal', 'class Base { protected: int protectedValue; void protectedMethod(); public: int publicValue; };\nclass Derived : public Base { public: void run() { this->@; } };\n', ['protectedValue', 'protectedMethod', 'publicValue']),
  cpp('27-function-overloads', 'int alpha(int number);\ndouble alpha(double number);\nvoid alpha(const char* text, int count = 2);\nint main() { al@; }\n', ['alpha']),
  cpp('28-constructor-name', 'class Widget { public: Widget(); Widget(int count, const char* name = "x"); ~Widget(); };\nint main() { Wid@; }\n', ['Widget']),
  cpp('29-constructor-arguments', 'class Widget { public: Widget(); Widget(int count, const char* name = "x"); ~Widget(); };\nint main() { Widget value(@); }\n', ['Widget']),
  cpp('30-namespace-name', 'namespace algo { int count; }\nint main() { al@; }\n', ['algo']),
  cpp('31-unavailable-and-deprecated', '__attribute__((unavailable)) int alphaUnavailable();\n__attribute__((deprecated)) int alphaDeprecated();\nint main() { al@; }\n', ['alphaUnavailable', 'alphaDeprecated']),
  cpp('32-fixits-disabled', 'struct Node { int value; };\nint main() { Node* node = nullptr; node.@; }\n', ['value']),
];

function prepareSource(probe) {
  let cursor;
  const files = probe.files.map(file => {
    const marker = file.markedText.indexOf('@');
    if (marker >= 0) {
      if (cursor || file.markedText.indexOf('@', marker + 1) >= 0) throw new Error(`Expected one @ cursor in ${probe.id}`);
      if (file.path !== probe.targetPath) throw new Error(`Cursor path mismatch in ${probe.id}`);
      const before = file.markedText.slice(0, marker);
      const linePrefix = before.slice(before.lastIndexOf('\n') + 1);
      cursor = {
        sourcePath: file.path, compilerPath: `/project/${file.path}`, utf16Offset: marker,
        line: before.split('\n').length, utf16Column: linePrefix.length + 1,
        utf8ByteColumn: encoder.encode(linePrefix).length + 1,
        linePrefix, prefixAtCursor: /[A-Za-z_][A-Za-z_0-9]*$/u.exec(linePrefix)?.[0] ?? '',
        offsetConvention: '0-based UTF-16 offset; 1-based line, UTF-16 column and UTF-8 byte column',
      };
    }
    return { path: file.path, role: file.role, text: marker >= 0 ? file.markedText.slice(0, marker) + file.markedText.slice(marker + 1) : file.markedText };
  });
  if (!cursor) throw new Error(`Missing cursor in ${probe.id}`);
  return { cursor, snapshot: createSnapshot(files, probe.translationUnit, { snapshotId: `native-probe-${probe.id}` }) };
}

const observations = [];
for (const probe of cases) {
  const directory = new URL(`${probe.id}/`, runDirectory);
  await mkdir(directory);
  const { cursor, snapshot } = prepareSource(probe);
  // Same target/system include/language options as compileArtifact; no emit-obj/debug/link step.
  const argv = [
    'clang', '-cc1', '-fsyntax-only', '-triple', TARGET.targetTriple,
    '-main-file-name', probe.translationUnit.split('/').at(-1), '-disable-free', '-isysroot', '/',
    ...(probe.language === 'cpp' ? ['-internal-isystem', '/include/c++/v1'] : []),
    '-internal-isystem', '/lib/clang/8.0.1/include', '-internal-isystem', '/include',
    '-I', '/project', '-O0', '-ferror-limit', '20', '-fmessage-length', '0',
    `-std=${probe.standard}`, '-x', probe.language === 'cpp' ? 'c++' : 'c',
    ...(probe.flags ?? []),
    `-code-completion-at=${cursor.compilerPath}:${cursor.line}:${cursor.utf8ByteColumn}`,
    `/project/${probe.translationUnit}`,
  ];
  await writeFile(new URL('input.json', directory), JSON.stringify({ ...probe, cursor, snapshot, argv }, null, 2) + '\n');
  for (const file of snapshot.files) {
    const sourceURL = new URL(`sources/${file.path}`, directory);
    await mkdir(new URL('./', sourceURL), { recursive: true });
    await writeFile(sourceURL, file.text);
  }
  const filesystemStart = performance.now();
  const fs = await ToolFileSystem.create(memfs, { outputLimit: environment.outputLimitBytes });
  fs.loadTar(bytes['sysroot.tar']);
  for (const file of snapshot.files) fs.put(`project/${file.path}`, encoder.encode(file.text));
  const filesystemSetupMs = performance.now() - filesystemStart;
  const invokedAt = new Date().toISOString();
  const completionStart = performance.now();
  let result;
  let hostError;
  try { result = await fs.run(clang, argv); }
  catch (error) {
    hostError = { name: error.name, message: error.message, stack: error.stack };
    result = { exitCode: null, stdout: fs.output?.[1] ?? '', stderr: fs.output?.[2] ?? '', memoryBytes: fs.hostMemory?.buffer.byteLength ?? null };
  }
  const completionMs = performance.now() - completionStart;
  const completionLines = result.stdout.split('\n').filter(line => line.startsWith('COMPLETION: '));
  const observed = {
    id: probe.id, invokedAt, language: probe.language, standard: probe.standard,
    translationUnit: probe.translationUnit, cursor, argv, sourceHash: snapshot.sourceHash,
    resources: verifiedResources, flags: probe.flags ?? [],
    exitCode: result.exitCode, hostError: hostError ?? null,
    filesystemSetupMs, completionMs, totalCaseMs: performance.now() - filesystemStart,
    memoryBytes: { clangAfterExecution: result.memoryBytes, memfsAfterExecution: fs.exports.memory.buffer.byteLength },
    stdoutByteLength: encoder.encode(result.stdout).length, stderrByteLength: encoder.encode(result.stderr).length,
    stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr),
    completionCount: completionLines.length,
    candidateObservations: probe.observations.map(name => ({
      name, lines: completionLines.filter(line => line.startsWith(`COMPLETION: ${name} :`) || line.startsWith(`COMPLETION: ${name} (`)),
    })),
    inaccessibleLines: completionLines.filter(line => /inaccessible|NotAccessible|NotAvailable|unavailable/iu.test(line)),
    stdout: result.stdout, stderr: result.stderr,
  };
  await writeFile(new URL('stdout.txt', directory), result.stdout);
  await writeFile(new URL('stderr.txt', directory), result.stderr);
  await writeFile(new URL('result.json', directory), JSON.stringify(observed, null, 2) + '\n');
  const { stdout, stderr, resources, argv: recordedArgv, ...compact } = observed;
  observations.push(compact);
  console.log(JSON.stringify({ id: probe.id, exitCode: result.exitCode, completionCount: completionLines.length,
    completionMs: Math.round(completionMs * 100) / 100, stderrByteLength: observed.stderrByteLength,
    candidateObservations: observed.candidateObservations, hostError: observed.hostError }));
}

await json('summary.json', {
  environment, completedAt: new Date().toISOString(),
  version: { exitCode: version.exitCode, stdout: version.stdout, stderr: version.stderr },
  completionHelpLines: help.stdout.split('\n').filter(line => /completion/u.test(line)),
  observations,
  conclusionBoundary: 'Raw backend feasibility observations only. Candidate presence is not an accepted UI contract, access-control policy, completion adapter, performance guarantee or iPad verification.',
});
console.log(`Evidence: ${fileURLToPath(runDirectory)}`);
