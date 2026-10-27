// REV-004: execute the current main.mjs functions with controlled DOM/network/adapter I/O.
// This checks UI orchestration only; adapter substitutes do not establish real compilation,
// resource integrity, browser behavior, or iPad readiness. No historical evidence is rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createSnapshot} from '../../compiler/src/source.mjs';
import {shortcutLabels} from '../src/editor.mjs';

const root=new URL('../../',import.meta.url),ref=process.env.UI_REVIEW_REF;
if(ref&&!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u.test(ref))throw Error('UI_REVIEW_REF must be a local Git revision or tag');
const source=ref?execFileSync('git',['show',`${ref}:ui/src/main.mjs`],{cwd:fileURLToPath(root),encoding:'utf8'}):await readFile(new URL('ui/src/main.mjs',root),'utf8');
const boundary=source.indexOf('\nautoSave=createAutosave(');
assert.ok(boundary>0,'main must expose its function prelude before wiring document events');
// Keep actual declarations and function bodies, including their real guards. The event wiring
// and top-level draft restore below this boundary are outside this deterministic fixture.
const prelude=source.slice(0,boundary).replace(/^import[^\r\n]*;\r?$/gmu,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
const resourceBytes=Uint8Array.of(1,2,3),checkedHash='sha256:fixture-resource';
const candidate=(name,{resources=false}={})=>({
  profile:{compatibilityId:name},lock:{toolchainId:`lock-${name}`},
  resources:resources?[{relativePath:`compiler/resources/${name}.wasm`,byteLength:resourceBytes.length,sha256:checkedHash}]:[],
  capabilities:{capabilities:['continue','step-into','step-over','step-out','watch-basic'].map(id=>({id,status:'implemented-unverified'}))},
});
const emptyView=()=>({session:null,actions:{},frames:[],scopes:[],variables:[],breakpoints:[],outputTail:[],outputTruncated:false});

function fixture({prepared=candidate('previous'),ready=true,restored=true,recovering=false,trust=async()=>({offline:false}),digest=async()=>checkedHash}={}){
  const elements=new Map(),calls={fetch:[],trust:[],digest:[],debugger:[],controllers:[],compiler:[],compile:[],start:[],cancel:[],control:[],register:[],frames:[]};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,disabled:false,hidden:false,textContent:'',value:'',dataset:{},setAttribute(){},removeAttribute(){}});
    return elements.get(id);
  };
  const controls=['continue','stepInto','stepOver','stepOut'].map(command=>({disabled:false,textContent:command,dataset:{command},setAttribute(){},removeAttribute(){}}));
  class FakeDebuggerAdapter{
    constructor(options){this.options=options;calls.debugger.push({options,instance:this});}
    dispose(){this.disposed=true;}
    async registerResource(path,bytes){calls.register.push({instance:this,path,bytes});}
  }
  class FakeController{
    constructor(options){this.options=options;this.current=emptyView();calls.controllers.push({options,instance:this});}
    getView(){return this.current;}
    dispose(){this.disposed=true;}
    async start(request){calls.start.push({instance:this,request});this.current={...emptyView(),session:{sessionId:request.sessionId,state:'running',synchronized:true,sourceHash:request.sourceHash},actions:{stop:true}};return {accepted:true};}
    async control(kind){calls.control.push({instance:this,kind});return {accepted:true};}
  }
  class FakeCompilerAdapter{
    constructor(options){this.options=options;calls.compiler.push({options,instance:this});}
    compile(request){const pending=deferred();this.pending={...pending,request};calls.compile.push({instance:this,...this.pending});return pending.promise;}
    async cancel(requestId){
      calls.cancel.push({instance:this,requestId});
      this.pending?.resolve({status:'cancelled',requestId,sourceHash:this.pending.request.snapshot.sourceHash,diagnostics:[]});
    }
  }
  const context=vm.createContext({
    URL,Uint8Array,crypto:{randomUUID},location:{href:'https://example.invalid/ui/probe.html'},
    // Defaults permit a fixed pre-fix source to fail behavioral assertions rather than merely
    // throwing because a newly introduced state variable was absent in that old revision.
    preparing:false,
    document:{getElementById:element,querySelectorAll:()=>controls,body:{dataset:{}}},
    requestAnimationFrame(callback){calls.frames.push(callback);return calls.frames.length;},
    createDraft:options=>({id:'main',revision:0,driverText:'',language:{language:'cpp',standard:'c++17'},...options}),
    createDraftStore:()=>({}),createSnapshot,shortcutLabels,
    fetch(...args){const pending=deferred();calls.fetch.push({args,...pending});return pending.promise;},
    async assertTrustedOfflineWorkers(...args){calls.trust.push(args);return trust(...args);},
    async digest(bytes){calls.digest.push(bytes);return digest(bytes);},
    WorkerDebuggerAdapter:FakeDebuggerAdapter,SessionController:FakeController,CompilerAdapter:FakeCompilerAdapter,
  });
  vm.runInContext(prelude+`
    // Keep the actual gate/status render; unrelated editor/list painting is outside this fixture.
    renderEditor=()=>{};renderBreakpoints=()=>{};renderInspection=()=>{};
    globalThis.subject={render,supports,prepare,compile,stop,
      read(){return {preparing,prepared,ready,restored,recovering,compilation,controller,adapter,compiler,activeSnapshot};},
      set(values){
        if('preparing'in values)preparing=values.preparing;
        if('prepared'in values)prepared=values.prepared;
        if('ready'in values)ready=values.ready;
        if('restored'in values)restored=values.restored;
        if('recovering'in values)recovering=values.recovering;
        if('compilation'in values)compilation=values.compilation;
        if('controller'in values)controller=values.controller;
      }
    };
  `,context,{filename:`main.mjs${ref?`@${ref}`:''}:controlled-prelude`});
  const subject=context.subject;
  subject.set({prepared,ready,restored,recovering});subject.render();
  return {subject,element,calls,context};
}

function assertPreparationLocked(h,message){
  for(const id of ['run','debug','prepare'])assert.equal(h.element(id).disabled,true,`${message}: ${id} must stay disabled`);
}
function resolveCandidate(h,value,index=0){h.calls.fetch[index].resolve({ok:true,json:async()=>value});}
function resolveResource(h,index=1){h.calls.fetch[index].resolve({ok:true,arrayBuffer:async()=>resourceBytes.buffer.slice(0)});}
function succeedCompile(h,index=0){
  const task=h.calls.compile[index],options=h.calls.compiler.find(call=>call.instance===task.instance).options;
  task.resolve({status:'succeeded',requestId:task.request.requestId,sourceHash:task.request.snapshot.sourceHash,diagnostics:[],
    build:{buildId:`build-${index}`,profile:options.profile}});
}
const sessionController=state=>({getView:()=>({...emptyView(),session:{sessionId:'already-active',state,synchronized:true},actions:{stop:!['terminated','failed'].includes(state)}}),dispose(){}});

test('prepare synchronously locks run/debug/prepare before its first await; renders and duplicate calls cannot reopen the gate',async()=>{
  const previous=candidate('previous'),next=candidate('next'),h=fixture({prepared:previous});
  assert.equal(h.element('run').disabled,false);
  const checking=h.subject.prepare();
  assertPreparationLocked(h,'before the candidate fetch resolves');
  assert.equal(h.subject.read().preparing,true);
  assert.equal(h.subject.read().ready,false);
  assert.equal(h.subject.read().prepared,null,'an older verified candidate must be cleared synchronously');
  assert.equal(h.context.document.body.dataset.executionState,'preparing');
  h.subject.render();assertPreparationLocked(h,'after an unrelated render');
  const duplicate=h.subject.prepare();
  assert.equal(h.calls.fetch.length,1,'a second direct prepare call must not start another check');
  await duplicate;
  for(const mode of ['run','debug']){
    // The command handler must enforce application state even if a stale DOM was enabled.
    h.element('run').disabled=false;h.element('debug').disabled=false;
    const attempt=h.subject.compile(mode);
    assert.equal(h.calls.debugger.length,0,`${mode}: no debugger constructor while preparing`);
    assert.equal(h.calls.compiler.length,0,`${mode}: no compiler constructor while preparing`);
    await attempt;
  }
  h.subject.render();assertPreparationLocked(h,'after blocked direct compile calls');
  resolveCandidate(h,next);await checking;
  assert.equal(h.subject.read().preparing,false);assert.equal(h.subject.read().ready,true);
  assert.equal(h.subject.read().prepared,next);
  for(const id of ['run','debug','prepare'])assert.equal(h.element(id).disabled,false,`successful check releases ${id}`);
});

test('prepare stays locked through trust and resource checks and unlocks only on successful completion',async()=>{
  const trustGate=deferred(),h=fixture({trust:()=>trustGate.promise}),next=candidate('checked',{resources:true});
  const checking=h.subject.prepare();resolveCandidate(h,next);await flush();
  assert.equal(h.calls.trust.length,1);assert.equal(h.calls.fetch.length,1);
  assertPreparationLocked(h,'while trusted worker validation is pending');
  assert.equal(h.subject.read().prepared,null);
  trustGate.resolve({offline:false});await flush();
  assert.equal(h.calls.fetch.length,2);
  assertPreparationLocked(h,'while a resource download is pending');
  assert.equal(h.subject.read().ready,false);
  resolveResource(h);await checking;
  assert.equal(h.calls.digest.length,1);
  assert.equal(h.subject.read().prepared,next);assert.equal(h.subject.read().preparing,false);
  assert.equal(h.element('run').disabled,false);assert.equal(h.element('debug').disabled,false);
});

test('failed preparation clears the old candidate, keeps compile disabled, and permits a later retry',async()=>{
  for(const failure of ['fetch','http','trust','resource-http','resource-hash']){
    let rejectTrust=true;
    const h=fixture({trust:async()=>{if(failure==='trust'&&rejectTrust){rejectTrust=false;throw Error('worker trust rejected');}return {offline:false};},
      digest:async()=>failure==='resource-hash'?'sha256:wrong':checkedHash});
    const checking=h.subject.prepare();
    if(failure==='fetch')h.calls.fetch[0].reject(Error('candidate fetch rejected'));
    else if(failure==='http')h.calls.fetch[0].resolve({ok:false});
    else{
      resolveCandidate(h,candidate('failed',{resources:failure.startsWith('resource-')}));
      if(failure.startsWith('resource-')){
        await flush();assert.equal(h.calls.fetch.length,2);
        if(failure==='resource-http')h.calls.fetch[1].resolve({ok:false});else resolveResource(h);
      }
    }
    await checking;
    const state=h.subject.read();
    assert.equal(state.ready,false,failure);assert.equal(state.prepared,null,failure);
    assert.equal(state.preparing,false,failure);
    assert.equal(h.element('run').disabled,true,failure);assert.equal(h.element('debug').disabled,true,failure);
    assert.equal(h.element('prepare').disabled,false,`${failure}: the retry remains available`);
    assert.equal(h.element('message').hidden,false,failure);assert.ok(h.element('message').textContent,failure);
    h.element('run').disabled=false;
    const refused=h.subject.compile('run');
    assert.equal(h.calls.compiler.length,0,`${failure}: a direct call cannot use the previous candidate`);await refused;
    const retry=h.subject.prepare(),next=candidate(`retried-${failure}`),index=h.calls.fetch.length-1;
    resolveCandidate(h,next,index);await retry;
    assert.equal(h.subject.read().prepared,next,failure);assert.equal(h.element('run').disabled,false,failure);
  }
});

test('prepare rejects direct entry while draft restoration, recovery, compilation, or a live session owns the gate',async()=>{
  const cases=[
    ['unrestored',{restored:false}],['recovering',{recovering:true}],['already-preparing',{preparing:true}],
    ['compiling',{compilation:{requestId:'another-build'}}],
    ...['created','starting','running','paused','stopping'].map(state=>[`session-${state}`,{controller:sessionController(state)}]),
  ];
  for(const [name,values] of cases){
    const h=fixture();h.subject.set(values);h.element('prepare').disabled=false;
    const attempt=h.subject.prepare();
    assert.equal(h.calls.fetch.length,0,`${name}: no resource fetch may start`);await attempt;
    h.subject.render();assertPreparationLocked(h,name);
  }
});

test('compile enforces state guards rather than trusting enabled buttons',async()=>{
  const cases=[
    ['unrestored',{restored:false}],['recovering',{recovering:true}],['preparing',{preparing:true}],
    ['not-ready',{ready:false}],['no-candidate',{prepared:null}],['already-compiling',{compilation:{requestId:'other'}}],
    ...['created','starting','running','paused','stopping'].map(state=>[`session-${state}`,{controller:sessionController(state)}]),
  ];
  for(const [name,values] of cases)for(const mode of ['run','debug']){
    const h=fixture();h.subject.set(values);
    h.element('run').disabled=false;h.element('debug').disabled=false;
    const attempt=h.subject.compile(mode);
    assert.equal(h.calls.debugger.length,0,`${name}/${mode}: no execution adapter construction`);
    assert.equal(h.calls.compiler.length,0,`${name}/${mode}: no compiler construction`);
    assert.equal(h.calls.compile.length,0,`${name}/${mode}: no compilation`);
    await attempt;
    h.subject.render();
    for(const id of ['run','debug'])assert.equal(h.element(id).disabled,true,`${name}/${mode}: render must keep ${id} disabled`);
  }
});

test('terminal sessions allow preparation again without accidentally reusing the old candidate',async()=>{
  for(const state of ['terminated','failed']){
    const h=fixture(),next=candidate(`after-${state}`);h.subject.set({controller:sessionController(state)});
    const checking=h.subject.prepare();assert.equal(h.calls.fetch.length,1,state);
    assert.equal(h.subject.read().prepared,null,state);
    resolveCandidate(h,next);await checking;
    assert.equal(h.subject.read().prepared,next,state);assert.equal(h.element('run').disabled,false,state);
  }
});

test('a compilation captures one candidate for adapter construction, compiler request, resource handoff and start',async()=>{
  for(const mode of ['run','debug']){
    const captured=candidate(`captured-${mode}`,{resources:true}),replacement=candidate(`replacement-${mode}`),h=fixture({prepared:captured});
    const compiling=h.subject.compile(mode);
    assert.equal(h.calls.debugger.length,1);assert.equal(h.calls.compiler.length,1);assert.equal(h.calls.compile.length,1);
    assert.equal(h.calls.debugger[0].options.profile,captured.profile);
    assert.equal(h.calls.debugger[0].options.resources,captured.resources);
    assert.equal(h.calls.compiler[0].options.profile,captured.profile);
    assert.equal(h.calls.compiler[0].options.lock,captured.lock);
    assert.equal(h.calls.compile[0].request.compatibilityId,captured.profile.compatibilityId);
    assert.equal(h.calls.compile[0].request.mode,mode);
    assertPreparationLocked(h,'while compilation is pending');
    // Simulate a stale external completion replacing global readiness during the compile await.
    h.subject.set({prepared:replacement});
    await h.calls.compiler[0].options.writeResource('compiler-builds/current/main.wasm',resourceBytes);
    assert.equal(h.calls.register[0].instance,h.calls.debugger[0].instance);
    succeedCompile(h);await compiling;
    assert.equal(h.calls.start.length,1);
    const request=h.calls.start[0].request;
    assert.equal(request.compatibilityId,captured.profile.compatibilityId,'start must not read the replacement global candidate');
    assert.equal(request.build.profile,captured.profile);
    assert.equal(request.sourceHash,h.calls.compile[0].request.snapshot.sourceHash);
    assert.equal(request.snapshot,h.calls.compile[0].request.snapshot);
    assert.equal(request.mode,mode);assert.equal(request.stopOnEntry,mode==='debug');
    assert.equal(h.subject.read().compilation,null);
    assert.equal(h.subject.read().prepared,replacement,'this fault injection really replaced the global candidate');
    const checkWhileRunning=h.subject.prepare();assert.equal(h.calls.fetch.length,0);await checkWhileRunning;
  }
});

test('stop cancels pending compilation without starting a stale result and releases the preparation gate',async()=>{
  const h=fixture(),compiling=h.subject.compile('debug');
  assert.equal(h.calls.compile.length,1);assertPreparationLocked(h,'before cancellation');
  const checking=h.subject.prepare();assert.equal(h.calls.fetch.length,0);await checking;
  await h.subject.stop();await compiling;
  assert.equal(h.calls.cancel.length,1);
  assert.equal(h.calls.cancel[0].requestId,h.calls.compile[0].request.requestId);
  assert.equal(h.calls.start.length,0);
  assert.equal(h.subject.read().compilation,null);
  assert.equal(h.element('run').disabled,false);assert.equal(h.element('prepare').disabled,false);
  assert.match(h.element('status').textContent,/已取消/);
});
