import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createCompletionController} from '../ui/src/completion-controller.mjs';
import {mountCompletionEditor} from '../ui/src/completion-editor.mjs';
import {createRaceDocument} from './lib/completion-race-dom.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),target='b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const run=process.argv[2]??'run02';
assert.match(run,/^run\d{2,}$/u,'Use a fresh runNN evidence subdirectory');
const evidence=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30/controlled-races',run);
await mkdir(resolve(evidence,'..'),{recursive:true});
await mkdir(evidence,{recursive:false});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['ui/src/completion-controller.mjs','ui/src/completion-editor.mjs','ui/src/completion-popup.mjs','ui/src/completion-edit.mjs','ui/src/main.mjs','compiler/src/source.mjs'];
const inputs=[];
for(const file of files){const actual=await readFile(resolve(root,file)),fixed=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'show',`${target}:${file}`],{cwd:root});assert.equal(hash(actual),hash(fixed),`fixed product bytes: ${file}`);inputs.push({file,sha256:hash(actual),byteLength:actual.length});}
const events=[],results=[];let assertions=0;
const check=(condition,label)=>{assertions++;assert.ok(condition,label);};
const equal=(actual,expected,label)=>{assertions++;assert.deepEqual(actual,expected,label);};
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label){for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('Test transport timeout: '+label);}
const base=()=>({enabled:true,focused:true,composing:false,documentVersion:1,sourcePath:'main.cpp',text:'obj.pr',offset:6,selectionEnd:6,language:'cpp',standard:'c++17',snapshot:{snapshotId:'snapshot-1',sourceHash:'sha256:controlled',translationUnit:'main.cpp',files:[{path:'main.cpp',role:'user',text:'obj.pr'}]}});
const result=(request,label='print')=>({requestId:request.requestId,documentVersion:request.documentVersion,snapshotId:request.snapshot.snapshotId,sourceHash:request.snapshot.sourceHash,sourcePath:request.sourcePath,offset:request.offset,status:'succeeded',items:[{id:label,label,insertText:label,kind:'field',detail:'int '+label,replaceRange:{startOffset:4,endOffset:request.offset}}]});
async function scenario(name,callback){const before=assertions;try{await callback();results.push({name,status:'passed',assertions:assertions-before});process.stdout.write('PASS '+name+'\n');}catch(error){results.push({name,status:'failed',assertions:assertions-before,error:{message:error.message,stack:error.stack}});process.exitCode=1;process.stdout.write('FAIL '+name+': '+error.message+'\n');}}

function controllerHost(){let context=base();const requests=[],applied=[],cancelled=[];const controller=createCompletionController({getContext:()=>context,delayMs:0,complete:request=>{const gate=defer();requests.push({request,...gate});return gate.promise;},cancel:requestId=>{cancelled.push(requestId);},onApply:edit=>{applied.push(edit);return true;},onChange:state=>events.push({type:'controller',phase:state.phase,token:state.token,items:state.items.map(item=>item.label)})});return {controller,requests,applied,cancelled,get context(){return context;},set context(value){context=value;}};}

await scenario('superseding request waits previous settlement and rejects its late result',async()=>{
  const h=controllerHost(),first=h.controller.request();await until(()=>h.requests.length===1,'first request');
  h.context={...h.context,documentVersion:2};const second=h.controller.request();await tick();equal(h.requests.length,1,'new request has not crossed old drain');equal(h.cancelled,[h.requests[0].request.requestId],'old request cancelled exactly once');
  h.requests[0].resolve(result(h.requests[0].request,'prior'));await first;await until(()=>h.requests.length===2,'new request after settlement');equal(h.controller.state.items,[],'late old candidate never displayed');
  h.requests[1].resolve(result(h.requests[1].request));await second;equal(h.controller.state.phase,'open','new result opens');equal(h.controller.state.items.map(item=>item.label),['print'],'only current result visible');await h.controller.dispose();
});

for(const [name,change] of [
  ['caret',c=>({...c,offset:5,selectionEnd:5})],['version',c=>({...c,documentVersion:2})],
  ['language',c=>({...c,language:'c',standard:'c11'})],['focus',c=>({...c,focused:false})],
  ['composition',c=>({...c,composing:true})],['readonly gate',c=>({...c,enabled:false})],
  ['snapshot other file',c=>({...c,snapshot:{...c.snapshot,files:[...c.snapshot.files,{path:'header.h',role:'user',text:'int other;'}]}})],
  ['source path',c=>({...c,sourcePath:'other.cpp'})]
])await scenario('late completion discarded after '+name+' change',async()=>{
  const h=controllerHost(),pending=h.controller.request();await until(()=>h.requests.length===1,'request starts');h.context=change(h.context);h.requests[0].resolve(result(h.requests[0].request));await pending;equal(h.controller.state.phase,'idle','changed context returns idle');equal(h.controller.state.items,[],'changed context has no actionable candidate');equal(h.applied,[],'no edit');await h.controller.dispose();
});

await scenario('cancellation rejection drain waits request settlement without accepting old result',async()=>{
  let context=base(),request,settle;const gate=defer(),controller=createCompletionController({getContext:()=>context,complete:r=>{request=r;return gate.promise;},cancel:()=>Promise.reject(Error('controlled cancel failure')),onApply:()=>true});
  const pending=controller.request();await until(()=>request,'request starts');let drained=false;const drain=controller.invalidate().then(()=>drained=true);await tick();equal(drained,false,'drain does not imply settled request after cancellation failure');context={...context,documentVersion:2};gate.resolve(result(request));await pending;await drain;equal(controller.state.phase,'idle','failed cancellation cannot show late result');await controller.dispose();
});

await scenario('result token consumed before reentrant apply prevents double application',async()=>{
  let controller,applies=0;controller=createCompletionController({getContext:base,complete:async r=>result(r),onApply:edit=>{applies++;equal(controller.choose(0,edit.token),false,'reentrant second choice rejected');return true;}});await controller.request();const token=controller.state.token;equal(controller.choose(0,token),true,'first choice applied');equal(controller.choose(0,token),false,'later same token rejected');equal(applies,1,'one transaction callback');await controller.dispose();
});

function editorHost(options={}){
  const dom=createRaceDocument();let version=1,text='obj.pr',enabled=true,edits=0;dom.source.value=text;dom.source.setSelectionRange(text.length,text.length);dom.source.focus();
  const calls=[],requests=[],providers=[];
  const getContext=()=>({enabled,documentVersion:version,sourcePath:'main.cpp',language:'cpp',standard:'c++17',snapshot:{snapshotId:'s'+version,sourceHash:'sha256:'+version,translationUnit:'main.cpp',files:[{path:'main.cpp',role:'user',text}]}});
  dom.source.oninput=()=>{text=dom.source.value;version++;edits++;};
  const ui=mountCompletionEditor({...dom,getContext,onEdited:()=>{text=dom.source.value;version++;edits++;}});
  const factory=()=>{const index=providers.length;const provider={complete(request){const gate=defer();calls.push(['complete',index,request.requestId]);requests.push({request,...gate});return gate.promise;},cancel(id){calls.push(['cancel',index,id]);return options.cancel?.(id,index);},dispose(){calls.push(['dispose-start',index]);const value=options.dispose?.(index);return Promise.resolve(value).then(()=>{calls.push(['dispose-end',index]);});}};providers.push(provider);return provider;};
  return {...dom,ui,calls,requests,providers,factory,get writes(){return dom.writes;},get edits(){return edits;},get enabled(){return enabled;},set enabled(value){enabled=value;},setText(value){text=value;version++;dom.source.value=value;dom.source.setSelectionRange(value.length,value.length);},async open(){dom.button.fire('click');await until(()=>requests.length>0,'editor request starts');requests.at(-1).resolve(result(requests.at(-1).request));await until(()=>ui.state.phase==='open','popup open');}};
}

await scenario('completed warm provider release is awaited and reentrant release disposes once',async()=>{
  const disposal=defer(),h=editorHost({dispose:()=>disposal.promise});await h.ui.setProviderFactory(h.factory);await h.open();equal(h.providers.length,1,'real facade created one controlled provider');
  let firstDone=false,secondDone=false;const first=h.ui.release().then(()=>firstDone=true),second=h.ui.release().then(()=>secondDone=true);await tick();equal(firstDone,false,'release waits warm dispose');equal(secondDone,false,'second release shares ordered barrier');equal(h.calls.filter(row=>row[0]==='dispose-start').length,1,'warm provider disposed once');equal(h.button.disabled,true,'no new completion while disposing');
  h.button.fire('click');await tick();equal(h.requests.length,1,'blocked click did not call provider');disposal.resolve();await Promise.all([first,second]);equal(h.calls.filter(row=>row[0]==='dispose-end').length,1,'one confirmed release');equal(h.button.disabled,false,'completion can be requested after confirmation');await h.ui.dispose();
});

await scenario('active release waits both cancel settlement and dispose then rejects stale response',async()=>{
  const cancellation=defer(),disposal=defer(),h=editorHost({cancel:()=>cancellation.promise,dispose:()=>disposal.promise});await h.ui.setProviderFactory(h.factory);h.button.fire('click');await until(()=>h.requests.length===1,'active request');let done=false;const releasing=h.ui.release().then(()=>done=true);await tick();equal(h.calls.filter(row=>row[0]==='dispose-start').length,0,'dispose not before cancel and complete drain');
  cancellation.resolve();await tick();equal(done,false,'cancel resolved but complete not settled');h.requests[0].resolve(result(h.requests[0].request));await until(()=>h.calls.some(row=>row[0]==='dispose-start'),'dispose after complete');equal(h.ui.state.phase,'idle','cancelled late success ignored');equal(done,false,'waits dispose');disposal.resolve();await releasing;equal(done,true,'release confirms all stages');await h.ui.dispose();
});

await scenario('dispose reentry returns one barrier and permanent event shutdown',async()=>{
  const disposal=defer(),h=editorHost({dispose:()=>disposal.promise});await h.ui.setProviderFactory(h.factory);await h.open();const first=h.ui.dispose(),second=h.ui.dispose();equal(first,second,'same disposal promise');equal(h.button.disabled,true,'disposed button disabled');h.button.fire('click');h.source.fire('keydown',{ctrlKey:true,key:'j',code:'KeyJ'});await tick();equal(h.requests.length,1,'removed events never create provider');disposal.resolve();await first;equal(h.calls.filter(row=>row[0]==='dispose-start').length,1,'dispose called once');
});

for(const failurePoint of ['cancel','dispose'])await scenario(failurePoint+' failure closes future provider/compile release gate',async()=>{
  const h=editorHost({cancel:()=>{if(failurePoint==='cancel')throw Error('controlled cancel failure');},dispose:()=>{if(failurePoint==='dispose')throw Error('controlled dispose failure');}});await h.ui.setProviderFactory(h.factory);
  if(failurePoint==='cancel'){h.button.fire('click');await until(()=>h.requests.length===1,'pending request');}else await h.open();
  const releasing=h.ui.release();const rejection=assert.rejects(releasing,/未能确认释放/);if(failurePoint==='cancel')h.requests[0].resolve(result(h.requests[0].request));await rejection;assertions++;
  equal(h.ui.failed,true,'failure flag persists');equal(h.button.disabled,true,'future UI trigger disabled');check(h.status.textContent.includes('保存或导出草稿'),'recovery action visible');
  await assert.rejects(h.ui.setProviderFactory(h.factory),/未能确认释放/);assertions++;h.button.fire('click');await tick();equal(h.providers.length,1,'failure never allocates replacement');await assert.rejects(h.ui.dispose(),/未能确认释放/);assertions++;
});

for(const key of ['Tab','Enter'])await scenario(key+' candidate confirmation consumes capture and leaves old bubble edit inactive',async()=>{
  const h=editorHost();let legacy=0;h.source.onkeydown=event=>{if(!event.defaultPrevented&&event.key==='Tab'&&!event.isComposing&&event.keyCode!==229&&!h.ui.composing)legacy++;};await h.ui.setProviderFactory(h.factory);await h.open();const event=h.source.fire('keydown',{key});equal(event.defaultPrevented,true,'candidate owns default action');equal(h.source.value,'obj.print','one candidate edit');equal(h.writes,1,'one controlled edit command');equal(h.edits,1,'one input/save notification');equal(legacy,0,'legacy indentation not executed');await h.ui.dispose();
});

await scenario('IME session and keyCode 229 preserve Tab/Enter/manual key defaults',async()=>{
  const h=editorHost();await h.ui.setProviderFactory(h.factory);await h.open();h.source.fire('compositionstart');equal(h.ui.composing,true,'local IME state set');equal(h.ui.state.phase,'idle','IME dismisses candidates');equal(h.button.disabled,true,'IME disables manual trigger');
  for(const key of ['Tab','Enter','j']){const event=h.source.fire('keydown',{key,ctrlKey:key==='j',code:key==='j'?'KeyJ':''});equal(event.defaultPrevented,false,'IME retains '+key);}
  equal(h.writes,0,'composition wrote no completion');h.source.fire('compositionend');equal(h.ui.composing,false,'IME ended');
  for(const key of ['Tab','Enter','j']){const event=h.source.fire('keydown',{key,keyCode:229,ctrlKey:key==='j',code:key==='j'?'KeyJ':''});equal(event.defaultPrevented,false,'229 retains '+key);}
  equal(h.writes,0,'229 wrote no completion');await h.ui.dispose();
});

for(const [label,change] of [
  ['readOnly',h=>{h.source.readOnly=true;}],['focus',h=>{h.document.activeElement=h.button;}],
  ['inert',h=>{h.source.setAttribute('inert','');}],['dialog',h=>{h.document.dialog=true;}],
  ['visibility',h=>{h.document.hidden=true;}],['changed source',h=>h.setText('obj.prior')]
])await scenario('old visible candidate is not actionable after '+label,async()=>{
  const h=editorHost();await h.ui.setProviderFactory(h.factory);await h.open();change(h);const token=h.ui.state.token;h.source.fire('keydown',{key:'Enter'});equal(h.writes,0,'old candidate writes nothing');equal(h.ui.state.phase,'idle','stale candidate dismissed');await h.ui.dispose();
});

await scenario('main module keeps explicit compile-release and keyboard propagation gates',async()=>{
  const source=await readFile(resolve(root,'ui/src/main.mjs'),'utf8');
  check(source.indexOf('compilation=task')<source.indexOf('if(completionUI)await completionUI.release();'),'compile lock before release');
  check(source.indexOf('if(completionUI)await completionUI.release();')<source.indexOf('compiler=new CompilerAdapter'),'release confirmation before new compiler allocation');
  check(/function handleShortcut\(event\)\{\s*if\(event\.defaultPrevented\|\|event\.isComposing\|\|event\.keyCode===229\|\|completionUI\?\.composing\)return;/u.test(source),'main debug shortcuts preserve completion and IME capture');
  check(/onkeydown=event=>\{if\(!event\.defaultPrevented&&event\.key==='Tab'&&!event\.isComposing&&event\.keyCode!==229&&!completionUI\?\.composing/u.test(source),'old source Tab property handler checks captured default and local IME');
  check(source.includes('&&!completionUI?.failed)'),'main compile action disabled after release failure');
});

const summary={target,scope:'Independent controlled transport tests against actual fixed product exports. No real browser/layout/native undo/Worker or iPad claim. Main integration gate checks are source assertions, not executed main.',inputs,scenarioCount:results.length,assertions,passed:results.filter(row=>row.status==='passed').length,failed:results.filter(row=>row.status==='failed').length,results};
await writeFile(resolve(evidence,'runner.mjs'),await readFile(fileURLToPath(import.meta.url)));
await writeFile(resolve(evidence,'controlled-dom.mjs'),await readFile(new URL('./lib/completion-race-dom.mjs',import.meta.url)));
await writeFile(resolve(evidence,'results.json'),JSON.stringify(summary,null,2)+'\n');await writeFile(resolve(evidence,'events.json'),JSON.stringify(events,null,2)+'\n');
await writeFile(resolve(evidence,'README.md'),'# Person 05 controlled completion races\n\nRun: `node tests/completion-ui-races-independent.mjs '+run+'` at '+target+'.\n\nThis directory uses real exported controller/editor/popup/edit modules with a purpose-built event, geometry and provider transport. Geometry, insertText and provider responses are controlled inputs. It does not establish native undo, real Worker termination, browser layout, physical IME or iPad behavior. Root performs the separate actual-browser/package checks.\n');
process.stdout.write(JSON.stringify({scenarios:summary.scenarioCount,assertions,passed:summary.passed,failed:summary.failed,evidence},null,2)+'\n');
