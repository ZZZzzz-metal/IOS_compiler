import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { CompletionAdapter } from '../src/completion-adapter.mjs';
import { loadCompletionToolchain, completeWithClang } from '../src/completion-engine.mjs';
import { createSnapshot } from '../src/source.mjs';

const lock = JSON.parse(await readFile(new URL('../resources/toolchain.lock.json', import.meta.url), 'utf8'));
function input(marked, { language = 'cpp', files = [], sourcePath = language === 'cpp' ? 'main.cpp' : 'main.c', translationUnit = sourcePath } = {}) {
  return { requestId: crypto.randomUUID(), documentVersion: 2, language, standard: language === 'cpp' ? 'c++17' : 'c11',
    snapshot: createSnapshot([{ path: sourcePath, role: 'user', text: marked.replace('@', '') }, ...files], translationUnit), sourcePath, offset: marked.indexOf('@') };
}
const reads = [];
const toolchain = await loadCompletionToolchain(lock, path => { reads.push(path); return readFile(new URL(`../resources/${path}`, import.meta.url)); });
const complete = async marked => (await completeWithClang(input(marked), toolchain)).result;

test('real completion loader reads only three locked resources and rejects corruption', async () => {
  assert.deepEqual(reads.map(path => path.split('/').at(-1)), ['memfs', 'sysroot.tar', 'clang']);
  assert.deepEqual(Object.keys(toolchain.modules), ['memfs', 'clang']);
  await assert.rejects(loadCompletionToolchain(lock, async path => {
    const bytes = await readFile(new URL(`../resources/${path}`, import.meta.url));
    if (path.endsWith('/clang')) bytes[10] ^= 1;
    return bytes;
  }), /integrity failed: clang/u);
});

test('real Clang scope, access, const correctness and overloads determine candidates', async () => {
  const outside = await complete('class Box{int secret; public:int value; void change(); int view()const;}; void f(){const Box b{}; b.@;}');
  assert.ok(outside.items.some(i => i.label === 'value')); assert.ok(outside.items.some(i => i.label === 'view'));
  assert.ok(!outside.items.some(i => ['secret', 'change'].includes(i.label)));
  const inside = await complete('class Box{int secret; public:void f(){this->@;}};');
  assert.ok(inside.items.some(i => i.label === 'secret'));
  const protectedOutside = await complete('struct Base{protected:int secret;public:int value;};struct Child:Base{};void f(){Child c;c.@;}');
  assert.ok(!protectedOutside.items.some(i => i.label === 'secret'));
  const protectedInside = await complete('struct Base{protected:int secret;};struct Child:Base{void f(){this->@;}};');
  assert.ok(protectedInside.items.some(i => i.label === 'secret'));
  const shadowed = await complete('double sample;void f(){int sample; sam@;}');
  assert.deepEqual(shadowed.items.filter(i => i.label === 'sample').map(i => i.detail), ['int sample']);
  const overloaded = await complete('int alpha(int);double alpha(double);void f(){al@;}');
  assert.equal(overloaded.items.filter(i => i.label === 'alpha').length, 2);
  assert.equal(new Set(overloaded.items.map(i => i.id)).size, overloaded.items.length);
});

test('real dot, arrow, namespace, unfinished source and error-prefix completions work', async () => {
  for (const marked of ['struct N{int value;};void f(){N n;n.@;}', 'struct N{int value;};void f(){N* n;n->@;}',
    'namespace N{int value;}void f(){N::@;}', 'struct N{int value;};void f(){N n;if(true){n.@']) {
    assert.ok((await complete(marked)).items.some(i => i.label === 'value'));
  }
  const errorPrefix = await completeWithClang(input('void f(){UnknownType x;int alpha;al@'), toolchain);
  assert.equal(errorPrefix.native.exitCode, 1); assert.equal(errorPrefix.result.status, 'succeeded');
  assert.ok(errorPrefix.result.items.some(i => i.label === 'alpha'));
  assert.ok(errorPrefix.result.diagnostics.some(i => i.severity === 'error'));
});

test('real libc++ const ordinary methods and vector overloads follow native eligibility', async () => {
  const vector = await complete('#include <vector>\nvoid f(){std::vector<int> v;v.pu@;}');
  assert.equal(vector.items.filter(i => i.label === 'push_back').length, 2);
  for (const [header, declaration, present, absent] of [
    ['vector', 'const std::vector<int> v;', 'size', 'push_back'],
    ['string', 'const std::string v;', 'substr', 'clear'],
  ]) {
    const result = await complete(`#include <${header}>\nvoid f(){${declaration}v.@;}`);
    assert.ok(result.items.some(i => i.label === present)); assert.ok(!result.items.some(i => i.label === absent));
  }
});

test('known Clang8 availability gap is preserved as evidence: const string member templates', async () => {
  const native = await completeWithClang(input('#include <string>\nvoid f(){const std::string s;s.ap@;}'), toolchain);
  assert.ok(native.result.items.some(i => i.label === 'append'));
  assert.match(native.native.stdout, /COMPLETION: append :/u);
  assert.ok(!native.native.stdout.includes('Inaccessible'));
  // This documents an unsupported native limitation, not a const correctness pass.
});

test('real character literals after case/sizeof and declarations named Pattern are retained', async () => {
  for (const marked of ['struct N{int value;};void f(){N n;switch(1){case\'a\': n.@;}}',
    'struct N{int value;};void f(){N n;sizeof\'a\'; n.@;}']) {
    assert.ok((await complete(marked)).items.some(i => i.label === 'value'));
  }
  for (const marked of ['int Pattern;void f(){Pat@;}', 'int Pattern(int);void f(){Pat@;}']) {
    assert.ok((await complete(marked)).items.some(i => i.label === 'Pattern'));
  }
});

test('real normalized unicode/user.inc cursor parses driver TU, C11 and mid-token ranges', async () => {
  const marked = '\uFEFFint f(){const char*s="中文😀"; std::vector<int> v;\r\nv.pu@;return 0;}';
  // raw editor mapping belongs to UI: normalize before deriving the request offset.
  const normalized = marked.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const request = input(normalized, { sourcePath: 'user.inc', translationUnit: 'driver.cpp', files: [
    { path: 'driver.cpp', role: 'driver', text: '#include <vector>\n#include "user.inc"\nint main(){return f();}' },
  ] });
  const native = await completeWithClang(request, toolchain);
  assert.ok(native.result.items.some(i => i.label === 'push_back'));
  assert.ok(native.native.argv.includes('-code-completion-at=/project/user.inc:2:5'));
  assert.equal(native.native.argv.at(-1), '/project/driver.cpp');
  const c = await completeWithClang(input('int alpha(int);void f(void){int alphaLocal;al@;}', { language: 'c' }), toolchain);
  assert.ok(c.result.items.some(i => i.label === 'alphaLocal'));
  const middle = input('int alpha;void f(){al@phaOld;}'), result = await completeWithClang(middle, toolchain);
  assert.deepEqual(result.result.items[0].replaceRange, { startOffset: middle.offset - 2, endOffset: middle.offset + 6 });
});

test('actual Worker remains responsive to cancellation, releases memory owner then restarts', async () => {
  const workers = [], events = [];
  const adapter = new CompletionAdapter({ lock, createWorker: () => { const worker = new Worker(new URL('../src/completion-worker.mjs', import.meta.url)); workers.push(worker); return worker; }, onProgress: event => events.push(event) });
  try {
    const first = input('int alpha;void f(){al@;}');
    assert.ok((await adapter.complete(first)).items.some(i => i.label === 'alpha'));
    const second = input('struct N{int value;};void f(){N n;n.@;}');
    assert.ok((await adapter.complete(second)).items.some(i => i.label === 'value'));
    assert.equal(workers.length, 1, 'completed calls reuse compiled Module cache');
    await adapter.cancel(first.requestId); assert.notEqual(workers[0].threadId, -1, 'old ID cannot release newer warm cache');
    await adapter.cancel(second.requestId); assert.equal(workers[0].threadId, -1);
    const long = input(Array.from({ length: 12000 }, (_, i) => `int alpha${i}(int);`).join('\n') + '\nvoid f(){al@;}');
    let cancel;
    adapter.onProgress = event => { if (event.phase === 'completion-started') cancel = new Promise(resolve => setTimeout(async () => { await adapter.cancel(long.requestId); resolve(); }, 5)); };
    const result = await adapter.complete(long); await cancel;
    assert.equal(result.status, 'cancelled'); assert.deepEqual(result.items, []); assert.equal(workers.at(-1).threadId, -1);
    adapter.onProgress = () => {};
    assert.ok((await adapter.complete(input('int alpha;void f(){al@;}'))).items.length);
    assert.equal('buildId' in result, false);
  } finally { await adapter.dispose(); }
  assert.ok(workers.every(worker => worker.threadId === -1));
});
