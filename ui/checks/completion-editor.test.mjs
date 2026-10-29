import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createSnapshot,normalizeSourceText} from '../../compiler/src/source.mjs';
import {mountCompletionEditor} from '../src/completion-editor.mjs';
import {createCompletionDOM} from './helpers/completion-dom.mjs';

// The actual consumer/controller/popup/edit modules run here. Only their DOM,
// semantic-provider and native-editing transports are controlled; these results
// do not establish Clang semantics, browser layout/native undo, or iPad support.
const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const tabWiring=main.split('\n').find(line=>line.startsWith("$('source').onkeydown="));
assert.ok(tabWiring,'exercise the actual main textarea key handler');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let attempt=0;attempt<80;attempt++){if(predicate())return;await tick();}throw Error('Completion editor transport did not reach expected state');}
const resultFor=(request,items=[],status='succeeded')=>({requestId:request.requestId,documentVersion:request.documentVersion,
  snapshotId:request.snapshot.snapshotId,sourceHash:request.snapshot.sourceHash,sourcePath:request.sourcePath,
  offset:request.offset,status,items,isIncomplete:false,diagnostics:[]});

async function fixture(t,options={}){
  const dom=createCompletionDOM(),{document,source,container}=dom;
  // main registers its oninput property before mounting the facade's bubble
  // listener. Native insertion's capture observer must still run before both.
  // The shared geometry fixture does not model event phases, so model just this
  // input dispatch explicitly without changing popup-only tests' transport.
  const captures=new Set(),add=source.addEventListener.bind(source),remove=source.removeEventListener.bind(source),dispatch=source.dispatch.bind(source);
  source.addEventListener=(type,handler,options)=>{if(type==='input'&&(options===true||options?.capture))captures.add(handler);add(type,handler,options);};
  source.removeEventListener=(type,handler,options)=>{captures.delete(handler);remove(type,handler,options);};
  source.dispatch=(type,properties={})=>{
    if(type!=='input')return dispatch(type,properties);
    const event={type,target:source,currentTarget:source,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...properties};
    const listeners=[...(source.listeners.get(type)??[])];
    for(const handler of listeners)if(captures.has(handler))handler(event);
    source.oninput?.(event);
    for(const handler of listeners)if(!captures.has(handler))handler(event);
    return event;
  };
  const button=document.createElement('button'),status=document.createElement('p');document.body.append(button,status);
  source.value=options.text??'int main(){ int answer; ans; }';
  source.setSelectionRange(options.offset??source.value.lastIndexOf('ans')+3,options.offset??source.value.lastIndexOf('ans')+3);
  let version=0,enabled=true,sourcePath='main.cpp',language='cpp',standard='c++17',ui;
  let snapshot=createSnapshot([{path:sourcePath,role:'user',text:source.value}],sourcePath,{snapshotId:'editor-0'});
  const calls={complete:[],cancel:[],dispose:[],instances:[],saves:[],indents:[],commands:0};
  function edited(){
    version++;snapshot=createSnapshot([{path:sourcePath,role:'user',text:source.value}],sourcePath,{snapshotId:'editor-'+version});
    calls.saves.push({version,text:source.value});ui?.invalidate();
  }
  source.oninput=edited;
  new Function('$','indent','snapshotMode','completionUI',tabWiring)(()=>source,outdent=>calls.indents.push(outdent),false,
    {get composing(){return ui?.composing;}});
  document.execCommand=(command,showUI,text)=>{
    assert.equal(command,'insertText');assert.equal(showUI,false);calls.commands++;
    const start=source.selectionStart,end=source.selectionEnd;
    source.value=source.value.slice(0,start)+text+source.value.slice(end);
    source.setSelectionRange(start+text.length,start+text.length);source.dispatch('input',{inputType:'insertText',data:text});return true;
  };
  const providerFactory=()=>{
    const instance={
      complete(request){const pending={request,instance,...deferred()};calls.complete.push(pending);return pending.promise;},
      cancel(requestId){
        calls.cancel.push({instance,requestId});
        if(options.cancel)return options.cancel(instance,requestId,calls);
        const pending=calls.complete.find(call=>call.instance===instance&&call.request.requestId===requestId);
        pending?.resolve(resultFor(pending.request,[],'cancelled'));return Promise.resolve();
      },
      dispose(){calls.dispose.push(instance);return options.dispose?.(instance,calls);}
    };calls.instances.push(instance);return instance;
  };
  const getContext=()=>({enabled,documentVersion:version,sourcePath,language,standard,snapshot});
  ui=mountCompletionEditor({source,container,button,status,getContext,onEdited:edited});
  await ui.setProviderFactory(providerFactory);
  const key=(key,properties={})=>source.dispatch('keydown',{key,code:'',ctrlKey:false,altKey:false,metaKey:false,
    shiftKey:false,repeat:false,isComposing:false,keyCode:0,getModifierState:()=>false,...properties});
  const manual=async()=>{const count=calls.complete.length;button.dispatch('click');await until(()=>calls.complete.length>count);return calls.complete.at(-1);};
  function succeed(pending,items){
    const request=pending.request,text=request.snapshot.files.find(file=>file.path===request.sourcePath).text;
    const prefix=/[_\p{ID_Continue}]+$/u.exec(text.slice(0,request.offset))?.[0]??'';
    pending.resolve(resultFor(request,items??[{id:'answer',label:'answer',insertText:'answer',kind:'variable',detail:'int answer',
      replaceRange:{startOffset:request.offset-prefix.length,endOffset:request.offset}}]));
  }
  t.after(async()=>{
    options.cleanup?.();
    for(const pending of calls.complete)pending.resolve(resultFor(pending.request,[],'cancelled'));
    try{await ui.dispose();}catch{/* Expected failure-path tests retain their release error. */}
  });
  return {...dom,button,status,ui,calls,key,manual,succeed,
    getContext,
    setContext(values){
      if('enabled'in values)enabled=values.enabled;if('documentVersion'in values)version=values.documentVersion;
      if('sourcePath'in values)sourcePath=values.sourcePath;if('language'in values)language=values.language;
      if('standard'in values)standard=values.standard;
    }};
}

test('editor warm release awaits asynchronous dispose, blocks new work, and lazily creates a fresh provider',async t=>{
  const disposal=deferred(),f=await fixture(t,{dispose:()=>disposal.promise,cleanup:()=>disposal.resolve()});
  const pending=await f.manual();f.succeed(pending);await until(()=>f.ui.state.phase==='open');
  let released=false;const done=f.ui.release().then(()=>{released=true;});await tick();
  assert.equal(f.calls.cancel.length,0,'settled warm requests are disposed rather than cancelled');
  assert.equal(f.calls.dispose.length,1);assert.equal(released,false);assert.equal(f.button.disabled,true);
  f.button.dispatch('click');f.key(' ',{ctrlKey:true,code:'Space'});await tick();
  assert.equal(f.calls.complete.length,1,'no provider work may start while dispose is pending');
  disposal.resolve();await done;assert.equal(f.button.disabled,false);
  const next=await f.manual();assert.equal(f.calls.instances.length,2);assert.notEqual(next.instance,pending.instance);
});

test('editor active release awaits both cancel acknowledgement and the complete promise settling',async t=>{
  const cancellation=deferred(),f=await fixture(t,{cancel:()=>cancellation.promise,cleanup:()=>cancellation.resolve()});
  const pending=await f.manual();let released=false;
  const done=f.ui.release().then(()=>{released=true;});await tick();
  assert.equal(f.calls.cancel.length,1);assert.equal(released,false);assert.equal(f.calls.dispose.length,0);
  cancellation.resolve();await tick();assert.equal(released,false,'cancel ACK alone cannot release an unsettled request');
  pending.resolve(resultFor(pending.request,[],'cancelled'));await done;
  assert.equal(f.calls.dispose.length,1);assert.equal(released,true);
});

test('editor repeated dispose and release share the same pending warm disposal barrier',async t=>{
  const disposal=deferred(),f=await fixture(t,{dispose:()=>disposal.promise,cleanup:()=>disposal.resolve()});
  const pending=await f.manual();f.succeed(pending);await until(()=>f.ui.state.phase==='open');
  let disposed=false,released=false;
  const first=f.ui.dispose(),again=f.ui.dispose();assert.equal(first,again);
  first.then(()=>{disposed=true;});const later=f.ui.release().then(()=>{released=true;});
  await tick();assert.equal(disposed,false);assert.equal(released,false);assert.equal(f.calls.dispose.length,1);
  disposal.resolve();await Promise.all([first,again,later]);assert.equal(disposed,true);assert.equal(released,true);
});

test('editor dispose rejection closes the provider gate permanently and subsequent release still rejects',async t=>{
  const failure=new Error('worker termination rejected'),f=await fixture(t,{dispose:()=>Promise.reject(failure)});
  const pending=await f.manual();f.succeed(pending);await until(()=>f.ui.state.phase==='open');
  let retained;
  await assert.rejects(f.ui.release(),error=>{retained=error;return error.cause===failure;});
  assert.equal(f.ui.failed,true);assert.equal(f.button.disabled,true);assert.equal(f.ui.state.items.length,0);
  assert.match(f.status.textContent,/未能确认释放/u,'the actionable release failure remains visible after final refresh');
  f.button.dispatch('click');f.key(' ',{ctrlKey:true,code:'Space'});await tick();
  assert.equal(f.calls.complete.length,1);assert.equal(f.calls.dispose.length,1);
  await assert.rejects(f.ui.release(),error=>error===retained);
  await assert.rejects(f.ui.setProviderFactory(()=>{throw Error('must not reopen after an unconfirmed release');}),error=>error===retained);
  assert.equal(f.calls.dispose.length,1,'the rejected provider reference is cleared');
});

test('editor cancel rejection still waits for settlement and dispose, then keeps compilation release closed',async t=>{
  const failure=new Error('cancel rejected'),f=await fixture(t,{cancel:()=>Promise.reject(failure)});
  const pending=await f.manual();let settled=false;
  const done=f.ui.release().finally(()=>{settled=true;});const rejected=assert.rejects(done,error=>error.cause===failure);
  await tick();assert.equal(settled,false);assert.equal(f.calls.dispose.length,0);
  pending.resolve(resultFor(pending.request,[],'cancelled'));await rejected;
  assert.equal(f.calls.dispose.length,1);assert.equal(f.ui.failed,true);assert.equal(f.button.disabled,true);
  assert.match(f.status.textContent,/未能确认释放/u);
  await assert.rejects(f.ui.release(),error=>error.cause===failure);
});

test('editor candidate Tab is one native edit/save and does not fall through to the actual main indent handler',async t=>{
  const f=await fixture(t),pending=await f.manual();f.succeed(pending);await until(()=>f.ui.state.phase==='open');
  const event=f.key('Tab');assert.equal(event.defaultPrevented,true);
  assert.equal(f.source.value,'int main(){ int answer; answer; }');
  assert.equal(f.calls.commands,1);assert.equal(f.calls.saves.length,1);assert.deepEqual(f.calls.indents,[]);
  assert.equal(f.ui.state.items.length,0);assert.equal(f.container.hidden,true);
  f.key('Tab');assert.deepEqual(f.calls.indents,[false],'ordinary Tab reaches existing indentation after completion closes');
});

test('editor empty and pending results do not consume Tab; Shift+Tab retains the existing outdent handler',async t=>{
  const f=await fixture(t),pending=await f.manual();f.key('Tab');assert.deepEqual(f.calls.indents,[false]);
  f.succeed(pending,[]);await until(()=>f.ui.state.phase==='empty');f.key('Tab');
  assert.deepEqual(f.calls.indents,[false,false]);
  const next=await f.manual();f.succeed(next);await until(()=>f.ui.state.phase==='open');f.key('Tab',{shiftKey:true});
  assert.deepEqual(f.calls.indents,[false,false,true]);assert.equal(f.calls.commands,0);
});

test('editor composition blocks automatic/manual requests and confirmation until composition ends',async t=>{
  const f=await fixture(t);f.source.dispatch('compositionstart');
  f.source.dispatch('input',{isComposing:true});f.key(' ',{ctrlKey:true,code:'Space'});f.key('Enter',{isComposing:true});
  await delay(330);assert.equal(f.calls.complete.length,0);assert.equal(f.button.disabled,true);
  f.source.dispatch('compositionend');const event=f.key(' ',{ctrlKey:true,code:'Space'});
  assert.equal(event.defaultPrevented,true);await until(()=>f.calls.complete.length===1);
});

test('editor local composition and keyCode 229 protect the actual main Tab handler even without event.isComposing',async t=>{
  const f=await fixture(t),pending=await f.manual();f.succeed(pending);await until(()=>f.ui.state.phase==='open');
  const before=f.source.value;f.source.dispatch('compositionstart');assert.equal(f.ui.composing,true);
  for(const [key,properties] of [['Tab',{}],['Tab',{shiftKey:true}],['Enter',{}],[' ',{ctrlKey:true,code:'Space'}]]){
    assert.equal(f.key(key,{isComposing:false,...properties}).defaultPrevented,false,'IME retains the unmarked native key');
  }
  assert.equal(f.source.value,before);assert.equal(f.calls.commands,0);assert.equal(f.calls.saves.length,0);assert.deepEqual(f.calls.indents,[]);
  f.source.dispatch('compositionend');assert.equal(f.ui.composing,false);f.ui.invalidate();
  assert.equal(f.key('Tab',{isComposing:false,keyCode:229}).defaultPrevented,false);
  assert.equal(f.source.value,before);assert.equal(f.calls.commands,0);assert.equal(f.calls.saves.length,0);assert.deepEqual(f.calls.indents,[]);
});

test('editor ordinary input saves first and debounces only the latest normalized source for automatic completion',async t=>{
  const f=await fixture(t);
  for(const prefix of ['ans','answ']){
    f.source.value=`int main(){ int answer; ${prefix}; }`;
    const caret=f.source.value.lastIndexOf(prefix)+prefix.length;f.source.setSelectionRange(caret,caret);
    f.source.dispatch('input',{inputType:'insertText',data:prefix.at(-1)});
  }
  assert.equal(f.calls.saves.length,2);assert.equal(f.calls.complete.length,0);
  await delay(330);await until(()=>f.calls.complete.length===1);
  const {request}=f.calls.complete[0];
  assert.equal(request.documentVersion,2);assert.equal(request.trigger,'identifier');
  assert.equal(request.snapshot.files[0].text,f.source.value);assert.equal(request.offset,f.source.selectionStart);
  f.succeed(f.calls.complete[0]);await until(()=>f.ui.state.phase==='open');
});

test('editor manual button restores source focus and Ctrl+Space uses exact modifier gates',async t=>{
  const f=await fixture(t);f.document.activeElement=f.button;
  const pending=await f.manual();assert.equal(f.document.activeElement,f.source);f.succeed(pending,[]);await until(()=>f.ui.state.phase==='empty');
  for(const properties of [{altKey:true},{metaKey:true},{shiftKey:true},{repeat:true},{getModifierState:key=>key==='AltGraph'}]){
    assert.equal(f.key(' ',{ctrlKey:true,code:'Space',...properties}).defaultPrevented,false);
  }
  assert.equal(f.calls.complete.length,1);
  assert.equal(f.key(' ',{ctrlKey:true,code:'Space'}).defaultPrevented,true);await until(()=>f.calls.complete.length===2);
});

test('editor Ctrl+J uses the same local manual entry with exact modifiers and IME/repeat guards',async t=>{
  const f=await fixture(t);
  for(const properties of [{altKey:true},{metaKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{keyCode:229},{getModifierState:key=>key==='AltGraph'}]){
    assert.equal(f.key('j',{ctrlKey:true,code:'KeyJ',...properties}).defaultPrevented,false);
  }
  assert.equal(f.calls.complete.length,0);
  assert.equal(f.key('j',{ctrlKey:true,code:'KeyJ'}).defaultPrevented,true);
  await until(()=>f.calls.complete.length===1);assert.equal(f.calls.complete[0].request.trigger,'manual');
});

test('editor caret/readonly/context/blur changes make existing candidate nodes harmless',async t=>{
  for(const change of ['caret','readonly','version','path','language','blur','disabled']){
    await t.test(change,async sub=>{
      const f=await fixture(sub),pending=await f.manual();f.succeed(pending);await until(()=>f.ui.state.phase==='open');
      const row=f.rows()[0],before=f.source.value;
      if(change==='caret'){f.source.setSelectionRange(0,0);f.document.dispatch('selectionchange');}
      if(change==='readonly'){f.source.readOnly=true;f.ui.refresh();}
      if(change==='version')f.setContext({documentVersion:1});
      if(change==='path')f.setContext({sourcePath:'driver.cpp'});
      if(change==='language')f.setContext({language:'c',standard:'c11'});
      if(change==='blur'){f.document.activeElement=f.button;f.source.dispatch('blur');}
      if(change==='disabled'){f.setContext({enabled:false});f.ui.refresh();}
      row.dispatch('click');assert.equal(f.source.value,before);assert.equal(f.calls.saves.length,0);assert.equal(f.calls.commands,0);
    });
  }
});

test('editor raw BOM/CRLF coordinates map to normalized requests and confirmation preserves surrounding text',async t=>{
  const original='\uFEFF// 😀\r\nint main(){ int answer; ans; }\r\n',offset=original.lastIndexOf('ans')+3;
  const f=await fixture(t,{text:original,offset}),pending=await f.manual();
  assert.equal(pending.request.offset,normalizeSourceText(original.slice(0,offset)).length);
  assert.equal(pending.request.snapshot.files[0].text,normalizeSourceText(original));
  f.succeed(pending);await until(()=>f.ui.state.phase==='open');f.key('Enter');
  assert.equal(f.source.value,'\uFEFF// 😀\r\nint main(){ int answer; answer; }\r\n');
  assert.equal(f.calls.saves.length,1);assert.equal(f.source.selectionStart,offset-3+'answer'.length);
  assert.equal(f.source.selectionEnd,f.source.selectionStart);
});
