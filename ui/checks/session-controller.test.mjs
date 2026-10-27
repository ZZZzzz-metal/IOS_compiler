// Contract/race checks with a fake adapter. These do not claim real execution or iPad validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../src/session-controller.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const sessionKey = { sessionId: 'session-1', buildId: 'build-1', sourceHash: 'sha256:source', compatibilityId: 'candidate-1' };
const startRequest = { ...sessionKey, initialBreakpoints: [] };
function fixture() {
  let listener, counter = 0;
  const commands = [], queries = [], resyncs = [];
  const adapter = {
    subscribe(fn) { listener = fn; return () => { listener = null; }; },
    command(command) { const d = deferred(); commands.push({ ...d, command }); return d.promise; },
    query(query) { const d = deferred(); queries.push({ ...d, query }); return d.promise; },
    resync(request) { const d = deferred(); resyncs.push({ ...d, request }); return d.promise; },
  };
  const controller = new SessionController({ adapter, idFactory: () => 'id-' + ++counter, maxBufferedEvents: 2 });
  const emit = event => listener?.({ ...sessionKey, ...event });
  const accept = index => { const pending = commands[index]; pending.resolve({ commandId: pending.command.commandId, accepted: true, key: sessionKey, acceptedAtEventSeq: 0 }); };
  const answer = (index, data) => { const pending = queries[index]; pending.resolve({ requestId: pending.query.requestId, key: pending.query.key, ...data }); };
  const answerSnapshot = (index, snapshot) => { const pending = resyncs[index]; pending.resolve({ requestId: pending.request.requestId, snapshot: { ...sessionKey, breakpoints: [], outputTail: [], outputTruncated: false, ...snapshot } }); };
  return { controller, commands, queries, resyncs, emit, accept, answer, answerSnapshot };
}
async function started(f) {
  const promise = f.controller.start(startRequest);
  f.emit({ kind: 'state', state: 'starting', eventSeq: 1 });
  f.accept(0); await promise;
}
async function paused(f, { pauseId = 'pause-1', eventSeq = 2 } = {}) {
  f.emit({ kind: 'paused', eventSeq, pauseId, reason: 'breakpoint', position: { sourcePath: 'main.cpp', line: 3, column: 1 } });
  await flush();
}

test('late start ACK cannot replace an already terminated short program', async () => {
  const f = fixture(), pending = f.controller.start(startRequest);
  f.emit({ kind: 'state', state: 'starting', eventSeq: 1 });
  f.emit({ kind: 'terminated', eventSeq: 2, reason: 'exit', exitCode: 0 });
  f.accept(0); await pending;
  assert.equal(f.controller.getView().session.state, 'terminated');
  assert.equal(f.controller.getView().session.eventSeq, 2);
  assert.equal(f.controller.getView().actions.start, true);
  f.controller.dispose();
});

test('resume immediately invalidates pause; stale stack and ACK do not restore it', async () => {
  const f = fixture(); await started(f); await paused(f);
  assert.equal(f.queries[0].query.kind, 'stack');
  const control = f.controller.control('stepOver');
  assert.equal(f.controller.getView().session.pauseId, undefined);
  assert.equal(f.controller.getView().actions.stepOver, false);
  await assert.rejects(f.controller.control('stepOver'));
  await flush();
  f.answer(0, { kind: 'stack', frames: [{ frameId: 'old-frame', functionName: 'old', module: 'main' }], total: 1 });
  f.emit({ kind: 'state', eventSeq: 3, state: 'running' });
  f.emit({ kind: 'paused', eventSeq: 4, pauseId: 'pause-2', reason: 'step' });
  f.accept(1); await control; await flush();
  const v = f.controller.getView();
  assert.equal(v.session.pauseId, 'pause-2');
  assert.equal(v.session.eventSeq, 4);
  assert.deepEqual(v.frames, []);
  assert.equal(f.queries.at(-1).query.key.pauseId, 'pause-2');
  f.controller.dispose();
});

test('stop dispatches while start ACK remains unresolved', async () => {
  const f = fixture();
  const start = f.controller.start(startRequest);
  f.emit({ kind: 'state', eventSeq: 1, state: 'starting' });
  const stop = f.controller.control('stop');
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[1].command.kind, 'stop');
  f.emit({ kind: 'terminated', eventSeq: 2, reason: 'stop' });
  f.accept(1); await stop;
  f.accept(0); await start;
  assert.equal(f.controller.getView().session.termination.reason, 'stop');
  f.controller.dispose();
});

test('foreign sessions and duplicate events cannot overwrite current view', async () => {
  const f = fixture(); await started(f);
  f.emit({ kind: 'output', eventSeq: 2, stream: 'stdout', text: 'new' });
  f.emit({ kind: 'output', eventSeq: 2, stream: 'stdout', text: 'duplicate' });
  f.emit({ kind: 'output', eventSeq: 3, sessionId: 'old-session', stream: 'stdout', text: 'old' });
  assert.equal(f.controller.getView().outputTail.map(p => p.text).join(''), 'new');
  assert.equal(f.resyncs.length, 0);
  f.controller.dispose();
});

test('sequence gap clears pause, then resync replays only newer contiguous events', async () => {
  const f = fixture(); await started(f); await paused(f);
  f.emit({ kind: 'output', eventSeq: 4, stream: 'stdout', text: 'after' });
  assert.equal(f.controller.getView().session.synchronized, false);
  assert.equal(f.controller.getView().session.pauseId, undefined);
  f.emit({ kind: 'terminated', eventSeq: 5, reason: 'exit', exitCode: 0 });
  f.answerSnapshot(0, { state: 'running', eventSeq: 3, outputTail: [{ eventSeq: 3, stream: 'stdout', text: 'before' }] });
  await flush();
  const view = f.controller.getView();
  assert.equal(view.session.state, 'terminated');
  assert.equal(view.session.synchronized, true);
  assert.equal(view.session.eventSeq, 5);
  assert.equal(view.outputTail.map(p => p.text).join(''), 'beforeafter');
  f.controller.dispose();
});

test('resync refuses an older snapshot and keeps inspection disabled', async () => {
  const f = fixture(); await started(f); await paused(f);
  const promise = f.controller.resync();
  f.answerSnapshot(0, { state: 'paused', eventSeq: 1, pause: { pauseId: 'old', reason: 'step' } });
  await assert.rejects(promise, /outdated/);
  assert.equal(f.controller.getView().session.synchronized, false);
  assert.equal(f.controller.getView().actions.inspect, false);
  f.controller.dispose();
});

test('a previous frame variable response cannot replace selected caller data', async () => {
  const f = fixture(); await started(f); await paused(f);
  const frames = [ { frameId: 'callee', functionName: 'helper', module: 'main' }, { frameId: 'caller', functionName: 'main', module: 'main' } ];
  f.answer(0, { kind: 'stack', frames, total: 2 }); await flush();
  f.answer(1, { kind: 'scopes', scopes: [{ name: 'locals', variablesReference: 'callee-locals', expensive: false }] }); await flush();
  assert.equal(f.queries[2].query.kind, 'variables');
  const caller = f.controller.selectFrame('caller'); await flush();
  f.answer(3, { kind: 'scopes', scopes: [{ name: 'locals', variablesReference: 'caller-locals', expensive: false }] }); await flush();
  f.answer(4, { kind: 'variables', variables: [{ name: 'x', type: 'int', availability: 'available', displayValue: '42', truncated: false }], hasMore: false });
  await caller;
  f.answer(2, { kind: 'variables', variables: [{ name: 'x', type: 'int', availability: 'available', displayValue: '999', truncated: false }], hasMore: false }); await flush();
  const v = f.controller.getView();
  assert.equal(v.session.frameId, 'caller');
  assert.equal(v.variables[0].displayValue, '42');
  f.controller.dispose();
});

test('resync buffer overflow requests another authoritative snapshot', async () => {
  const f = fixture(); await started(f);
  f.emit({ kind: 'output', eventSeq: 3, stream: 'stdout', text: '3' });
  f.emit({ kind: 'output', eventSeq: 4, stream: 'stdout', text: '4' });
  f.emit({ kind: 'output', eventSeq: 5, stream: 'stdout', text: '5' });
  f.answerSnapshot(0, { state: 'running', eventSeq: 5 }); await flush();
  assert.equal(f.resyncs.length, 2);
  assert.equal(f.controller.getView().session.synchronized, false);
  f.answerSnapshot(1, { state: 'running', eventSeq: 5 }); await flush();
  assert.equal(f.controller.getView().session.synchronized, true);
  f.controller.dispose();
});

test('scope pagination advertises unread values and appends each page once', async () => {
  const f = fixture(); await started(f); await paused(f);
  f.answer(0, { kind: 'stack', frames: [{ frameId: 'frame-1', functionName: 'main', module: 'main' }], total: 123 }); await flush();
  f.answer(1, { kind: 'scopes', scopes: [{ name: 'locals', variablesReference: 'locals', expensive: false }] }); await flush();
  const variable = name => ({ name, type: 'int', availability: 'available', displayValue: name, truncated: false });
  f.answer(2, { kind: 'variables', variables: [variable('first')], total: 2, hasMore: true }); await flush();
  assert.equal(f.controller.getView().stackTotal, 123);
  assert.equal(f.controller.getView().scopePages[0].hasMore, true);
  const more = f.controller.loadMoreScope('locals');
  const duplicate = await f.controller.loadMoreScope('locals');
  assert.equal(duplicate, null);
  assert.equal(f.queries[3].query.start, 1);
  f.answer(3, { kind: 'variables', variables: [variable('second')], total: 2, hasMore: false }); await more;
  assert.deepEqual(f.controller.getView().variables.map(v => v.name), ['first', 'second']);
  assert.equal(f.controller.getView().scopePages[0].hasMore, false);
  f.controller.dispose();
});

test('a rejected stale query does not display an error on a new pause', async () => {
  const f = fixture(); await started(f); await paused(f);
  const old = f.queries[0];
  const step = f.controller.control('stepInto'); await flush();
  f.emit({ kind: 'paused', eventSeq: 3, pauseId: 'pause-2', reason: 'step' });
  f.accept(1); await step;
  old.reject(new Error('expired old pause')); await flush();
  assert.equal(f.controller.getView().error, null);
  assert.equal(f.controller.getView().session.pauseId, 'pause-2');
  f.controller.dispose();
});

test('output history stays bounded and truncation is explicit', async () => {
  const f = fixture(); await started(f);
  f.emit({ kind: 'output', eventSeq: 2, stream: 'stdout', text: 'x'.repeat(70000) });
  f.emit({ kind: 'output', eventSeq: 3, stream: 'stderr', text: 'retained' });
  assert.equal(f.controller.getView().outputTruncated, true);
  assert.equal(f.controller.getView().outputTail.map(p => p.text).join(''), 'retained');
  f.controller.dispose();
});

test('breakpoint replacements are serialized and actual bindings come from events', async () => {
  const f = fixture(); await started(f);
  const breakpoints = [{ breakpointId: 'b', requested: { sourcePath: 'main.cpp', line: 2, column: 1 }, enabled: true }];
  const first = f.controller.setBreakpoints('main.cpp', breakpoints);
  const second = f.controller.setBreakpoints('main.cpp', []);
  await flush();
  assert.equal(f.commands.length, 2);
  f.emit({ kind: 'breakpoints', eventSeq: 2, bindings: [{ breakpointId: 'b', requested: breakpoints[0].requested, status: 'bound', actual: [{ sourcePath: 'main.cpp', line: 4, column: 1 }] }] });
  f.accept(1); await first; await flush();
  assert.equal(f.commands.length, 3);
  assert.equal(f.controller.getView().breakpoints[0].actual[0].line, 4);
  f.accept(2); await second;
  f.controller.dispose();
});

test('an old rejected ACK cannot invalidate the authoritative resynced pause', async () => {
  const f = fixture(); await started(f); await paused(f);
  const step = f.controller.control('stepOver'); await flush();
  const sync = f.controller.resync();
  f.answerSnapshot(0, { state: 'paused', eventSeq: 4, pause: { pauseId: 'pause-new', reason: 'step' } }); await sync;
  const pending = f.commands[1];
  pending.resolve({ commandId: pending.command.commandId, accepted: false, code: 'stale-context', message: 'old pause expired' }); await step;
  assert.equal(f.controller.getView().session.pauseId, 'pause-new');
  assert.equal(f.controller.getView().session.synchronized, true);
  assert.equal(f.controller.getView().error, null);
  assert.equal(f.resyncs.length, 1);
  f.controller.dispose();
});
