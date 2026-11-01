// Execute the real main prelude and resolver against controlled DOM/compiler I/O.
// The real SessionController supplies pause invalidation and independent stop behavior;
// these are orchestration checks, not browser, compiler, debugger, or iPad evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createSnapshot} from '../../compiler/src/source.mjs';
import {SessionController} from '../src/session-controller.mjs';
import {highlight,breakpointView,resolveShortcut,shortcutLabels} from '../src/editor.mjs';

const source=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const boundary=source.indexOf('\nautoSave=createAutosave(');
assert.ok(boundary>0,'main functions must precede document wiring');
const prelude=source.slice(0,boundary).replace(/^import[^\r\n]*;\r?$/gmu,'');
const wiringStart=source.indexOf("$('prepare').onclick",boundary),wiringEnd=source.indexOf("$('source').oninput",wiringStart);
assert.ok(wiringStart>boundary&&wiringEnd>wiringStart,'exercise the actual execution button handlers');
const wiring=source.slice(wiringStart,wiringEnd);
const settingsStart=source.indexOf("$('shortcut-scheme').value=shortcutScheme",wiringEnd),settingsEnd=source.indexOf("document.addEventListener('keydown'",settingsStart);
assert.ok(settingsStart>wiringEnd&&settingsEnd>settingsStart,'exercise the actual shortcut setting initialization and onchange handler');
const settingsWiring=source.slice(settingsStart,settingsEnd);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<16;index++)await Promise.resolve();};
const capabilities=['continue','step-into','step-over','step-out','watch-basic'];
const candidate=()=>({profile:{compatibilityId:'controlled-keyboard'},lock:{},resources:[],capabilities:{capabilities:capabilities.map(id=>({id,status:'implemented-unverified'}))}});
const emptyView=()=>({session:null,frames:[],stackTotal:0,scopes:[],scopePages:[],variables:[],breakpoints:[],outputTail:[],outputTruncated:false,error:null});
const keys={start:['F5',{}],run:['F5',{ctrlKey:true}],stop:['F5',{shiftKey:true}],breakpoint:['F9',{}],stepOver:['F10',{}],stepInto:['F11',{}],stepOut:['F11',{shiftKey:true}]};
const alternatives={start:['5',{code:'Digit5',ctrlKey:true}],run:['6',{code:'Digit6',ctrlKey:true}],stop:['%',{code:'Digit5',ctrlKey:true,shiftKey:true}],breakpoint:['9',{code:'Digit9',ctrlKey:true}],stepOver:['0',{code:'Digit0',ctrlKey:true}],stepInto:['-',{code:'Minus',ctrlKey:true}],stepOut:['_',{code:'Minus',ctrlKey:true,shiftKey:true}]};

function fixture({scheme='control-number',storage}={}){
  const elements=new Map(),calls={compilers:[],compiles:[],adapters:[],commands:[],cancels:[],fetches:[],frames:[],storageReads:[],storageWrites:[]};
  let savedScheme=scheme;
  const settingStore=storage??{getItem:()=>savedScheme,setItem:(_key,value)=>{savedScheme=value;}};
  let document,dialogOpen=false;
  function element(id,tagName='DIV'){
    if(elements.has(id))return elements.get(id);
    const attributes=new Map(),item={id,tagName,dataset:{},children:[],disabled:false,hidden:false,textContent:'',value:'',selectionStart:0,selectionEnd:0,scrollTop:0,scrollLeft:0,parentElement:null,
      setAttribute(name,value){attributes.set(name,String(value));},removeAttribute(name){attributes.delete(name);},getAttribute(name){return attributes.get(name)??null;},hasAttribute(name){return attributes.has(name);},
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=[...children];},
      focus(){document.activeElement=this;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
      matches(){return ['INPUT','TEXTAREA','SELECT'].includes(this.tagName)||(attributes.has('contenteditable')&&attributes.get('contenteditable')!=='false');},
      closest(selector){assert.equal(selector,'[inert]');for(let target=this;target;target=target.parentElement)if(target.hasAttribute?.('inert'))return target;return null;},
    };elements.set(id,item);return item;
  }
  const body=element('body','BODY'),main=element('main','MAIN'),execution=element('execution','NAV');main.parentElement=body;execution.parentElement=body;
  for(const id of ['source','stdin','clipboard-text'])element(id,'TEXTAREA').parentElement=main;
  for(const id of ['find','expression'])element(id,'INPUT').parentElement=main;
  element('language','SELECT').parentElement=execution;
  element('shortcut-scheme','SELECT').parentElement=execution;
  for(const id of ['run','debug','stop','prepare','breakpoint'])element(id,'BUTTON').parentElement=execution;
  const controls=['continue','stepInto','stepOver','stepOut'].map(command=>{const button=element(command,'BUTTON');button.dataset.command=command;button.textContent=command;button.parentElement=execution;return button;});
  document={body,activeElement:element('source'),getElementById:element,createElement:tag=>element(`created-${elements.size}`,tag.toUpperCase()),
    querySelectorAll:selector=>{assert.equal(selector,'[data-command]');return controls;},
    querySelector:selector=>selector==='dialog[open]'?(dialogOpen?element('clipboard-dialog','DIALOG'):null):selector==='main'?main:selector==='.execution'?execution:null};
  class ControlledAdapter{
    constructor(options){this.options=options;this.listener=null;calls.adapters.push(this);}
    subscribe(listener){this.listener=listener;return ()=>{this.listener=null;};}
    command(command){const pending=deferred();calls.commands.push({adapter:this,command,...pending});return pending.promise;}
    query(){return Promise.resolve({kind:'stack',frames:[],totalFrames:0});}
    resync(){return Promise.reject(Error('unexpected resync'));}
    registerResource(){return Promise.resolve();}
    dispose(){this.listener=null;}
  }
  class ControlledCompiler{
    constructor(options){this.options=options;calls.compilers.push(this);}
    compile(request){this.pending={request,...deferred()};calls.compiles.push(this.pending);return this.pending.promise;}
    async cancel(requestId){calls.cancels.push(requestId);this.pending.resolve({status:'cancelled',requestId,sourceHash:this.pending.request.snapshot.sourceHash,diagnostics:[]});}
  }
  const context=vm.createContext({URL,Uint8Array,crypto:{randomUUID},document,location:{href:'https://example.invalid/ui/probe.html'},
    window:{localStorage:{
      getItem(key){calls.storageReads.push(key);return settingStore.getItem(key);},
      setItem(key,value){calls.storageWrites.push({key,value});return settingStore.setItem(key,value);},
    }},requestAnimationFrame:callback=>calls.frames.push(callback),
    createDraft:options=>({id:'main',revision:0,driverText:'',language:{language:'cpp',standard:'c++17'},...options}),createDraftStore:()=>({}),
    createSnapshot,highlight,breakpointView,resolveShortcut,shortcutLabels,WorkerDebuggerAdapter:ControlledAdapter,SessionController,CompilerAdapter:ControlledCompiler,
    fetch(...args){const pending=deferred();calls.fetches.push({args,...pending});return pending.promise;},assertTrustedOfflineWorkers:async()=>({offline:false}),digest:async()=>''});
  vm.runInContext(prelude+`
    renderBreakpoints=()=>{};renderInspection=()=>{};
    globalThis.subject={render,handleShortcut,canInvokeShortcut,invokeShortcut,compile,prepare,stop,makeSnapshot,readShortcutScheme,
      read(){return {draft,requested,activeSnapshot,snapshotMode,ready,prepared,preparing,restored,recovering,compilation,controller,shortcutScheme};},
      set(values){
        if('draft'in values)draft=values.draft;if('requested'in values)requested=values.requested;
        if('activeSnapshot'in values)activeSnapshot=values.activeSnapshot;if('snapshotMode'in values)snapshotMode=values.snapshotMode;
        if('ready'in values)ready=values.ready;if('prepared'in values)prepared=values.prepared;
        if('preparing'in values)preparing=values.preparing;if('restored'in values)restored=values.restored;
        if('recovering'in values)recovering=values.recovering;if('compilation'in values)compilation=values.compilation;
        if('controller'in values)controller=values.controller;if('currentTab'in values)currentTab=values.currentTab;
        if('shortcutScheme'in values)shortcutScheme=values.shortcutScheme;
        if('completionUI'in values)completionUI=values.completionUI;
      }};
  `+wiring+settingsWiring,context,{filename:'main.mjs:controlled-keyboard'});
  const subject=context.subject;
  subject.set({ready:true,prepared:candidate(),restored:true});element('source').value=subject.read().draft.userText;subject.render();
  function key(key,options={}){
    const event={key,code:'',ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,repeat:false,isComposing:false,keyCode:0,defaultPrevented:false,prevented:0,
      getModifierState:()=>false,...options,preventDefault(){this.prevented++;this.defaultPrevented=true;}};
    subject.handleShortcut(event);return event;
  }
  function seedSession({state='paused',synchronized=true,actions={},pendingControl=null}={}){
    const adapter=new ControlledAdapter({}),controller=new SessionController({adapter,idFactory:randomUUID});
    const sourceHash=subject.makeSnapshot().sourceHash;
    controller.view={...emptyView(),session:{sessionId:randomUUID(),buildId:'build',sourceHash,compatibilityId:'controlled-keyboard',state,synchronized,eventSeq:1,pendingControl,...(state==='paused'?{pauseId:'pause',frameId:'frame'}:{})},frames:[{frameId:'frame',functionName:'main'}]};
    if(Object.keys(actions).length){const getView=controller.getView.bind(controller);controller.getView=()=>{const result=getView();return {...result,actions:{...result.actions,...actions}};};}
    subject.set({controller});return controller;
  }
  function succeedCompile(index=0){const task=calls.compiles[index];task.resolve({status:'succeeded',requestId:task.request.requestId,sourceHash:task.request.snapshot.sourceHash,diagnostics:[],build:{buildId:'compiled-build',profile:subject.read().prepared.profile}});}
  return {subject,element,document,calls,key,seedSession,succeedCompile,setDialog:value=>{dialogOpen=value;},press(action,alternative=false){return key(...(alternative?alternatives:keys)[action]);}};
}
const commandKinds=h=>h.calls.commands.map(item=>item.command.kind);

test('saved standard mode is restored; unknown, absent and denied settings fall back to Control alternatives',async()=>{
  for(const [name,stored,expected] of [['standard','standard','standard'],['control-number','control-number','control-number'],['unknown','unexpected-mode','control-number'],['absent',null,'control-number'],['read-denied',null,'control-number']]){
    const h=fixture({storage:{getItem(){if(name==='read-denied')throw Error('storage access denied');return stored;},setItem(){throw Error('initialization must not write');}}});
    assert.deepEqual(h.calls.storageReads,['ipad-debugger.shortcut-scheme'],name);
    assert.equal(h.subject.read().shortcutScheme,expected,name);assert.equal(h.element('shortcut-scheme').value,expected,name);
    assert.equal(h.subject.readShortcutScheme(),expected,name);assert.equal(h.calls.storageWrites.length,0,name);
    assert.equal(h.element('debug').getAttribute('aria-keyshortcuts'),expected==='standard'?'F5':'F5 Control+5',name);
    const alternative=h.press('start',true);await flush();
    assert.equal(alternative.prevented,expected==='standard'?0:1,name);
    if(expected==='standard'){assert.equal(h.calls.compiles.length,0,name);h.press('start');await flush();}
    assert.equal(h.calls.compiles.length,1,name);
  }
});

test('changing a shortcut scheme persists it and immediately updates labels, ARIA and actual dispatch',async()=>{
  for(const target of ['standard','control-number']){
    let saved=target==='standard'?'control-number':'standard';
    const storage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}},h=fixture({storage});
    h.element('shortcut-scheme').value=target;h.element('shortcut-scheme').onchange();
    assert.equal(h.subject.read().shortcutScheme,target);assert.equal(saved,target);
    assert.deepEqual(h.calls.storageWrites,[{key:'ipad-debugger.shortcut-scheme',value:target}]);
    assert.match(h.element('shortcut-save').textContent,/已记住此浏览器的选择/u);
    assert.equal(h.element('debug').title,target==='standard'?'编译调试（F5）':'编译调试（F5 / Ctrl+5）');
    assert.equal(h.element('debug').getAttribute('aria-keyshortcuts'),target==='standard'?'F5':'F5 Control+5');
    assert.equal(h.element('run').getAttribute('aria-keyshortcuts'),target==='standard'?'Control+F5':'Control+F5 Control+6');
    assert.equal(h.element('breakpoint').getAttribute('aria-keyshortcuts'),target==='standard'?'F9':'F9 Control+9');
    assert.equal(h.element('stop').getAttribute('aria-keyshortcuts'),null,'a disabled action must not acquire active ARIA shortcuts');
    assert.ok(h.element('shortcut-hint').textContent.startsWith(target==='standard'?'F5':'Ctrl+5'));
    const reloaded=fixture({storage});assert.equal(reloaded.subject.read().shortcutScheme,target);assert.equal(reloaded.element('shortcut-scheme').value,target);
    const alternative=h.press('start',true);await flush();assert.equal(alternative.prevented,target==='standard'?0:1);
    if(target==='standard'){assert.equal(h.calls.compiles.length,0);h.press('start');await flush();}
    assert.equal(h.calls.compiles.length,1,'the newly selected scheme must govern this page without a reload');
  }
});

test('denied setting writes keep the selected scheme effective for this page and show the Chinese recovery hint',async()=>{
  for(const target of ['standard','control-number']){
    const saved=target==='standard'?'control-number':'standard',h=fixture({storage:{getItem:()=>saved,setItem(){throw Error('storage write denied');}}});
    h.element('shortcut-scheme').value=target;assert.doesNotThrow(()=>h.element('shortcut-scheme').onchange());
    assert.equal(h.subject.read().shortcutScheme,target,'failed persistence must not revert the active page scheme');
    assert.equal(h.subject.readShortcutScheme(),saved,'the old persisted value remains separate from this page selection');
    assert.deepEqual(h.calls.storageWrites,[{key:'ipad-debugger.shortcut-scheme',value:target}]);
    assert.match(h.element('shortcut-save').textContent,/浏览器未允许保存设置，本次选择仍有效/u);
    assert.equal(h.element('debug').getAttribute('aria-keyshortcuts'),target==='standard'?'F5':'F5 Control+5');
    assert.equal(h.element('debug').title,target==='standard'?'编译调试（F5）':'编译调试（F5 / Ctrl+5）');
    const alternative=h.press('start',true);await flush();assert.equal(alternative.prevented,target==='standard'?0:1);
    if(target==='standard'){assert.equal(h.calls.compiles.length,0);h.press('start');await flush();}
    assert.equal(h.calls.compiles.length,1,'actual dispatch must use the unsaved current choice');
  }
});

test('standard keys and physical Control alternatives dispatch the actual main intents',async()=>{
  for(const alternative of [false,true])for(const action of ['start','run','stop','stepOver','stepInto','stepOut']){
    const h=fixture();if(!['start','run'].includes(action))h.seedSession();
    const event=h.press(action,alternative);await flush();
    assert.equal(event.prevented,1,`${action}/${alternative}: exact mapping is consumed`);
    if(['start','run'].includes(action)){assert.equal(h.calls.compiles.length,1);assert.equal(h.calls.compiles[0].request.mode,action==='run'?'run':'debug');}
    else assert.deepEqual(commandKinds(h),[action]);
  }
});

test('F5 continues a paused session while the run key never recompiles an active session',async()=>{
  const h=fixture();h.seedSession();h.press('run');await flush();assert.equal(h.calls.compiles.length,0);
  h.press('start');await flush();assert.deepEqual(commandKinds(h),['continue']);assert.equal(h.calls.compiles.length,0);
  for(const state of ['terminated','failed']){const terminal=fixture();terminal.seedSession({state});terminal.press('start');await flush();assert.equal(terminal.calls.compiles[0].request.mode,'debug',state);}
});

test('compile buttons and both keyboard entry modes share restoration, resource, recovery and active-session guards',async()=>{
  const cases=[['unrestored',{restored:false}],['recovering',{recovering:true}],['preparing',{preparing:true}],['not-ready',{ready:false}],['no-candidate',{prepared:null}],['compiling',{compilation:{requestId:'pending'}}]];
  for(const [name,values] of cases)for(const action of ['start','run']){
    const h=fixture();h.subject.set(values);h.subject.render();assert.equal(h.element('run').disabled,true,name);assert.equal(h.element('debug').disabled,true,name);
    // Stale enabled DOM cannot bypass the shared application-state gate.
    h.element('run').disabled=h.element('debug').disabled=false;
    h.element(action==='run'?'run':'debug').onclick();const event=h.press(action);await flush();
    assert.equal(event.prevented,1,name);assert.equal(h.calls.compilers.length,0,`${name}/${action}`);
  }
  for(const state of ['created','starting','running','paused','stopping']){
    const h=fixture();h.seedSession({state,synchronized:false});h.subject.render();
    assert.equal(h.element('run').disabled,true,state);assert.equal(h.element('debug').disabled,true,state);
    h.press('start');h.press('run');await flush();assert.equal(h.calls.compilers.length,0,state);assert.deepEqual(commandKinds(h),[],state);
  }
});

test('step-out has its own action and capability gate and agrees with its rendered button',async()=>{
  for(const allowed of [false,true]){
    const h=fixture();h.seedSession({actions:{stepInto:!allowed,stepOut:allowed}});h.subject.render();
    assert.equal(h.element('stepOut').disabled,!allowed);assert.equal(h.element('stepInto').disabled,allowed);
    h.press('stepOut');await flush();assert.deepEqual(commandKinds(h),allowed?['stepOut']:[]);
  }
  for(const [action,id] of [['start','continue'],['stepInto','step-into'],['stepOver','step-over'],['stepOut','step-out']])for(const status of ['unsupported','planned','missing','implemented-unverified','verified']){
    const h=fixture();h.seedSession();const value=candidate();value.capabilities.capabilities=value.capabilities.capabilities.filter(item=>item.id!==id);if(status!=='missing')value.capabilities.capabilities.push({id,status});h.subject.set({prepared:value});h.subject.render();
    const enabled=['implemented-unverified','verified'].includes(status),button=action==='start'?'continue':action;
    assert.equal(h.element(button).disabled,!enabled,`${action}/${status}`);h.press(action);await flush();assert.deepEqual(commandKinds(h),enabled?[action==='start'?'continue':action]:[],`${action}/${status}`);assert.equal(h.calls.compiles.length,0);
  }
});

test('continue and each step also reject preparation, recovery, restoration and compilation ownership',async()=>{
  for(const values of [{preparing:true},{recovering:true},{restored:false},{compilation:{requestId:'busy'}}])for(const action of ['start','stepInto','stepOver','stepOut']){
    const h=fixture();h.seedSession();h.subject.set(values);h.subject.render();
    assert.equal(h.element(action==='start'?'continue':action).disabled,true);h.press(action);await flush();assert.deepEqual(commandKinds(h),[]);
  }
});

test('unmapped extra modifiers and number-pad keys are neither consumed nor dispatched',async()=>{
  const events=[['F5',{ctrlKey:true,shiftKey:true}],['F10',{ctrlKey:true}],['F11',{ctrlKey:true}],['F9',{shiftKey:true}],['F5',{altKey:true}],['F11',{metaKey:true}],['F10',{getModifierState:key=>key==='AltGraph'}],['5',{ctrlKey:true,code:'Numpad5'}],['6',{ctrlKey:true,code:'Digit6',shiftKey:true}],['x',{}]];
  for(const [key,options] of events){const h=fixture();h.seedSession();const event=h.key(key,options);await flush();assert.equal(event.prevented,0,`${key}/${JSON.stringify(options)}`);assert.deepEqual(commandKinds(h),[]);assert.equal(h.calls.compiles.length,0);}
  const h=fixture({scheme:'standard'});assert.equal(h.press('start',true).prevented,0);await flush();assert.equal(h.calls.compiles.length,0);assert.equal(h.press('start').prevented,1);await flush();assert.equal(h.calls.compiles.length,1);
});

test('composition and handled events are ignored; recognized repeats are consumed without execution',async()=>{
  for(const options of [{isComposing:true},{keyCode:229},{defaultPrevented:true}]){const h=fixture();h.seedSession();const event=h.key('F5',options);await flush();assert.equal(event.prevented,0);assert.deepEqual(commandKinds(h),[]);}
  for(const action of Object.keys(keys))for(const alternative of [false,true]){
    const h=fixture();h.seedSession();const [key,options]=(alternative?alternatives:keys)[action],event=h.key(key,{...options,repeat:true});await flush();
    assert.equal(event.prevented,1,`${action}/${alternative}`);assert.deepEqual(commandKinds(h),[]);assert.equal(h.subject.read().requested.length,0);
  }
});

test('other text fields and dialogs retain their keys; source and non-editable controls allow dispatch',async()=>{
  for(const id of ['stdin','find','expression','clipboard-text','language','editable']){
    const h=fixture();h.seedSession();if(id==='editable')h.element(id).setAttribute('contenteditable','true');h.element(id).focus();const event=h.press('start');await flush();assert.equal(event.prevented,0,id);assert.deepEqual(commandKinds(h),[],id);
  }
  const dialog=fixture();dialog.seedSession();dialog.setDialog(true);assert.equal(dialog.press('start').prevented,0);await flush();assert.deepEqual(commandKinds(dialog),[]);
  for(const id of ['source','run','output','body','readonly-content']){const h=fixture();h.seedSession();if(id==='readonly-content')h.element(id).setAttribute('contenteditable','false');h.element(id).focus();assert.equal(h.press('start').prevented,1,id);await flush();assert.deepEqual(commandKinds(h),['continue'],id);}
});

test('recovery and inert surfaces consume known keys without invoking actions',async()=>{
  for(const lock of ['recovery','main','execution']){
    const h=fixture();h.seedSession();if(lock==='recovery')h.subject.set({recovering:true});else{h.element(lock).setAttribute('inert','');h.element(lock==='main'?'source':'run').focus();}
    const event=h.press('start');await flush();assert.equal(event.prevented,1,lock);assert.deepEqual(commandKinds(h),[],lock);assert.equal(h.calls.compiles.length,0,lock);
  }
});

test('F9 only changes editable source requests; dirty edits and snapshots leave old session bindings intact',async()=>{
  const h=fixture(),snapshot=h.subject.makeSnapshot(),controller=h.seedSession();
  const bp={breakpointId:'existing',requested:{sourcePath:'main.cpp',line:2,column:1},enabled:true};
  controller.view.breakpoints=[{breakpointId:bp.breakpointId,requested:bp.requested,status:'bound',actual:[bp.requested]}];
  h.subject.set({activeSnapshot:snapshot,requested:[bp]});const draft=h.subject.read().draft;draft.userText+='\n// changed draft';h.element('source').value=draft.userText;h.element('source').selectionStart=draft.userText.indexOf('\n')+1;
  assert.equal(h.press('breakpoint').prevented,1);await flush();assert.equal(h.subject.read().requested.length,0);assert.deepEqual(commandKinds(h),[]);assert.equal(controller.getView().breakpoints.length,1);
  h.subject.set({snapshotMode:true});h.subject.render();assert.equal(h.element('breakpoint').disabled,true);assert.ok(h.element('gutter').children.every(button=>button.disabled));
  assert.equal(h.press('breakpoint').prevented,1);await flush();assert.equal(h.subject.read().requested.length,0);assert.equal(controller.getView().breakpoints.length,1);assert.deepEqual(commandKinds(h),[]);
  h.subject.set({snapshotMode:false});draft.userText=snapshot.files[0].text;h.element('source').value=draft.userText;
  h.element('run').focus();assert.equal(h.press('breakpoint').prevented,0);assert.equal(h.press('breakpoint',true).prevented,0);
  h.element('source').focus();assert.equal(h.press('breakpoint',true).prevented,1);await flush();assert.equal(h.subject.read().requested.length,1);assert.equal(h.subject.read().requested[0].requested.sourcePath,'main.cpp');assert.equal(h.subject.read().requested[0].requested.line,2);assert.deepEqual(commandKinds(h),['setBreakpoints']);
  for(const values of [{recovering:true},{restored:false}]){h.subject.set(values);h.press('breakpoint');await flush();assert.equal(h.subject.read().requested.length,1);assert.equal(h.calls.commands.length,1);h.subject.set({recovering:false,restored:true});}
});

test('the actual prepare function blocks keyboard compilation until the controlled resource check succeeds',async()=>{
  const h=fixture(),checking=h.subject.prepare();assert.equal(h.calls.fetches.length,1);
  h.press('start');h.press('run');await flush();assert.equal(h.calls.compiles.length,0);assert.equal(h.element('debug').disabled,true);
  h.calls.fetches[0].resolve({ok:true,json:async()=>candidate()});await checking;
  assert.equal(h.element('debug').disabled,false);h.press('start');await flush();assert.equal(h.calls.compiles.length,1);
});

test('keyboard stop cancels compiling once and a queued duplicate start cannot construct another compiler',async()=>{
  const h=fixture();h.press('start');h.press('start');h.element('debug').onclick();await flush();
  assert.equal(h.calls.compiles.length,1);assert.equal(h.element('stop').disabled,false);assert.equal(h.element('stop').getAttribute('aria-keyshortcuts'),'Shift+F5 Control+Shift+5');
  const requestId=h.calls.compiles[0].request.requestId;h.press('stop');h.press('stop');await flush();
  assert.deepEqual(h.calls.cancels,[requestId]);assert.deepEqual(commandKinds(h),[]);assert.equal(h.subject.read().compilation,null);assert.equal(h.element('debug').disabled,false);
});

test('pending continue invalidates repeated actions immediately while stop bypasses its unresolved ACK',async()=>{
  const h=fixture(),controller=h.seedSession();h.press('start');h.press('start');h.press('stepOver');await flush();
  assert.deepEqual(commandKinds(h),['continue']);assert.ok(controller.getView().session.pendingControl);assert.equal(controller.getView().session.pauseId,undefined);
  h.subject.set({ready:false,prepared:null});
  h.subject.render();assert.equal(h.element('continue').disabled,true);assert.equal(h.element('continue').getAttribute('aria-keyshortcuts'),null);assert.equal(h.element('stop').disabled,false);
  h.press('stop');h.press('stop');await flush();assert.deepEqual(commandKinds(h),['continue','stop']);assert.equal(controller.getView().actions.stop,false);
});

test('pending startup blocks another start and allows independent stop before its ACK',async()=>{
  const h=fixture();h.press('start');await flush();h.succeedCompile();await flush();assert.deepEqual(commandKinds(h),['start']);
  assert.equal(h.subject.read().controller.getView().session.state,'created');h.press('start');h.press('run');await flush();assert.equal(h.calls.compiles.length,1);assert.deepEqual(commandKinds(h),['start']);
  h.press('stop');await flush();assert.deepEqual(commandKinds(h),['start','stop']);
});

test('source search keeps its exact modifier and focus behavior without invoking debug actions',async()=>{
  for(const modifier of ['ctrlKey','metaKey']){const h=fixture();const event=h.key('f',{[modifier]:true});assert.equal(event.prevented,1);assert.equal(h.document.activeElement,h.element('find'));assert.equal(h.calls.compiles.length,0);}
  for(const options of [{ctrlKey:true,shiftKey:true},{ctrlKey:true,altKey:true},{ctrlKey:true,metaKey:true},{ctrlKey:true,repeat:true}]){const h=fixture();assert.equal(h.key('f',options).prevented,0);assert.equal(h.document.activeElement,h.element('source'));}
});

test('local editor composition gates global debugging even when key event isComposing is false',async()=>{
  const h=fixture();h.subject.set({completionUI:{composing:true}});
  assert.equal(h.key('F5',{isComposing:false}).prevented,0);await flush();
  assert.equal(h.calls.compiles.length,0);
});
