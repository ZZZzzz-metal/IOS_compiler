// Delayed-lock fault injection for browser module-worker startup; no compiler claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = (await readFile(new URL('../src/compiler-worker.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gmu, '').replaceAll('import.meta.url', JSON.stringify('https://compiler.test/compiler/src/compiler-worker.mjs'));
test('browser Worker receives its first request before any asynchronous lock loading', async () => {
  let release, fetches = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const sent = [];
  const self = { postMessage: message => sent.push(message) };
  const execution = vm.runInNewContext(`(async () => {${code}\n})()`, {
    self, URL, fetch: async () => { fetches++; await pending; return { ok: true, json: async () => ({}) }; },
    loadToolchain: async () => ({}),
    compileArtifact: async request => ({ status: 'failed', requestId: request.requestId, sourceHash: 'fixture', reason: 'synthetic-check' }),
  });
  assert.equal(typeof self.onmessage, 'function');
  assert.equal(fetches, 0);
  self.onmessage({ data: { request: { requestId: 'first-message' } } });
  await Promise.resolve();
  release();
  await execution;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'result');
  assert.equal(sent[0].evidence.requestId, 'first-message');
});
