// Real fresh CompilerAdapter output and an isolated WorkerDebuggerAdapter.
// Target PCs, locations, memory and values are never assigned by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createIntegrationCandidate } from '../../app/integration/candidate.mjs';
import { createNodeHost, breakpoint, buildEvidence, pauseKey } from '../../app/integration/node-host.mjs';
import { ToolFileSystem } from '../../compiler/src/wasm-host.mjs';
import { CompilerAdapter } from '../../compiler/src/compiler-adapter.mjs';
import { createSnapshot } from '../../compiler/src/source.mjs';
import { Worker } from 'node:worker_threads';

const integerCases = [
  ['0', '0'], ['010', '8'], ['00010', '8'], ['077', '63'],
  ['10', '10'], ['0x10', '16'], ['010 + 0x10', '24'], ['077 & 0xF', '15'],
  ['037777777777 + 1', '0'], ['020000000000 < -1', '1'],
  ['037777777777 == -1', '1'], ['2147483648 + 1', '2147483649'],
  ['0xffffffff + 1', '0'], ['010 == 8', '1'], ['0X10', '16'],
  ['020000000000 + 020000000000', '0'], ['-1 < 020000000000', '0'],
];
const oracleLines = integerCases.map(([expression], index) =>
  `  std::printf("integer${index}=%lld\\n", (long long)(${expression}));`);
const sourceLines = [
  '#include <cstdio>',
  'int main() {',
  '  int array[3] = {11,22,33};',
  '  int other[3] = {44,55,66};',
  '  short small[2] = {7,8};',
  '  int *p = &array[2];',
  '  int *q = &array[0];',
  '  int *r = &other[0];',
  '  short *s = &small[0];',
  '  int *nullPointer = 0;',
  '  void *opaque = p;',
  '  int octal = 010;',
  '  float f = 16777216.0f;',
  ...oracleLines,
  '  std::printf("target octal=%d difference=%d middle=%d null=%d plus=%.0f minus=%.0f\\n", octal, int(p-q), *(p-1), int(nullPointer == 0), (+f)+1, (-f)-1);',
  '  return 0;',
  '}',
  '',
];
const source = sourceLines.join('\n');
const pauseLine = sourceLines.indexOf(oracleLines[0]) + 1;
const expectedOutput = integerCases.map(([, value], index) => `integer${index}=${value}\n`).join('') +
  'target octal=8 difference=2 middle=22 null=1 plus=16777216 minus=-16777216\n';
const available = (result, expected, expression) => {
  assert.equal(result.availability, 'available', `${expression}: ${JSON.stringify(result)}`);
  assert.equal(result.displayValue, expected, expression);
};

test('watch semantics match fresh native Wasm or explicitly report the unsupported subset', { timeout: 60000 }, async t => {
  const candidate = await createIntegrationCandidate(), host = createNodeHost(candidate);
  const compiled = await host.compile({ text: source });
  const fs = await ToolFileSystem.create(await WebAssembly.compile(await candidate.readResource(
    `compiler/resources/${candidate.lock.vendorDirectory}/memfs`)));
  const native = await fs.run(await WebAssembly.compile(compiled.bytes), ['program']);
  assert.equal(native.exitCode, 0);
  assert.equal(native.stdout, expectedOutput, 'the oracle is actual compiled C++, independently executed');
  const session = await host.debug(compiled, { initialBreakpoints: [breakpoint(pauseLine, 'main.cpp')] });
  const observations = [], invalidPrograms = [];
  let pause, frame, termination, interpreterOutput;
  const collect = async expressions => {
    const results = [];
    for (const expression of expressions) {
      const result = await session.evaluate(pause, frame, expression);
      observations.push({ expression, result, pauseId: pause.pauseId, frameId: frame.frameId });
      results.push(result);
    }
    return results;
  };
  try {
    pause = await session.waitFor(event => event.kind === 'paused');
    assert.equal(pause.position.line, pauseLine);
    frame = (await session.stack(pause))[0];

    await t.test('REV-002: integer bases and subsequent integer conversions agree with compiled expressions', async () => {
      const results = await collect(integerCases.map(([expression]) => expression));
      for (let index = 0; index < results.length; index++)
        available(results[index], integerCases[index][1], integerCases[index][0]);
      assert.match(results[0].type, /int/);
      assert.match(results[8].type, /unsigned/);
    });

    await t.test('REV-002: invalid octal tokens are explicitly unsupported, including nested and skipped operands', async () => {
      const expressions = ['08', '09', '0009', '08 + 1', '1 + 09', 'true || 08', 'false && 09'];
      const results = await collect(expressions);
      for (let index = 0; index < results.length; index++) {
        assert.equal(results[index].availability, 'unsupported', `${expressions[index]}: ${JSON.stringify(results[index])}`);
        assert.match(results[index].reason, /octal|literal|token/i);
      }
    });

    await t.test('REV-003: two pointers never enter pointer-integer arithmetic and unknown provenance stays unsupported', async () => {
      const expressions = ['p + q', 'q + p', 'p - q', 'q - p', 'p - p', 'p - r', 'p - s', 'p + nullPointer',
        'opaque + p', 'p + opaque', 'opaque - p', 'p - opaque', 'opaque + 1', 'opaque - 1'];
      const results = await collect(expressions);
      for (let index = 0; index < results.length; index++) {
        assert.equal(results[index].availability, 'unsupported', `${expressions[index]}: ${JSON.stringify(results[index])}`);
        assert.match(results[index].reason, /pointer/i);
      }
    });

    await t.test('REV-003: integer pointer offsets, dereference and null comparisons retain actual values', async () => {
      const expressions = ['p', 'q', 'p + 1', 'p - 1', '*(p-1)', '*(q+2)', 'p == 0', 'p != 0',
        'nullPointer == 0', '0 == nullPointer', 'p == q', 'p != q', 'p - 0'];
      const results = await collect(expressions);
      for (const result of results) assert.equal(result.availability, 'available', JSON.stringify(result));
      const address = text => BigInt(text);
      const pointer = address(results[0].displayValue), start = address(results[1].displayValue);
      assert.equal(pointer - start, 8n);
      assert.equal(address(results[2].displayValue), pointer + 4n, 'one-past-array pointer remains inspectable');
      assert.equal(address(results[3].displayValue), pointer - 4n);
      assert.equal(address(results[12].displayValue), pointer);
      for (const [index, expected] of [[4, '22'], [5, '33'], [6, '0'], [7, '1'], [8, '1'], [9, '1'], [10, '0'], [11, '1']])
        available(results[index], expected, expressions[index]);
      const rejected = await collect(['p + 1.0', 'p - 1.0', '1 - p', 'p * q', 'p / q',
        '&(p+1)', 'array[p]', 'p[q]']);
      for (const result of rejected) assert.equal(result.availability, 'unsupported', JSON.stringify(result));
      const addresses = await collect(['&p', '*(&p)']);
      assert.equal(addresses[0].availability, 'available', JSON.stringify(addresses[0]));
      assert.match(addresses[0].type, /\*\s*\*/);
      available(addresses[1], results[0].displayValue, '*(&p)');
      const voidComparisons = await collect(['opaque == 0', 'opaque != 0']);
      available(voidComparisons[0], '0', 'opaque == 0');
      available(voidComparisons[1], '1', 'opaque != 0');
    });

    await t.test('float32 unary signs preserve the operand width through arithmetic', async () => {
      const expressions = ['+f', '-f', '(+f) + 1', '(-f) - 1', '+(-f)', '-(-f)'];
      const results = await collect(expressions);
      for (let index = 0; index < results.length; index++) {
        available(results[index], index === 1 || index === 3 || index === 4 ? '-16777216' : '16777216', expressions[index]);
        assert.equal(results[index].type, 'float', expressions[index]);
      }
    });

    await t.test('real compiler separately rejects invalid octal constants and pointer addition', async () => {
      const compiler = new CompilerAdapter({ profile: candidate.profile, lock: candidate.lock,
        createWorker: () => new Worker(new URL('../../compiler/src/compiler-worker.mjs', import.meta.url), { execArgv: [] }),
        writeResource: async () => { throw new Error('Invalid oracle program unexpectedly compiled'); } });
      for (const [caseId, text, diagnostic] of [
        ['08', 'int main() { return 08; }\n', /invalid digit.*octal/i],
        ['09', 'int main() { return 09; }\n', /invalid digit.*octal/i],
        ['pointer-addition', 'int main() { int a[3] = {11,22,33}; int *p = &a[2]; int *q = &a[0]; return p + q; }\n', /invalid operands/i],
      ]) {
        const snapshot = createSnapshot([{ path: 'main.cpp', role: 'user', text }], 'main.cpp');
        const result = await compiler.compile({ requestId: crypto.randomUUID(), snapshot,
          compatibilityId: candidate.profile.compatibilityId, language: 'cpp', standard: 'c++17', mode: 'debug', optimization: 'O0' });
        invalidPrograms.push({ caseId, source: text, result });
        assert.equal(result.status, 'failed');
        assert.match(JSON.stringify(result.diagnostics), diagnostic);
      }
    });

    await t.test('queries leave real program execution, event identity and native output unchanged', async () => {
      available((await collect(['octal']))[0], '8', 'octal');
      assert.equal((await session.command('continue', { key: pauseKey(pause) })).accepted, true);
      termination = await session.waitFor(event => event.kind === 'terminated', pause.eventSeq);
      interpreterOutput = session.events.filter(event => event.kind === 'output' && event.stream === 'stdout').map(event => event.text).join('');
      assert.equal(termination.exitCode, 0);
      assert.equal(interpreterOutput, native.stdout);
      session.assertEvents();
    });
  } finally {
    await session.close();
    if (process.env.WATCH_SEMANTICS_EVIDENCE) {
      const suffix = process.env.WATCH_SEMANTICS_EVIDENCE;
      assert.match(suffix, /^[a-zA-Z0-9][a-zA-Z0-9-]{0,80}$/);
      const directory = new URL(`../.local/watch-semantics-${suffix}/`, import.meta.url);
      await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
      await mkdir(directory, { recursive: false });
      await writeFile(new URL('results.json', directory), JSON.stringify({
        kind: 'fresh-compiler-adapter-real-worker-watch-regression', capturedAt: new Date().toISOString(),
        environment: { node: process.version, platform: process.platform, browserTested: false, ipadTested: false },
        profile: candidate.profile, build: buildEvidence(compiled), native, pause, frame, observations,
        invalidPrograms, interpreterOutput, termination, events: session.events,
        scope: 'Pointer subtraction is explicitly unsupported because the evaluator does not establish common array provenance.',
      }, null, 2) + '\n', { flag: 'wx' });
      await writeFile(new URL('source.cpp', directory), source, { flag: 'wx' });
      await writeFile(new URL('artifact.wasm', directory), compiled.bytes, { flag: 'wx' });
    }
  }
});
