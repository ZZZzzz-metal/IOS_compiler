// Shared by the development workbench and the versioned offline entry.
export const ISOLATED_WORKER_PATHS=Object.freeze([
  'compiler/src/compiler-worker.mjs','compiler/src/completion-worker.mjs','debugger/src/debugger-worker.mjs',
]);
export function verifyOfflineWorker(worker, {timeoutMs=120000,type='OFFLINE_VERIFY'}={}) {
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel(),requestId=crypto.randomUUID();
    const timer=setTimeout(()=>finish(new Error('离线资源检查超时。请保持此页面在前台后重试。')),timeoutMs);
    function finish(error,value){clearTimeout(timer);channel.port1.close();if(error)reject(error);else resolve(value);}
    channel.port1.onmessage=event=>{
      const value=event.data;
      if(value?.type!=='OFFLINE_VERIFIED'||value.requestId!==requestId)return;
      if(!value.ok)finish(new Error(value.error||'已存离线资源不完整，请联网重新准备。'));
      else finish(null,value);
    };
    channel.port1.onmessageerror=()=>finish(new Error('无法读取离线资源检查结果。'));
    try{worker.postMessage({type,requestId},[channel.port2]);}catch(error){finish(error);}
  });
}

export async function assertTrustedOfflineWorkers(candidate,baseURL){
  if(!navigator.serviceWorker)return {offline:false};
  const base=new URL(baseURL),expectedScript=new URL('sw.js',base).href;
  const workerURLs=ISOLATED_WORKER_PATHS.map(path=>new URL(path,base).href);
  const registrations=await navigator.serviceWorker.getRegistrations();
  const covering=registrations.filter(reg=>reg.active&&workerURLs.some(url=>url.startsWith(reg.scope)));
  if(!covering.length)return {offline:false};
  if(covering.some(reg=>reg.scope!==base.href||reg.active.scriptURL!==expectedScript)){
    throw Error('此地址受其他实验页的离线缓存控制。请使用独立入口或端口；原缓存和草稿已保留。');
  }
  if(covering.length!==1)throw Error('发现重叠的离线资源范围，请使用独立入口。');
  const result=await verifyOfflineWorker(covering[0].active);
  const bundleId=base.pathname.split('/').filter(Boolean).at(-1);
  if(result.baseURL!==base.href||result.bundleId!==bundleId||
      result.compatibilityId!==candidate.profile.compatibilityId||
      result.resourceManifestHash!==candidate.profile.resourceManifestHash){
    throw Error('当前离线资源与工作台的编译调试组合不一致。请返回该版本的离线准备页检查。');
  }
  return {offline:true,bundleId:result.bundleId};
}
