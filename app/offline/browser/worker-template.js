/* Generated once for an immutable release. Do not use this template as a worker directly. */
const BUNDLE=__BUNDLE_DESCRIPTOR__;
const BASE=new URL('./',self.location.href).href;
const PREFIX=`ipad-debugger-offline:${BUNDLE.bundleId}:`;
const MARKER=new URL('__offline_complete__',BASE).href;
const FILES=new Map(BUNDLE.resources.map(resource=>[new URL(resource.path,BASE).href,resource]));
const DESCRIPTOR_URL=new URL('bundle.json',BASE).href;
const CACHE_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
// These files must work before the launcher can offer its full check or repair button.
const STARTUP_PATHS=['index.html','launcher.mjs','app/offline/browser/trust.mjs'];
async function digest(bytes){return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
async function checked(response,resource){
  if(!response||!response.ok||response.type==='opaque')throw Error(`资源缺失：${resource.path}`);
  const bytes=await response.clone().arrayBuffer();
  if(bytes.byteLength!==resource.byteLength||await digest(bytes)!==resource.sha256)throw Error(`资源校验失败：${resource.path}`);
  return response;
}
async function completeCache(){
  const names=await caches.keys();
  for(const name of names.filter(name=>name.startsWith(PREFIX)).reverse()){
    const cache=await caches.open(name),marker=await cache.match(MARKER);
    if(!marker)continue;
    try{const value=await marker.json();if(value.bundleId===BUNDLE.bundleId&&value.compatibilityId===BUNDLE.compatibilityId&&value.resourceManifestHash===BUNDLE.resourceManifestHash)return cache;}catch{}
  }
  throw Error('本版本尚无完整离线资源，请联网重新准备。');
}
async function verifyCache(cache){
  for(const resource of BUNDLE.resources)await checked(await cache.match(new URL(resource.path,BASE).href),resource);
  const descriptor=await cache.match(DESCRIPTOR_URL);
  if(!descriptor||await descriptor.text()!==JSON.stringify(BUNDLE)+'\n')throw Error('本版本的离线清单缺失或损坏。');
}
async function verifyStartup(cache){
  for(const path of STARTUP_PATHS){
    const url=new URL(path,BASE).href,resource=FILES.get(url);
    if(!resource)throw Error(`启动资源未列入清单：${path}`);
    await checked(await cache.match(url),resource);
  }
  const descriptor=await cache.match(DESCRIPTOR_URL);
  if(!descriptor||await descriptor.text()!==JSON.stringify(BUNDLE)+'\n')throw Error('启动清单缺失或损坏。');
}
let staging=null;
async function noOtherWindows(sourceId){
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  if(windows.some(client=>client.id!==sourceId&&client.url.startsWith(BASE)))throw Error('请先关闭本版本的其他工作台或准备页窗口，再回此页重试。');
}
async function stageCache(sourceId){
  if(staging)return staging;
  staging=(async()=>{
    const name=PREFIX+'staging-'+crypto.randomUUID(),cache=await caches.open(name);
    try{
      for(const resource of BUNDLE.resources){
        const url=new URL(resource.path,BASE).href;
        const response=await fetch(url,{cache:'no-store',credentials:'same-origin',redirect:'error'});
        await checked(response,resource);await cache.put(url,response);
      }
      await cache.put(DESCRIPTOR_URL,new Response(JSON.stringify(BUNDLE)+'\n',{headers:CACHE_HEADERS}));
      await verifyCache(cache);
      if(sourceId)await noOtherWindows(sourceId);
      // This final write is the commit marker. Incomplete caches are never used.
      await cache.put(MARKER,new Response(JSON.stringify({bundleId:BUNDLE.bundleId,compatibilityId:BUNDLE.compatibilityId,resourceManifestHash:BUNDLE.resourceManifestHash}),{headers:CACHE_HEADERS}));
    }catch(error){await caches.delete(name);throw error;}
  })();
  try{await staging;}finally{staging=null;}
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{await verifyCache(await completeCache());return;}catch{}
    await stageCache();
  })());
});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function unavailable(message){return new Response(message,{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});}
function recoveryPage(){
  // This page comes from the installed worker, so it remains available even if
  // the cached launcher is lost. Only the button initiates a network transaction.
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>恢复离线资源</title><body><main><h1>本版本离线入口需要恢复</h1><p>资源可能被系统回收或损坏。请先关闭本版本的其他工作台窗口，联网后点击下面按钮。此操作保留原草稿和其他版本，不会恢复已终止的调试会话。</p><button id="repair">联网重新准备资源</button><p id="status" role="status">尚未下载任何资源。</p></main><script>
document.getElementById('repair').addEventListener('click',async()=>{
 const button=document.getElementById('repair'),status=document.getElementById('status');button.disabled=true;
 status.textContent='正在重新下载并逐项校验，请保持页面在前台…';
 try{
  const registration=await navigator.serviceWorker.getRegistration(location.href);
  if(!registration?.active)throw Error('本版本离线入口已失效，请重新打开提供给你的HTTPS入口。');
  await new Promise((resolve,reject)=>{
   const channel=new MessageChannel(),requestId=crypto.randomUUID();
   const timer=setTimeout(()=>finish(new Error('准备超时，请保持联网后重试。')),180000);
   function finish(error){clearTimeout(timer);channel.port1.close();error?reject(error):resolve();}
   channel.port1.onmessage=event=>{const value=event.data;if(value?.type==='OFFLINE_VERIFIED'&&value.requestId===requestId)finish(value.ok?null:new Error(value.error||'资源准备失败。'));};
   registration.active.postMessage({type:'OFFLINE_PREPARE',requestId},[channel.port2]);
  });
  location.reload();
 }catch(error){status.textContent=error.message;button.disabled=false;}
});
</script></body></html>`;
  return new Response(html,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||!url.href.startsWith(BASE))return;
  url.search='';url.hash='';
  if(url.href===BASE)url.pathname+='index.html';
  event.respondWith((async()=>{
    try{
      const cache=await completeCache();
      if(request.mode==='navigate'&&url.href===new URL('index.html',BASE).href)await verifyStartup(cache);
      if(url.href===DESCRIPTOR_URL){const result=await cache.match(DESCRIPTOR_URL);if(!result||await result.clone().text()!==JSON.stringify(BUNDLE)+'\n')throw Error('离线清单损坏');return result;}
      const resource=FILES.get(url.href);
      if(!resource)return unavailable('此文件不属于当前离线版本。请返回本版本的准备页。');
      return await checked(await cache.match(url.href),resource);
    }catch(error){
      if(request.mode==='navigate'&&url.href===new URL('index.html',BASE).href)return recoveryPage();
      return unavailable(`离线资源不可用：${error.message}。请联网返回离线准备页重试，保留原草稿。`);
    }
  })());
});
self.addEventListener('message',event=>{
  if(!['OFFLINE_VERIFY','OFFLINE_PREPARE'].includes(event.data?.type)||!event.ports[0])return;
  const requestId=event.data.requestId;
  event.waitUntil((async()=>{
    let error=null;
    try{
      if(event.data.type==='OFFLINE_PREPARE'){
        const source=event.source,sourceURL=source?.url&&new URL(source.url);
        if(!source?.id||!sourceURL||![BASE,new URL('index.html',BASE).href].includes(sourceURL.origin+sourceURL.pathname))throw Error('请从本版本的离线准备页主动准备资源。');
        await noOtherWindows(source.id);
        await stageCache(source.id);
      }
      await verifyCache(await completeCache());
    }catch(problem){error=problem.message;}
    event.ports[0].postMessage({type:'OFFLINE_VERIFIED',requestId,ok:!error,bundleId:BUNDLE.bundleId,
      compatibilityId:BUNDLE.compatibilityId,resourceManifestHash:BUNDLE.resourceManifestHash,baseURL:BASE,
      resourceCount:BUNDLE.resources.length,error});
  })());
});
