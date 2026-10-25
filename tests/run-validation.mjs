import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { platform, release, arch } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { root, compilerRoot, debuggerRoot, baseCandidate, compile, Harness, observations,
  breakpoint, marker, available, pauseKey, frameKey, id, revision } from './lib/harness.mjs';

const manifest = JSON.parse(await readFile(new URL('fixtures/manifest.json', root), 'utf8'));
const definitions = new Map(manifest.cases.map(item => [item.id, item]));
const compiled = new Map();
const results = [];
const startedAt = new Date().toISOString();
const destination = new URL('tests/evidence/', root);
await mkdir(destination, { recursive: true });
const lines = ['TAP version 13'];
async function check(name, action) {
  const started = performance.now();
  try {
    await action();
    results.push({ name, status: 'passed', durationMs: performance.now() - started });
    const line = `ok ${results.length} - ${name}`; lines.push(line); console.log(line);
  } catch (error) {
    results.push({ name, status: 'failed', durationMs: performance.now() - started,
      error: { message: error.message, stack: error.stack, expected: error.expected, actual: error.actual } });
    const line = `not ok ${results.length} - ${name}`; lines.push(line); console.log(line, '\n  ' + error.message);
  }
}
const definition = name => { const value = definitions.get(name); assert.ok(value, `Fixture ${name}`); return value; };
const artifact = name => { const value = compiled.get(name); assert.ok(value?.build, `Compiled fixture ${name}`); return value; };
const source = name => artifact(name).snapshot.files[0].text;
const line = (name, checkpoint) => marker(source(name), checkpoint);
async function session(options, callback) {
  const h = new Harness(options);
  try { await callback(h); } finally { await h.close(); }
}
async function startAt(h, name, checkpoint, overrides = {}) {
  await h.start(artifact(name), definition(name), { initialBreakpoints: [breakpoint(artifact(name), line(name, checkpoint))], ...overrides });
  const paused = await h.wait(e => e.kind === 'paused' || e.kind === 'terminated' || e.kind === 'error');
  assert.equal(paused.kind, 'paused', JSON.stringify(paused));
  assert.equal(paused.position.line, line(name, checkpoint));
  return paused;
}
async function assertValues(h, paused, values, frame) {
  for (const [expression, expected] of Object.entries(values)) available(await h.evaluate(paused, expression, frame), expected);
}

await check('fixture markers and expected UTF-16 diagnostic columns are consistent', async () => {
  for (const item of manifest.cases) {
    const text = await readFile(new URL(`fixtures/${item.source}`, root), 'utf8');
    assert.ok(!text.includes('\r')); assert.ok(!text.startsWith('\ufeff'));
    for (const point of item.checkpoints) assert.equal(marker(text, point.name), point.line);
    if (item.expected.diagnostic) {
      const { token, line, column } = item.expected.diagnostic;
      assert.equal(text.split('\n')[line - 1].indexOf(token) + 1, column);
    }
  }
});

for (const item of manifest.cases) {
  await check(`fresh compile and native Wasm reference: ${item.id}`, async () => {
    const dangerous = ['infinite-loop', 'runtime-trap'].includes(item.id);
    const value = await compile(item, { smoke: !dangerous }); compiled.set(item.id, value);
    assert.equal(value.result.status, item.expected.compileStatus, value.result.rawDiagnostics);
    if (value.result.status === 'failed') {
      assert.equal(value.build, undefined); assert.equal(value.result.executable, undefined);
      const expected = item.expected.diagnostic;
      const actual = value.result.diagnostics.find(d => d.message.includes(expected.token));
      assert.ok(actual); assert.equal(actual.range.start.line, expected.line); assert.equal(actual.range.start.column, expected.column);
      return;
    }
    assert.equal(value.result.wasm.dwarfSections.find(s => s.name === '.debug_info').dwarfVersion, 4);
    if (!dangerous) {
      const expectedOutput = item.expected.stdout ?? item.expected.stdoutRepeat.text.repeat(item.expected.stdoutRepeat.count);
      assert.equal(value.result.smoke.stdout, expectedOutput);
      assert.equal(value.result.smoke.stderr, item.expected.stderr); assert.equal(value.result.smoke.exitCode, item.expected.exitCode);
    }
  });
}

await check('real interpreter matches native C, C++ and STL reference output', async () => {
  for (const name of ['c-core', 'cpp-core', 'cpp-stl', 'solution-driver']) await session({}, async h => {
    await h.start(artifact(name), definition(name));
    const end = await h.wait(e => e.kind === 'terminated' || e.kind === 'error');
    assert.equal(end.kind, 'terminated', JSON.stringify(end)); assert.equal(end.reason, 'exit');
    assert.equal(end.exitCode, definition(name).expected.exitCode); assert.equal(h.output(), definition(name).expected.stdout);
    assert.equal(h.output('stderr'), ''); h.ordered();
  });
});

await check('C: live array, pointer, stdin and all three stepping commands', async () => session({}, async h => {
  const before = await startAt(h, 'c-core', 'triangle-call');
  await assertValues(h, before, { sum: 15, 'values[0]': 2, 'values[2]': 8, '*pointer': 5 });
  await h.control('stepOver', before);
  const after = await h.wait(e => e.kind === 'paused', before.eventSeq);
  assert.equal(after.position.line, line('c-core', 'add-call')); available(await h.evaluate(after, 'triangle'), 6);
  assert.equal((await h.query('stack', pauseKey(before), { start: 0, count: 10 })).kind, 'error');
  await h.control('stepInto', after);
  const inside = await h.wait(e => e.kind === 'paused', after.eventSeq);
  const frames = await h.stack(inside); assert.match(frames[0].functionName, /add_bias/);
  available(await h.evaluate(inside, 'value', frames[0]), 15);
  await h.control('stepOut', inside);
  let returned = await h.wait(e => e.kind === 'paused', inside.eventSeq);
  assert.match((await h.stack(returned))[0].functionName, /main/);
  // A real return can stop on the caller's call-line continuation before its store.
  if (returned.position.line === line('c-core', 'add-call')) {
    await h.control('stepOver', returned); returned = await h.wait(e => e.kind === 'paused', returned.eventSeq);
  }
  assert.equal(returned.position.line, line('c-core', 'ready')); available(await h.evaluate(returned, 'adjusted'), 18);
  await h.control('continue', returned); const end = await h.wait(e => e.kind === 'terminated');
  assert.equal(end.exitCode, 0); assert.equal(h.output(), definition('c-core').expected.stdout); h.ordered();
}));

await check('C++: actual vector reallocation, array, pointer and empty/short/long/UTF-8 strings', async () => session({}, async h => {
  const paused = await startAt(h, 'cpp-core', 'step-call');
  await assertValues(h, paused, { seed: 4, '*pointer': 6, 'raw[2]': 9, 'values[0]': 7, 'values[2]': 8 });
  const frame = (await h.stack(paused))[0]; const key = frameKey(paused, frame);
  const values = await h.evaluate(paused, 'values', frame); available(values);
  const first = await h.query('variables', key, { variablesReference: values.variablesReference, start: 0, count: 2 });
  const last = await h.query('variables', key, { variablesReference: values.variablesReference, start: 2, count: 2 });
  assert.deepEqual(first.variables.map(v => v.displayValue), ['7', '1']); assert.equal(first.hasMore, true);
  assert.deepEqual(last.variables.map(v => v.displayValue), ['8']); assert.equal(last.hasMore, false);
  for (const [name, text] of [['empty', ''], ['shortText', 'pad'], ['longText', 'x'.repeat(48)], ['utf8', '中文😀']]) {
    const actual = await h.evaluate(paused, name, frame); available(actual); assert.equal(actual.displayValue, JSON.stringify(text));
  }
  assert.notEqual((await h.evaluate(paused, 'raw[3]')).availability, 'available');
}));

await check('C++: step into/out/over enters the real callee and exposes computed result', async () => session({}, async h => {
  const before = await startAt(h, 'cpp-core', 'step-call');
  await h.control('stepInto', before); const inside = await h.wait(e => e.kind === 'paused', before.eventSeq);
  assert.match((await h.stack(inside))[0].functionName, /twice/); available(await h.evaluate(inside, 'value'), 4);
  await h.control('stepOut', inside); let after = await h.wait(e => e.kind === 'paused', inside.eventSeq);
  assert.match((await h.stack(after))[0].functionName, /main/);
  if (after.position.line === line('cpp-core', 'step-call')) {
    await h.control('stepOver', after); after = await h.wait(e => e.kind === 'paused', after.eventSeq);
  }
  assert.equal(after.position.line, line('cpp-core', 'main-recurse-call')); available(await h.evaluate(after, 'doubled'), 8);
  await h.control('stepOver', after); const returned = await h.wait(e => e.kind === 'paused', after.eventSeq);
  assert.match((await h.stack(returned))[0].functionName, /main/); available(await h.evaluate(returned, 'recurrence'), 33);
}));

await check('recursive caller frame selection retains distinct real parameters and locals', async () => session({}, async h => {
  const first = await startAt(h, 'cpp-core', 'recurse-call'); available(await h.evaluate(first, 'depth'), 2);
  await h.control('continue', first); const second = await h.wait(e => e.kind === 'paused', first.eventSeq);
  const frames = await h.stack(second); const recursion = frames.filter(f => /^recurse\b/.test(f.functionName));
  assert.equal(recursion.length, 2); assert.notEqual(recursion[0].frameId, recursion[1].frameId);
  await assertValues(h, second, { depth: 1, token: 11 }, recursion[0]);
  await assertValues(h, second, { depth: 2, token: 12 }, recursion[1]);
  available(await h.evaluate(second, 'depth', recursion[0]), 1);
}));

await check('lexical shadowing selects the inner variable before restoring outer scope', async () => session({}, async h => {
  const inner = await startAt(h, 'cpp-core', 'shadow-inner');
  await h.locals(inner); // Preserve both raw entries even if expression evaluation fails.
  await assertValues(h, inner, { shadow: 17, innerSeen: 36, loopTotal: 19 });
  assert.equal((await h.command('setBreakpoints', { key: h.current, sourcePath: artifact('cpp-core').snapshot.translationUnit,
    breakpoints: [breakpoint(artifact('cpp-core'), line('cpp-core', 'shadow-outer'))] })).accepted, true);
  await h.control('continue', inner); const outer = await h.wait(e => e.kind === 'paused', inner.eventSeq);
  available(await h.evaluate(outer, 'shadow'), 5); assert.notEqual((await h.evaluate(outer, 'innerSeen')).availability, 'available');
}));

await check('blank and invalid breakpoint lines expose actual binding or an explicit reason', async () => session({}, async h => {
  const value = artifact('c-core');
  await h.start(value, definition('c-core'), { stopOnEntry: true,
    initialBreakpoints: [breakpoint(value, 2), breakpoint(value, 999999)] });
  const paused = await h.wait(e => e.kind === 'paused');
  const bindings = h.events.find(e => e.kind === 'breakpoints'); assert.ok(bindings.eventSeq < paused.eventSeq);
  assert.equal(bindings.bindings[0].requested.line, 2);
  const blank = bindings.bindings[0];
  if (blank.status === 'bound') assert.ok(blank.actual.length && blank.actual.every(p => p.line !== 2));
  else assert.ok(blank.reason);
  assert.equal(bindings.bindings[1].status, 'invalid'); assert.ok(bindings.bindings[1].reason); h.ordered();
}));

await check('watches support the tested arithmetic and reject side effects without modifying locals', async () => session({}, async h => {
  const paused = await startAt(h, 'c-core', 'ready');
  await assertValues(h, paused, { 'sum + *pointer * 2': 25, '(adjusted + triangle) / 2': 12, '*(pointer + 1)': 8 });
  for (const expression of ['sum++', 'sum = 99', 'add_bias(sum)', 'unknown_value', 'values[3]']) {
    const result = await h.query('evaluate', frameKey(paused, (await h.stack(paused))[0]), { expression, allowSideEffects: false });
    assert.ok(result.kind === 'error' || result.result.availability !== 'available', JSON.stringify(result));
  }
  available(await h.evaluate(paused, 'sum'), 15);
}));

await check('real wall-clock pause exceeds the configured execution budget and resumes successfully', async () => session({}, async h => {
  const budget = 1000;
  const paused = await startAt(h, 'c-core', 'ready', { limits: { runningTimeMs: budget, outputBytes: 1024, variablePageSize: 32, memoryBytes: 268435456 } });
  const start = performance.now(); await delay(budget + 250);
  const elapsedMs = performance.now() - start;
  available(await h.evaluate(paused, 'sum'), 15);
  assert.equal(h.events.some(e => e.kind === 'terminated'), false);
  await h.control('continue', paused); const end = await h.wait(e => e.kind === 'terminated');
  assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 0);
  observations.notes.push({ kind: 'real-pause-budget', budget, elapsedMs });
}));

await check('Worker Stop terminates real infinite execution; five fresh sessions reject old queries', async () => session({ worker: true }, async h => {
  await h.start(artifact('infinite-loop'), definition('infinite-loop'));
  await h.wait(e => e.kind === 'state' && e.state === 'running');
  let ticks = 0; const ticker = setInterval(() => ++ticks, 5); await delay(40); clearInterval(ticker); assert.ok(ticks > 0);
  const previous = { ...h.current }; const started = performance.now();
  assert.equal((await h.command('stop', { key: previous })).accepted, true);
  const stopped = await h.wait(e => e.kind === 'terminated'); assert.equal(stopped.reason, 'stop');
  observations.notes.push({ kind: 'worker-stop', elapsedMs: performance.now() - started, callerTicks: ticks });
  for (let round = 0; round < 5; ++round) {
    await h.start(artifact('c-core'), definition('c-core'), { stopOnEntry: true });
    const entry = await h.wait(e => e.kind === 'paused');
    assert.equal((await h.query('stack', { ...previous, pauseId: 'obsolete' }, { start: 0, count: 4 })).kind, 'error');
    await h.control('continue', entry); const end = await h.wait(e => e.kind === 'terminated');
    assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 0); assert.equal(h.output(), definition('c-core').expected.stdout); h.ordered();
  }
}));

await check('source edits require a new build and old pause/frame references cannot query it', async () => session({ worker: true }, async h => {
  const paused = await startAt(h, 'c-core', 'ready'); const oldFrame = (await h.stack(paused))[0];
  assert.equal((await h.command('stop', { key: h.current })).accepted, true);
  const changedText = source('c-core').replace('int bias = 3;', 'int bias = 4;') + '\n// validation05 freshly edited source\n';
  const changed = await compile(definition('c-core'), { text: changedText, suffix: '-edited' });
  assert.notEqual(changed.snapshot.sourceHash, artifact('c-core').snapshot.sourceHash);
  assert.notEqual(changed.result.executableRef.sha256, artifact('c-core').result.executableRef.sha256);
  await h.start(changed, definition('c-core'), { initialBreakpoints: [breakpoint(changed, marker(changedText, 'ready'))] });
  const newer = await h.wait(e => e.kind === 'paused'); available(await h.evaluate(newer, 'adjusted'), 19);
  assert.equal((await h.query('scopes', frameKey(paused, oldFrame))).kind, 'error');
  await h.control('continue', newer); const end = await h.wait(e => e.kind === 'terminated');
  assert.equal(end.exitCode, 0); assert.equal(h.output(), definition('c-core').expected.stdout.replace('adjusted=18', 'adjusted=19'));
}));

await check('controlled trap and output flood preserve real termination and permit recovery', async () => session({ worker: true }, async h => {
  await h.start(artifact('runtime-trap'), definition('runtime-trap'));
  const trap = await h.wait(e => e.kind === 'terminated'); assert.equal(trap.reason, 'trap');
  assert.equal(h.output('stderr'), definition('runtime-trap').expected.stderr);
  await h.start(artifact('output-flood'), definition('output-flood'), { limits: { runningTimeMs: 30000, outputBytes: 64, variablePageSize: 32, memoryBytes: 268435456 } });
  const end = await h.wait(e => e.kind === 'terminated'); assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 7);
  assert.ok(h.events.some(e => e.sessionId === h.current.sessionId && e.kind === 'output-truncated'));
  assert.ok(new TextEncoder().encode(h.output()).length <= 64); assert.ok(!h.output().includes('\ufffd'));
  await h.start(artifact('c-core'), definition('c-core'), { stdin: { text: '2\n', encoding: 'utf-8', eof: true } });
  const eof = await h.wait(e => e.kind === 'terminated'); assert.equal(eof.reason, 'exit'); assert.equal(eof.exitCode, 2);
}));

const summary = { schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
  environment: { platform: platform(), release: release(), arch: arch(), node: process.version,
    evidenceScope: 'desktop-node-real-compiler-and-interpreter', ipadTested: false,
    networkDisabled: false, browserTested: false },
  baseline: '59c7080ae44b27c45cb0f94639752b3adbb28649',
  validationRevisionAtStart: revision(root), compilerRevision: revision(compilerRoot), debuggerRevision: revision(debuggerRoot),
  profile: baseCandidate.profile, resources: baseCandidate.resources, results,
  counts: { passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length },
  pending: ['real iPad offline cold start and new-source compile/debug', 'keyboard/mouse/window/App switching',
    'draft recovery and export', 'complete offline resources and upgrades', 'UI filtering of delayed session/frame replies'],
  observations };
lines.push(`1..${results.length}`);
await writeFile(new URL('independent-2026-10-25.json', destination), JSON.stringify(summary, null, 2) + '\n');
await writeFile(new URL('independent-2026-10-25.tap', destination), lines.join('\n') + '\n');
console.log(JSON.stringify(summary.counts));
process.exitCode = summary.counts.failed ? 1 : 0;
