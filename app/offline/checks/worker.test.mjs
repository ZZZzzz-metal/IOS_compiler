// Executes the shipped worker template with small Cache API/network substitutes.
// These lifecycle/fault checks are not browser or iPad offline evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash, webcrypto} from 'node:crypto';

const templateURL = new URL('../browser/worker-template.js', import.meta.url);
const origin = 'https://offline.example';
const scope = `${origin}/release/`;
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const address = input => String(input?.url ?? input);

function fixture(version = 'one') {
  const files = new Map([
    ['index.html', `<main>${version}</main>`],
    ['launcher.mjs', `import './app/offline/browser/trust.mjs'; // ${version}`],
    ['app/offline/browser/trust.mjs', `export const version='${version}';`],
    ['compiler/engine.wasm', `small-engine-${version}`],
  ]);
  const resources = [...files].map(([path, bytes]) => ({path,
    sha256: sha256(bytes), byteLength: Buffer.byteLength(bytes),
    mediaType: path.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/wasm',
  }));
  return {files, descriptor: {schemaVersion: 1, bundleId: `offline-test-${version}`,
    compatibilityId: `integration-test-${version}`, resourceManifestHash: sha256(`components-${version}`),
    resources, totalBytes: resources.reduce((sum, item) => sum + item.byteLength, 0)}};
}

async function harness(sample = fixture(), shared = new Map()) {
  const network = new Map([...sample.files].map(([path, body]) => [new URL(path, scope).href, body]));
  const handlers = new Map(), fetches = [], deletions = [];
  let online = true, claims = 0, skips = 0;
  let windows = [];
  const cacheAPI = {
    async open(name) {
      if (!shared.has(name)) shared.set(name, new Map());
      const entries = shared.get(name);
      return {
        async put(input, response) { entries.set(address(input), response.clone()); },
        async match(input) { return entries.get(address(input))?.clone(); },
        async delete(input) { return entries.delete(address(input)); },
        async keys() { return [...entries.keys()].map(url => new Request(url)); },
      };
    },
    async keys() { return [...shared.keys()]; },
    async delete(name) { deletions.push(name); return shared.delete(name); },
    async has(name) { return shared.has(name); },
    async match(input) {
      for (const entries of shared.values()) {
        const result = entries.get(address(input));
        if (result) return result.clone();
      }
    },
  };
  const self = {
    location: {href: `${scope}service-worker.js`, origin},
    registration: {scope},
    clients: {async claim() { claims++; }, async matchAll() { return windows; }},
    async skipWaiting() { skips++; },
    addEventListener(kind, callback) { handlers.set(kind, callback); },
  };
  const source = await readFile(templateURL, 'utf8');
  assert.equal(source.split('__BUNDLE_DESCRIPTOR__').length, 2, 'exactly one descriptor placeholder');
  vm.runInNewContext(source.replace('__BUNDLE_DESCRIPTOR__', JSON.stringify(sample.descriptor)), {
    self, caches: cacheAPI, crypto: webcrypto, URL, Request, Response, Headers,
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console,
    fetch: async input => {
      const url = address(input);
      fetches.push(url);
      if (!online) throw new TypeError('Simulated disconnected network');
      if (!network.has(url)) return new Response('not found', {status: 404});
      const value = network.get(url);
      if (value instanceof Error) throw value;
      return value instanceof Response ? value.clone() : new Response(value);
    },
  }, {filename: 'offline-worker-template.js'});
  async function dispatch(kind, event = {}) {
    const pending = [];
    let response;
    handlers.get(kind)?.({...event,
      waitUntil(value) { pending.push(value); },
      respondWith(value) { assert.equal(response, undefined); response = Promise.resolve(value); },
    });
    await Promise.all(pending);
    return response ? await response : undefined;
  }
  return {sample, shared, network, fetches, deletions, dispatch,
    get claims() { return claims; }, get skips() { return skips; },
    disconnect() { online = false; },
    setWindows(value) { windows = value; },
    async request(path, method = 'GET') {
      const url = new URL(path, scope).href;
      return dispatch('fetch', {request: new Request(url, {method})});
    },
    async verify(type = 'OFFLINE_VERIFY', source = {id: 'test-client', url: `${scope}index.html`}) {
      let result;
      await dispatch('message', {data: {type, requestId: 'verify-from-test'}, source,
        ports: [{postMessage(value) { result = value; }}]});
      return result;
    },
  };
}

test('complete installation serves navigation and engine with no network after disconnect', async () => {
  const app = await harness();
  await app.dispatch('install');
  await app.dispatch('activate');
  assert.equal(app.claims, 1);
  assert.equal(app.skips, 0);
  assert.equal(app.fetches.length, 4);
  app.disconnect();
  assert.equal(await (await app.request('./')).text(), '<main>one</main>');
  assert.equal(await (await app.request('compiler/engine.wasm?fresh=1')).text(), 'small-engine-one');
  const result = await app.verify();
  assert.equal(result.ok, true);
  assert.equal(result.resourceCount, 4);
  assert.equal(result.bundleId, 'offline-test-one');
  assert.equal(app.fetches.length, 4, 'cache reads never try the network');
});

for (const failure of ['wrong bytes', 'network interrupted', 'HTTP failure']) {
  test(`${failure} never commits a partial cache or removes the previous version`, async () => {
    const old = await harness(fixture('old'));
    await old.dispatch('install');
    const oldNames = [...old.shared.keys()];
    const next = await harness(fixture('new'), old.shared);
    next.network.set(new URL('compiler/engine.wasm', scope).href,
      failure === 'wrong bytes' ? 'incorrect' : failure === 'network interrupted' ? new Error('interrupted') : new Response('missing', {status: 404}));
    await assert.rejects(next.dispatch('install'));
    assert.deepEqual([...next.shared.keys()], oldNames);
    assert.equal((await next.verify()).ok, false);
    assert.equal((await old.verify()).ok, true);
    assert.equal(next.deletions.length, 1, 'only this failed staging cache is removed');
    assert.ok(next.deletions.every(name => name.includes('offline-test-new:staging-')));
  });
}

test('new complete version preserves old version and unrelated caches', async () => {
  const old = await harness(fixture('old'));
  old.shared.set('other-application', new Map());
  await old.dispatch('install');
  const next = await harness(fixture('new'), old.shared);
  await next.dispatch('install');
  await next.dispatch('activate');
  old.disconnect(); next.disconnect();
  assert.equal(await (await old.request('compiler/engine.wasm')).text(), 'small-engine-old');
  assert.equal(await (await next.request('compiler/engine.wasm')).text(), 'small-engine-new');
  assert.equal(old.shared.has('other-application'), true);
  assert.deepEqual(next.deletions, []);
  assert.equal(next.skips, 0);
});

test('unknown files and evicted files return 503 without network repair', async () => {
  const app = await harness();
  await app.dispatch('install');
  const fetchCount = app.fetches.length;
  for (const path of ['not-in-manifest.js', 'nested/../not-in-manifest.js', '%2e%2e/secret']) {
    const response = await app.request(path);
    // URL normalization can put traversal outside this worker scope.
    if (response) assert.equal(response.status, 503);
  }
  const cache = [...app.shared.values()][0];
  cache.delete(new URL('compiler/engine.wasm', scope).href);
  assert.equal((await app.request('compiler/engine.wasm')).status, 503);
  assert.equal((await app.verify()).ok, false);
  assert.equal(app.fetches.length, fetchCount);
});

test('cached corruption and descriptor corruption fail the full startup check', async () => {
  for (const path of ['compiler/engine.wasm', 'bundle.json']) {
    const app = await harness();
    await app.dispatch('install');
    [...app.shared.values()][0].set(new URL(path, scope).href, new Response('tampered'));
    const before = app.fetches.length;
    assert.equal((await app.verify()).ok, false);
    assert.equal((await app.request(path)).status, 503);
    assert.equal(app.fetches.length, before);
  }
});

test('explicit prepare repairs corruption through a new full transaction and preserves old cache', async () => {
  const app = await harness();
  await app.dispatch('install');
  const oldNames = [...app.shared.keys()];
  [...app.shared.values()][0].set(new URL('compiler/engine.wasm', scope).href, new Response('broken'));
  assert.equal((await app.verify()).ok, false);
  const repaired = await app.verify('OFFLINE_PREPARE');
  assert.equal(repaired.ok, true);
  assert.equal(app.fetches.length, 8);
  assert.ok(oldNames.every(name => app.shared.has(name)), 'repair retains the earlier cache');
  assert.equal(app.shared.size, 2);
  app.disconnect();
  assert.equal(await (await app.request('compiler/engine.wasm')).text(), 'small-engine-one');
});

test('failed explicit repair retains the previous complete package', async () => {
  const app = await harness();
  await app.dispatch('install');
  const oldNames = [...app.shared.keys()];
  app.network.set(new URL('compiler/engine.wasm', scope).href, 'wrong new bytes');
  assert.equal((await app.verify('OFFLINE_PREPARE')).ok, false);
  assert.deepEqual([...app.shared.keys()], oldNames);
  assert.equal((await app.verify()).ok, true);
});

test('missing launcher navigation supplies a local recovery page without fetching network resources', async () => {
  const app = await harness();
  await app.dispatch('install');
  [...app.shared.values()][0].delete(new URL('index.html', scope).href);
  app.disconnect();
  const before = app.fetches.length;
  const response = await app.dispatch('fetch', {request: {method: 'GET', url: scope, mode: 'navigate'}});
  assert.equal(response.status, 503);
  assert.match(response.headers.get('Content-Type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /联网重新准备资源/);
  assert.match(html, /OFFLINE_PREPARE/);
  assert.equal(app.fetches.length, before);
  assert.equal((await app.verify()).ok, false);
});

test('explicit prepare rejects an open workbench and non-launcher callers before any network', async () => {
  const app = await harness();
  await app.dispatch('install');
  const before = app.fetches.length;
  app.setWindows([{id: 'workbench', url: `${scope}ui/probe.html`}]);
  const blocked = await app.verify('OFFLINE_PREPARE');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /关闭/);
  app.setWindows([]);
  const foreign = await app.verify('OFFLINE_PREPARE', {id: 'foreign', url: `${origin}/other/index.html`});
  assert.equal(foreign.ok, false);
  assert.equal(app.fetches.length, before);
});

for (const path of ['index.html','launcher.mjs','app/offline/browser/trust.mjs','bundle.json']) {
  for (const damage of ['missing','corrupt']) {
    test(`${damage} startup resource ${path} opens local repair before launcher execution`, async () => {
      const app=await harness();await app.dispatch('install');
      const oldNames=[...app.shared.keys()],cache=[...app.shared.values()][0],url=new URL(path,scope).href;
      if(damage==='missing')cache.delete(url);else cache.set(url,new Response('damaged bootstrap bytes'));
      const before=app.fetches.length;
      const navigate=()=>app.dispatch('fetch',{request:{method:'GET',url:scope+'index.html',mode:'navigate'}});
      const failed=await navigate();
      assert.equal(failed.status,503,'startup may not serve an unusable launcher page');
      assert.match(failed.headers.get('Content-Type'),/text\/html/);
      assert.match(await failed.text(),/联网重新准备资源/);
      assert.equal(app.fetches.length,before,'opening repair must not start a network transaction');
      assert.equal((await app.verify('OFFLINE_PREPARE')).ok,true);
      assert.ok(oldNames.every(name=>app.shared.has(name)),'preserve old caches and all unrelated storage');
      const restored=await navigate();assert.equal(restored.status,200);assert.equal(await restored.text(),'<main>one</main>');
      assert.equal((await app.verify()).ok,true);
    });
  }
}

test('a new workbench opened during repair prevents cache commit', async () => {
  const app = await harness();
  await app.dispatch('install');
  const oldNames = [...app.shared.keys()];
  const response = new Response('small-engine-one');
  const originalClone = response.clone.bind(response);
  // The network response is cloned by the harness. Opening on clone models a
  // window appearing after the initial permission check but before final commit.
  response.clone = () => {
    app.setWindows([{id: 'late-workbench', url: `${scope}ui/probe.html`}]);
    return originalClone();
  };
  app.network.set(new URL('compiler/engine.wasm', scope).href, response);
  const result = await app.verify('OFFLINE_PREPARE');
  assert.equal(result.ok, false);
  assert.deepEqual([...app.shared.keys()], oldNames);
  assert.equal((await app.verify()).ok, true);
});

test('ordinary development entry works without a covering worker; foreign covering worker stays rejected', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const {assertTrustedOfflineWorkers} = await import('../browser/trust.mjs');
  const candidate = {profile: {compatibilityId: 'candidate', resourceManifestHash: 'hash'}};
  try {
    Object.defineProperty(globalThis, 'navigator', {value: {}, configurable: true});
    assert.deepEqual(await assertTrustedOfflineWorkers(candidate, scope), {offline: false});
    Object.defineProperty(globalThis, 'navigator', {value: {serviceWorker: {getRegistrations: async () => []}}, configurable: true});
    assert.deepEqual(await assertTrustedOfflineWorkers(candidate, scope), {offline: false});
    Object.defineProperty(globalThis, 'navigator', {value: {serviceWorker: {getRegistrations: async () => [{scope: origin + '/', active: {scriptURL: origin + '/old-sw.js'}}]}}, configurable: true});
    await assert.rejects(assertTrustedOfflineWorkers(candidate, scope), /其他实验页/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

test('a foreign scope covering only the completion worker is rejected before any trusted handshake', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const {assertTrustedOfflineWorkers} = await import('../browser/trust.mjs');
  const candidate = {profile: {compatibilityId: 'candidate', resourceManifestHash: 'hash'}};
  const completionScope = new URL('compiler/src/completion-worker.mjs', scope).href;
  // This narrow registration cannot cover either of the existing execution Workers.
  for (const path of ['compiler/src/compiler-worker.mjs', 'debugger/src/debugger-worker.mjs']) {
    assert.equal(new URL(path, scope).href.startsWith(completionScope), false);
  }
  const foreign = {scope: completionScope, active: {scriptURL: origin + '/foreign-completion-sw.js'}};
  let handshakes = 0;
  const trusted = {scope, active: {scriptURL: scope + 'sw.js', postMessage(request, ports) {
    handshakes++;
    ports[0].postMessage({type: 'OFFLINE_VERIFIED', requestId: request.requestId, ok: true,
      bundleId: 'release', compatibilityId: 'candidate', resourceManifestHash: 'hash', baseURL: scope});
    ports[0].close();
  }}};
  try {
    for (const registrations of [[foreign], [trusted, foreign]]) {
      Object.defineProperty(globalThis, 'navigator', {value: {serviceWorker: {getRegistrations: async () => registrations}}, configurable: true});
      await assert.rejects(assertTrustedOfflineWorkers(candidate, scope), /其他实验页/);
    }
    assert.equal(handshakes, 0, 'reject the foreign completion scope before trusting the complete bundle');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

test('workbench trust checks bundle scope and component identity after the worker handshake', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const {assertTrustedOfflineWorkers} = await import('../browser/trust.mjs');
  const candidate = {profile: {compatibilityId: 'candidate', resourceManifestHash: 'hash'}};
  let identity = {type: 'OFFLINE_VERIFIED', ok: true, bundleId: 'release', compatibilityId: 'candidate', resourceManifestHash: 'hash', baseURL: scope};
  const worker = {scriptURL: scope + 'sw.js', postMessage(request, ports) {ports[0].postMessage({...identity, requestId: request.requestId});ports[0].close();}};
  try {
    Object.defineProperty(globalThis, 'navigator', {value: {serviceWorker: {getRegistrations: async () => [{scope, active: worker}]}}, configurable: true});
    assert.deepEqual(await assertTrustedOfflineWorkers(candidate, scope), {offline: true, bundleId: 'release'});
    identity = {...identity, resourceManifestHash: 'different'};
    await assert.rejects(assertTrustedOfflineWorkers(candidate, scope), /不一致/);
    identity = {...identity, ok: false, error: 'resource unavailable'};
    await assert.rejects(assertTrustedOfflineWorkers(candidate, scope), /resource unavailable/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});
