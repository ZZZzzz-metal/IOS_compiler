// Person05: audit recorded browser DOM only; never drives a page or compiles code.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const round=new URL('./evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/',import.meta.url);
const browser=new URL('browser/',round);
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{assert.match(arg,/^--[a-z-]+=/);const at=arg.indexOf('=');return [arg.slice(2,at),arg.slice(at+1)];}));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[];
function check(name,fn){fn();checks.push(name);}
const observations=[];
for(const name of (await readdir(browser)).filter(name=>/^\d{3}-.+\.json$/.test(name)).sort()){
 const bytes=await readFile(new URL(name,browser));
 observations.push({name,bytes:bytes.length,sha256:sha(bytes),data:JSON.parse(bytes)});
}
const byNumber=new Map(observations.map(item=>[Number(item.name.slice(0,3)),item]));
const at=number=>{const result=byNumber.get(number);assert(result,`Missing observation ${number}`);return result.data;};
const source=observation=>{const field=observation.dom.fields.find(field=>field.id==='source');assert(field,'Recorded source textarea');return field.value;};
const select=(observation,id)=>{const field=observation.dom.selects.find(field=>field.id===id);assert(field,`Recorded select ${id}`);return field.value;};
const statuses=observation=>observation.dom.statuses??[];
function popup(observation){
 const marker='- listbox "代码提示":';
 const index=observation.snapshot.indexOf(marker);
 if(index<0)return [];
 // Only actual listbox option rows are candidate evidence. Source declarations
 // and stale footer/status text must not be searched as candidate membership.
 return observation.snapshot.slice(index+marker.length).split('\n').filter(line=>/^  - option "/.test(line)).map(line=>line.replace(/^  - option "/,'').replace(/"(?: \[[^\]]+\])?:?$/,''));
}
check('numbered-observations-contiguous-and-fixed-local-release',()=>{
 assert(observations.length>=31);
 observations.forEach((item,index)=>{
  assert.equal(Number(item.name.slice(0,3)),index+1);
  assert.match(item.data.url,/^http:\/\/127\.0\.0\.1:4265\/releases\/ipad-web-probe-4b6a8377cadd31e675701549\/(?:index\.html|ui\/probe\.html)$/);
  assert(Number.isFinite(Date.parse(item.data.at)));
  assert.equal(typeof item.data.snapshot,'string');
 });
});
check('prepared-and-stopped-server-cold-launcher-check-65',()=>{
 for(const number of [3,4])assert.match(at(number).dom.text,/已检查 65 项资源，可以打开工作台/);
 assert.match(at(3).dom.text,/60,976,781 字节/);
});
check('const-string64-preserves-size-cstr-excludes-append',()=>{
 const options=popup(at(9));assert.equal(options.length,64);
 assert(options.some(option=>/^符号 size /.test(option)));
 assert(options.some(option=>/^符号 c_str /.test(option)));
 assert(!options.some(option=>/^符号 append /.test(option)));
 assert.match(source(at(9)),/const std::string frozen; frozen\.$/);
});
check('const-append-prefix-no-match-is-real-negative',()=>{
 assert.match(source(at(10)),/const std::string frozen; frozen\.ap$/);
 assert(statuses(at(10)).includes('没有匹配的代码提示。'));
 assert.equal(popup(at(10)).length,0);
});
check('mutable-string-prefix-retains10-append-options',()=>{
 const options=popup(at(11));assert.equal(options.length,10);
 assert(options.every(option=>/^符号 append /.test(option)));
 assert.match(source(at(11)),/\{ std::string frozen; frozen\.ap$/);
});
check('const-concrete-template-retains-const-and-static-excludes-mutable',()=>{
 const options=popup(at(12));assert.equal(options.length,2);
 assert(options.some(option=>/^符号 v047Inspect int v047Inspect\(U\) const$/.test(option)));
 assert(options.some(option=>/^符号 v047Relay int v047Relay\(U value\)$/.test(option)));
 assert(!options.some(option=>/^符号 v047Mutate /.test(option)));
 assert.match(source(at(12)),/const FieldBox<int> box\{\}; box\.v047$/);
});
check('mutable-template-positive-retains-three-members',()=>{
 const options=popup(at(13));assert.equal(options.length,3);
 for(const name of ['v047Inspect','v047Mutate','v047Relay'])assert(options.some(option=>option.startsWith(`符号 ${name} `)));
 assert.match(source(at(13)),/\{ FieldBox<int> box\{\}; box\.v047$/);
});
check('availability-keeps-ordinary-deprecated-and-legal-overload-only',()=>{
 const options=popup(at(14));assert.equal(options.length,3);
 assert.deepEqual(options,[
  '符号 pkgChoice int pkgChoice(double)',
  '符号 pkgDeprecated int pkgDeprecated()',
  '符号 pkgOrdinary int pkgOrdinary()'
 ]);
 // Input must still contain the unavailable/deleted declarations; this is not
 // a test where those declarations were removed to obtain an empty negative.
 assert.match(source(at(14)),/unavailable\("v047-unavailable"\)/);
 assert.match(source(at(14)),/int pkgChoice\(int\) = delete;/);
});
check('017-018-are-newline-exploration-not-completion-proof',()=>{
 assert.equal(source(at(17)),source(at(18))+'\n');
 assert.match(source(at(18)),/box\.v047In$/);
 assert.equal(popup(at(17)).length,0);assert.equal(popup(at(18)).length,0);
});
check('019-ready-020-single-insertion-021-native-undo-022-redo',()=>{
 assert.deepEqual(popup(at(19)),['符号 v047Inspect int v047Inspect(U) const']);
 assert.match(source(at(19)),/box\.v047In$/);
 assert.equal(source(at(20)),source(at(19))+'spect');
 assert.equal(source(at(21)),source(at(19)));
 assert.equal(source(at(22)),source(at(20)));
 for(const number of [19,20,21,22]){
  const field=at(number).dom.fields.find(field=>field.id==='source');
  assert.equal(field.selectionStart,field.value.length);assert.equal(field.selectionEnd,field.value.length);
 }
});
const program=await readFile(new URL('final-program.cpp',browser),'utf8');
check('new-program-source-equal-at-complete-run-and-session-cold-recovery',()=>{
 assert.equal(Buffer.byteLength(program),749);
 for(const number of [24,25,26,27,28,29,30,31])assert.equal(source(at(number)),program);
 assert.match(program,/box\.v047Inspect\(0\)/);
 assert.match(program,/pkgOrdinary\(\) \+ pkgDeprecated\(\) \+ pkgChoice\(1\.0\)/);
});
check('real-offline-run-output41-and-exit41',()=>{
 assert.match(at(26).snapshot,/exit · 返回 41/);
 assert.match(at(26).snapshot,/person05-v047=41/);
 assert(statuses(at(26)).includes('已结束'));
});
check('recovered-cold-draft-revision11-cpp-and-resource-revalidation',()=>{
 assert(statuses(at(29)).includes('草稿已保存 · 版本 11'));
 assert(statuses(at(29)).includes('编译资源未校验'));
 assert.equal(select(at(29),'language'),'cpp');
 assert(statuses(at(31)).includes('本版本离线资源已校验 · iPad 真机待验证'));
});

// Final milestones are exact filenames supplied after the actual browser
// sequence finishes. Missing final evidence fails rather than becoming a pass.
async function named(key){
 const name=args[key];assert(name,`Required --${key}=observation.json`);
 assert.match(name,/^\d{3}-.+\.json$/);
 const item=observations.find(item=>item.name===name);assert(item,`Missing ${name}`);return item.data;
}
if(args.mode!=='initial'){
 const paused=await named('paused'),saved=await named('saved'),cold=await named('cold');
 check('real-debug-pause-value-stable29-outcome41',()=>{
  assert.equal(source(paused),program);
  assert(statuses(paused).includes('已暂停 · main.cpp:18:1'));
  assert.match(paused.snapshot,/- button "main · main\.cpp:18:1" \[pressed\]/);
  assert.match(paused.snapshot,/- paragraph:\n      - code: stable\n      - emphasis: int\n      - generic: "29"/);
  assert.match(paused.snapshot,/- paragraph:\n      - code: outcome\n      - emphasis: int\n      - generic: "41"/);
 });
 check('saved-keyboard-scheme-and-exact-draft-survive-cold-reopen',()=>{
  assert.equal(source(saved),program);assert.equal(source(cold),program);
  assert.equal(select(saved,'shortcut-scheme'),'standard');
  assert.equal(select(cold,'shortcut-scheme'),'standard');
  assert.equal(select(cold,'language'),'cpp');
  const savedStatus=statuses(saved).find(status=>/^草稿已保存 · 版本 \d+$/.test(status));
  assert(savedStatus);assert(statuses(cold).includes(savedStatus));
  assert(statuses(saved).includes('已记住此浏览器的选择。'));
 });
 check('debug-continued-to-output41-and-exit41',()=>{
  assert.equal(source(at(36)),program);
  assert.match(at(36).snapshot,/exit · 返回 41/);
  assert.match(at(36).snapshot,/person05-v047=41/);
  assert(statuses(at(36)).includes('已结束'));
 });
 check('second-cold-launcher65-loading-record-excluded-final-ready',()=>{
  assert.match(at(39).dom.text,/已检查 65 项资源，可以打开工作台/);
  assert(statuses(at(40)).includes('正在读取本地草稿…'));
  assert.equal(source(at(43)),program);
  assert.equal(select(at(43),'shortcut-scheme'),'standard');
  assert.equal(select(at(43),'language'),'cpp');
  assert(statuses(at(43)).includes('草稿已保存 · 版本 11'));
  assert(statuses(at(43)).includes('本版本离线资源已校验 · iPad 真机待验证'));
 });
 for(const name of ['final-ready-console.json','recovered-workbench-console.json']){
  const logs=JSON.parse(await readFile(new URL(name,browser),'utf8'));
  check(name+'-recorded-warn-error-empty',()=>assert.deepEqual(logs,[]));
 }
}

const serverLog=(await readFile(new URL('server/requests.jsonl',round),'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
const stoppedAt=serverLog.findIndex(entry=>entry.type==='stopped');
check('server-stopped-once-no-request-after-stop-all-later-dom-after-stop',()=>{
 assert(stoppedAt>=0);assert.equal(serverLog.length-1,stoppedAt);
 assert.equal(serverLog.filter(entry=>entry.type==='stopped').length,1);
 for(const item of observations.filter(item=>Number(item.name.slice(0,3))>=4))assert(Date.parse(item.data.at)>Date.parse(serverLog[stoppedAt].at));
});
for(const name of ['server/after-stop.json','server/reconnected-listener-check.json']){
 const data=JSON.parse((await readFile(new URL(name,round),'utf8')).replace(/^\uFEFF/,''));
 check(name+'-listener-zero',()=>{assert.equal(data.port,4265);assert.equal(data.listenerCount,0);assert.deepEqual(data.records,[]);});
}
const report={at:new Date().toISOString(),passed:true,mode:args.mode==='initial'?'initial-record-audit':'final-record-audit',command:{executable:process.execPath,args:process.argv.slice(1),scriptSHA256:sha(await readFile(new URL(import.meta.url)))},target:'912a23bf14cd6e48a0adb7ec119f4ce86bc58f93',bundleId:'ipad-web-probe-4b6a8377cadd31e675701549',browserObservationCount:observations.length,checkCount:checks.length,checks,source:{byteLength:Buffer.byteLength(program),sha256:sha(program)},milestones:Object.fromEntries(['paused','saved','cold'].filter(key=>args[key]).map(key=>[key,args[key]])),excludedAsProof:{'017-018':'Enter while still pending inserted a newline; undo removed that newline. Actual completion transaction is019-022.','028':'Debug compilation had started; no paused value claimed from this observation.','023':'Partial typing after tool deadline, corrected by024 before compile.','040':'Initial asynchronous draft loading; exact recovery is041 and043.'},scope:'Read-only consistency audit of recorded DOM/snapshots and local server log; no product execution, system network disconnection or physical iPad verification.',observations:observations.map(({data,...entry})=>entry)};
if(args.out){assert.match(args.out,/^[a-z0-9.-]+\.json$/);await writeFile(new URL(args.out,round),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({passed:report.passed,mode:report.mode,checkCount:report.checkCount,browserObservationCount:report.browserObservationCount,output:args.out?fileURLToPath(new URL(args.out,round)):null},null,2));
