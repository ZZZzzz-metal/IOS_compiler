// In-memory cache fault injection. Real offline browser evidence is recorded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
const logic = await readFile(new URL('../src/service-worker-template.js', import.meta.url), 'utf8');
function harness() {
  const base = 'https://compiler.test/compiler/', maps = new Map(), network = new Map(), handlers = new Map();
  const body = 'compiler-fixture-bytes', path = 'resource.wasm';
  network.set(base + path, body);
  const resources = [{ path, byteLength: body.length, sha256: createHash('sha256').update(body).digest('hex') }];
  let connected = true;
  const caches = {
    async open(name) {
      if (!maps.has(name)) maps.set(name, new Map());
      const map = maps.get(name);
      return { put: async (url, response) => { map.set(String(url), response.clone()); }, match: async url => map.get(String(url))?.clone() };
    },
    keys: async () => [...maps.keys()], delete: async name => maps.delete(name),
  };
  const self = { location: { href: base + 'service-worker.js' }, skipWaiting: async () => {}, clients: { claim: async () => {} }, addEventListener: (name, handler) => handlers.set(name, handler) };
  vm.runInNewContext(`const CACHE='compiler-probe-current', PREFIX='compiler-probe-', RESOURCES=${JSON.stringify(resources)};\n` + logic, {
    self, caches, URL, Response, crypto: webcrypto,
    fetch: async url => { if (!connected) throw new Error('offline'); return network.has(String(url)) ? new Response(network.get(String(url))) : new Response('', { status: 404 }); },
  });
  return { maps, network, offline: () => { connected = false; },
    dispatch: async (kind, event = {}) => {
      let pending = Promise.resolve(), response;
      handlers.get(kind)({ ...event, waitUntil: value => { pending = value; }, respondWith: value => { response = value; } });
      await pending;
      return response ? await response : undefined;
    },
    verify: async repair => {
      let pending, result;
      handlers.get('message')({ data: { kind: 'verify-resources', repair }, ports: [{ postMessage: value => { result = value; } }], waitUntil: value => { pending = value; } });
      await pending; return result;
    },
    base,
  };
}
test('activated cache is rechecked, corruption is blocked on fetch, repair is explicit', async () => {
  const fixture = harness();
  await fixture.dispatch('install');
  assert.equal((await fixture.verify(false)).ok, true);
  fixture.maps.get('compiler-probe-current').set(fixture.base + 'resource.wasm', new Response('corrupt'));
  assert.equal((await fixture.verify(false)).ok, false);
  const response = await fixture.dispatch('fetch', { request: { method: 'GET', url: fixture.base + 'resource.wasm' } });
  assert.equal(response.status, 503);
  assert.equal((await fixture.verify(true)).ok, true);
  fixture.offline();
  assert.equal((await fixture.verify(false)).ok, true);
  fixture.maps.get('compiler-probe-current').clear();
  assert.equal((await fixture.verify(true)).ok, false);
});
test('failed staging keeps the old complete cache and removes partial new cache', async () => {
  const fixture = harness();
  fixture.maps.set('compiler-probe-old', new Map());
  fixture.network.set(fixture.base + 'resource.wasm', 'wrong');
  await assert.rejects(fixture.dispatch('install'), /integrity/u);
  assert.equal(fixture.maps.has('compiler-probe-current'), false);
  assert.equal(fixture.maps.has('compiler-probe-old'), true);
});
