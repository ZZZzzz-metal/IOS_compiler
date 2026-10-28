// Verify already captured public DOM and real static-host lifecycle evidence.
// This script does not launch a browser or emulate cache, Worker, compiler, or DB.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),repo=new URL('../../../../',here);
const json=async p=>JSON.parse((await readFile(new URL(p,here),'utf8')).replace(/^\uFEFF/,''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const index=await json('observations-index.json');assert.equal(index.length,69);
const records=new Map();for(const item of index){const r=await json(item.file);assert.equal(r.step,item.step);assert.equal(r.at,item.at);assert.equal(r.url,item.url);assert(!records.has(r.step));records.set(r.step,r);}
const get=step=>{assert(records.has(step),step);return records.get(step);};
const dom=(step,text)=>assert(get(step).dom.includes(text),`${step}: ${text}`);
const source=await readFile(new URL('offline-new-source.cpp',here),'utf8');
const source2=await readFile(new URL('offline-after-repairs-new-source.cpp',here),'utf8');
for(const step of ['online-prepared-51','server-stopped-cold-launcher-51-passed','index-missing-product-repair-complete','trust-corrupt-product-repair-complete','after-repairs-offline-launcher-51-passed'])dom(step,'已检查 51 项资源');
for(const [step,line] of [
 ['offline-standard-F5-entry7',7],['offline-standard-F10-to8',8],['offline-stdin-F10-stays8',8],['offline-standard-F11-enters3',3],['offline-standard-shiftF11-returns8',8],['offline-standard-F10-stores-total29-at9',9],['offline-standard-F5-hits-breakpoint13',13],
 ['offline-control5-entry-state',7],['offline-control0-to8',8],['offline-controlMinus-enters3',3],['offline-controlShiftMinus-returns8',8],['offline-control0-stores29-at9',9],['offline-control5-breakpoint13',13],
])dom(step,`已暂停 · main.cpp:${line}:1`);
dom('offline-standard-F11-enters3','lift · main.cpp:3:1');
dom('offline-controlMinus-enters3','lift · main.cpp:3:1');
for(const step of ['offline-standard-F10-stores-total29-at9','offline-control0-stores29-at9'])dom(step,'generic: "29"');
for(const step of ['offline-standard-F5-exit-output29-0-1','offline-standard-controlF5-run-output29-exit0','offline-control5-exit-output','offline-control6-run-output29-exit0']){
 dom(step,'generic "程序输出": person05-r3=29 mix=0 bool=1');dom(step,'exit · 返回 0');
}
for(const step of ['offline-standard-shiftF5-stop','offline-controlShift5-stop'])dom(step,'heading "程序输出 stop"');
dom('offline-watch-mixed-float-result0','code: negative + exactInt\n      - emphasis: float\n      - generic: "0"');
dom('offline-watch-nan-shortcircuit-result1','code: nanValue || (1/zero)\n      - emphasis: bool\n      - generic: "1"');
const bp=step=>get(step).fields.gutter.find(e=>e.line==='13')?.bp;
assert.equal(bp('offline-standard-F9-breakpoint13'),'true');
assert.notEqual(bp('offline-control9-removes-breakpoint13'),'true');
assert.equal(bp('offline-control9-restores-breakpoint13'),'true');
assert.equal(get('offline-restored-sentinel-stdin-standard').fields.stdin,'person05-saved-input');
assert.equal(get('offline-restored-sentinel-stdin-standard').fields.scheme,'standard');
for(const step of ['index-repair-workbench-draft-load-complete','trust-repair-restored-draft-and-scheme','after-repairs-offline-draft-control-scheme-restored']){
 assert.equal(get(step).fields.source,source);assert.equal(get(step).fields.scheme,'control-number');dom(step,'草稿已保存 · 版本 2');
}
const caches=step=>JSON.parse(get(step).fields.cacheSnapshot);
const critical=(step,path)=>caches(step).resources.find(e=>e.path===path);
assert.equal(critical('real-cache-index-deleted','index.html').present,false);
assert.equal(critical('real-cache-index-deleted','index.html').backupInThisPage,true);
const before=caches('real-cache-current-completed-before-trust-fault'),broken=caches('real-cache-current-trust-corrupted');
assert.equal(before.selected,broken.selected);assert(before.selected.endsWith('e6590a98-3a49-4924-b26e-c1b1b13942cd'));
assert.equal(critical('real-cache-current-completed-before-trust-fault','index.html').present,true);
assert.equal(critical('real-cache-current-trust-corrupted','app/offline/browser/trust.mjs').byteLength,46);
assert.notEqual(critical('real-cache-current-trust-corrupted','app/offline/browser/trust.mjs').sha256,critical('real-cache-current-completed-before-trust-fault','app/offline/browser/trust.mjs').sha256);
for(const prefix of ['index-missing','trust-corrupt']){
 dom(prefix+'-offline-recovery-page','本版本离线入口需要恢复');dom(prefix+'-offline-recovery-page','尚未下载任何资源');
 dom(prefix+'-offline-repair-fails-retry-preserved','Failed to fetch');
 dom(prefix+'-offline-repair-fails-retry-preserved','button "联网重新准备资源"');
 assert(!get(prefix+'-offline-repair-fails-retry-preserved').dom.includes('button "联网重新准备资源" [disabled]'));
}
for(const entry of caches('real-cache-latest-repaired-all-critical-original').resources){
 const orig=critical('real-cache-before-index-delete',entry.path);assert.equal(entry.present,true);assert.equal(entry.byteLength,orig.byteLength);assert.equal(entry.sha256,orig.sha256);
}
dom('after-repairs-offline-new-seed15-output31-exit0','generic "程序输出": person05-recovered=31 mix=0 bool=1');
dom('after-repairs-offline-new-seed15-output31-exit0','exit · 返回 0');
assert.equal(get('final-offline-draft3-restored').fields.source,source2);assert.equal(get('final-offline-draft3-restored').fields.scheme,'control-number');dom('final-offline-draft3-restored','草稿已保存 · 版本 3');
const lifecycle=[];
for(const path of ['stopped-before-cold-start.json','stopped-before-index-fault.json','stopped-before-trust-fault.json','stopped-after-both-repairs.json']){const r=await json(path);assert.equal(r.listeningCount,0);lifecycle.push({path,...r});}
assert(new Date(lifecycle[0].checkedAt)<new Date(get('offline-new-source-unprepared-F5-preserved').at));
assert(new Date(lifecycle[1].checkedAt)<new Date(get('index-missing-offline-recovery-page').at));
assert(new Date(lifecycle[2].checkedAt)<new Date(get('trust-corrupt-offline-recovery-page').at));
assert(new Date(lifecycle[3].checkedAt)<new Date(get('after-repairs-offline-new-seed15-source-entered').at));
await mkdir(new URL('fixture-source/',here),{recursive:true});
const frozen={
 'offline-browser-host.mjs':'572588fbce0c87612303b42fca1eb5a184a630a12fb003157be5bdc01243d048',
 'offline-cache-control.html':'3b46de1afbac02e5b6d242f27046e8a21d2c9c3065d223d92668bcc0e44518d7',
 'OFFLINE-BROWSER-FIXTURE.md':'cacbd3cc5d4f5ef81d00cd43f6ee15ef00b9a642f5792230100323376a87f41c'
};
for(const [file,hash] of Object.entries(frozen)){const b=await readFile(new URL('tests/'+file,repo));assert.equal(sha(b),hash);await writeFile(new URL('fixture-source/'+file,here),b,{flag:'wx'});}
const bundleBytes=await readFile(new URL('tests/.local/final-v045-r3/site/releases/ipad-web-probe-eb5236b6ed8f9aab4a9d9ced/bundle.json',repo));
await writeFile(new URL('bundle-original.json',here),bundleBytes,{flag:'wx'});const bundle=JSON.parse(bundleBytes);
const logs=[];
for(let i=1;i<=4;i++){
 const file=`server-0${i}.jsonl`,b=await readFile(new URL(file,here)),entries=b.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
 assert.equal(entries[0].type,'listening');const paths=new Set(entries.filter(e=>e.type==='request'&&e.status===200).map(e=>e.path));
 const present=bundle.resources.filter(e=>paths.has('/releases/'+bundle.bundleId+'/'+e.path));
 if(i===1||i===3||i===4)assert.equal(present.length,51,file+' actual network resource preparation');
 if(i===2)assert(entries.filter(e=>e.type==='request').every(e=>e.path==='/_person05/cache-control.html'));
 logs.push({file,sha256:sha(b),requests:entries.filter(e=>e.type==='request').length,manifestResourcesDownloaded:present.length,firstAt:entries[0].at,lastAt:entries.at(-1).at});
}
const summary={recordedAt:new Date().toISOString(),observations:index.length,passed:true,sourceSHA256:sha(Buffer.from(source)),recoveredSourceSHA256:sha(Buffer.from(source2)),manifestResources:bundle.resources.length,totalBytes:bundle.totalBytes,logs,lifecycle,fixtureSHA256:frozen,conclusion:{coldStartAndNewCompile:'passed in actual desktop IAB with static host stopped',shortcutSchemes:'seven actions per scheme observed; standard and Control numbers',realCacheFaults:['index.html missing','trust.mjs corrupt in current completed cache'],productRepair:'both repair paths passed, 51 downloads verified each, draft/settings preserved',rev001:'independently closed only for these tested desktop cache faults',actualSystemNetworkDisabled:false,actualIpadTested:false,strongDraftDurabilityTested:false},notes:[
 'The first process started 08:44:06.339Z; fixture-only port guard was last edited 08:44:10.661Z/08:44:11.024Z. No control page was loaded in process01; release archive bytes never changed. Processes02-04 use frozen fixture bytes.',
 'One trust corruption initially selected the old broken cache. That observation is preserved; the actual second fault explicitly selected the newly completed e659 cache and verified its intact index first.',
 'Initial asynchronous draft-loading snapshots do not prove a missing draft; later completed snapshots independently match exact original source.',
 'Control stop scenario began compiling offline; process02 briefly served only the control page, then was stopped before CtrlShift5. These observations are not proof of system-level network isolation.',
 'The fixture retained response backups; successful recoveries used only the product repair button, never the fixture restore button.',
 'Browser DOM does not expose a complete BuildManifest/session identity; automatic actual-Wasm and browser observations retain their separate evidence scopes.'
]};
await writeFile(new URL('verification.json',here),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log('69 recorded observations verified; 51-resource online preparations x3; actual stopped-host cold start/new builds and two product cache repairs passed.');
