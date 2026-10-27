import {verifyOfflineWorker} from './app/offline/browser/trust.mjs';
const $=id=>document.getElementById(id),baseURL=new URL('./',location.href).href;
let descriptor=null,busy=false;
function access(ready){$('open-workbench').classList.toggle('disabled',!ready);$('open-workbench').setAttribute('aria-disabled',String(!ready));$('open-workbench').tabIndex=ready?0:-1;}
function state(message,working=false){busy=working;$('status').textContent=message;$('progress').hidden=!working;$('prepare').disabled=working||!descriptor;$('verify').disabled=working||!descriptor;}
function fail(error){access(false);$('error').hidden=false;$('error').textContent=error?.message??String(error);state('离线资源尚未就绪。原草稿不会被清除。');}
function clearError(){$('error').hidden=true;$('error').textContent='';}
async function ownRegistration(){
  const registration=await navigator.serviceWorker.getRegistration(baseURL);
  if(!registration)return null;
  if(registration.scope!==baseURL)throw Error('此入口被其他实验页的缓存覆盖，请使用独立地址。原缓存已保留。');
  if(registration.active&&registration.active.scriptURL!==new URL('sw.js',baseURL).href)throw Error('当前缓存不属于此版本，请使用独立地址。');
  return registration;
}
async function verify(){
  access(false);clearError();state('正在逐项检查已存资源，请保持页面在前台…',true);
  try{
    const registration=await ownRegistration();
    if(!registration?.active){state('尚未保存本版本。请联网点击“准备离线资源”。');return;}
    const result=await verifyOfflineWorker(registration.active);
    if(result.bundleId!==descriptor.bundleId||result.baseURL!==baseURL||result.compatibilityId!==descriptor.compatibilityId||result.resourceManifestHash!==descriptor.resourceManifestHash||result.resourceCount!==descriptor.resources.length)throw Error('已存资源与当前版本清单不一致。');
    access(true);state(`已检查 ${result.resourceCount} 项资源，可以打开工作台。iPad 完全离线仍需按手册实测。`);
  }catch(error){fail(error);}
}
function activated(registration){
  if(registration.active)return Promise.resolve(registration.active);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('资源准备超时，请保持联网和页面前台后重试。')),180000);
    let watched=null;
    function finish(error,worker){clearTimeout(timer);registration.removeEventListener('updatefound',watch);watched?.removeEventListener('statechange',changed);if(error)reject(error);else resolve(worker);}
    function changed(){if(watched.state==='activated')finish(null,watched);else if(watched.state==='redundant')finish(new Error('资源下载或校验失败。请检查网络与可用空间后重试。'));}
    function watch(){const worker=registration.installing||registration.waiting||registration.active;if(!worker)return;watched?.removeEventListener('statechange',changed);watched=worker;worker.addEventListener('statechange',changed);changed();}
    registration.addEventListener('updatefound',watch);watch();
  });
}
async function prepare(){
  if(busy)return;access(false);clearError();state('正在下载并校验本版本资源，请保持联网和页面前台…',true);
  try{
    const existing=await ownRegistration();
    if(existing?.active){
      // Re-registering identical worker bytes does not run install again.
      // Repair is an explicit transaction, never a fetch-time network fallback.
      state('请关闭本版本其他工作台窗口；正在重新下载并校验资源，原草稿和其他版本会保留…',true);
      await verifyOfflineWorker(existing.active,{type:'OFFLINE_PREPARE',timeoutMs:180000});
    }else{
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      await activated(registration);
    }
    await verify();
  }catch(error){fail(error);}
}
$('prepare').addEventListener('click',prepare);
$('verify').addEventListener('click',()=>{if(!busy)void verify();});
$('open-workbench').addEventListener('click',event=>{if(event.currentTarget.getAttribute('aria-disabled')==='true')event.preventDefault();});
$('persist').addEventListener('click',async()=>{
  $('persist').disabled=true;
  try{const allowed=await navigator.storage.persist();$('storage-status').textContent=allowed?'系统已授予保留请求。仍请导出重要草稿，系统行为需真机验证。':'系统暂未授予保留请求。可以继续测试，请导出重要草稿。';}
  catch(error){$('storage-status').textContent=`存储保留请求失败：${error.message}。请导出重要草稿。`;}
  finally{$('persist').disabled=false;}
});
async function start(){
  access(false);
  try{
    if(!isSecureContext||!navigator.serviceWorker||!crypto.subtle)throw Error('离线入口需要受信任的 HTTPS。电脑本机 localhost 可用于开发验证；平板不能使用电脑的 localhost 或普通 HTTP 地址。');
    const response=await fetch('./bundle.json',{cache:'no-store'});
    if(!response.ok)throw Error('无法读取本版本清单，请联网重新打开该版本的入口。');
    descriptor=await response.json();
    if(descriptor.schemaVersion!==1||!Array.isArray(descriptor.resources)||!Number.isSafeInteger(descriptor.totalBytes))throw Error('本版本资源清单格式无效。');
    const mib=(descriptor.totalBytes/1048576).toFixed(1);
    $('bundle-details').textContent=`版本 ${descriptor.bundleId} · ${descriptor.resources.length} 项 · 下载约 ${mib} MiB（${descriptor.totalBytes.toLocaleString()} 字节）`;
    $('persist').disabled=!navigator.storage?.persist;
    await verify();
  }catch(error){fail(error);$('prepare').disabled=true;$('verify').disabled=true;}
}
void start();
