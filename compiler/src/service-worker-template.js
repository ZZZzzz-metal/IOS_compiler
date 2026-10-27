// Constants CACHE/PREFIX/RESOURCES are generated from actual bytes by build-probe.mjs.
const base = new URL('./', self.location.href);
const entries = new Map(RESOURCES.map(resource => [new URL(resource.path, base).href, resource]));
async function checked(response, resource) {
  if (!response?.ok) throw new Error('Resource unavailable: ' + resource.path);
  const bytes = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== resource.byteLength || hash !== resource.sha256) throw new Error('Resource integrity failed: ' + resource.path);
  return new Response(bytes, { headers: response.headers });
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try {
    for (const resource of RESOURCES) {
      const url = new URL(resource.path, base);
      await cache.put(url, await checked(await fetch(url, { cache: 'no-store' }), resource));
    }
    await self.skipWaiting();
  } catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data?.kind !== 'verify-resources' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      for (const resource of RESOURCES) {
        const url = new URL(resource.path, base);
        try { await checked(await cache.match(url), resource); }
        catch (error) {
          if (event.data.repair !== true) throw error;
          await cache.put(url, await checked(await fetch(url, { cache: 'no-store' }), resource));
        }
      }
      event.ports[0].postMessage({ ok: true });
    } catch (error) { event.ports[0].postMessage({ ok: false, message: error.message }); }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || event.request.method !== 'GET') return;
  if (url.pathname === base.pathname) url.pathname += 'probe.html';
  event.respondWith((async () => {
    try {
      const resource = entries.get(url.href);
      if (!resource) throw new Error('Unlisted compiler resource');
      const cache = await caches.open(CACHE);
      return await checked(await cache.match(url), resource);
    } catch { return new Response('Compiler resource missing or corrupt. Prepare resources again.', { status: 503 }); }
  })());
});
