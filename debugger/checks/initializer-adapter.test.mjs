// Fresh CompilerProbe (through CompilerAdapter) -> Wasm -> real pause transport.
// PCs, stores and stack frames are never assigned or fabricated by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createIntegrationCandidate } from '../../app/integration/candidate.mjs';
import { createNodeHost, keyOf, pauseKey, frameKey, bounded, breakpoint } from '../../app/integration/node-host.mjs';
import { DebuggerAdapter } from '../src/debugger-adapter.mjs';
import { AT, TAG } from '../src/dwarf.mjs';

const original = [
  'int seed(int n) {',
  '  return n + 10;',
  '}',
  'int main() {',
  '  int total = 0;',
  '  for (int i = 0; i < 2; ++i) {',
  '    int x = seed(i);',
  '    total += x;',
  '  }',
  '  return total;',
  '}',
  '',
].join('\n');
const shadowed = [
  'int seed(int n) {',
  '  return n + 10;',
  '}',
  'int main() {',
  '  int x = 99;',
  '  int total = 0;',
  '  for (int i = 0; i < 2; ++i) {',
  '    int x = seed(i);',
  '    total += x;',
  '  }',
  '  return total + x - 99;',
  '}',
  '',
].join('\n');

async function exercise(t, source, { name, initializerLine, bodyLine, exitLine, outer = false }) {
  const candidate = await createIntegrationCandidate();
  const host = createNodeHost(candidate);
  const compiled = await host.compile({ text: source });
  assert.ok(WebAssembly.validate(compiled.bytes));
  const adapter = new DebuggerAdapter({ ...candidate, readResource: async path =>
    host.artifacts.has(path) ? host.artifacts.get(path).slice() : candidate.readResource(path), sliceInstructions: 1000 });
  const events = [], listeners = new Set(), observations = [], failures = [];
  const unsubscribe = adapter.subscribe(event => {
    events.push(event);
    for (const listener of [...listeners]) listener(event);
  });
  const request = {
    sessionId: crypto.randomUUID(), buildId: compiled.result.build.buildId,
    sourceHash: compiled.snapshot.sourceHash, compatibilityId: candidate.profile.compatibilityId,
    build: compiled.result.build, snapshot: compiled.snapshot, mode: 'debug',
    stdin: { text: '', encoding: 'utf-8', eof: true }, initialBreakpoints: [breakpoint(2, 'main.cpp')], stopOnEntry: false,
    limits: { runningTimeMs: 30000, outputBytes: 1024, variablePageSize: 128, memoryBytes: 268435456 },
  };
  t.after(() => { adapter.dispose(); unsubscribe(); listeners.clear(); });
  const command = (kind, payload) => bounded(adapter.command({ commandId: crypto.randomUUID(), kind, ...payload }), kind);
  const query = (kind, key, extra = {}) => bounded(adapter.query({ requestId: crypto.randomUUID(), kind, key, ...extra }), kind);
  const waitFor = async (predicate, after = 0) => {
    const inspect = event => event.eventSeq > after && predicate(event);
    const old = events.find(inspect);
    if (old) return old;
    let listener;
    try {
      return await bounded(new Promise((resolve, reject) => {
        listener = event => {
          if (event.eventSeq <= after) return;
          if (inspect(event)) resolve(event);
          else if (event.kind === 'terminated' || event.kind === 'error' && event.fatal)
            reject(new Error(`Unexpected terminal event: ${JSON.stringify(event)}`));
        };
        listeners.add(listener);
      }), 'actual source stop');
    } finally { listeners.delete(listener); }
  };
  const stack = async paused => {
    const reply = await query('stack', pauseKey(paused), { start: 0, count: 32 });
    assert.equal(reply.kind, 'stack', JSON.stringify(reply));
    return reply.frames;
  };
  const evaluate = async (paused, frame, expression) => {
    const reply = await query('evaluate', frameKey(paused, frame), { expression, allowSideEffects: false });
    assert.equal(reply.kind, 'evaluate', JSON.stringify(reply)); return reply.result;
  };
  const locals = async (paused, frame) => {
    const key = frameKey(paused, frame), scopes = await query('scopes', key);
    assert.equal(scopes.kind, 'scopes');
    const variables = [];
    for (const scope of scopes.scopes) {
      const reply = await query('variables', key, { variablesReference: scope.variablesReference, start: 0, count: 128 });
      assert.equal(reply.kind, 'variables'); variables.push(...reply.variables);
    }
    return variables;
  };
  const step = async (kind, paused) => {
    assert.equal((await command(kind, { key: pauseKey(paused) })).accepted, true);
    return waitFor(event => event.kind === 'paused', paused.eventSeq);
  };
  const check = (label, fn) => { try { fn(); } catch (error) { failures.push({ label, message: error.message }); } };
  const storage = frame => {
    // Read-only cross-check: DWARF locates the real slot; machine bytes remain
    // unchanged while the pending lifetime must be hidden by query responses.
    const session = adapter.sessions.get(request.sessionId), actual = session.frames.get(frame.frameId);
    const depth = item => { let count = 0; for (let scope = item.die.parent; scope && scope !== item.function; scope = scope.parent) if ([TAG.lexical, TAG.inline].includes(scope.tag)) count++; return count; };
    const info = session.symbols.variables(actual.pc).filter(item => item.inScope && session.symbols.attr(item.die, AT.name) === 'x').sort((a, b) => depth(b) - depth(a))[0];
    assert.ok(info);
    const location = session.inspector._expression(session.symbols.locationExpression(info.die, AT.location, actual.pc), actual, info.function);
    assert.equal(location.kind, 'memory');
    const address = Number(location.value), bytes = [...session.runtime.memory.subarray(address, address + 4)];
    return { address, bytes, signedValue: new DataView(session.runtime.memory.buffer, address, 4).getInt32(0, true),
      pc: actual.pc, callPC: actual.callPC, lastPC: actual.lastPC, executedInstructions: session.runtime.instructionsExecuted };
  };
  const inspectX = async (stage, paused, frame, iteration, expected) => {
    // Repeated evaluate/scopes requests cannot themselves initialize or reset x.
    for (let repetition = 0; repetition < 3; repetition++) {
      const x = await evaluate(paused, frame, 'x');
      const localX = (await locals(paused, frame)).filter(value => value.name === 'x');
      const index = await evaluate(paused, frame, 'i');
      const machine = storage(frame);
      observations.push({ stage, iteration, repetition, pauseId: paused.pauseId, frameId: frame.frameId,
        position: frame.position, index, x, localX, machine });
      assert.equal(index.availability, 'available', JSON.stringify(index));
      assert.equal(index.displayValue, String(iteration));
      if (expected !== undefined) assert.equal(machine.signedValue, expected, 'visible x agrees with the actual stored machine value');
      else if (iteration === 1) assert.equal(machine.signedValue, 10, 'old bytes remain physically present while hidden from the pending new lifetime');
      check(`${stage}, iteration ${iteration}, query ${repetition}: nearest x`, () => {
        if (expected === undefined) {
          assert.notEqual(x.availability, 'available', `unfinished new lifetime must not expose prior x: ${JSON.stringify(x)}`);
          assert.ok(x.reason, 'unavailable x explains why');
          assert.ok(localX.some(value => value.availability !== 'available'), 'scope lookup also withholds unfinished x');
        } else {
          assert.equal(x.availability, 'available', JSON.stringify(x));
          assert.equal(x.displayValue, String(expected));
          assert.ok(localX.some(value => value.availability === 'available' && value.displayValue === String(expected)));
        }
        if (outer) assert.ok(localX.some(value => value.availability === 'available' && value.displayValue === '99'), 'outer x remains intact while inner x controls expression lookup');
      });
    }
  };

  assert.equal((await command('start', { request })).accepted, true);
  let paused = await waitFor(event => event.kind === 'paused');
  const callerIDs = [], calleeIDs = [];
  for (let iteration = 0; iteration < 2; iteration++) {
    assert.equal(paused.reason, 'breakpoint'); assert.equal(paused.position.line, 2);
    const frames = await stack(paused);
    assert.equal(frames[0].functionName, 'seed'); assert.equal(frames[1].functionName, 'main');
    calleeIDs.push(frames[0].frameId); callerIDs.push(frames[1].frameId);
    assert.equal((await evaluate(paused, frames[0], 'n')).displayValue, String(iteration));
    assert.equal(frames[1].position.line, initializerLine);
    const active = adapter.sessions.get(request.sessionId), actualCallee = active.runtime.frames.at(-1), actualCaller = active.runtime.frames.at(-2);
    const call = active.runtime.functions[actualCaller.funcIndex].instructions.get(actualCaller.callPC);
    assert.equal(call.op, 0x10); assert.equal(call.index, actualCallee.funcIndex);
    assert.equal(call.nextPC, actualCaller.pc, 'suspended caller is at the real call continuation');
    const beforeStore = storage(frames[1]);
    await inspectX('callee-before-initializer-store', paused, frames[1], iteration);
    paused = await step('stepOut', paused);
    assert.equal(paused.reason, 'step'); assert.equal(paused.position.line, initializerLine);
    const caller = (await stack(paused))[0];
    assert.equal(caller.functionName, 'main');
    assert.equal(storage(caller).pc, beforeStore.pc, 'stepOut stops at the actual continuation before its following store');
    assert.deepEqual(storage(caller).bytes, beforeStore.bytes, 'returning alone has not stored the new initializer value');
    await inspectX('returned-before-initializer-store', paused, caller, iteration);
    paused = await step('stepOver', paused);
    assert.equal(paused.reason, 'step'); assert.equal(paused.position.line, bodyLine);
    await inspectX('body-after-actual-initializer-store', paused, (await stack(paused))[0], iteration, 10 + iteration);
    if (iteration === 0) {
      assert.equal((await command('continue', { key: pauseKey(paused) })).accepted, true);
      paused = await waitFor(event => event.kind === 'paused', paused.eventSeq);
    }
  }
  assert.notEqual(calleeIDs[0], calleeIDs[1], 'each call/pause has a distinct frame identity');
  assert.notEqual(callerIDs[0], callerIDs[1], 'pause-bound caller handles are fresh');
  if (outer) {
    assert.equal((await command('setBreakpoints', { key: keyOf(request), sourcePath: 'main.cpp', breakpoints: [breakpoint(exitLine, 'main.cpp')] })).accepted, true);
    assert.equal((await command('continue', { key: pauseKey(paused) })).accepted, true);
    paused = await waitFor(event => event.kind === 'paused', paused.eventSeq);
    assert.equal(paused.position.line, exitLine);
    const outerX = await evaluate(paused, (await stack(paused))[0], 'x');
    assert.equal(outerX.availability, 'available'); assert.equal(outerX.displayValue, '99');
    observations.push({ stage: 'outer-after-inner-scope-exit', x: outerX });
  }
  assert.equal((await command('continue', { key: pauseKey(paused) })).accepted, true);
  const end = await waitFor(event => event.kind === 'terminated', paused.eventSeq);
  assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 21);
  events.forEach((event, index) => { assert.equal(event.eventSeq, index + 1); assert.deepEqual(keyOf(event), keyOf(request)); });
  t.diagnostic(JSON.stringify({ name, sourceHash: compiled.snapshot.sourceHash, artifactSHA256: compiled.result.build.executable.sha256,
    observations: observations.length, failureCount: failures.length, exitCode: end.exitCode }));
  if (process.env.INITIALIZER_TEST_EVIDENCE) {
    assert.match(process.env.INITIALIZER_TEST_EVIDENCE, /^[a-z0-9-]{1,64}$/u);
    const directory = new URL('../../.local/initializer-fix/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL(`${name}-${process.env.INITIALIZER_TEST_EVIDENCE}.json`, directory), JSON.stringify({
      kind: 'fresh-compiler-to-debugger-initializer-regression', source, sourceHash: compiled.snapshot.sourceHash,
      artifactSHA256: compiled.result.build.executable.sha256, compilerArguments: compiled.result.build.compilerArguments,
      linkerArguments: compiled.result.build.linkerArguments, observations, failures, events,
    }, null, 2) + '\n');
  }
  assert.deepEqual(failures, [], 'an initializer must not expose a previous dynamic lifetime or a shadowed outer x');
}

test('fresh loop initializer withholds previous iteration x until its real new store', { timeout: 180000 }, async t => {
  await exercise(t, original, { name: 'loop-initializer', initializerLine: 7, bodyLine: 8, exitLine: 10 });
});

test('fresh inner initializer never falls back to outer x and restores it after lexical exit', { timeout: 180000 }, async t => {
  await exercise(t, shadowed, { name: 'shadow-initializer', initializerLine: 8, bodyLine: 9, exitLine: 11, outer: true });
});

test('real Node Worker transport preserves initializer lifetime through caller queries and all steps', { timeout: 180000 }, async t => {
  const candidate = await createIntegrationCandidate(), host = createNodeHost(candidate);
  const compiled = await host.compile({ text: original });
  const session = await host.debug(compiled, { initialBreakpoints: [breakpoint(2, 'main.cpp')] });
  t.after(() => session.close());
  const observations = [];
  const inspect = async (stage, paused, frame, iteration, expected) => {
    for (let repetition = 0; repetition < 3; repetition++) {
      const x = await session.evaluate(paused, frame, 'x');
      const index = await session.evaluate(paused, frame, 'i');
      const key = frameKey(paused, frame), scopes = await session.query('scopes', key);
      assert.equal(scopes.kind, 'scopes');
      const localX = [];
      for (const scope of scopes.scopes) {
        const reply = await session.query('variables', key, { variablesReference: scope.variablesReference, start: 0, count: 32 });
        assert.equal(reply.kind, 'variables'); localX.push(...reply.variables.filter(value => value.name === 'x'));
      }
      observations.push({ stage, iteration, repetition, pauseId: paused.pauseId, frameId: frame.frameId, x, index, localX });
      assert.equal(index.availability, 'available'); assert.equal(index.displayValue, String(iteration));
      if (expected === undefined) {
        assert.notEqual(x.availability, 'available', JSON.stringify(x));
        assert.ok(x.reason); assert.equal(localX.length, 1); assert.notEqual(localX[0].availability, 'available');
      } else {
        assert.equal(x.availability, 'available'); assert.equal(x.displayValue, String(expected));
        assert.ok(localX.some(value => value.availability === 'available' && value.displayValue === String(expected)));
      }
    }
  };
  let paused = await session.waitFor(event => event.kind === 'paused');
  for (let iteration = 0; iteration < 2; iteration++) {
    assert.equal(paused.reason, 'breakpoint'); assert.equal(paused.position.line, 2);
    const frames = await session.stack(paused);
    assert.equal(frames[0].functionName, 'seed'); assert.equal(frames[1].functionName, 'main');
    assert.equal(frames[1].position.line, 7);
    await inspect('worker-callee-before-store', paused, frames[1], iteration);
    paused = await session.step('stepOut', paused);
    assert.equal(paused.reason, 'step'); assert.equal(paused.position.line, 7);
    await inspect('worker-returned-before-store', paused, (await session.stack(paused))[0], iteration);
    paused = await session.step('stepOver', paused);
    assert.equal(paused.reason, 'step'); assert.equal(paused.position.line, 8);
    await inspect('worker-body-after-store', paused, (await session.stack(paused))[0], iteration, 10 + iteration);
    if (iteration === 0) paused = await session.step('continue', paused);
  }
  assert.equal((await session.command('continue', { key: pauseKey(paused) })).accepted, true);
  const end = await session.waitFor(event => event.kind === 'terminated', paused.eventSeq);
  assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 21); session.assertEvents();
  t.diagnostic(JSON.stringify({ name: 'worker-loop-initializer', sourceHash: compiled.snapshot.sourceHash,
    artifactSHA256: compiled.result.build.executable.sha256, observations: observations.length, exitCode: end.exitCode }));
  if (process.env.INITIALIZER_TEST_EVIDENCE) {
    assert.match(process.env.INITIALIZER_TEST_EVIDENCE, /^[a-z0-9-]{1,64}$/u);
    const directory = new URL('../../.local/initializer-fix/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL(`worker-loop-initializer-${process.env.INITIALIZER_TEST_EVIDENCE}.json`, directory), JSON.stringify({
      kind: 'fresh-compiler-to-real-node-worker-initializer-regression', source: original, sourceHash: compiled.snapshot.sourceHash,
      artifactSHA256: compiled.result.build.executable.sha256, observations, events: session.events,
    }, null, 2) + '\n');
  }
});

test('a later call on the same source line does not hide an already constructed vector', { timeout: 180000 }, async t => {
  const source = '#include <vector>\nint seed(int n) {\n return n + 10;\n}\nint main() {\n std::vector<int> values = {1,2}; int x = seed(0);\n return values[0] + x;\n}\n';
  const host = createNodeHost(await createIntegrationCandidate()), compiled = await host.compile({ text: source });
  const session = await host.debug(compiled, { initialBreakpoints: [breakpoint(3, 'main.cpp')] });
  t.after(() => session.close());
  const paused = await session.waitFor(event => event.kind === 'paused');
  assert.equal(paused.reason, 'breakpoint'); assert.equal(paused.position.line, 3);
  const frames = await session.stack(paused);
  assert.equal(frames[0].functionName, 'seed'); assert.equal(frames[1].functionName, 'main');
  assert.equal(frames[1].position.line, 6);
  for (let repetition = 0; repetition < 3; repetition++) {
    const values = await session.evaluate(paused, frames[1], 'values');
    assert.equal(values.availability, 'available', 'a completed constructor cannot be confused with a later initializer sharing its source line');
    assert.ok(values.variablesReference);
    const children = await session.query('variables', frameKey(paused, frames[1]), { variablesReference: values.variablesReference, start: 0, count: 32 });
    assert.equal(children.kind, 'variables'); assert.deepEqual(children.variables.map(value => value.displayValue), ['1', '2']);
    const x = await session.evaluate(paused, frames[1], 'x');
    assert.notEqual(x.availability, 'available', 'the scalar initializer that is actually running remains unfinished');
  }
  assert.equal((await session.command('continue', { key: pauseKey(paused) })).accepted, true);
  const end = await session.waitFor(event => event.kind === 'terminated', paused.eventSeq);
  assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 11); session.assertEvents();
  t.diagnostic(JSON.stringify({ name: 'same-line-completed-vector', sourceHash: compiled.snapshot.sourceHash,
    artifactSHA256: compiled.result.build.executable.sha256, exitCode: end.exitCode }));
});
