// Actual production engine/Worker adapter checks. Each run preserves new evidence.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { CompletionAdapter } from '../../src/completion-adapter.mjs';
import { loadCompletionToolchain, completeWithClang } from '../../src/completion-engine.mjs';
import { createSnapshot, hashBytes } from '../../src/source.mjs';
const root = new URL('../../../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', root), 'utf8'));
const dir = new URL(`compiler/evidence/completion-2026-10-29/provider/${new Date().toISOString().replace(/[:.]/gu, '-')}-${crypto.randomUUID().slice(0, 8)}/`, root);
await mkdir(dir, { recursive: true });
const json = (path, value) => writeFile(new URL(path, dir), JSON.stringify(value, null, 2) + '\n');
const resourceReads = [], toolchain = await loadCompletionToolchain(lock, path => { resourceReads.push(path); return readFile(new URL(`compiler/resources/${path}`, root)); });
function input(marked, language = 'cpp', files) {
  const offset = marked.indexOf('@'), text = marked.replace('@', ''), sourcePath = files ? 'user.inc' : language === 'cpp' ? 'main.cpp' : 'main.c';
  return { requestId: crypto.randomUUID(), documentVersion: 1, language, standard: language === 'cpp' ? 'c++17' : 'c11',
    snapshot: createSnapshot([{ path: sourcePath, role: 'user', text }, ...(files ?? [])], files ? 'driver.cpp' : sourcePath), sourcePath, offset };
}
const cases = [
  ['locals-functions', 'int alphaFunction(int x); void f(){int alphaLocal=0; al@;}', ['alphaLocal', 'alphaFunction']],
  ['struct-dot', 'struct Node{int value; void change(int n);}; void f(){Node n; n.@;}', ['value', 'change']],
  ['pointer-arrow', 'struct Node{int value;}; void f(){Node* p; p->@;}', ['value']],
  ['private-outside', 'class Box{int hidden; public:int visible;}; void f(){Box b; b.@;}', ['visible'], ['hidden']],
  ['private-inside', 'class Box{int hidden; public:void f(){this->@;}};', ['hidden']],
  ['protected-outside', 'struct Base{protected:int secret; public:int visible;}; struct Child:Base{}; void f(){Child b; b.@;}', ['visible'], ['secret']],
  ['protected-inside', 'struct Base{protected:int secret;}; struct Child:Base{void f(){this->@;}};', ['secret']],
  ['namespace', 'namespace algo{int count; int compute(int); struct Thing{};} void f(){algo::@;}', ['count', 'compute', 'Thing']],
  ['class-scope', 'struct Node{static int count; static int compute(int);}; void f(){Node::@;}', ['count', 'compute']],
  ['vector', '#include <vector>\nvoid f(){std::vector<int> v; v.pu@;}', ['push_back']],
  ['string', '#include <string>\nvoid f(){std::string s; s.sub@;}', ['substr']],
  ['shadowing', 'double sample; void f(){int sample; sam@;}', ['sample']],
  ['shadowed-receiver', 'struct Node{int value;}; void f(){Node n; {int n; n.@;}}', [], ['value']],
  ['unfinished', 'struct Node{int value;}; void f(){Node n; if(true){n.@', ['value']],
  ['error-before', 'void f(){UnknownType x; int alpha; al@', ['alpha']],
  ['unicode', 'int alphaFunction();\nvoid f(){const char* s="中文😀"; int alphaLocal; al@;}', ['alphaFunction', 'alphaLocal']],
  ['driver-user', 'int f(){std::vector<int> v; v.pu@; return 0;}', ['push_back'], [], 'cpp', [{ path: 'driver.cpp', role: 'driver', text: '#include <vector>\n#include "user.inc"\nint main(){return f();}' }]],
  ['c11', 'int alphaFunction(int n); void f(void){int alphaLocal; al@;}', ['alphaFunction', 'alphaLocal'], [], 'c'],
  ['overloads', 'int alpha(int); double alpha(double); void f(){al@;}', ['alpha']],
  ['const-receiver', 'struct Node{void mutate(); int view()const;}; void f(){const Node n{}; n.@;}', ['view'], ['mutate']],
  ['const-vector', '#include <vector>\nvoid f(){const std::vector<int> v; v.@;}', ['size', 'begin'], ['push_back', 'clear']],
  // Native Clang8 emits non-const function templates here without availability.
  // Record this unsupported boundary; do not invent a spelling-based filter.
  ['const-string-native-gap', '#include <string>\nvoid f(){const std::string s; s.@;}', ['size', 'substr', 'append'], ['clear']],
  ['case-character-literal', 'struct N{int value;};void f(){N n;switch(1){case\'a\': n.@;}}', ['value']],
  ['sizeof-character-literal', 'struct N{int value;};void f(){N n;sizeof\'a\'; n.@;}', ['value']],
  ['pattern-variable', 'int Pattern;void f(){Pat@;}', ['Pattern']],
  ['pattern-function', 'int Pattern(int);void f(){Pat@;}', ['Pattern']],
  ['comment', 'int alpha; void f(){/* al@ */}', []],
  ['string-literal', 'void f(){const char* s="al@";}', []],
  ['raw-literal', 'void f(){auto s=R"tag(text " al@)tag";}', []],
  ['mid-token', 'int alphaLocal; void f(){al@phaOld;}', ['alphaLocal']],
];
const observations = [], workers = [], progress = [];
const adapter = new CompletionAdapter({ lock, createWorker: () => { const w = new Worker(new URL('../../src/completion-worker.mjs', import.meta.url)); workers.push(w); return w; }, onProgress: event => progress.push(event) });
try {
  for (const [name, marked, expected, absent = [], language = 'cpp', files] of cases) {
    const request = input(marked, language, files), before = JSON.stringify(request);
    const native = await completeWithClang(request, toolchain), started = performance.now();
    const reply = await adapter.complete(request), adapterMs = performance.now() - started;
    await json(`${name}.json`, { request, reply, adapterMs, native, checks: { expected, absent, sourceUnchanged: JSON.stringify(request) === before } });
    assert.equal(JSON.stringify(request), before, 'provider must not mutate source');
    assert.equal(reply.sourceHash, request.snapshot.sourceHash);
    for (const label of expected) assert.ok(reply.items.some(item => item.label === label), `${name}: missing ${label}: ${JSON.stringify(reply)}`);
    for (const label of absent) assert.ok(!reply.items.some(item => item.label === label), `${name}: forbidden ${label}`);
    if (name === 'overloads') assert.equal(reply.items.filter(item => item.label === 'alpha').length, 2);
    if (['comment', 'string-literal', 'raw-literal'].includes(name)) assert.equal(reply.items.length, 0);
    if (name === 'shadowing') { assert.equal(reply.items.filter(item => item.label === 'sample').length, 1); assert.equal(reply.items.find(item => item.label === 'sample').detail, 'int sample'); }
    observations.push({ name, status: reply.status, itemCount: reply.items.length, adapterMs, nativeExit: native.native?.exitCode ?? null,
      constMutatePresent: name === 'const-receiver' ? reply.items.some(item => item.label === 'mutate') : undefined });
  }
  const last = workers.at(-1), lastRequestId = last ? adapter.slot?.lastRequestId : undefined;
  await adapter.cancel(lastRequestId);
  assert.equal(last.threadId, -1, 'cancel completed request releases warm Worker');
  const cancelledRequest = input('#include <vector>\n' + Array.from({ length: 12000 }, (_, i) => `int alpha${i}(int);`).join('\n') + '\nvoid f(){al@;}');
  let releaseSeen, cancelMs, ticks = 0;
  const released = new Promise(resolve => { releaseSeen = resolve; });
  adapter.onProgress = event => {
    if (event.phase === 'completion-started') setTimeout(async () => {
      const start = performance.now(); await adapter.cancel(cancelledRequest.requestId); cancelMs = performance.now() - start; releaseSeen();
    }, 5);
  };
  const timer = setInterval(() => ticks++, 2);
  const cancelled = await adapter.complete(cancelledRequest); await released; clearInterval(timer);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(workers.at(-1).threadId, -1); assert.ok(ticks > 1);
  await json('actual-cancel.json', { request: cancelledRequest, reply: cancelled, cancelMs, callerEventLoopTicks: ticks, terminatedThreadId: workers.at(-1).threadId });
  adapter.onProgress = () => {};
  const afterCancel = await adapter.complete(input('int alpha; void f(){al@;}'));
  assert.ok(afterCancel.items.some(item => item.label === 'alpha'));
  await json('after-cancel.json', afterCancel);
} finally { await adapter.dispose(); }
await json('summary.json', { requestId: 'CC-20261029-02', baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, resourceReads, loadedLld: resourceReads.some(path => path.endsWith('/lld')),
  sourceFiles: await Promise.all(['adapter', 'worker', 'engine', 'source', 'output'].map(async name => { const path = `compiler/src/completion-${name}.mjs`; const bytes = await readFile(new URL(path, root)); return { path, sha256: hashBytes(bytes), byteLength: bytes.length }; })),
  observations, workersCreated: workers.length, allWorkersReleased: workers.every(w => w.threadId === -1), progress,
  knownLimitations: ['const-string-native-gap: native Clang8 emits append/assign/insert/replace member templates without unavailable markers on a const receiver; full const/template availability is unsupported.', 'CLI does not expose AST kind, priority, deprecated or unavailable attributes. kind=unknown.'],
  scope: 'Real production engine + Node Worker adapter, fixed Clang Wasm. No UI, browser, offline cold restart or iPad claim.' });
console.log(JSON.stringify({ evidence: dir.href, cases: observations.length, workersCreated: workers.length, observations }, null, 2));
