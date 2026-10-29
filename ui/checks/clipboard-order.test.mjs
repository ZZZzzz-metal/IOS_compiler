import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {CompilerAdapter} from '../../compiler/src/compiler-adapter.mjs';
import {createSnapshot} from '../../compiler/src/source.mjs';
import {WorkerDebuggerAdapter} from '../../debugger/src/worker-adapter.mjs';
import {digest} from '../../debugger/src/integrity.mjs';
import {SessionController} from '../src/session-controller.mjs';
import * as editor from '../src/editor.mjs';
import {createDraft,parseImport,serializeDraft,validateDraft} from '../../storage/src/draft-store.mjs';
import {createAutosave} from '../../storage/src/autosave.mjs';
import {assertTrustedOfflineWorkers} from '../../app/offline/browser/trust.mjs';
import {mountCompletionEditor} from '../src/completion-editor.mjs';

// Run the complete actual main module, replacing only imports with the same
// real implementations and controlled DOM/clipboard/store transports. No
// application function is extracted or patched. The full-module approach
// follows person 05's audit; no dependency on their transient audit files.
// Historical mode must fail behavior assertions, not missing-new-helper errors.
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=process.env.UI_REVIEW_REF
  ? execFileSync('git',['show',process.env.UI_REVIEW_REF+':ui/src/main.mjs'],{cwd:root,encoding:'utf8'})
  : await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
assert.equal((source.match(/^import[^\r\n]*;\r?$/gmu)??[]).length,process.env.UI_REVIEW_REF?9:10);
const executable=source.replace(/^import[^\r\n]*;\r?$/gmu,'');
if(process.env.UI_REVIEW_REF){
  for(const path of ['ui/src/editor.mjs','ui/src/session-controller.mjs','storage/src/autosave.mjs','storage/src/draft-store.mjs']){
    const current=(await readFile(new URL('../../'+path,import.meta.url),'utf8')).replace(/\r\n/gu,'\n');
    const historical=execFileSync('git',['show',process.env.UI_REVIEW_REF+':'+path],{cwd:root,encoding:'utf8'}).replace(/\r\n/gu,'\n');
    assert.equal(current,historical,'Historical comparison dependency changed: '+path);
  }
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('Clipboard fixture did not start the expected read');}

class Element{
  constructor(id,document){Object.assign(this,{id,document,ownerDocument:document,dataset:{},attributes:{},children:[],files:[],value:'',textContent:'',className:'',style:{},disabled:false,hidden:false,readOnly:false,scrollTop:0,scrollLeft:0,selectionStart:0,selectionEnd:0,open:false,returnValue:'',listeners:new Map()});}
  replaceChildren(...children){this.children=children;this.textContent='';}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(name,handler){this.listeners.set(name,handler);}
  removeEventListener(name,handler){if(this.listeners.get(name)===handler)this.listeners.delete(name);}
  focus(){this.document.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  showModal(){assert.equal(this.open,false);this.open=true;}
  close(value){if(value!==undefined)this.returnValue=value;this.open=false;return this.listeners.get('close')?.();}
  select(){}
}
async function fixture(t){
  const nodes=new Map(),document={activeElement:null,hidden:false};
  const window={localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},removeEventListener(){}};
  const node=id=>{if(!nodes.has(id))nodes.set(id,new Element(id,document));return nodes.get(id);};
  const controls=['continue','stepInto','stepOver','stepOut'].map(command=>{const button=node('control-'+command);button.dataset.command=command;button.textContent=command;return button;});
  Object.assign(document,{body:node('body'),defaultView:window,getElementById:node,createElement:tag=>new Element(tag,document),
    querySelector:selector=>selector==='dialog[open]'?[...nodes.values()].find(item=>item.open)??null:node(selector),
    querySelectorAll:selector=>selector==='[data-command]'?controls:[],addEventListener(){},removeEventListener(){}});
  const original=createDraft({id:'main',revision:1,userText:'int original = 1;\n',stdin:'1\n'});
  const records=new Map([['main',structuredClone(original)]]),writes=[],reads=[],copies=[],tasks=[];
  let recoveryGate=null;
  const store={async load(id){return records.has(id)?structuredClone(records.get(id)):null;},
    async save(value,expected){
      if(value.id.startsWith('recovery-')&&recoveryGate)await recoveryGate.promise;
      const draft=validateDraft(value),prior=records.get(draft.id);
      assert.equal(prior?.revision??null,expected,'Real autosave must retain CAS revision');
      const saved={...draft,revision:(prior?.revision??0)+1};records.set(saved.id,structuredClone(saved));writes.push(structuredClone(saved));return {revision:saved.revision};
    }};
  const context=vm.createContext({URL,URLSearchParams,Uint8Array,TextEncoder,structuredClone,crypto:webcrypto,setTimeout,clearTimeout,
    location:{href:'https://clipboard-test.invalid/ui/probe.html',hash:''},history:{replaceState(){}},
    window,document,
    navigator:{clipboard:{readText(){const read=deferred();reads.push(read);return read.promise;},writeText(){const copy=deferred();copies.push(copy);return copy.promise;}}},
    CompilerAdapter,createSnapshot,WorkerDebuggerAdapter,digest,SessionController,...editor,mountCompletionEditor,
    createDraft,parseImport,serializeDraft,createAutosave,createDraftStore:()=>store,assertTrustedOfflineWorkers,
    requestAnimationFrame(){throw Error('Unexpected asynchronous rendering in clipboard test');},
    fetch(){throw Error('Unexpected network request in clipboard test');}});
  await vm.runInContext('(async()=>{\n'+executable+'\n globalThis.subject={read:()=>({draft,currentTab,snapshotMode,recovering,autoSave,completionUI:typeof completionUI===\'undefined\'?null:completionUI})};})()',context,{filename:'ui/src/main.mjs:complete-module'});
  const state=()=>context.subject.read(),flush=()=>state().autoSave.flush();
  const track=promise=>{tasks.push(promise);return promise;};
  const app={node,reads,copies,records,writes,original,state,flush,
    attemptPaste(){return track(node('paste').onclick());},
    async paste(){const index=reads.length,done=track(node('paste').onclick());await until(()=>reads.length>index);return {...reads[index],done};},
    async copy(){const index=copies.length,done=track(node('copy').onclick());await until(()=>copies.length>index);return {...copies[index],done};},
    edit(text){node('source').value=text;node('source').oninput();},
    async import(text){node('file').files=[{name:'new.cpp',size:Buffer.byteLength(text),async text(){return text;}}];await node('file').onchange();},
    async manual(){const read=await app.paste();read.reject(Error('Clipboard permission denied'));await read.done;assert.equal(node('clipboard-dialog').open,true);},
    recover(){return track(node('recover-save').onclick());},
    blockRecovery(){recoveryGate=deferred();return recoveryGate;},
    message:()=>node('message').textContent};
  t.after(async()=>{recoveryGate?.resolve();for(const read of reads)read.resolve('// cleanup');for(const copy of copies)copy.resolve();await Promise.allSettled(tasks);await state().completionUI?.dispose();state().autoSave.dispose();});
  return app;
}

test('clipboard: a saved source edit survives a late read with no extra revision',async t=>{
  const app=await fixture(t),read=await app.paste();
  app.edit('int latest_typed = 20;\n');await app.flush();
  assert.equal(app.records.get('main').revision,2);
  read.resolve('int stale_clipboard = 10;\n');await read.done;await app.flush();
  assert.equal(app.state().draft.userText,'int latest_typed = 20;\n');
  assert.equal(app.node('source').value,'int latest_typed = 20;\n');
  assert.equal(app.records.get('main').userText,'int latest_typed = 20;\n');
  assert.equal(app.records.get('main').revision,2);
  assert.equal(app.writes.length,1);
  assert.match(app.message(),/保留当前内容/u);
});
for(const change of ['stdin','language','driver']){
  test('clipboard: '+change+' edits invalidate an earlier read',async t=>{
    const app=await fixture(t),read=await app.paste();
    if(change==='stdin'){app.node('stdin').value='new input\n';app.node('stdin').oninput();}
    if(change==='language'){app.node('language').value='c';app.node('language').onchange();}
    if(change==='driver'){app.node('driver-tab').onclick();app.edit('int main() { return 2; }\n');}
    await app.flush();const before=structuredClone(app.state().draft),shown=app.node('source').value;
    read.resolve('obsolete clipboard');await read.done;await app.flush();
    assert.deepEqual(structuredClone(app.state().draft),before);
    assert.equal(app.node('source').value,shown);assert.equal(app.writes.length,1);
    assert.equal(app.records.get('main').revision,2);
  });
}
test('clipboard: newest request alone wins when B finishes before A',async t=>{
  const app=await fixture(t),a=await app.paste(),b=await app.paste();
  b.resolve('new B');await b.done;await app.flush();
  app.node('message').textContent='new feedback';
  a.resolve('old A');await a.done;await app.flush();
  assert.equal(app.node('source').value,'new B');assert.equal(app.writes.length,1);
  assert.equal(app.records.get('main').userText,'new B');assert.equal(app.message(),'new feedback');
});
test('clipboard: A cannot apply while a newer B read is still pending',async t=>{
  const app=await fixture(t),a=await app.paste(),b=await app.paste();
  a.resolve('old A');await a.done;await app.flush();
  assert.equal(app.node('source').value,app.original.userText);assert.equal(app.writes.length,0);
  b.resolve('new B');await b.done;await app.flush();
  assert.equal(app.records.get('main').userText,'new B');assert.equal(app.writes.length,1);
});
test('clipboard: old failure does not open fallback while B is pending',async t=>{
  const app=await fixture(t),a=await app.paste(),b=await app.paste();
  app.node('message').textContent='B feedback';a.reject(Error('old denial'));await a.done;
  assert.equal(app.node('clipboard-dialog').open,false);assert.equal(app.message(),'B feedback');
  b.resolve('B source');await b.done;await app.flush();assert.equal(app.writes.length,1);
});
test('clipboard: old failure cannot reopen fallback after B has succeeded',async t=>{
  const app=await fixture(t),a=await app.paste(),b=await app.paste();
  b.resolve('B source');await b.done;await app.flush();app.node('message').textContent='B saved';
  a.reject(Error('old denial'));await a.done;
  assert.equal(app.node('clipboard-dialog').open,false);assert.equal(app.message(),'B saved');
  assert.equal(app.node('source').value,'B source');assert.equal(app.writes.length,1);
});
test('clipboard: failure after an edit preserves feedback and never opens fallback',async t=>{
  const app=await fixture(t),read=await app.paste();
  app.edit('new source');await app.flush();app.node('message').textContent='current feedback';
  read.reject(Error('old denial'));await read.done;
  assert.equal(app.node('clipboard-dialog').open,false);assert.equal(app.message(),'current feedback');
  assert.equal(app.writes.length,1);assert.equal(app.node('source').value,'new source');
});
for(const text of ['// 正常粘贴\n','']){
  test('clipboard: a current successful read applies '+(text?'Unicode source':'empty text'),async t=>{
    const app=await fixture(t);app.node('driver-tab').onclick();const read=await app.paste();
    read.resolve(text);await read.done;await app.flush();
    assert.equal(app.state().currentTab,'user');assert.equal(app.state().snapshotMode,false);
    assert.equal(app.node('source').value,text);assert.equal(app.records.get('main').userText,text);
    assert.equal(app.records.get('main').revision,2);assert.equal(app.writes.length,1);
  });
}
test('clipboard: current denied read can apply manual text exactly once',async t=>{
  const app=await fixture(t);await app.manual();
  app.node('clipboard-text').value='manual text';app.node('clipboard-dialog').close('apply');await app.flush();
  assert.equal(app.node('source').value,'manual text');assert.equal(app.writes.length,1);
  app.node('clipboard-dialog').close('apply');await app.flush();assert.equal(app.writes.length,1);
});
test('clipboard: cancelling manual paste leaves draft and store unchanged',async t=>{
  const app=await fixture(t);await app.manual();app.node('clipboard-text').value='cancelled';
  app.node('clipboard-dialog').close('close');await app.flush();
  assert.equal(app.node('source').value,app.original.userText);assert.equal(app.writes.length,0);
});
test('clipboard: pending import replacement blocks late read side effects (preventative)',async t=>{
  const app=await fixture(t),read=await app.paste();
  await app.import('int imported = 40;\n');await app.flush();const imported=app.state().draft;
  read.resolve('int stale_clipboard = 30;\n');await read.done;await app.flush();
  assert.equal(app.state().draft,imported);assert.equal(app.node('source').value,imported.userText);
  assert.equal(app.writes.length,1);assert.equal(app.records.get('main').revision,2);
  assert.match(app.message(),/保留当前内容/u);
});
test('clipboard: manual apply revalidates after an import replaces the draft',async t=>{
  const app=await fixture(t);await app.manual();app.node('clipboard-text').value='old manual';
  await app.import('new imported');await app.flush();
  app.node('clipboard-dialog').close('apply');await app.flush();
  assert.equal(app.node('source').value,'new imported');assert.equal(app.records.get('main').userText,'new imported');
  assert.equal(app.writes.length,1);assert.match(app.message(),/保留当前内容/u);
});
test('clipboard: recovery start invalidates reads and rejects new paste requests',async t=>{
  const app=await fixture(t),read=await app.paste(),gate=app.blockRecovery(),recovered=app.recover();
  await until(()=>app.state().recovering);
  const extra=app.attemptPaste();await tick();assert.equal(app.reads.length,1);await extra;
  read.resolve('obsolete before recovery');await read.done;
  assert.equal(app.state().draft.userText,app.original.userText);assert.equal(app.writes.length,0);
  gate.resolve();await recovered;assert.match(app.state().draft.id,/^recovery-/u);
  assert.equal(app.node('source').value,app.original.userText);assert.equal(app.writes.length,1);
});
test('clipboard: manual apply cannot write into a completed recovery copy',async t=>{
  const app=await fixture(t);await app.manual();app.node('clipboard-text').value='obsolete manual';
  await app.recover();const recovered=app.state().draft;
  app.node('clipboard-dialog').close('apply');await app.flush();
  assert.equal(app.state().draft,recovered);assert.equal(recovered.userText,app.original.userText);
  assert.equal(app.writes.length,1);assert.equal(app.records.get(recovered.id).revision,1);
});
test('clipboard: an old error after recovery cannot open fallback or replace feedback',async t=>{
  const app=await fixture(t),read=await app.paste();await app.recover();app.node('message').textContent='recovery feedback';
  read.reject(Error('obsolete denial'));await read.done;
  assert.equal(app.node('clipboard-dialog').open,false);assert.equal(app.message(),'recovery feedback');
});
test('clipboard: copy fallback resets prior dialog return value and cannot paste',async t=>{
  const app=await fixture(t);await app.manual();app.node('clipboard-text').value='first manual';
  app.node('clipboard-dialog').close('apply');await app.flush();
  const copy=await app.copy();copy.reject(Error('copy denied'));await copy.done;
  assert.equal(app.node('clipboard-dialog').returnValue,'');assert.equal(app.node('clipboard-apply').hidden,true);
  app.node('clipboard-text').value='copy view is not input';app.node('clipboard-dialog').close('apply');await app.flush();
  assert.equal(app.node('source').value,'first manual');assert.equal(app.writes.length,1);
});
test('clipboard: late copy fallback preserves an open manual paste and its context',async t=>{
  const app=await fixture(t),copy=await app.copy();await app.manual();app.node('clipboard-text').value='manual in progress';
  copy.reject(Error('late copy denial'));await copy.done;
  assert.equal(app.node('clipboard-text').value,'manual in progress');assert.equal(app.node('clipboard-apply').hidden,false);
  app.node('clipboard-dialog').close('apply');await app.flush();
  assert.equal(app.node('source').value,'manual in progress');assert.equal(app.writes.length,1);
});
