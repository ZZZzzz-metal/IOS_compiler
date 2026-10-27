// Independent tests: every execution below uses a real Clang/LLD-produced Wasm.
// No synthetic debugger events or prerecorded execution traces are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DebuggerAdapter } from '../src/debugger-adapter.mjs';
import { createCandidate } from '../scripts/candidate.mjs';

let serial = 0;
const id = prefix => `${prefix}-${++serial}`;
const encoder = new TextEncoder();
const keyOf = value => Object.fromEntries(['sessionId', 'buildId', 'sourceHash', 'compatibilityId'].map(k => [k, value[k]]));
const pauseKey = event => ({ ...keyOf(event), pauseId: event.pauseId });
const frameKey = (event, frame) => ({ ...pauseKey(event), frameId: frame.frameId });
const breakpoint = (line, sourcePath = 'main.cpp') => ({ breakpointId: id('bp'), requested: { sourcePath, line, column: 1 }, enabled: true });

async function bounded(promise, milliseconds = 10000, description = 'operation') {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${description} timed out`)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function harness(t, fixture = 'debug-handoff', options = {}) {
  const candidate = await createCandidate({ fixture });
  const adapter = new DebuggerAdapter({ ...candidate, ...options });
  const events = [];
  const listeners = new Set();
  const unsubscribe = adapter.subscribe(event => {
    events.push(structuredClone(event));
    for (const listener of [...listeners]) listener(event);
  });
  let currentKey;
  let pageSize = 32;
  const waitFor = (predicate, after = 0) => {
    const existing = events.find(event => event.eventSeq > after && predicate(event));
    if (existing) return Promise.resolve(existing);
    return bounded(new Promise(resolve => {
      const listener = event => { if (event.eventSeq > after && predicate(event)) { listeners.delete(listener); resolve(event); } };
      listeners.add(listener);
    }), 20000, 'real debugger event');
  };
  const command = (kind, payload = {}) => adapter.command({ commandId: id(kind), kind, ...payload });
  const start = async (overrides = {}, otherCandidate = candidate) => {
    const request = {
      sessionId: id('session'), buildId: otherCandidate.build.buildId,
      sourceHash: otherCandidate.snapshot.sourceHash, compatibilityId: otherCandidate.profile.compatibilityId,
      build: otherCandidate.build, snapshot: otherCandidate.snapshot, mode: 'debug',
      stdin: { text: '', encoding: 'utf-8', eof: true }, initialBreakpoints: [], stopOnEntry: false,
      limits: { runningTimeMs: 30000, outputBytes: 65536, variablePageSize: 32, memoryBytes: 268435456 },
      ...overrides,
    };
    currentKey = keyOf(request);
    pageSize = request.limits.variablePageSize;
    const ack = await bounded(command('start', { request }), 20000, 'start');
    assert.equal(ack.accepted, true, JSON.stringify(ack));
    return request;
  };
  const query = (kind, key, extra = {}) => adapter.query({ requestId: id(kind), kind, key, ...extra });
  const stack = async event => {
    const frames = [];
    let total;
    do {
      const reply = await query('stack', pauseKey(event), { start: frames.length, count: pageSize });
      assert.equal(reply.kind, 'stack', JSON.stringify(reply));
      assert.ok(reply.frames.length > 0, 'stack pagination makes progress');
      frames.push(...reply.frames); total = reply.total;
    } while (frames.length < total);
    assert.ok(frames.length > 0);
    return frames;
  };
  const locals = async (event, frame) => {
    const key = frameKey(event, frame ?? (await stack(event))[0]);
    const scopes = await query('scopes', key);
    assert.equal(scopes.kind, 'scopes', JSON.stringify(scopes));
    const variables = [];
    for (const scope of scopes.scopes) {
      const reply = await query('variables', key, { variablesReference: scope.variablesReference, start: 0, count: 32 });
      assert.equal(reply.kind, 'variables', JSON.stringify(reply));
      variables.push(...reply.variables);
    }
    return { key, variables, named: Object.fromEntries(variables.map(v => [v.name, v])) };
  };
  const evaluate = async (event, frame, expression) => {
    const reply = await query('evaluate', frameKey(event, frame), { expression, allowSideEffects: false });
    assert.equal(reply.kind, 'evaluate', JSON.stringify(reply));
    return reply.result;
  };
  t.after(async () => {
    if (currentKey) await bounded(command('stop', { key: currentKey }), 2000, 'cleanup stop').catch(() => {});
    adapter.dispose();
    unsubscribe();
    listeners.clear();
  });
  return { candidate, adapter, events, waitFor, command, start, query, stack, locals, evaluate, get key() { return currentKey; } };
}

function assertAvailable(variable, expected) {
  assert.ok(variable, 'variable must exist');
  assert.equal(variable.availability, 'available', JSON.stringify(variable));
  if (expected !== undefined) assert.equal(variable.displayValue, expected);
}

function assertOrdered(events, key) {
  const own = events.filter(event => event.sessionId === key.sessionId);
  own.forEach((event, index) => {
    assert.equal(event.eventSeq, index + 1, 'event sequences are contiguous');
    assert.deepEqual(keyOf(event), keyOf(key));
  });
}

test('real source breakpoints bind before execution and pause at the requested user line', { timeout: 30000 }, async t => {
  const h = await harness(t);
  const requested = [breakpoint(21), breakpoint(999999)];
  await h.start({ initialBreakpoints: requested });
  const paused = await h.waitFor(e => e.kind === 'paused');
  assert.equal(paused.reason, 'breakpoint');
  assert.deepEqual(paused.position, { sourcePath: 'main.cpp', line: 21, column: paused.position.column });
  const bound = h.events.find(e => e.kind === 'breakpoints');
  assert.ok(bound);
  assert.ok(bound.eventSeq < paused.eventSeq);
  const execution = h.events.find(e => e.kind === 'paused' || e.kind === 'state' && e.state === 'running');
  assert.ok(bound.eventSeq < execution.eventSeq, 'initial bindings precede the first execution event');
  assert.equal(bound.bindings[0].status, 'bound');
  assert.deepEqual(bound.bindings[0].requested, requested[0].requested);
  assert.ok(bound.bindings[0].actual.some(p => p.sourcePath === 'main.cpp' && p.line === 21));
  assert.equal(bound.bindings[1].status, 'invalid');
  assert.ok(bound.bindings[1].reason);
  assert.match((await h.stack(paused))[0].functionName, /main/u);
  assertOrdered(h.events, h.key);
});

test('stopOnEntry pauses before the first user statement and breakpoint replacement removes old bindings', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.start({ stopOnEntry: true, initialBreakpoints: [breakpoint(21)] });
  const entry = await h.waitFor(e => e.kind === 'paused');
  assert.equal(entry.reason, 'entry');
  assert.equal(entry.position.sourcePath, 'main.cpp');
  assert.ok(entry.position.line >= 15 && entry.position.line <= 16);
  const replace = await h.command('setBreakpoints', { key: h.key, sourcePath: 'main.cpp', breakpoints: [breakpoint(24)] });
  assert.equal(replace.accepted, true);
  assert.equal((await h.command('continue', { key: pauseKey(entry) })).accepted, true);
  const end = await h.waitFor(e => e.kind === 'paused' || e.kind === 'terminated', entry.eventSeq);
  assert.equal(end.kind, 'paused');
  assert.equal(end.reason, 'breakpoint');
  assert.equal(end.position.line, 24);
  const frame = (await h.stack(end))[0];
  assertAvailable(await h.evaluate(end, frame, 'values[3]'), '19');
});

test('step over executes a real recursive call and exposes its result in the caller', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.start({ initialBreakpoints: [breakpoint(21)] });
  const before = await h.waitFor(e => e.kind === 'paused');
  assert.equal((await h.command('stepOver', { key: pauseKey(before) })).accepted, true);
  const after = await h.waitFor(e => e.kind === 'paused', before.eventSeq);
  assert.equal(after.reason, 'step');
  assert.equal(after.position.line, 22);
  const frames = await h.stack(after);
  assert.match(frames[0].functionName, /main/u);
  const result = await h.evaluate(after, frames[0], 'total');
  assertAvailable(result, '15');
  assert.notEqual(before.pauseId, after.pauseId);
});

test('step into reaches the actual callee and step out returns to its caller', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.start({ initialBreakpoints: [breakpoint(21)] });
  const before = await h.waitFor(e => e.kind === 'paused');
  assert.equal((await h.command('stepInto', { key: pauseKey(before) })).accepted, true);
  const inside = await h.waitFor(e => e.kind === 'paused', before.eventSeq);
  const frames = await h.stack(inside);
  assert.match(frames[0].functionName, /^sum\b/u);
  assert.equal(inside.position.sourcePath, 'main.cpp');
  assert.ok(inside.position.line >= 9 && inside.position.line <= 12);
  assertAvailable(await h.evaluate(inside, frames[0], 'index'), '0');
  assert.equal((await h.command('stepOut', { key: pauseKey(inside) })).accepted, true);
  const outside = await h.waitFor(e => e.kind === 'paused', inside.eventSeq);
  assert.match((await h.stack(outside))[0].functionName, /main/u);
  assert.ok(outside.position.line >= 21 && outside.position.line <= 22);
});

test('recursive stack frames have distinct identities and retain their own local values', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.start({ initialBreakpoints: [breakpoint(11)] });
  let event = await h.waitFor(e => e.kind === 'paused');
  for (let level = 0; level < 3; level++) {
    const frames = await h.stack(event);
    const sums = frames.filter(frame => /^sum\b/u.test(frame.functionName));
    assert.equal(sums.length, level + 1);
    assert.equal(new Set(frames.map(frame => frame.frameId)).size, frames.length);
    for (let index = 0; index < sums.length; index++) {
      assertAvailable(await h.evaluate(event, sums[index], 'index'), String(level - index));
    }
    if (level < 2) {
      assert.equal((await h.command('continue', { key: pauseKey(event) })).accepted, true);
      event = await h.waitFor(e => e.kind === 'paused', event.eventSeq);
    }
  }
});

test('real DWARF variables expose arrays, pointer targets, strings and vector contents', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.start({ initialBreakpoints: [breakpoint(22)] });
  const paused = await h.waitFor(e => e.kind === 'paused');
  const { key, named } = await h.locals(paused);
  assertAvailable(named.total, '15');
  assertAvailable(named.pointer);
  assert.match(named.pointer.displayValue, /0x[0-9a-f]+/iu);
  for (const [name, expected] of [['array', ['2', '4', '6']], ['values', ['3', '5', '7']]]) {
    assertAvailable(named[name]);
    assert.ok(named[name].variablesReference);
    const children = await h.query('variables', key, { variablesReference: named[name].variablesReference, start: 0, count: 10 });
    assert.equal(children.kind, 'variables', JSON.stringify(children));
    assert.deepEqual(children.variables.map(v => v.displayValue), expected);
  }
  assertAvailable(named.shortText);
  assert.ok(named.shortText.displayValue.includes('hello'));
  assertAvailable(named.longText);
  assert.ok(named.longText.displayValue.includes('x'.repeat(80)));
  const frame = (await h.stack(paused))[0];
  for (const [expression, expected] of [['*pointer', '4'], ['total + *pointer * 2', '23'], ['(total + 5) / 2', '10'], ['array[1] + values[2]', '11'], ['*(pointer + 1)', '6']]) {
    assertAvailable(await h.evaluate(paused, frame, expression), expected);
  }
  assert.notEqual((await h.evaluate(paused, frame, 'array[3]')).availability, 'available');
});

test('container mutation, pagination, UTF-8 strings and int64 values come from live memory', { timeout: 30000 }, async t => {
  const h = await harness(t, 'containers');
  await h.start({ initialBreakpoints: [breakpoint(13)], limits: { runningTimeMs: 30000, outputBytes: 1024, variablePageSize: 2, memoryBytes: 268435456 } });
  const paused = await h.waitFor(e => e.kind === 'paused');
  const frames = await h.stack(paused);
  const key = frameKey(paused, frames[0]);
  for (const [expression, expected] of [['big', '9223372036854775806'], ['values[0]', '99'], ['values[2]', '33']]) {
    assertAvailable(await h.evaluate(paused, frames[0], expression), expected);
  }
  const vector = await h.evaluate(paused, frames[0], 'values');
  assertAvailable(vector);
  const first = await h.query('variables', key, { variablesReference: vector.variablesReference, start: 0, count: 2 });
  const last = await h.query('variables', key, { variablesReference: vector.variablesReference, start: 2, count: 2 });
  assert.equal(first.kind, 'variables'); assert.equal(last.kind, 'variables');
  assert.deepEqual(first.variables.map(v => v.displayValue), ['99', '22']);
  assert.equal(first.hasMore, true);
  assert.deepEqual(last.variables.map(v => v.displayValue), ['33']);
  assert.equal(last.hasMore, false);
  for (const expression of ['blank', 'empty', 'shortText', 'longText']) assertAvailable(await h.evaluate(paused, frames[0], expression));
  assert.ok((await h.evaluate(paused, frames[0], 'shortText')).displayValue.includes('中文😀'));
  const invalid = await h.evaluate(paused, frames[0], '*invalid');
  assert.notEqual(invalid.availability, 'available');
  assert.ok(invalid.reason);
});

test('side-effecting watches and foreign frame references fail without changing execution state', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.start({ initialBreakpoints: [breakpoint(22)] });
  const paused = await h.waitFor(e => e.kind === 'paused');
  const frame = (await h.stack(paused))[0];
  for (const expression of ['total++', 'total = 99', 'add(total, 1)']) {
    const reply = await h.query('evaluate', frameKey(paused, frame), { expression, allowSideEffects: false });
    assert.ok(reply.kind === 'error' || reply.kind === 'evaluate' && reply.result.availability !== 'available', JSON.stringify(reply));
  }
  assertAvailable(await h.evaluate(paused, frame, 'total'), '15');
  const reply = await h.query('scopes', { ...frameKey(paused, frame), frameId: 'foreign-frame' });
  assert.equal(reply.kind, 'error');
});

test('accepted controls invalidate all old pause handles and duplicate command IDs never step twice', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.start({ initialBreakpoints: [breakpoint(21)] });
  const paused = await h.waitFor(e => e.kind === 'paused');
  const frames = await h.stack(paused);
  const locals = await h.locals(paused, frames[0]);
  const control = { commandId: id('deduplicated'), kind: 'stepOver', key: pauseKey(paused) };
  const accepted = await h.adapter.command(control);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.invalidatedPauseId, paused.pauseId);
  assert.equal(Object.hasOwn(accepted, 'snapshot'), false);
  assert.equal((await h.query('stack', pauseKey(paused), { start: 0, count: 10 })).kind, 'error');
  const after = await h.waitFor(e => e.kind === 'paused', paused.eventSeq);
  const eventCount = h.events.length;
  assert.deepEqual(await h.adapter.command(control), accepted);
  await delay(10);
  assert.equal(h.events.length, eventCount);
  const oldVariable = locals.variables.find(v => v.variablesReference);
  assert.ok(oldVariable);
  assert.equal((await h.query('variables', locals.key, { variablesReference: oldVariable.variablesReference, start: 0, count: 10 })).kind, 'error');
  assert.equal((await h.command('continue', { key: pauseKey(paused) })).accepted, false);
  assert.equal((await h.command('stop', { key: { ...h.key, sourceHash: 'sha256:foreign' } })).accepted, false);
  const currentFrame = (await h.stack(after))[0];
  const currentLocals = await h.locals(after, currentFrame);
  const currentReference = currentLocals.variables.find(v => v.variablesReference).variablesReference;
  const synced = await h.adapter.resync({ requestId: id('resync'), key: h.key });
  assert.equal(synced.snapshot.state, 'paused');
  assert.equal(synced.snapshot.pause.pauseId, after.pauseId);
  assert.ok(synced.snapshot.eventSeq >= after.eventSeq);
  assert.deepEqual(keyOf(synced.snapshot), h.key);
  assert.equal((await h.query('scopes', currentLocals.key)).kind, 'error', 'resync revokes prior frame lookups');
  await h.stack(after);
  assert.equal((await h.query('variables', currentLocals.key, { variablesReference: currentReference, start: 0, count: 2 })).kind, 'error', 'resync permanently revokes prior variable handles');
  await assert.rejects(h.adapter.resync({ requestId: id('foreign-resync'), key: { ...h.key, buildId: 'foreign-build' } }));
  assertOrdered(h.events, h.key);
});

test('start preflight rejects altered source, component identity and actual resource bytes', { timeout: 30000 }, async t => {
  const candidate = await createCandidate();
  const base = {
    sessionId: id('invalid-start'), buildId: candidate.build.buildId, sourceHash: candidate.snapshot.sourceHash,
    compatibilityId: candidate.profile.compatibilityId, build: candidate.build, snapshot: candidate.snapshot,
    mode: 'debug', stdin: { text: '', encoding: 'utf-8', eof: true }, initialBreakpoints: [], stopOnEntry: true,
    limits: { runningTimeMs: 1000, outputBytes: 1024, variablePageSize: 8, memoryBytes: 268435456 },
  };
  const variants = [
    request => { request.snapshot.files[0].text += '\n// changed after build'; },
    request => { request.build.profile.runtime.version += '-different'; },
    request => { request.sourceHash = 'sha256:foreign'; },
    request => { request.build.executable.relativePath = '../escape.wasm'; },
    request => { request.stdin.eof = false; },
    request => { request.build.debugInfo = []; },
    request => { request.limits.memoryBytes = 65536; },
  ];
  for (const mutate of variants) {
    const adapter = new DebuggerAdapter(candidate);
    const request = structuredClone(base); mutate(request);
    const ack = await adapter.command({ commandId: id('invalid'), kind: 'start', request });
    assert.equal(ack.accepted, false, JSON.stringify(ack));
  }
  const corrupt = new DebuggerAdapter({ ...candidate, readResource: async path => {
    const bytes = (await candidate.readResource(path)).slice();
    if (path === candidate.build.executable.relativePath) bytes[bytes.length - 1] ^= 1;
    return bytes;
  } });
  const ack = await corrupt.command({ commandId: id('corrupt'), kind: 'start', request: structuredClone(base) });
  assert.equal(ack.accepted, false);
});

test('batch stdin and real stdio produce the expected output, with EOF available', { timeout: 30000 }, async t => {
  const h = await harness(t, 'stdio');
  await h.start({ stdin: { text: '2 4 6 8\n', encoding: 'utf-8', eof: true } });
  const terminated = await h.waitFor(e => e.kind === 'terminated');
  assert.equal(terminated.reason, 'exit'); assert.equal(terminated.exitCode, 0);
  assert.equal(h.events.filter(e => e.kind === 'output' && e.stream === 'stdout').map(e => e.text).join(''), 'sum=20 first=2 int64=9223372036854775806\n');
  assertOrdered(h.events, h.key);
  const short = await harness(t, 'stdio');
  await short.start({ stdin: { text: '2 4\n', encoding: 'utf-8', eof: true } });
  const exhausted = await short.waitFor(e => e.kind === 'terminated');
  assert.equal(exhausted.reason, 'exit'); assert.equal(exhausted.exitCode, 2, 'scanf sees EOF instead of blocking');
});

test('ordinary run and debug execute the same real Wasm with the same deterministic result', { timeout: 30000 }, async t => {
  const h = await harness(t, 'stdio');
  await h.start({ mode: 'run', build: { ...h.candidate.build, mode: 'run' }, stdin: { text: '1 2 3 4\n', encoding: 'utf-8', eof: true } });
  const end = await h.waitFor(e => e.kind === 'terminated');
  const result = stream => h.events.filter(e => e.kind === 'output' && e.stream === stream && e.sessionId === h.key.sessionId).map(e => e.text).join('');
  const ordinary = { stdout: result('stdout'), stderr: result('stderr'), exitCode: end.exitCode };
  assert.equal(end.reason, 'exit');
  assert.equal(end.exitCode, h.candidate.evidence.smoke.exitCode);
  assert.equal(ordinary.stdout, h.candidate.evidence.smoke.stdout);
  assert.equal(ordinary.stderr, h.candidate.evidence.smoke.stderr);
  assert.equal(h.events.some(e => e.kind === 'paused'), false);
  await h.start({ stdin: { text: '1 2 3 4\n', encoding: 'utf-8', eof: true } });
  const debugEnd = await h.waitFor(e => e.kind === 'terminated' && e.sessionId === h.key.sessionId);
  assert.deepEqual({ stdout: result('stdout'), stderr: result('stderr'), exitCode: debugEnd.exitCode }, ordinary);
});

test('output is bounded and truncated explicitly while exit status survives', { timeout: 30000 }, async t => {
  const h = await harness(t, 'output-flood');
  await h.start({ limits: { runningTimeMs: 30000, outputBytes: 8, variablePageSize: 8, memoryBytes: 268435456 } });
  const end = await h.waitFor(e => e.kind === 'terminated');
  assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 7);
  const output = h.events.filter(e => e.kind === 'output').map(e => e.text).join('');
  assert.ok(encoder.encode(output).byteLength <= 8);
  assert.equal(output.includes('\uFFFD'), false, 'a byte cap must not produce replacement characters');
  assert.equal(output, '中文', 'the partial four-byte emoji is dropped at the eight-byte cap');
  assert.ok(h.events.some(e => e.kind === 'output-truncated' && e.droppedBytes > 0));
  const synced = await h.adapter.resync({ requestId: id('tail'), key: h.key });
  assert.equal(synced.snapshot.outputTruncated, true);
  assert.equal(synced.snapshot.termination.exitCode, 7);
  assertOrdered(h.events, h.key);
});

test('stop cancels a pending resource read and late bytes cannot start the cancelled session', { timeout: 30000 }, async t => {
  const candidate = await createCandidate();
  let release, didEnter, first = true;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { didEnter = resolve; });
  const adapter = new DebuggerAdapter({ ...candidate, readResource: async path => {
    if (first) { first = false; didEnter(); await gate; }
    return candidate.readResource(path);
  } });
  const events = [];
  const unsubscribe = adapter.subscribe(event => events.push(event));
  t.after(() => { release(); unsubscribe(); });
  const request = {
    sessionId: id('starting-session'), buildId: candidate.build.buildId, sourceHash: candidate.snapshot.sourceHash,
    compatibilityId: candidate.profile.compatibilityId, build: candidate.build, snapshot: candidate.snapshot,
    mode: 'debug', stdin: { text: '', encoding: 'utf-8', eof: true }, initialBreakpoints: [], stopOnEntry: true,
    limits: { runningTimeMs: 1000, outputBytes: 1024, variablePageSize: 8, memoryBytes: 268435456 },
  };
  const pending = adapter.command({ commandId: id('pending-start'), kind: 'start', request });
  await bounded(entered, 2000, 'resource reader entry');
  const stop = await bounded(adapter.command({ commandId: id('cancel-start'), kind: 'stop', key: keyOf(request) }), 1000, 'cancel starting');
  assert.equal(stop.accepted, true);
  release();
  assert.equal((await bounded(pending, 2000, 'cancelled start ack')).accepted, false);
  await delay(20);
  assert.equal(events.some(e => e.kind === 'paused' || e.kind === 'state' && e.state === 'running'), false);
  assert.equal(events.filter(e => e.kind === 'terminated' && e.reason === 'stop').length, 1);
});

test('a stale stop cannot cancel another build while its resource verification is pending', { timeout: 30000 }, async t => {
  const candidate = await createCandidate();
  let release, didEnter, first = true;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { didEnter = resolve; });
  const adapter = new DebuggerAdapter({ ...candidate, readResource: async path => {
    if (first) { first = false; didEnter(); await gate; }
    return candidate.readResource(path);
  } });
  t.after(() => { release(); adapter.dispose(); });
  const request = {
    sessionId: id('verified-session'), buildId: candidate.build.buildId, sourceHash: candidate.snapshot.sourceHash,
    compatibilityId: candidate.profile.compatibilityId, build: candidate.build, snapshot: candidate.snapshot,
    mode: 'debug', stdin: { text: '', encoding: 'utf-8', eof: true }, initialBreakpoints: [], stopOnEntry: true,
    limits: { runningTimeMs: 1000, outputBytes: 1024, variablePageSize: 8, memoryBytes: 268435456 },
  };
  const pending = adapter.command({ commandId: id('valid-start'), kind: 'start', request });
  await bounded(entered, 2000, 'resource reader entry');
  const stale = adapter.command({ commandId: id('stale-stop'), kind: 'stop', key: { ...keyOf(request), sourceHash: 'sha256:old-source' } });
  release();
  assert.equal((await bounded(pending, 2000, 'valid start')).accepted, true);
  assert.equal((await bounded(stale, 2000, 'stale stop ack')).accepted, false);
  const synced = await adapter.resync({ requestId: id('live-session'), key: keyOf(request) });
  assert.ok(['running', 'paused'].includes(synced.snapshot.state));
});

test('a real unreachable instruction is reported as a trap, distinct from normal exit', { timeout: 30000 }, async t => {
  const h = await harness(t, 'trap');
  await h.start();
  const end = await h.waitFor(e => e.kind === 'terminated');
  assert.equal(end.reason, 'trap');
  assert.ok(end.message);
  const stderr = h.events.filter(e => e.kind === 'output' && e.stream === 'stderr');
  assert.equal(stderr.map(e => e.text).join(''), 'before-trap\n');
  assert.ok(stderr.every(e => e.eventSeq < end.eventSeq), 'real stderr is delivered before the trap terminal event');
});

test('an executing infinite loop can be stopped and a new real session started', { timeout: 30000 }, async t => {
  const h = await harness(t, 'infinite', { sliceInstructions: 1000 });
  await h.start();
  await h.waitFor(e => e.kind === 'state' && e.state === 'running');
  await delay(20); // UI/event-loop work must get a turn while real Wasm is looping.
  const oldKey = h.key;
  assert.equal((await bounded(h.command('stop', { key: oldKey }), 1000, 'stop infinite loop')).accepted, true);
  const stopped = await h.waitFor(e => e.kind === 'terminated');
  assert.equal(stopped.reason, 'stop');
  assert.equal((await h.command('stop', { key: oldKey })).accepted, true, 'stop is idempotent');
  const next = await createCandidate();
  assert.equal(next.profile.compatibilityId, h.candidate.profile.compatibilityId);
  await h.start({ stopOnEntry: true }, next);
  const paused = await h.waitFor(e => e.sessionId === h.key.sessionId && e.kind === 'paused');
  assert.notEqual(paused.sessionId, oldKey.sessionId);
  assert.equal((await h.query('stack', { ...oldKey, pauseId: 'old-pause' }, { start: 0, count: 10 })).kind, 'error');
  assert.equal((await h.command('continue', { key: pauseKey(paused) })).accepted, true);
  const exit = await h.waitFor(e => e.sessionId === h.key.sessionId && e.kind === 'terminated');
  assert.equal(exit.reason, 'exit'); assert.equal(exit.exitCode, 0);
});

test('runtime timeout terminates real computation while human pause time is excluded', { timeout: 30000 }, async t => {
  let wallTime = 0;
  const h = await harness(t, 'debug-handoff', { now: () => wallTime });
  await h.start({ initialBreakpoints: [breakpoint(21)], limits: { runningTimeMs: 10, outputBytes: 1024, variablePageSize: 8, memoryBytes: 268435456 } });
  const paused = await h.waitFor(e => e.kind === 'paused');
  wallTime += 1000000;
  assert.equal((await h.command('continue', { key: pauseKey(paused) })).accepted, true);
  const end = await h.waitFor(e => e.kind === 'terminated');
  assert.equal(end.reason, 'exit'); assert.equal(end.exitCode, 0);
  let activeTime = 0;
  const loop = await harness(t, 'infinite', { now: () => ++activeTime, sliceInstructions: 100 });
  await loop.start({ limits: { runningTimeMs: 3, outputBytes: 1024, variablePageSize: 8, memoryBytes: 268435456 } });
  assert.equal((await loop.waitFor(e => e.kind === 'terminated')).reason, 'resource-limit');
});

test('backgrounding terminates real computation and never resumes it on its own', { timeout: 30000 }, async t => {
  const h = await harness(t, 'infinite', { sliceInstructions: 1000 });
  await h.start();
  await h.waitFor(e => e.kind === 'state' && e.state === 'running');
  await delay(10);
  await h.adapter.background();
  const end = await h.waitFor(e => e.kind === 'terminated');
  assert.equal(end.reason, 'background');
  const count = h.events.length;
  await delay(20);
  assert.equal(h.events.length, count);
  const snapshot = await h.adapter.resync({ requestId: id('background'), key: h.key });
  assert.equal(snapshot.snapshot.state, 'terminated');
  assert.equal(snapshot.snapshot.termination.reason, 'background');
});
