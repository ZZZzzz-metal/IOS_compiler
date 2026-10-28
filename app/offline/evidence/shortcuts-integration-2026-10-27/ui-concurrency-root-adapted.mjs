// ROOT integration host adaptation of person05 fixed harness; original file and evidence untouched.
// Changes below are recorded in ui-host-adaptation.json; no product behavior or assertions changed.
// Person 05 independent orchestration checks. This runs the complete main module,
// including its own render, event wiring and startup restore, in a controlled VM.
// DOM, File.text, network, compiler/debugger and storage transport are substitutes.
// Draft parsing, validation, source snapshots, editor helpers and autosave are real.
// This does not establish browser, IndexedDB durability, compilation or iPad success.
// Usage: node tests/ui-concurrency-independent.mjs --ref HEX_COMMIT --out
// tests/evidence/integrated-NEW/independent/NEW_RUN (the run directory must not exist).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {inspect} from 'node:util';
import {createDraft,parseImport,serializeDraft,validateDraft} from '../../../../storage/src/draft-store.mjs';
import {createAutosave} from '../../../../storage/src/autosave.mjs';
import {createSnapshot} from '../../../../compiler/src/source.mjs';
import {highlight,indentSelection,breakpointView,resolveShortcut,shortcutLabels} from '../../../../ui/src/editor.mjs';

const repository=fileURLToPath(new URL('../../../../',import.meta.url));
const args=process.argv.slice(2),options={};
for(let index=0;index<args.length;index+=2){
  assert.ok(['--ref','--out'].includes(args[index])&&args[index+1], 'Use --ref HEX_COMMIT --out tests/evidence/integrated-.../independent/NEW_RUN');
  options[args[index].slice(2)]=args[index+1];
}
assert.match(options.ref??'',/^[a-f0-9]{7,40}$/u,'A fixed hexadecimal commit is required');
assert.ok(options.out,'A new evidence output directory is required');
const commit=execFileSync('git',['rev-parse',options.ref],{cwd:repository,encoding:'utf8'}).trim();
const gitFile=path=>execFileSync('git',['show',`${commit}:${path}`],{cwd:repository});
const sourceBytes=gitFile('ui/src/main.mjs'),source=sourceBytes.toString('utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=resolve(repository,options.out),evidenceBase=resolve(repository,'tests/evidence');
const parts=relative(evidenceBase,output).split(sep);
assert.ok(parts[0].startsWith('integrated-')&&parts.includes('independent')&&!parts.includes('..'), 'Output must be a new integrated evidence directory under independent/');
await mkdir(dirname(output),{recursive:true});
await mkdir(output); // Deliberately refuses an existing run, even an empty one.

const imports=source.match(/^import[^\r\n]*;\r?$/gmu)??[];
assert.equal(imports.length,9,'Review the harness if the production module import surface changes');
const executable=source.replace(/^import[^\r\n]*;\r?$/gmu,'');
const realInputs=['storage/src/draft-store.mjs','storage/src/autosave.mjs','compiler/src/source.mjs','ui/src/editor.mjs'];
const inputHashes=[];
for(const path of realInputs){
  const bytes=await readFile(resolve(repository,path));
  assert.equal(sha(bytes),sha(gitFile(path)),`Real dependency ${path} must match the selected revision`);
  inputHashes.push({path,byteLength:bytes.length,sha256:sha(bytes)});
}
inputHashes.push({path:'ui/src/main.mjs',revision:commit,byteLength:sourceBytes.length,sha256:sha(sourceBytes)});
const testBytes=await readFile(fileURLToPath(import.meta.url));
inputHashes.push({path:'tests/ui-concurrency-independent.mjs',byteLength:testBytes.length,sha256:sha(testBytes)});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(yes=>setImmediate(yes));
const emptyView=()=>({session:null,actions:{},frames:[],scopes:[],scopePages:[],variables:[],breakpoints:[],stackTotal:0,outputTail:[],outputTruncated:false});
const candidate=name=>({profile:{compatibilityId:name},resources:[],lock:{id:`lock-${name}`},capabilities:{capabilities:[]}});

class Element {
  constructor(id,document){this.id=id;this.document=document;this.dataset={};this.attributes={};this.children=[];this.files=[];this._value='';this.textContent='';this.innerHTML='';this.disabled=false;this.hidden=false;this.readOnly=false;this.scrollTop=0;this.scrollLeft=0;this.selectionStart=0;this.selectionEnd=0;this.listeners=new Map();}
  get value(){return this._value;}
  set value(value){this._value=value;if(this.id==='file'&&value==='')this.files=[];}
  replaceChildren(...children){this.children=children;this.textContent='';}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(name,handler){this.listeners.set(name,handler);}
  focus(){this.document.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  click(){return this.onclick?.();}
  showModal(){}
  select(){}
}

async function harness(){
  const nodes=new Map(),document={activeElement:null,hidden:false,listeners:new Map()};
  const element=id=>{if(!nodes.has(id))nodes.set(id,new Element(id,document));return nodes.get(id);};
  const controls=['continue','stepInto','stepOver','stepOut'].map(command=>{const node=element(`control-${command}`);node.dataset.command=command;return node;});
  Object.assign(document,{body:element('body'),getElementById:element,createElement:tag=>new Element(tag,document),querySelector:selector=>selector==='dialog[open]'?null:element(selector),querySelectorAll:selector=>selector==='[data-command]'?controls:[],addEventListener(name,handler){this.listeners.set(name,handler);}});
  const records=new Map(),writes=[],network=[],compilers=[],debuggers=[],controllers=[],frames=[],files=[];
  const original=createDraft({id:'main',revision:4,userText:'int original = 4;\n',driverText:'',stdin:'4\n'});
  records.set('main',original);
  const store={
    async load(id){return records.has(id)?structuredClone(records.get(id)):null;},
    async save(draft,expected){
      const incoming=validateDraft(draft),previous=records.get(incoming.id);
      assert.equal(expected,previous?.revision??null,'The memory store records actual autosave CAS arguments');
      const saved={...incoming,revision:(previous?.revision??0)+1};records.set(saved.id,structuredClone(saved));writes.push({expected,draft:structuredClone(saved)});return {revision:saved.revision};
    },
  };
  class ControlledDebugger {
    constructor(options){this.options=options;this.registered=[];debuggers.push(this);}
    async registerResource(path,bytes){this.registered.push({path,bytes:[...bytes]});}
    dispose(){this.disposed=true;}
    background(){}
  }
  class ControlledCompiler {
    constructor(options){this.options=options;compilers.push(this);}
    compile(request){this.request=request;this.pending=deferred();return this.pending.promise;}
    async cancel(requestId){this.pending?.resolve({status:'cancelled',requestId,sourceHash:this.request.snapshot.sourceHash,diagnostics:[]});}
  }
  class ControlledController {
    constructor(options){this.options=options;this.view=emptyView();controllers.push(this);}
    getView(){return this.view;}
    async start(request){this.started=request;this.view={...emptyView(),session:{...request,state:'running',synchronized:true},actions:{stop:true}};return {accepted:true};}
    async control(kind){if(kind==='stop')this.view={...emptyView(),session:{state:'terminated',synchronized:true}};return {accepted:true};}
    dispose(){this.disposed=true;}
  }
  const context=vm.createContext({URL,URLSearchParams,Uint8Array,TextEncoder,structuredClone,crypto:{randomUUID},setTimeout,clearTimeout,
    location:{href:'https://independent.invalid/ui/probe.html',hash:''},history:{replaceState(){}},navigator:{clipboard:{async readText(){return 'clipboard';},async writeText(){}}},
    window:{addEventListener(){}},document,createDraft,parseImport,serializeDraft,createAutosave,createSnapshot,highlight,indentSelection,breakpointView,resolveShortcut,shortcutLabels,
    createDraftStore:()=>store,CompilerAdapter:ControlledCompiler,WorkerDebuggerAdapter:ControlledDebugger,SessionController:ControlledController,
    requestAnimationFrame(callback){frames.push(callback);return frames.length;},
    fetch(url){const pending=deferred();network.push({url:String(url),pending,settled:false});return pending.promise;},
    async assertTrustedOfflineWorkers(){return {offline:false};},async digest(){return '';},
  });
  // Only import declarations are removed. All production declarations, handlers,
  // paints and top-level restore execute. The bridge observes/directly invokes
  // functions; it never replaces a production function or adds missing state.
  await vm.runInContext(`(async()=>{\n${executable}\n globalThis.subject={prepare,compile,render,stop,
    state(){return {draft,ready,prepared,compilation,controller,activeSnapshot,recovering};},
    autosave(){return autoSave;},
    forceCandidateForCaptureCheck(value){prepared=value;}
  };\n})()`,context,{filename:`ui/src/main.mjs@${commit}:full-module`});
  const app=context.subject,tasks=[];
  const track=task=>{tasks.push(task);return task;};
  const answer=(index,value)=>{const call=network[index];assert.ok(call&&!call.settled,'An outstanding network response must exist');call.settled=true;call.pending.resolve(value);};
  const success=value=>({ok:true,json:async()=>structuredClone(value)});
  const h={app,nodes,element,network,writes,records,compilers,debuggers,controllers,original,track,answer,
    draft:()=>structuredClone(app.state().draft),
    buttons:()=>Object.fromEntries(['run','debug','prepare'].map(id=>[id,element(id).disabled])),
    async verify(value=candidate('verified')){const index=network.length,task=track(app.prepare());assert.equal(network.length,index+1,'Preparation must request its candidate');answer(index,success(value));await task;},
    async edit(text){element('source').value=text;element('source').oninput();await turn();},
    async flush(){await app.autosave().flush();},
    pendingFile(name){const pending=deferred(),began=deferred();const file={name,size:80,text(){began.resolve();return pending.promise;}};const item={file,pending,began:began.promise,settled:false};files.push(item);return item;},
    async select(item){element('file').files=[item.file];element('file').value=`C:\\fakepath\\${item.file.name}`;const done=track(element('file').onchange());await item.began;return {done};},
    finishFile(item,text,error){assert.equal(item.settled,false);item.settled=true;if(error)item.pending.reject(error);else item.pending.resolve(text);},
    async cleanup(){
      for(const call of network)if(!call.settled){call.settled=true;call.pending.resolve({ok:false});}
      for(const item of files)if(!item.settled){item.settled=true;item.pending.resolve('// cleanup');}
      for(const compiler of compilers)compiler.pending?.resolve({status:'cancelled',requestId:compiler.request.requestId,sourceHash:compiler.request.snapshot.sourceHash,diagnostics:[]});
      await Promise.allSettled(tasks);await turn();app.autosave().dispose();
    },
  };
  return h;
}

const definitions=[];
const check=(id,title,run)=>definitions.push({id,title,run});
check('REV005-01','last selected B survives reverse A/B completion and real autosave',async(h,record)=>{
  const a=h.pendingFile('older.cpp'),aTask=await h.select(a),b=h.pendingFile('latest.cpp'),bTask=await h.select(b);
  h.finishFile(b,'int chosen_B = 25;\n');await bTask.done;await h.flush();
  h.finishFile(a,'int obsolete_A = 15;\n');await aTask.done;await h.flush();
  record({draft:h.draft(),writes:h.writes});
  assert.equal(h.draft().userText,'int chosen_B = 25;\n');
  assert.ok(h.writes.length>0);assert.ok(h.writes.every(write=>write.draft.userText==='int chosen_B = 25;\n'));
});
check('REV005-02','source typed during reading survives with an explanatory conflict prompt',async(h,record)=>{
  const file=h.pendingFile('pending.cpp'),task=await h.select(file);
  await h.edit('int typed_later = 35;\n');await h.flush();
  h.finishFile(file,'int stale_file = 10;\n');await task.done;await h.flush();
  record({draft:h.draft(),message:h.element('message').textContent,writes:h.writes});
  assert.equal(h.draft().userText,'int typed_later = 35;\n');
  assert.match(h.element('message').textContent,/保留.*重新选择/u);assert.equal(h.element('message').hidden,false);
  assert.equal(h.records.get('main').userText,'int typed_later = 35;\n');
});
for(const field of ['stdin','language','driver'])check(`REV005-03-${field}`,`${field} change during reading invalidates the file without losing the edited project`,async(h,record)=>{
  const file=h.pendingFile('pending.cpp'),task=await h.select(file);
  if(field==='stdin'){h.element('stdin').value='new input\n';h.element('stdin').oninput();}
  if(field==='language'){h.element('language').value='c';h.element('language').onchange();}
  if(field==='driver'){h.element('driver-tab').onclick();await h.edit('#include "user.inc"\nint main() { return 6; }\n');}
  const edited=h.draft();await h.flush();h.finishFile(file,'int stale_file = 10;\n');await task.done;await h.flush();
  record({field,edited,after:h.draft(),message:h.element('message').textContent,writes:h.writes});
  assert.deepEqual(h.draft(),edited);assert.match(h.element('message').textContent,/保留.*重新选择/u);
});
check('REV005-04','obsolete read failure cannot replace the actual newer malformed-project error',async(h,record)=>{
  const a=h.pendingFile('old.cpp'),old=await h.select(a),b=h.pendingFile('latest.json'),latest=await h.select(b);
  h.finishFile(b,'{invalid project');await latest.done;const expected=h.element('message').textContent;
  h.finishFile(a,null,new Error('OBSOLETE_READ_ERROR'));await old.done;await h.flush();
  record({expected,after:h.element('message').textContent,writes:h.writes});
  assert.match(expected,/草稿|文件/u);assert.equal(h.element('message').textContent,expected);assert.equal(h.writes.length,0);
});
check('REV005-05','obsolete finally does not clear the currently selected and still-reading B input',async(h,record)=>{
  const a=h.pendingFile('old.cpp'),old=await h.select(a),b=h.pendingFile('new.cpp'),latest=await h.select(b);
  const selected=h.element('file').value;h.finishFile(a,'int obsolete = 1;\n');await old.done;
  const whileReading={input:h.element('file').value,draft:h.draft()};
  h.finishFile(b,'int latest = 2;\n');await latest.done;await h.flush();record({selected,whileReading,writes:h.writes});
  assert.equal(whileReading.input,selected);assert.equal(whileReading.draft.userText,h.original.userText);
  assert.equal(h.draft().userText,'int latest = 2;\n');
});
check('REV005-06','a current malformed project preserves the restored draft and never schedules a write',async(h,record)=>{
  const file=h.pendingFile('bad.json'),task=await h.select(file);h.finishFile(file,'{not valid');await task.done;await h.flush();
  record({draft:h.draft(),writes:h.writes,message:h.element('message').textContent});
  assert.deepEqual(h.draft(),h.original);assert.equal(h.writes.length,0);assert.match(h.element('message').textContent,/草稿|文件/u);
});
check('REV004-01','re-prepare locks all three entries before await and real editor render keeps them locked',async(h,record)=>{
  await h.verify();assert.deepEqual(h.buttons(),{run:false,debug:false,prepare:false});
  const index=h.network.length,task=h.track(h.app.prepare()),beforeEdit=h.buttons();
  await h.edit('int changed_while_preparing = 8;\n');const afterEdit=h.buttons();
  h.answer(index,{ok:true,json:async()=>candidate('replacement')});await task;record({beforeEdit,afterEdit,afterSuccess:h.buttons()});
  assert.deepEqual(beforeEdit,{run:true,debug:true,prepare:true});assert.deepEqual(afterEdit,beforeEdit);
  assert.deepEqual(h.buttons(),{run:false,debug:false,prepare:false});
});
check('REV004-02','direct duplicate preparation is rejected instead of starting overlapping requests',async(h,record)=>{
  await h.verify();const base=h.network.length,first=h.track(h.app.prepare()),second=h.track(h.app.prepare()),third=h.track(h.app.prepare());
  const started=h.network.length-base;
  for(let index=base;index<h.network.length;index++)h.answer(index,{ok:true,json:async()=>candidate(`answer-${index}`)});
  await Promise.all([first,second,third]);record({started,final:h.app.state().prepared?.profile.compatibilityId});assert.equal(started,1);
});
check('REV004-03','direct run/debug refuses preparation even when stale DOM reports enabled',async(h,record)=>{
  await h.verify();const index=h.network.length,prepare=h.track(h.app.prepare());
  h.element('run').disabled=h.element('debug').disabled=false;
  const run=h.track(h.app.compile('run')),debug=h.track(h.app.compile('debug'));const entered=h.compilers.length;
  for(const compiler of h.compilers)compiler.pending.resolve({status:'cancelled',requestId:compiler.request.requestId,sourceHash:compiler.request.snapshot.sourceHash,diagnostics:[]});
  h.answer(index,{ok:true,json:async()=>candidate('after-check')});await Promise.all([prepare,run,debug]);record({entered,debuggerConstructors:h.debuggers.length});
  assert.equal(entered,0);assert.equal(h.debuggers.length,0);
});
check('REV004-04','failed re-check discards the old candidate and retry alone restores compile availability',async(h,record)=>{
  await h.verify(candidate('old'));const index=h.network.length,task=h.track(h.app.prepare());h.answer(index,{ok:false});await task;
  const failed={ready:h.app.state().ready,prepared:h.app.state().prepared,buttons:h.buttons(),resource:h.element('resources').textContent};
  await h.verify(candidate('retry'));record({failed,retry:{ready:h.app.state().ready,identity:h.app.state().prepared?.profile.compatibilityId,buttons:h.buttons()}});
  assert.equal(failed.ready,false);assert.equal(failed.prepared,null);assert.deepEqual(failed.buttons,{run:true,debug:true,prepare:false});
  assert.equal(h.app.state().ready,true);assert.equal(h.app.state().prepared.profile.compatibilityId,'retry');assert.equal(h.element('run').disabled,false);
});
check('REV004-05','one compilation retains the same candidate through adapters, handoff, request and start',async(h,record)=>{
  const first=candidate('candidate-A');await h.verify(first);const done=h.track(h.app.compile('debug'));
  const compiler=h.compilers[0],adapter=h.debuggers[0];assert.ok(compiler?.request,'Compile must reach the instrumented compiler');
  // Deliberate VM-only state perturbation tests the candidate-capture defense.
  // Normal concurrent prepare is separately rejected; no browser state is injected.
  h.app.forceCandidateForCaptureCheck(candidate('candidate-B'));
  await compiler.options.writeResource('virtual/new.wasm',Uint8Array.of(7,8));
  compiler.pending.resolve({status:'succeeded',requestId:compiler.request.requestId,sourceHash:compiler.request.snapshot.sourceHash,diagnostics:[],build:{buildId:'instrumented-build'}});await done;
  const controller=h.controllers[0],observed={debugger:adapter.options.profile.compatibilityId,compiler:compiler.options.profile.compatibilityId,request:compiler.request.compatibilityId,start:controller.started?.compatibilityId,registered:adapter.registered};record(observed);
  assert.deepEqual([observed.debugger,observed.compiler,observed.request,observed.start],Array(4).fill('candidate-A'));
  assert.equal(compiler.options.lock.id,'lock-candidate-A');assert.deepEqual(adapter.registered,[{path:'virtual/new.wasm',bytes:[7,8]}]);
});
check('REV004-06','an in-flight compilation rejects a direct second compile despite enabled DOM',async(h,record)=>{
  await h.verify();const first=h.track(h.app.compile('run'));
  h.element('run').disabled=h.element('debug').disabled=false;
  const second=h.track(h.app.compile('debug')),entered=h.compilers.length;
  for(const compiler of h.compilers)compiler.pending.resolve({status:'cancelled',requestId:compiler.request.requestId,sourceHash:compiler.request.snapshot.sourceHash,diagnostics:[]});
  await Promise.all([first,second]);record({entered,debuggerConstructors:h.debuggers.length});
  assert.equal(entered,1);assert.equal(h.debuggers.length,1);
});

const startedAt=new Date().toISOString(),results=[],tap=['TAP version 13'];
for(const [index,definition] of definitions.entries()){
  const observations=[];let h,result;
  try{h=await harness();await definition.run(h,value=>observations.push(structuredClone(value)));result={id:definition.id,title:definition.title,status:'passed',observations};}
  catch(error){result={id:definition.id,title:definition.title,status:'failed',assertionFailure:error.code==='ERR_ASSERTION',error:{name:error.name,code:error.code,message:error.message,expected:inspect(error.expected),actual:inspect(error.actual),stack:error.stack},observations};}
  finally{if(h)try{await h.cleanup();}catch(error){result={...result,status:'failed',assertionFailure:false,cleanupError:{name:error.name,message:error.message,stack:error.stack}};}}
  results.push(result);tap.push(`${result.status==='passed'?'ok':'not ok'} ${index+1} - ${definition.id}: ${definition.title}`);
  if(result.error)tap.push('  ---',`  error: ${JSON.stringify(result.error.message)}`,`  type: ${JSON.stringify(result.error.name)}`,'  ...');
}
tap.push(`1..${results.length}`);
const passed=results.filter(item=>item.status==='passed').length,failed=results.length-passed,infrastructureFailures=results.filter(item=>item.status==='failed'&&!item.assertionFailure).length;
const summary={startedAt,completedAt:new Date().toISOString(),revision:commit,sourceSha256:sha(sourceBytes),method:'full actual main module evaluated in VM; only import declarations replaced by explicit dependencies',
  boundary:'Controlled DOM/File.text/network/trust/compiler/debugger/controller and memory store. Real parser/autosave/editor/source modules. No actual browser, IndexedDB, byte trust, compilation, offline or iPad result.',
  counts:{total:results.length,passed,failed,infrastructureFailures},inputs:inputHashes,results};
await writeFile(resolve(output,'results.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(output,'checks.tap'),tap.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({revision:commit,output,counts:summary.counts}));
process.exitCode=infrastructureFailures?2:failed?1:0;
