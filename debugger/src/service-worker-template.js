const CACHE='debugger-probe-03-'+VERSION;
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const root=new URL('../',self.registration.scope);
const entries=new Map(RESOURCES.map(r=>[new URL(r.path,root).href,r]));
const checked=async(response,entry)=>{
  if(!response?.ok)throw new Error('Missing local resource: '+entry.path);
  const bytes=await response.clone().arrayBuffer();
  if(bytes.byteLength!==entry.byteLength||await hash(bytes)!==entry.sha256)throw new Error('Resource integrity mismatch: '+entry.path);
  return response;
};
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  try{for(const [url,entry] of entries){const response=await fetch(url,{cache:'no-store'});await cache.put(url,await checked(response,entry));}await self.skipWaiting();}
  catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('debugger-probe-03-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const entry=entries.get(event.request.url);
  if(!entry)return;
  event.respondWith((async()=>{try{return await checked(await(await caches.open(CACHE)).match(event.request.url),entry);}catch(error){return new Response(error.message,{status:503});}})());
});
self.addEventListener('message',event=>{
  if(event.data?.kind!=='verify')return;
  event.waitUntil((async()=>{try{const cache=await caches.open(CACHE);for(const [url,entry] of entries)await checked(await cache.match(url),entry);event.ports[0].postMessage({ok:true});}catch(error){event.ports[0].postMessage({ok:false,message:error.message});}})());
});
