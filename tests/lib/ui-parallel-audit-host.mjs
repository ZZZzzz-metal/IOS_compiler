// Person 05 audit host: full actual main module, controlled external I/O.
// Only import declarations are replaced. No product function is patched.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as editor from '../../ui/src/editor.mjs';
import {createSnapshot} from '../../compiler/src/source.mjs';
import {createDraft,parseImport,serializeDraft,validateDraft,DraftStorageError} from '../../storage/src/draft-store.mjs';
import {createAutosave} from '../../storage/src/autosave.mjs';

export const root=fileURLToPath(new URL('../../',import.meta.url));
export const revision=process.env.UI_PARALLEL_REVISION??'3248ad54faa5f0f3a8b6f6501829e95e4699f066';
assert.match(revision,/^[a-f0-9]{40}$/u,'UI_PARALLEL_REVISION must be a full immutable commit hash');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes=execFileSync('git',['show',`${revision}:ui/src/main.mjs`],{cwd:root});
const source=sourceBytes.toString('utf8');
export const inputs=[{path:'ui/src/main.mjs',byteLength:sourceBytes.length,sha256:sha(sourceBytes),revision}];
for(const path of ['ui/src/editor.mjs','storage/src/autosave.mjs','storage/src/draft-store.mjs','compiler/src/source.mjs']){
  const bytes=await readFile(resolve(root,path));
  assert.equal(sha(bytes),sha(execFileSync('git',['show',`${revision}:${path}`],{cwd:root})),`Dependency must match ${revision}: ${path}`);
  inputs.push({path,byteLength:bytes.length,sha256:sha(bytes)});
}
assert.equal((source.match(/^import[^\r\n]*;\r?$/gmu)??[]).length,9);
const executable=source.replace(/^import[^\r\n]*;\r?$/gmu,'');
export const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
export async function until(predicate,label){for(let count=0;count<100;count++){if(predicate())return;await tick();}throw Error(`Audit harness timed out: ${label}`);}
const emptyView=()=>({session:null,actions:{},frames:[],scopes:[],scopePages:[],variables:[],breakpoints:[],stackTotal:0,outputTail:[],outputTruncated:false});

class Element {
  constructor(id,document,tagName='DIV'){Object.assign(this,{id,document,tagName,dataset:{},attributes:{},children:[],files:[],_value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,readOnly:false,scrollTop:0,scrollLeft:0,selectionStart:0,selectionEnd:0,open:false,returnValue:'',parentElement:null,listeners:new Map()});}
  get value(){return this._value;}
  set value(value){this._value=value;if(this.id==='file'&&value==='')this.files=[];}
  replaceChildren(...children){this.children=children;this.textContent='';}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(name,handler){this.listeners.set(name,handler);}
  focus(){this.document.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  click(){return this.onclick?.();}
  showModal(){if(this.open)throw Error('Dialog already open');this.open=true;}
  close(value){if(value!==undefined)this.returnValue=value;this.open=false;return this.listeners.get('close')?.();}
  select(){}
  matches(){return ['INPUT','TEXTAREA','SELECT'].includes(this.tagName)||(this.attributes.contenteditable!==undefined&&this.attributes.contenteditable!=='false');}
  closest(selector){assert.equal(selector,'[inert]');for(let node=this;node;node=node.parentElement)if(node.attributes.inert!==undefined)return node;return null;}
}

export async function host({loadHook,saveHook}={}){
  const nodes=new Map(),document={activeElement:null,hidden:false,listeners:new Map()};
  const element=id=>{if(!nodes.has(id))nodes.set(id,new Element(id,document));return nodes.get(id);};
  const body=element('body'),main=element('main'),execution=element('.execution');main.parentElement=body;execution.parentElement=body;
  for(const id of ['source','stdin','clipboard-text']){element(id).tagName='TEXTAREA';element(id).parentElement=main;}
  for(const id of ['find','expression'])element(id).tagName='INPUT';
  for(const id of ['language','shortcut-scheme'])element(id).tagName='SELECT';
  const controls=['continue','stepInto','stepOver','stepOut'].map(command=>{const node=element(`control-${command}`);node.tagName='BUTTON';node.dataset.command=command;node.textContent=command;return node;});
  Object.assign(document,{body,getElementById:element,createElement:tag=>new Element(tag,document,tag.toUpperCase()),querySelector:selector=>selector==='dialog[open]'?[...nodes.values()].find(node=>node.open)??null:element(selector),querySelectorAll:selector=>selector==='[data-command]'?controls:[],addEventListener(name,handler){this.listeners.set(name,handler);}});
  const original=createDraft({id:'main',revision:1,userText:'int original = 1;\n',stdin:'1\n'}),records=new Map([['main',structuredClone(original)]]);
  const calls={loads:[],saves:[],clipboardReads:[],clipboardWrites:[],compilers:[],debuggers:[],controllers:[],network:[],frames:[],history:[]},pendingTasks=[];
  const store={async load(id){const call={id,index:calls.loads.length};calls.loads.push(call);if(loadHook){const result=await loadHook(call,{records});if(result?.handled)return result.value;}return records.has(id)?structuredClone(records.get(id)):null;},
    async save(value,expected){const draft=validateDraft(value),call={draft:structuredClone(draft),expected,index:calls.saves.length,completed:false};calls.saves.push(call);
      if(saveHook)await saveHook(call,{records});
      const prior=records.get(draft.id);if((prior?.revision??null)!==expected)throw new DraftStorageError('conflict','Audit memory transport CAS conflict');
      const saved={...draft,revision:(prior?.revision??0)+1};records.set(saved.id,structuredClone(saved));call.completed=true;return {revision:saved.revision};}};
  class Debugger {constructor(options){this.options=options;calls.debuggers.push(this);}dispose(){}background(){}async registerResource(){}}
  class Compiler {constructor(options){this.options=options;calls.compilers.push(this);}compile(request){this.request=request;this.pending=deferred();return this.pending.promise;}async cancel(){this.pending?.resolve({status:'cancelled',requestId:this.request.requestId,sourceHash:this.request.snapshot.sourceHash,diagnostics:[]});}}
  class Controller {constructor(){this.view=emptyView();this.controls=[];calls.controllers.push(this);}getView(){return this.view;}dispose(){}async start(request){this.view={...emptyView(),session:{...request,state:'running',synchronized:true},actions:{stop:true}};return {accepted:true};}async control(kind){this.controls.push(kind);return {accepted:true};}async setBreakpoints(){}}
  const context=vm.createContext({URL,URLSearchParams,Uint8Array,TextEncoder,structuredClone,crypto:{randomUUID},setTimeout,clearTimeout,
    location:{href:'https://audit.invalid/ui/probe.html',hash:''},history:{replaceState(...args){calls.history.push(args);}},
    window:{localStorage:{getItem(){return null;},setItem(){}},addEventListener(){}},document,
    navigator:{clipboard:{readText(){const item=deferred();calls.clipboardReads.push(item);return item.promise;},writeText(text){const item={text,...deferred()};calls.clipboardWrites.push(item);return item.promise;}}},
    createDraft,parseImport,serializeDraft,createAutosave,createSnapshot,...editor,createDraftStore:()=>store,CompilerAdapter:Compiler,WorkerDebuggerAdapter:Debugger,SessionController:Controller,
    requestAnimationFrame(callback){calls.frames.push(callback);return calls.frames.length;},fetch(url){const item={url:String(url),...deferred()};calls.network.push(item);return item.promise;},async assertTrustedOfflineWorkers(){return {offline:false};},async digest(){return '';},
  });
  await vm.runInContext(`(async()=>{${executable}\n globalThis.subject={render,handleShortcut,canInvokeShortcut,invokeShortcut,manualClipboard,
    read(){return {draft,requested,snapshotMode,currentTab,recovering,restored,prepared,ready,compilation,controller,autoSave,unqueuedEdits};},
    seedSession(value,capabilities){controller=new SessionController({});controller.view=value;prepared={capabilities:{capabilities},profile:{compatibilityId:'audit'},resources:[],lock:{}};ready=true;},
    showSnapshot(){activeSnapshot=makeSnapshot();snapshotMode=true;showText();}
  };})()`,context,{filename:`ui/src/main.mjs@${revision}:complete-module`});
  const app=context.subject;
  const track=promise=>{pendingTasks.push(promise);return promise;};
  return {app,calls,records,original,document,element,track,store,
    read:()=>structuredClone(app.read().draft),
    async edit(text){element('source').value=text;element('source').oninput();await tick();},
    async flush(){await app.read().autoSave.flush();},
    async paste(){const index=calls.clipboardReads.length,done=track(element('paste').onclick());await until(()=>calls.clipboardReads.length>index,'clipboard read begins');return {index,done,request:calls.clipboardReads[index]};},
    async copy(){const index=calls.clipboardWrites.length,done=track(element('copy').onclick());await until(()=>calls.clipboardWrites.length>index,'clipboard write begins');return {index,done,request:calls.clipboardWrites[index]};},
    async importText(text,name='new.cpp'){element('file').files=[{name,size:Buffer.byteLength(text),async text(){return text;}}];element('file').value=name;await element('file').onchange();},
    key(key,options={}){const event={key,code:'',ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,repeat:false,isComposing:false,keyCode:0,defaultPrevented:false,...options,preventDefault(){this.defaultPrevented=true;},getModifierState:()=>false};document.listeners.get('keydown')(event);return event;},
    async cleanup(){for(const item of calls.clipboardReads)item.resolve('// cleanup');for(const item of calls.clipboardWrites)item.resolve();for(const item of calls.network)item.resolve({ok:false});for(const item of calls.compilers)item.pending?.resolve({status:'cancelled',requestId:item.request.requestId,sourceHash:item.request.snapshot.sourceHash,diagnostics:[]});await Promise.allSettled(pendingTasks);await tick();app.read().autoSave.dispose();},
  };
}
