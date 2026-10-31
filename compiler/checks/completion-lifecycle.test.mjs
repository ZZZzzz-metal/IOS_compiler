// Fault injection only; these workers do not establish semantic capability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { CompletionAdapter } from '../src/completion-adapter.mjs';
import { completionResourceIdentity } from '../src/completion-semantics.mjs';
import { createSnapshot } from '../src/source.mjs';
import { completionContext, completionIdentity } from '../src/completion-source.mjs';
const lock = JSON.parse(await readFile(new URL('../resources/toolchain.lock.json', import.meta.url), 'utf8'));
const input = () => ({ requestId: crypto.randomUUID(), documentVersion: 1, language: 'cpp', standard: 'c++17',
  snapshot: createSnapshot([{ path: 'main.cpp', role: 'user', text: 'int main(){ int alpha; al; }' }], 'main.cpp'), sourcePath: 'main.cpp', offset: 24 });
function result(request) {
  return { ...completionIdentity(request), status: 'succeeded', isIncomplete: false, diagnostics: [],
    ...completionResourceIdentity(lock),
    items: [{ id: 'alpha-int', label: 'alpha', insertText: 'alpha', detail: 'int alpha', kind: 'unknown',
      replaceRange: completionContext(request.snapshot.files[0].text, request.offset).replaceRange }] };
}
class FixtureWorker extends EventEmitter {
  constructor(handler = () => {}, release = Promise.resolve()) { super(); this.handler = handler; this.release = release; this.requests = []; }
  postMessage(message) { this.requests.push(message.request); queueMicrotask(() => this.handler(this, message.request)); }
  terminate() { this.terminated = true; return this.release; }
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('completion rejects foreign identities/resources, unsafe ranges, duplicate IDs and snippets', async () => {
  for (const mutate of [
    r => { r.requestId = 'foreign'; }, r => { r.documentVersion++; }, r => { r.sourceHash = 'wrong'; },
    r => { r.snapshotId = 'wrong'; }, r => { r.sourcePath = 'other.cpp'; }, r => { r.offset++; },
    r => { r.compilerResourceHash = 'wrong'; }, r => { r.sysrootResourceHash = 'wrong'; }, r => { r.toolchainId = 'wrong'; },
    r => { r.compilerResourceHash = `sha256:${lock.files.find(f => f.filename === 'clang').sha256}`; },
    r => { r.toolchainId = lock.toolchainId; },
    r => { r.items[0].replaceRange.endOffset = 10000; }, r => { r.items[0].replaceRange.startOffset = 0; },
    r => { r.items.push(structuredClone(r.items[0])); }, r => { r.items[0].insertText = 'alpha(<#x#>)'; },
    r => { r.status = 'failed'; }, r => { r.items[0].kind = 'invented'; },
  ]) {
    const worker = new FixtureWorker((w, request) => { const reply = result(request); mutate(reply); w.emit('message', { kind: 'result', result: reply }); });
    const adapter = new CompletionAdapter({ lock, createWorker: () => worker });
    const reply = await adapter.complete(input());
    assert.equal(reply.status, 'failed'); assert.deepEqual(reply.items, []); assert.equal(worker.terminated, true);
    await adapter.dispose();
  }
});

test('cancel and supersession await actual worker release; old ID cannot kill new work', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const workers = [new FixtureWorker(undefined, gate), new FixtureWorker()];
  let created = 0;
  const adapter = new CompletionAdapter({ lock, createWorker: () => workers[created++] });
  const first = input(), second = input();
  let firstSettled = false, cancelSettled = false;
  const one = adapter.complete(first).then(r => { firstSettled = true; return r; });
  await turn();
  const cancel = adapter.cancel(first.requestId).then(() => { cancelSettled = true; });
  const two = adapter.complete(second);
  await turn();
  assert.equal(workers[0].terminated, true); assert.equal(firstSettled, false); assert.equal(cancelSettled, false); assert.equal(created, 1);
  release(); await cancel; assert.equal((await one).status, 'cancelled'); await turn();
  assert.equal(created, 2);
  workers[0].emit('message', { kind: 'result', result: result(first) });
  await adapter.cancel(first.requestId);
  assert.equal(workers[1].terminated, undefined);
  workers[1].emit('message', { kind: 'result', result: result(second) });
  assert.equal((await two).status, 'succeeded');
  await adapter.cancel(second.requestId); assert.equal(workers[1].terminated, true);
  await adapter.dispose();
});

test('warm worker handles new requests, ignores old duplicates, owns a cloned draft', async () => {
  const worker = new FixtureWorker();
  const adapter = new CompletionAdapter({ lock, createWorker: () => worker });
  const first = input(), frozen = structuredClone(first), one = adapter.complete(first);
  first.snapshot.files[0].text = 'mutated after entry';
  await turn();
  assert.equal(worker.requests[0].snapshot.files[0].text, frozen.snapshot.files[0].text);
  worker.emit('message', { kind: 'result', result: result(frozen) });
  assert.equal((await one).sourceHash, frozen.snapshot.sourceHash);
  const second = input(), two = adapter.complete(second); await turn();
  worker.emit('message', { kind: 'result', result: result(frozen) });
  worker.emit('message', { kind: 'result', result: result(second) });
  assert.equal((await two).status, 'succeeded'); assert.equal(worker.requests.length, 2);
  assert.equal((await adapter.complete(second)).reason, 'invalid-request');
  await adapter.dispose(); assert.equal(worker.terminated, true);
  assert.equal((await adapter.complete(input())).status, 'failed');
});

test('latest complete supersedes active work and timeout releases a hanging worker', async () => {
  const workers = [];
  const adapter = new CompletionAdapter({ lock, timeoutMs: 30, createWorker: () => { const w = new FixtureWorker(); workers.push(w); return w; } });
  const first = input(), one = adapter.complete(first); await turn();
  const second = input(), two = adapter.complete(second);
  assert.equal((await one).reason, 'superseded');
  const timed = await two; assert.equal(timed.reason, 'completion-timeout'); assert.equal(workers.at(-1).terminated, true);
  await adapter.dispose();
});

test('a suppressed comment request releases the preceding idle warm worker', async () => {
  const worker = new FixtureWorker((w, request) => w.emit('message', { kind: 'result', result: result(request) }));
  const adapter = new CompletionAdapter({ lock, createWorker: () => worker });
  await adapter.complete(input());
  const comment = input();
  comment.snapshot = createSnapshot([{ path: 'main.cpp', role: 'user', text: '// comment' }], 'main.cpp');
  comment.offset = 10;
  const reply = await adapter.complete(comment);
  assert.equal(reply.reason, 'suppressed-line-comment'); assert.equal(worker.terminated, true);
  await adapter.dispose();
});

test('a failed worker termination cannot authorize starting a replacement or full compilation', async () => {
  const worker = new FixtureWorker(); worker.terminate = () => Promise.reject(new Error('release failed'));
  let created = 0;
  const adapter = new CompletionAdapter({ lock, createWorker: () => { created++; return worker; } });
  const request = input(), pending = adapter.complete(request); await turn();
  await assert.rejects(adapter.cancel(request.requestId), /release failed/u);
  assert.equal((await pending).reason, 'worker-release-failed');
  assert.equal((await adapter.complete(input())).status, 'failed'); assert.equal(created, 1);
  await assert.rejects(adapter.dispose(), /release failed/u);
});
