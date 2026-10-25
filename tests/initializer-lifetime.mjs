// New independent coverage; never changes the original 21 checks or old results.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { platform, release } from 'node:os';
import { root, compile, Harness, breakpoint, marker, available, observations, evidenceRoot, provenance,
  baseCandidate, compilerRoot, debuggerRoot, revision } from './lib/harness.mjs';

const startedAt = new Date().toISOString();
const definitions = [
  { id: 'initializer-cycle', source: 'regressions/initializer-cycle.cpp', language: 'cpp', standard: 'c++17', stdin: '', stdout: 'total=81\n' },
  { id: 'initializer-same-line', source: 'regressions/initializer-same-line.cpp', language: 'cpp', standard: 'c++17', stdin: '', stdout: 'total=89\n' },
];
const results = [], artifacts = new Map();
const tap = ['TAP version 13'];
const testInputs = ['tests/initializer-lifetime.mjs', ...definitions.map(item => 'fixtures/' + item.source)];
const inputHashes = await Promise.all(testInputs.map(async path => {
  const bytes = await readFile(new URL(path, root));
  return { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
for (const definition of definitions) {
  const compiled = await compile(definition);
  assert.equal(compiled.result.status, 'compiled', compiled.result.rawDiagnostics);
  assert.equal(compiled.result.smoke.stdout, definition.stdout);
  assert.equal(compiled.result.smoke.exitCode, 0);
  artifacts.set(definition.id, compiled);
}

async function scenario(definition, worker, skipFirstInspection = false) {
  const compiled = artifacts.get(definition.id), text = compiled.snapshot.files[0].text;
  const h = new Harness({ worker });
  const samples = [], failures = [];
  const started = performance.now();
  const recordCheck = (label, action) => {
    try { action(); }
    catch (error) { failures.push({ label, message: error.message, expected: error.expected, actual: error.actual }); }
  };
  const inspect = async (paused, frame, cycle, stage) => {
    const current = await h.evaluate(paused, 'current', frame);
    const again = await h.evaluate(paused, 'current', frame);
    const loopCounter = await h.evaluate(paused, 'cycle', frame);
    const total = await h.evaluate(paused, 'total', frame);
    const sample = { cycle, stage, position: frame.position, pauseId: paused.pauseId,
      frameId: frame.frameId, current, repeatedCurrent: again, loopCounter, total };
    samples.push(sample);
    recordCheck(`${cycle}/${stage}: caller counter`, () => available(loopCounter, cycle));
    recordCheck(`${cycle}/${stage}: completed prior total`, () => available(total, cycle === 0 ? 0 : definition.id === 'initializer-cycle' ? 40 : 44));
    recordCheck(`${cycle}/${stage}: querying twice does not change availability/value`, () => {
      assert.equal(current.availability, again.availability); assert.equal(current.displayValue, again.displayValue);
    });
    if (stage === 'after-store') recordCheck(`${cycle}/${stage}: freshly stored value`, () => available(current, 40 + cycle));
    else recordCheck(`${cycle}/${stage}: old storage is not a current value`, () => {
      assert.notEqual(current.availability, 'available', JSON.stringify(current));
      assert.ok(current.reason, 'An unreadable pending initialization must have a reason');
    });
    if (definition.id === 'initializer-same-line') {
      sample.ready = await h.evaluate(paused, 'ready', frame);
      sample.first = await h.evaluate(paused, 'ready[0]', frame);
      sample.second = await h.evaluate(paused, 'ready[1]', frame);
      recordCheck(`${cycle}/${stage}: earlier same-line vector remains available`, () => {
        available(sample.ready); available(sample.first, 9); available(sample.second, 4);
      });
    }
  };
  try {
    await h.start(compiled, definition, { initialBreakpoints: [breakpoint(compiled, marker(text, 'initializer'))] });
    let after = 0;
    for (let cycle = 0; cycle < 2; ++cycle) {
      const inside = await h.wait(event => event.kind === 'paused' || event.kind === 'terminated', after);
      assert.equal(inside.kind, 'paused'); assert.equal(inside.position.line, marker(text, 'initializer'));
      if (skipFirstInspection && cycle === 0) {
        samples.push({ cycle, stage: 'first-cycle-not-inspected', pauseId: inside.pauseId });
        await h.control('continue', inside); after = inside.eventSeq; continue;
      }
      const frames = await h.stack(inside);
      assert.match(frames[0].functionName, /^derive_value\b/);
      const caller = frames.find(frame => /^main\b/.test(frame.functionName)); assert.ok(caller);
      available(await h.evaluate(inside, 'cycle', frames[0]), cycle);
      await inspect(inside, caller, cycle, 'initializer-callee');
      await h.control('stepOut', inside);
      const returned = await h.wait(event => event.kind === 'paused' || event.kind === 'terminated', inside.eventSeq);
      assert.equal(returned.kind, 'paused'); assert.equal(returned.position.line, marker(text, 'declaration'), 'Must exercise caller continuation before the store');
      const callerAfterReturn = (await h.stack(returned))[0]; assert.match(callerAfterReturn.functionName, /^main\b/);
      await inspect(returned, callerAfterReturn, cycle, 'returned-before-store');
      await h.control('stepOver', returned);
      const stored = await h.wait(event => event.kind === 'paused' || event.kind === 'terminated', returned.eventSeq);
      assert.equal(stored.kind, 'paused'); assert.equal(stored.position.line, marker(text, 'written'));
      await inspect(stored, (await h.stack(stored))[0], cycle, 'after-store');
      await h.control('continue', stored); after = stored.eventSeq;
    }
    const end = await h.wait(event => event.kind === 'terminated' || event.kind === 'error', after);
    assert.equal(end.kind, 'terminated'); assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 0);
    assert.equal(h.output(), definition.stdout); assert.equal(h.output('stderr'), ''); h.ordered();
  } catch (error) { failures.push({ label: 'scenario execution', message: error.message, stack: error.stack }); }
  finally { await h.close(); }
  const result = { name: `${definition.id}/${worker ? 'worker' : 'direct'}/${skipFirstInspection ? 'no-first-cycle-queries' : 'all-stages'}`,
    status: failures.length ? 'failed' : 'passed', durationMs: performance.now() - started, samples, failures };
  results.push(result);
  const line = `${failures.length ? 'not ok' : 'ok'} ${results.length} - ${result.name}`;
  tap.push(line); console.log(line);
  for (const failure of failures) console.log(`  ${failure.label}: ${failure.message}`);
}
for (const definition of definitions) for (const worker of [false, true]) await scenario(definition, worker);
for (const worker of [false, true]) await scenario(definitions[0], worker, true);

const summary = { schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
  environment: { node: process.version, platform: platform(), release: release(), ipadTested: false, browserTested: false, networkDisabled: false },
  validationRevisionAtStart: revision(root), compilerRevision: revision(compilerRoot), debuggerRevision: revision(debuggerRoot),
  provenance: await provenance(), extraInputHashes: inputHashes, profile: baseCandidate.profile, resources: baseCandidate.resources,
  results, counts: { passed: results.filter(item => item.status === 'passed').length, failed: results.filter(item => item.status === 'failed').length },
  note: 'Negative runs retain the same assertions and a nonzero status; expected historical failures are not counted as passes.',
  observations };
tap.push(`1..${results.length}`);
await writeFile(new URL('initializer-lifetime.json', evidenceRoot), JSON.stringify(summary, null, 2) + '\n');
await writeFile(new URL('initializer-lifetime.tap', evidenceRoot), tap.join('\n') + '\n');
console.log(JSON.stringify(summary.counts)); process.exitCode = summary.counts.failed ? 1 : 0;
