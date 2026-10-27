const VERSION="5e1ae21816681e5c1e0644c3affc0d20d8816e71719f992872dd249fb6f689b7";
const RESOURCES=[
  {
    "path": "debugger/src/wasm-runtime.mjs",
    "byteLength": 49136,
    "sha256": "17261ad99674572f0b2ab03d0ce52e700ec9c72349eacaa76ac7afeb19728c9f"
  },
  {
    "path": "debugger/src/dwarf.mjs",
    "byteLength": 25566,
    "sha256": "a90c5783958fb814fa7dc8bd074166fe490d50ba2ecf6c9e82b79c5c3e58eb95"
  },
  {
    "path": "debugger/src/variables.mjs",
    "byteLength": 43287,
    "sha256": "7a678889ab7b8f21dcc39f83c51771b9fff8df7103bec92275937c8ff40f996c"
  },
  {
    "path": "debugger/src/integrity.mjs",
    "byteLength": 7031,
    "sha256": "6c705f346157d4ed07d1e7797474ad90cf653e7431b27bcf32ee4b282f3eeb07"
  },
  {
    "path": "debugger/src/debugger-adapter.mjs",
    "byteLength": 21034,
    "sha256": "07f12b21547d630e04bd1fd7c7e50d7e7d39e37e2bcfd719345d5f6aaaacd64c"
  },
  {
    "path": "debugger/src/worker-adapter.mjs",
    "byteLength": 8478,
    "sha256": "1560145ebf8cbced7e758ccc82e8473c1157649f39be70b34d9a7d09af7857c6"
  },
  {
    "path": "debugger/src/worker-bridge.mjs",
    "byteLength": 1673,
    "sha256": "b1271d7c34651296ef9011c69493f6c0e0f62d97db71d8f3fe27c9561e54eda1"
  },
  {
    "path": "debugger/src/debugger-worker.mjs",
    "byteLength": 600,
    "sha256": "4b867a736ada849efddffc1c074739eed039d5dd4f222ab8d99c24f2fe9e559d"
  },
  {
    "path": "debugger/LICENSE",
    "byteLength": 600,
    "sha256": "810a7126a235c23fe56bd32f0d78617232260ee5d03fd1cb32462ac679cd8cf5"
  },
  {
    "path": "debugger/probe.html",
    "byteLength": 1689,
    "sha256": "4cae062fd4ed1d21a9fabf4fb38c0a891908a0159f3130747b790791529ec64f"
  },
  {
    "path": "debugger/probe-page.mjs",
    "byteLength": 11595,
    "sha256": "d2322bd26217820ef4db875980600eb6c65668753e36d20df4fb2c9b4cee6d01"
  },
  {
    "path": "debugger/probe-candidate.json",
    "byteLength": 6125,
    "sha256": "037051be14c08a9b8325516b4ab84cfa01142e31e280243791327c094d5b1263"
  },
  {
    "path": "debugger/fixtures/debug-handoff/snapshot.json",
    "byteLength": 1145,
    "sha256": "e050485c20932cf5b119871d441282db5a9e374b32d0727dc08ff5a0c4d5e9ee"
  },
  {
    "path": "debugger/compiler/probe.html",
    "byteLength": 2195,
    "sha256": "8e7bd19110f4e41f7e8942e840a844ec76ea313721da40de2b99123b6f2aceca"
  },
  {
    "path": "debugger/compiler/probe-page.mjs",
    "byteLength": 5694,
    "sha256": "c414d8a5804a7ec821a7bb7a6b604ab9d8488541d65f7b50a36cfdb23220bd37"
  },
  {
    "path": "debugger/compiler/src/compiler-probe.mjs",
    "byteLength": 3912,
    "sha256": "40327315c54e4307d8faf322ad64ed0da248e8849f9ed72ad7d691e52cafd648"
  },
  {
    "path": "debugger/compiler/src/compiler-worker.mjs",
    "byteLength": 2400,
    "sha256": "b3011c7601b957f28e358216d8a4ecfe1a339b0201b4acd32245b9e7115c1416"
  },
  {
    "path": "debugger/compiler/src/toolchain-engine.mjs",
    "byteLength": 7649,
    "sha256": "03695bb52cbf7f4ab024ef773fca630eecb01c5452faa0f54fc055b574bbe3b5"
  },
  {
    "path": "debugger/compiler/src/wasm-host.mjs",
    "byteLength": 6856,
    "sha256": "ff458fe980fcf4529a2f28812d1442029eabe5f899bac3c76a257d00c9fe2a73"
  },
  {
    "path": "debugger/compiler/src/wasm-inspect.mjs",
    "byteLength": 1825,
    "sha256": "dfd5ae8ea29df1b266775250e3f07e3181ef3a48bd49ae97cbcf6b929df63a21"
  },
  {
    "path": "debugger/compiler/src/source.mjs",
    "byteLength": 7201,
    "sha256": "4f83bd06bb519ae2bad29bbbc1fd8be6aa147e2a70294d3042bcdedf9fa0e5d1"
  },
  {
    "path": "debugger/compiler/src/diagnostics.mjs",
    "byteLength": 3218,
    "sha256": "14399bd23b8eb131a20196d0ed926db1243ace34bda42a221bae687378bfbad3"
  },
  {
    "path": "debugger/compiler/resources/toolchain.lock.json",
    "byteLength": 6149,
    "sha256": "a8145ad87886f52a7ecf3a88d572239183b90fc43ed4ea1e0514d2b25df01e8d"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/clang",
    "byteLength": 31214472,
    "sha256": "2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/lld",
    "byteLength": 19490094,
    "sha256": "36419ed202011765222098d7701218378b67f634d50f0a4625059ae2c9860f48"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/memfs",
    "byteLength": 345442,
    "sha256": "2c72ee42bd9430029dda8c6bafc9f37143f6fe88d5f1ea950a70259ab748bcfe"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/sysroot.tar",
    "byteLength": 9297920,
    "sha256": "2435a7b549af30c2be7ec249c405bc2e911ab0c6003012f0909ec3c131bff867"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/shared.js",
    "byteLength": 23973,
    "sha256": "4de0be862bda1a7571c1f0632abe3c62c47a56e734cc6b703155805a4b160b1c"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/worker.js",
    "byteLength": 2758,
    "sha256": "c0d4c3f3ef0e2047c0f109922f0a4ee9e0f2b12947a569a835da83b6bdcf995e"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/d8.js",
    "byteLength": 1722,
    "sha256": "a7ae2decd5330e2deadb6c258cfa11b4f0c5645807feb7f0114d319335e4a4b5"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/shared_web.js",
    "byteLength": 8110,
    "sha256": "90f2eb3c832b9d3af7f0ef7aa63c71554182efb73eba734810607e20d4cb5681"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/LICENSE",
    "byteLength": 11358,
    "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/LICENSE.llvm",
    "byteLength": 15140,
    "sha256": "ebcd9bbf783a73d05c53ba4d586b8d5813dcdf3bbec50265860ccc885e606f47"
  },
  {
    "path": "debugger/compiler/resources/vendor/wasm-clang/README.md",
    "byteLength": 1446,
    "sha256": "2ded8e20209ca550698c829ab65dfff3e4e26e90fc21240bae5f0c4f1cbd7a57"
  }
];
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
