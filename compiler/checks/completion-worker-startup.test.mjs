// Browser module-worker startup fault injection, not a browser semantic claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = (await readFile(new URL('../src/completion-worker.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gmu, '').replaceAll('import.meta.url', JSON.stringify('https://compiler.test/compiler/src/completion-worker.mjs'));

test('browser completion worker attaches synchronously and serializes requests during delayed initialization', async () => {
  let release, loads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [], parsed = [], self = { postMessage: data => sent.push(data) };
  await vm.runInNewContext(`(async () => {${code}\n})()`, {
    self, URL, loadCompletionToolchain: async () => { loads++; await gate; return {}; },
    completeWithClang: async request => { parsed.push(request.requestId); return { result: { requestId: request.requestId } }; },
  });
  assert.equal(typeof self.onmessage, 'function'); assert.equal(loads, 0);
  self.onmessage({ data: { request: { requestId: 'first' }, lock: {} } });
  self.onmessage({ data: { request: { requestId: 'second' }, lock: {} } });
  await Promise.resolve(); assert.equal(loads, 1); assert.equal(parsed.length, 0);
  release();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(parsed, ['first', 'second']); assert.equal(loads, 1);
  assert.deepEqual(sent.filter(message => message.kind === 'result').map(message => message.result.requestId), ['first', 'second']);
});
