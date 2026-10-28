// Person 05 independent watch review: fresh CompilerAdapter -> persisted bytes -> real Node Worker.
// Native WebAssembly execution is the oracle; no target values, PCs or debugger events are injected.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { platform, release } from 'node:os';
import { createIntegrationCandidate } from '../app/integration/candidate.mjs';
import { createNodeHost, breakpoint, pauseKey, buildEvidence } from '../app/integration/node-host.mjs';
import { ToolFileSystem } from '../compiler/src/wasm-host.mjs';

const root = new URL('../', import.meta.url);
const output = new URL(process.env.WATCH_TYPES_OUTPUT ??
  'tests/evidence/integrated-person05-parallel-review-3248ad5-2026-10-28/engine/run-01/', root);
assert.ok(output.href.startsWith(new URL('tests/evidence/integrated-', root).href), 'Evidence stays in a new integrated directory');
await mkdir(output, { recursive: true });
const outputFile = (name, data) => writeFile(new URL(name, output), data, { flag: 'wx' });
const checks = [
  { id: 'REV002-octal', expression: '010 + 077', expected: '71' },
  { id: 'REV002-unsigned-octal', expression: '037777777777 + 1', expected: '0' },
  { id: 'REV003-offset', expression: '*(p-1)', expected: '22' },
  { id: 'small-signed-promotion', expression: 'signedSmall + 1', expected: '-4' },
  { id: 'small-unsigned-promotion', expression: 'unsignedSmall + -1', expected: '65534' },
  { id: 'signed-unsigned-comparison', expression: 'signedLong < unsignedLong', expected: '0' },
  { id: 'wide-narrow-conversion', expression: 'wideSigned + unsignedLong', expected: '4294967294' },
  { id: 'unsigned-wrapping', expression: 'unsignedLong + 1', expected: '0' },
  { id: 'float-unary-preserves-width', expression: '(+positive) + 1', expected: '16777216' },
  { id: 'mixed-float-int-addition', expression: 'negative + exactInt', expected: '0' },
  { id: 'mixed-int-float-addition', expression: 'exactInt + negative', expected: '0' },
  { id: 'mixed-float-int-subtraction', expression: 'positive - exactInt', expected: '0' },
  { id: 'mixed-float-int-equality', expression: 'positive == exactInt', expected: '1' },
  { id: 'mixed-float-int-less-than', expression: 'positive < exactInt', expected: '0' },
  { id: 'mixed-float-int-division', expression: 'positive / exactInt == 1', expected: '1' },
  { id: 'mixed-float-wide-addition', expression: 'negative + exactLong', expected: '0' },
  { id: 'nan-logical-not', expression: '!nanValue', expected: '0' },
  { id: 'nan-logical-or', expression: 'nanValue || 0', expected: '1' },
  { id: 'nan-logical-and', expression: 'nanValue && 1', expected: '1' },
  { id: 'nan-equality', expression: 'nanValue == nanValue', expected: '0' },
  { id: 'short-circuit-null', expression: 'nullPointer != 0 && *nullPointer == 99', expected: '0' },
  { id: 'short-circuit-division', expression: '1 || (1/zero)', expected: '1' },
  { id: 'short-circuit-nan-rhs', expression: 'nanValue || (1/zero)', expected: '1' },
  { id: 'REV003-same-array-difference', expression: 'p - q', unsupported: /pointer subtraction.*unsupported|provenance/i },
  { id: 'REV003-pointer-addition', expression: 'p + q', unsupported: /pointer/i },
  { id: 'sizeof-unsupported-boundary', expression: 'sizeof(exactInt)', boundaryOnly: true },
];
const nativeChecks = checks.filter(item => item.expected !== undefined);
const sourceLines = [
  '#include <cstdio>',
  'int main() {',
  '  int array[3] = {11,22,33};',
  '  int *p = &array[2];',
  '  int *q = &array[0];',
  '  int *nullPointer = 0;',
  '  signed char signedSmall = -5;',
  '  unsigned short unsignedSmall = 65535;',
  '  long signedLong = -1;',
  '  unsigned long unsignedLong = 4294967295UL;',
  '  long long wideSigned = -1;',
  '  int exactInt = 16777217;',
  '  long long exactLong = 16777217;',
  '  float positive = 16777216.0f;',
  '  float negative = -16777216.0f;',
  '  float nanValue = __builtin_nanf("");',
  '  int zero = 0;',
  ...nativeChecks.map(item => `  std::printf("${item.id}=%lld\\n", (long long)(${item.expression}));`),
  '  std::printf("pointer-native-difference=%d\\n", int(p-q));',
  '  return 0;',
  '}',
  '',
];
const source = sourceLines.join('\n');
const pauseLine = 18;
const startedAt = new Date().toISOString();
const candidate = await createIntegrationCandidate();
assert.equal(candidate.profile.compatibilityId, 'integration-prototype-b02def5d2c6e7f39', 'The independent run targets the requested new engine bytes');
const host = createNodeHost(candidate);
const compiled = await host.compile({ text: source });
const fs = await ToolFileSystem.create(await WebAssembly.compile(await candidate.readResource(
  `compiler/resources/${candidate.lock.vendorDirectory}/memfs`)));
const native = await fs.run(await WebAssembly.compile(compiled.bytes), ['program']);
assert.equal(native.exitCode, 0);
const oracle = Object.fromEntries(native.stdout.trim().split('\n').map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
for (const item of nativeChecks) assert.equal(oracle[item.id], item.expected, 'Actual compiler oracle agrees for ' + item.expression);
assert.equal(oracle['pointer-native-difference'], '2');
const session = await host.debug(compiled, { initialBreakpoints: [breakpoint(pauseLine, 'main.cpp')] });
const observations = [], failures = [];
let pause, frame, termination, interpreterOutput;
try {
  pause = await session.waitFor(event => event.kind === 'paused');
  assert.equal(pause.position.line, pauseLine);
  frame = (await session.stack(pause))[0];
  for (const item of checks) {
    const result = await session.evaluate(pause, frame, item.expression);
    let passed = true;
    if (item.expected !== undefined) passed = result.availability === 'available' && result.displayValue === oracle[item.id];
    else if (item.unsupported) passed = result.availability === 'unsupported' && item.unsupported.test(result.reason ?? '');
    const observation = { ...item, unsupported: item.unsupported?.source, result, oracle: oracle[item.id], status: item.boundaryOnly ? 'boundary-only' : passed ? 'passed' : 'failed' };
    observations.push(observation);
    if (!passed) failures.push(observation);
    console.log(`${passed ? 'ok' : 'not ok'} ${observations.length} - ${item.id}: ${result.availability} ${result.displayValue ?? result.reason}`);
  }
  assert.equal((await session.command('continue', { key: pauseKey(pause) })).accepted, true);
  termination = await session.waitFor(event => event.kind === 'terminated', pause.eventSeq);
  interpreterOutput = session.events.filter(event => event.kind === 'output' && event.stream === 'stdout').map(event => event.text).join('');
  assert.equal(termination.reason, 'exit'); assert.equal(termination.exitCode, 0);
  assert.equal(interpreterOutput, native.stdout, 'Watch queries do not alter actual program output');
  session.assertEvents();
} finally {
  await session.close();
  const bytes = await readFile(new URL('debugger/src/variables.mjs', root));
  const results = {
    schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), release: release(), ipadTested: false, browserTested: false, networkDisabled: false },
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(),
    variablesSHA256: createHash('sha256').update(bytes).digest('hex'),
    profile: candidate.profile, resources: candidate.resources, build: buildEvidence(compiled), native,
    pause, frame, observations, failures, interpreterOutput, termination, events: session.events,
    counts: { passed: observations.filter(item => item.status === 'passed').length, failed: failures.length, boundaryOnly: observations.filter(item => item.status === 'boundary-only').length },
    note: 'Fresh local compilation and independent native WebAssembly oracle. Accepted mismatches remain failures; documented unsupported pointer subtraction is a supported boundary, not a difference implementation. No browser or iPad claims.',
  };
  await outputFile('source.cpp', source);
  await outputFile('artifact.wasm', compiled.bytes);
  await outputFile('results.json', JSON.stringify(results, null, 2) + '\n');
  await outputFile('checks.tap', ['TAP version 13', ...observations.map((item, i) => `${item.status === 'failed' ? 'not ok' : 'ok'} ${i + 1} - ${item.id}${item.boundaryOnly ? ' # SKIP support boundary only' : ''}`), `1..${observations.length}`, ''].join('\n'));
}
process.exitCode = failures.length ? 1 : 0;
