// Run from any cwd. This writes fresh engine-* evidence beside this script;
// preserve archived evidence and use ENGINE_REVIEW_OUTPUT for a later rerun.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { createIntegrationCandidate } from '../../../../app/integration/candidate.mjs';
import { createNodeHost, breakpoint, buildEvidence, pauseKey } from '../../../../app/integration/node-host.mjs';
import { ToolFileSystem } from '../../../../compiler/src/wasm-host.mjs';
import { CompilerAdapter } from '../../../../compiler/src/compiler-adapter.mjs';
import { createSnapshot } from '../../../../compiler/src/source.mjs';

const output = process.env.ENGINE_REVIEW_OUTPUT
  ? resolve(process.env.ENGINE_REVIEW_OUTPUT) : fileURLToPath(new URL('./', import.meta.url));
await mkdir(output, { recursive: true });
const save = (file, bytes) => writeFile(resolve(output, file), bytes, { flag: 'wx' });
const root = new URL('../../../../', import.meta.url);
const source = ['#include <cstdio>', 'int main() {', '  int array[3] = {11,22,33};',
  '  int *p = &array[2];', '  int *q = &array[0];', '  int octal = 010;',
  '  float f = 16777216.0f;',
  '  std::printf("target octal=%d difference=%d plus=%.0f minus=%.0f\\n", octal, int(p-q), (+f)+1, (-f)-1);',
  '  return 0;', '}'].join('\n') + '\n';
const candidate = await createIntegrationCandidate(), host = createNodeHost(candidate);
const compiled = await host.compile({ text: source });
const fs = await ToolFileSystem.create(await WebAssembly.compile(await candidate.readResource(
  `compiler/resources/${candidate.lock.vendorDirectory}/memfs`)));
const native = await fs.run(await WebAssembly.compile(compiled.bytes), ['program']);
const session = await host.debug(compiled, { initialBreakpoints: [breakpoint(8, 'main.cpp')] });
let execution;
try {
  const pause = await session.waitFor(event => event.kind === 'paused');
  assert.equal(pause.position.line, 8);
  const frame = (await session.stack(pause))[0], results = [];
  for (const expression of ['octal', '010', '00010', '08', 'p', 'q', 'p + q', 'p - q',
    'p + 1', '1 + p', '(+f) + 1', '(-f) - 1', 'p[-1]', '*(p-1)']) {
    results.push({ expression, result: await session.evaluate(pause, frame, expression) });
  }
  assert.equal((await session.command('continue', { key: pauseKey(pause) })).accepted, true);
  const termination = await session.waitFor(event => event.kind === 'terminated', pause.eventSeq);
  const interpreterOutput = session.events.filter(event => event.kind === 'output' && event.stream === 'stdout')
    .map(event => event.text).join('');
  assert.equal(native.exitCode, 0);
  assert.equal(native.stdout, 'target octal=8 difference=2 plus=16777216 minus=-16777216\n');
  assert.equal(interpreterOutput, native.stdout);
  assert.equal(termination.exitCode, 0);
  session.assertEvents();
  execution = { native, interpreterOutput, pause, frame, results, termination, events: session.events };
} finally { await session.close(); }

const compiler = new CompilerAdapter({ profile: candidate.profile, lock: candidate.lock,
  createWorker: () => new Worker(new URL('../../../../compiler/src/compiler-worker.mjs', import.meta.url), { execArgv: [] }),
  writeResource: async () => { throw new Error('Invalid oracle program unexpectedly compiled'); } });
const invalidPrograms = [];
for (const [caseId, text] of [
  ['invalid-octal', 'int main() { return 08; }\n'],
  ['pointer-plus-pointer', 'int main() { int a[3] = {11,22,33}; int *p = &a[2]; int *q = &a[0]; return p + q; }\n'],
]) {
  const snapshot = createSnapshot([{ path: 'main.cpp', role: 'user', text }], 'main.cpp');
  const result = await compiler.compile({ requestId: randomUUID(), snapshot,
    compatibilityId: candidate.profile.compatibilityId, language: 'cpp', standard: 'c++17', mode: 'debug', optimization: 'O0' });
  assert.equal(result.status, 'failed');
  invalidPrograms.push({ caseId, source: text, result });
}
const paths = ['debugger/src/variables.mjs', 'debugger/src/debugger-adapter.mjs',
  'debugger/src/worker-adapter.mjs', 'debugger/src/wasm-runtime.mjs', 'debugger/README.md',
  'compiler/src/compiler-adapter.mjs', 'app/integration/node-host.mjs', 'app/integration/candidate.mjs'];
const sourceInputs = await Promise.all(paths.map(async path => {
  const bytes = await readFile(new URL(path, root));
  return { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const record = { kind: 'fresh-real-compiler-adapter-worker-watch-semantic-review', capturedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch,
    browserTested: false, ipadTested: false, compilerNetworkUsed: false },
  profile: candidate.profile, build: buildEvidence(compiled), ...execution, invalidPrograms,
  scope: ['Program execution is independently compared with native WebAssembly using the compiler smoke host.',
    'Reported contradictions concern the debugger evaluate query; source execution output matches.',
    'Floating watch arithmetic is an appendix because the README promises only tested integer arithmetic.',
    'Negative pointer indexing and integer-plus-pointer are recorded as subset limitations, not added release blockers.'] };
await save('engine-source.cpp', source);
await save('engine-artifact.wasm', compiled.bytes);
await save('engine-results.json', JSON.stringify(record, null, 2) + '\n');
await save('engine-source-inputs.json', JSON.stringify(sourceInputs, null, 2) + '\n');
console.log(JSON.stringify({ output, native: execution.native, results: execution.results,
  invalidPrograms: invalidPrograms.map(value => ({ caseId: value.caseId, status: value.result.status, diagnostics: value.result.diagnostics })) }, null, 2));
