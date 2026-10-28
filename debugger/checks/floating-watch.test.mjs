// Fresh actual C++ -> persisted Wasm -> native oracle and isolated debugger Worker.
// No target memory, PC, result or execution event is assigned by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createIntegrationCandidate } from '../../app/integration/candidate.mjs';
import { createNodeHost, breakpoint, buildEvidence, pauseKey } from '../../app/integration/node-host.mjs';
import { ToolFileSystem } from '../../compiler/src/wasm-host.mjs';

const groups = [
  ['float32 operands convert integer inputs before arithmetic and comparison', [
    ['negative + exactInt', '0', 'float'], ['exactInt + negative', '0', 'float'],
    ['positive - exactInt', '0', 'float'], ['exactInt - positive', '0', 'float'],
    ['positive == exactInt', '1', 'bool'], ['exactInt == positive', '1', 'bool'],
    ['positive < exactInt', '0', 'bool'], ['exactInt > positive', '0', 'bool'],
    ['positive / exactInt', '1', 'float'], ['exactInt / positive', '1', 'float'],
    ['negative + exactLong', '0', 'float'], ['exactLong + negative', '0', 'float'],
    ['negative + unsignedInt', '0', 'float'], ['unsignedInt + negative', '0', 'float'],
    ['negative + unsignedLong', '0', 'float'], ['unsignedLong + negative', '0', 'float'],
    ['negative * exactInt == negative * positive', '1', 'bool'],
  ]],
  ['int64 converts directly to float32 without intermediate double rounding', [
    ['roundAbove + floatZero - signedRoundBase', '549755813888', 'float'],
    ['floatZero + roundAbove - signedRoundBase', '549755813888', 'float'],
    ['roundBelow + floatZero - signedRoundBase', '549755813888', 'float'],
    ['(-roundAbove) + floatZero + signedRoundBase', '-549755813888', 'float'],
    ['unsignedRoundAbove + floatZero - unsignedRoundBase', '1099511627776', 'float'],
    ['signedRoundBase == roundAbove', '0', 'bool'],
    ['signedRoundBase < roundAbove', '1', 'bool'],
  ]],
  ['float and double NaN convert to true in logical operations', [
    ['!nanValue', '0', 'bool'], ['!doubleNan', '0', 'bool'],
    ['nanValue || 0', '1', 'bool'], ['0 || nanValue', '1', 'bool'],
    ['nanValue && 1', '1', 'bool'], ['1 && nanValue', '1', 'bool'],
    ['doubleNan || 0', '1', 'bool'], ['0 || doubleNan', '1', 'bool'],
    ['doubleNan && 1', '1', 'bool'], ['1 && doubleNan', '1', 'bool'],
    ['!!nanValue', '1', 'bool'], ['!!doubleNan', '1', 'bool'],
    ['nanValue == nanValue', '0', 'bool'], ['nanValue != nanValue', '1', 'bool'],
    ['nanValue < 1', '0', 'bool'], ['nanValue >= 1', '0', 'bool'],
    ['doubleNan == doubleNan', '0', 'bool'], ['doubleNan != doubleNan', '1', 'bool'],
  ]],
  ['C++ truth conversion controls actual short circuiting without evaluating the skipped branch', [
    ['nanValue || (1 / zero)', '1', 'bool'], ['doubleNan || (1 / zero)', '1', 'bool'],
    ['0 && nanValue', '0', 'bool'], ['0 && doubleNan', '0', 'bool'],
    ['(nanValue || 0) || (1 / zero)', '1', 'bool'],
    ['!(nanValue && 1) && (1 / zero)', '0', 'bool'],
    ['1 || (1 / zero)', '1', 'bool'], ['0 && (1 / zero)', '0', 'bool'],
  ]],
  ['signed zero and infinity use C++ scalar truth values', [
    ['!floatZero', '1', 'bool'], ['!negativeZero', '1', 'bool'],
    ['floatZero || negativeZero', '0', 'bool'], ['negativeZero && 1', '0', 'bool'],
    ['!doubleZero', '1', 'bool'], ['!doubleNegativeZero', '1', 'bool'],
    ['!infinity', '0', 'bool'], ['infinity || 0', '1', 'bool'], ['infinity && 1', '1', 'bool'],
    ['!negativeInfinity', '0', 'bool'], ['negativeInfinity && 1', '1', 'bool'],
    ['infinity || (1 / zero)', '1', 'bool'],
  ]],
  ['double common type retains double precision and integer conversions', [
    ['positive + doubleOne', '16777217', 'double'], ['doubleOne + positive', '16777217', 'double'],
    ['negative + doubleExact', '1', 'double'], ['doubleExact + negative', '1', 'double'],
    ['doublePositive == exactInt', '0', 'bool'], ['doublePositive < exactInt', '1', 'bool'],
    ['doubleZero + roundAbove - doubleRoundBase', '0', 'double'],
    ['(+positive) + doubleOne', '16777217', 'double'],
  ]],
];
const cases = groups.flatMap(([, items]) => items).map(([expression, expected, type], index) => ({ expression, expected, type, id: `case${index}` }));
const declarations = [
  '#include <cstdio>', 'int main() {',
  '  int exactInt = 16777217;', '  long long exactLong = 16777217;',
  '  unsigned int unsignedInt = 16777217U;', '  unsigned long long unsignedLong = 16777217ULL;',
  '  float positive = 16777216.0f;', '  float negative = -16777216.0f;',
  '  float floatZero = 0.0f;', '  float negativeZero = -0.0f;',
  '  double doubleZero = 0.0;', '  double doubleNegativeZero = -0.0;',
  '  float nanValue = __builtin_nanf("");', '  double doubleNan = __builtin_nan("");',
  '  float infinity = __builtin_inff();', '  float negativeInfinity = -__builtin_inff();',
  '  int zero = 0;',
  '  long long roundAbove = 4611686293305294849LL;',
  '  long long roundBelow = 4611686843061108735LL;',
  '  unsigned long long unsignedRoundAbove = 9223372586610589697ULL;',
  '  float signedRoundBase = 4611686018427387904.0f;',
  '  float unsignedRoundBase = 9223372036854775808.0f;',
  '  double doubleOne = 1.0;', '  double doubleExact = 16777217.0;',
  '  double doublePositive = 16777216.0;',
  '  double doubleRoundBase = 4611686293305294848.0;',
];
const source = [...declarations,
  ...cases.map(item => `  std::printf("${item.id}=%lld\\n", (long long)(${item.expression}));`),
  '  return 0;', '}', '',
].join('\n');
const pauseLine = declarations.length + 1;

test('floating watch conversions and truth values agree with freshly compiled C++ execution', { timeout: 60000 }, async t => {
  const candidate = await createIntegrationCandidate(), host = createNodeHost(candidate);
  const compiled = await host.compile({ text: source });
  const fs = await ToolFileSystem.create(await WebAssembly.compile(await candidate.readResource(
    `compiler/resources/${candidate.lock.vendorDirectory}/memfs`)));
  const native = await fs.run(await WebAssembly.compile(compiled.bytes), ['program']);
  assert.equal(native.exitCode, 0);
  const oracle = Object.fromEntries(native.stdout.trim().split('\n').map(line => {
    const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
  }));
  for (const item of cases) assert.equal(oracle[item.id], item.expected, `compiled C++ oracle: ${item.expression}`);
  const session = await host.debug(compiled, { initialBreakpoints: [breakpoint(pauseLine, 'main.cpp')] });
  const observations = [], failures = [];
  let pause, frame, termination, interpreterOutput;
  try {
    pause = await session.waitFor(event => event.kind === 'paused');
    assert.equal(pause.position.line, pauseLine);
    frame = (await session.stack(pause))[0];
    let index = 0;
    for (const [name, items] of groups) {
      await t.test(name, async () => {
        const groupFailures = [];
        for (const _ of items) {
          const item = cases[index++], result = await session.evaluate(pause, frame, item.expression);
          const passed = result.availability === 'available' && result.displayValue === oracle[item.id] && result.type === item.type;
          const observation = { ...item, result, oracle: oracle[item.id], passed, pauseId: pause.pauseId, frameId: frame.frameId };
          observations.push(observation);
          if (!passed) { failures.push(observation); groupFailures.push(observation); }
        }
        assert.deepEqual(groupFailures, [], `actual Worker watch results differ from native C++ in ${name}`);
      });
    }
    await t.test('queries retain actual execution output and ordered event identity', async () => {
      assert.equal((await session.command('continue', { key: pauseKey(pause) })).accepted, true);
      termination = await session.waitFor(event => event.kind === 'terminated', pause.eventSeq);
      interpreterOutput = session.events.filter(event => event.kind === 'output' && event.stream === 'stdout').map(event => event.text).join('');
      assert.equal(termination.reason, 'exit'); assert.equal(termination.exitCode, 0);
      assert.equal(interpreterOutput, native.stdout);
      session.assertEvents();
    });
  } finally {
    await session.close();
    if (process.env.FLOATING_WATCH_EVIDENCE) {
      const suffix = process.env.FLOATING_WATCH_EVIDENCE;
      assert.match(suffix, /^[a-zA-Z0-9][a-zA-Z0-9-]{0,80}$/);
      const output = new URL(`../.local/floating-watch-${suffix}/`, import.meta.url);
      await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
      await mkdir(output, { recursive: false });
      await writeFile(new URL('results.json', output), JSON.stringify({
        kind: 'fresh-compiler-native-wasm-real-worker-floating-watch-regression', capturedAt: new Date().toISOString(),
        environment: { node: process.version, platform: process.platform, browserTested: false, ipadTested: false },
        profile: candidate.profile, resources: candidate.resources, build: buildEvidence(compiled), native,
        pause, frame, observations, failures, interpreterOutput, termination, events: session.events,
      }, null, 2) + '\n', { flag: 'wx' });
      await writeFile(new URL('source.cpp', output), source, { flag: 'wx' });
      await writeFile(new URL('artifact.wasm', output), compiled.bytes, { flag: 'wx' });
    }
  }
});
