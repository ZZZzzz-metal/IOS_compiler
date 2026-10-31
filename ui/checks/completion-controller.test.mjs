import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {createCompletionController,completionLexicalContext} from '../src/completion-controller.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes,no) => { resolve=yes; reject=no; });
  return {promise,resolve,reject};
};
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function context(text='pri', offset=text.length) {
  return {enabled:true,focused:true,composing:false,documentVersion:1,sourcePath:'main.cpp',text,offset,selectionEnd:offset,
    language:'cpp',standard:'c++17',snapshot:{snapshotId:'snapshot-1',sourceHash:'sha256:source-1',encoding:'utf-8',newline:'lf',
      translationUnit:'main.cpp',files:[{path:'main.cpp',role:'user',text,contentHash:'sha256:file-1'}]}};
}
const candidate = (id='print', start=0, end=3, extra={}) => ({id,label:id,kind:'function',detail:'void '+id+'()',insertText:id,
  replaceRange:{startOffset:start,endOffset:end},...extra});
const result = (request, items=[candidate()], extra={}) => ({requestId:request.requestId,documentVersion:request.documentVersion,
  snapshotId:request.snapshot.snapshotId,sourceHash:request.snapshot.sourceHash,sourcePath:request.sourcePath,offset:request.offset,
  status:'succeeded',items,isIncomplete:false,diagnostics:[],...extra});
function harness({initial=context(),complete,cancel,apply,delayMs=1,maxItems=80,makeRequestId,onChange}={}) {
  let live=initial;
  const requests=[], changes=[], edits=[];
  const controller=createCompletionController({getContext:()=>live,complete:request=>{
    requests.push(request); return complete?.(request) ?? Promise.resolve(result(request));
  },cancel,onChange:state=>{changes.push(state);onChange?.(state);},onApply:edit=>{
    edits.push(edit);return apply ? apply(edit) : true;
  },delayMs,maxItems,makeRequestId});
  return {controller,requests,changes,edits,get live(){return live;},set live(value){live=value;}};
}

test('requests use the frozen CompletionAdapter contract and read-only detached snapshots', async () => {
  const h=harness();
  await h.controller.request();
  const request=h.requests[0];
  assert.deepEqual(Object.keys(request).sort(),['requestId','documentVersion','snapshot','sourcePath','offset','trigger','language','standard'].sort());
  assert.equal(request.trigger,'manual');assert.equal(request.sourcePath,'main.cpp');
  assert.notEqual(request.snapshot,h.live.snapshot);
  assert.equal(Object.isFrozen(request.snapshot.files[0]),true);
  assert.throws(()=>{request.snapshot.files[0].text='rewritten';},TypeError);
  assert.equal(h.live.text,'pri');
  assert.equal(h.controller.state.phase,'open');
  assert.equal(Object.isFrozen(h.controller.state.items[0].replaceRange),true);
  assert.throws(()=>{h.controller.state.items.push(candidate());},TypeError);
});

test('automatic input is debounced and captures the final snapshot only', async () => {
  const h=harness({delayMs:10});
  h.controller.input();h.live=context('prin',4);h.controller.input();
  assert.equal(h.requests.length,0);assert.equal(h.controller.state.phase,'idle');
  await sleep(25);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].offset,4);assert.equal(h.requests[0].trigger,'identifier');
  h.controller.dispose();
});

test('manual request bypasses automatic delay', async () => {
  const h=harness({delayMs:60000});h.controller.input();
  await h.controller.request();assert.equal(h.requests.length,1);
  assert.equal(h.controller.state.phase,'open');await h.controller.dispose();
});

test('changed timer context cannot start a stale request even without another input event', async () => {
  const h=harness({delayMs:5});h.controller.input();h.live=context('print',5);
  await sleep(15);assert.equal(h.requests.length,0);assert.equal(h.controller.state.phase,'idle');
});

test('old success after cancellation cannot overwrite a later request; cancellation drains first', async () => {
  const old=deferred(), cancelled=deferred(), fresh=deferred();
  const cancellations=[];
  const h=harness({complete:request=>request.documentVersion===1?old.promise:fresh.promise,
    cancel:id=>{cancellations.push(id);return cancelled.promise;}});
  const first=h.controller.request();await tick();
  h.live=context('pri');h.live.documentVersion=2;
  const second=h.controller.request();await tick();
  assert.equal(h.requests.length,1);assert.deepEqual(cancellations,[h.requests[0].requestId]);
  cancelled.resolve();await tick();assert.equal(h.requests.length,1,'cancel resolution alone does not prove complete settled');
  old.resolve(result(h.requests[0],[candidate('private')]));await first;await tick();
  assert.equal(h.requests.length,2);assert.equal(h.controller.state.phase,'pending');
  fresh.resolve(result(h.requests[1],[candidate('print')]));await second;
  assert.equal(h.controller.state.items[0].label,'print');
});

test('invalidate returns a fence for request settlement even when cancel rejects', async () => {
  const pending=deferred();let drained=false;
  const h=harness({complete:()=>pending.promise,cancel:()=>Promise.reject(new Error('cancel transport failed'))});
  const request=h.controller.request();await tick();
  const cancellation=h.controller.invalidate().then(()=>{drained=true;});await tick();
  assert.equal(drained,false);assert.equal(h.controller.state.phase,'idle');
  pending.reject(new Error('worker stopped'));await request;await cancellation;
  assert.equal(drained,true);assert.equal(h.controller.state.phase,'idle');
});

test('old rejection cannot replace current results', async () => {
  const pending=deferred();let count=0;
  const h=harness({complete:request=>++count===1?pending.promise:Promise.resolve(result(request)),cancel:()=>undefined});
  const first=h.controller.request();await tick();const second=h.controller.request();
  pending.reject(new Error('old failure'));await first;await second;
  assert.equal(h.controller.state.phase,'open');
});

for (const [field,value] of [['requestId','other'],['documentVersion',2],['snapshotId','other'],['sourceHash','sha256:other'],['sourcePath','other.cpp'],['offset',2]]) {
  test(`rejects stale result identity: ${field}`, async () => {
    const h=harness({complete:request=>Promise.resolve(result(request,[candidate()],{[field]:value}))});
    await h.controller.request();assert.equal(h.controller.state.phase,'error');assert.equal(h.controller.state.items.length,0);
    assert.equal(h.controller.choose(0,h.controller.state.token),false);assert.equal(h.edits.length,0);
  });
}

for (const [name,change] of [
  ['caret',c=>({...c,offset:2,selectionEnd:2})],['selection',c=>({...c,selectionEnd:0})],
  ['document version',c=>({...c,documentVersion:2})],['file',c=>({...c,sourcePath:'other.cpp'})],
  ['focus',c=>({...c,focused:false})],['composition',c=>({...c,composing:true})],
  ['read-only/disabled',c=>({...c,enabled:false})],['text without version bump',c=>({...c,text:'pro'})],
  ['snapshot contents without identity bump',c=>({...c,snapshot:{...c.snapshot,files:[...c.snapshot.files,{path:'extra.cpp',text:'different'}]}})]
]) {
  test(`late result and selection both reject changed ${name}`, async () => {
    const pending=deferred(),h=harness({complete:()=>pending.promise});
    const request=h.controller.request();await tick();h.live=change(h.live);
    pending.resolve(result(h.requests[0]));await request;
    assert.equal(h.controller.state.phase,'idle');assert.equal(h.edits.length,0);
    const shown=harness();await shown.controller.request();const token=shown.controller.state.token;
    shown.live=change(shown.live);assert.equal(shown.controller.choose(0,token),false);assert.equal(shown.edits.length,0);
  });
}

test('safe prefix ranges extend over the identifier suffix and apply once with a caret', async () => {
  const h=harness({initial:context('print + 1',3)});await h.controller.request();
  assert.deepEqual(h.controller.state.items[0].replaceRange,{startOffset:0,endOffset:5});
  const token=h.controller.state.token;
  assert.equal(h.controller.choose(0,token),true);assert.equal(h.controller.choose(0,token),false);
  assert.deepEqual(h.edits,[{start:0,end:5,text:'print',caret:5,token}]);assert.equal(h.controller.state.phase,'idle');
});

test('range validation rejects arbitrary, cross-line, partial-start and split-surrogate rewrites', async () => {
  const h=harness({initial:context('int x;\npri',10),complete:request=>Promise.resolve(result(request,[
    candidate('print',0,10),candidate('print2',6,10),candidate('print3',8,10),candidate('print4',7,9),
    candidate('print5',7,99),candidate('print6',7,7.5),candidate('print7',7,10)
  ]))});
  await h.controller.request();assert.deepEqual(h.controller.state.items.map(item=>item.id),['print7']);
  const unicode=harness({initial:context('𝒫ri',4),complete:request=>Promise.resolve(result(request,[
    candidate('𝒫rint',1,4),candidate('𝒫rint2',0,4)
  ]))});
  await unicode.controller.request();assert.deepEqual(unicode.controller.state.items.map(item=>item.id),['𝒫rint2']);
});

test('member insertion accepts empty range and replaces suffix at a caret before a member name', async () => {
  const dot=harness({initial:context('obj.',4),complete:request=>Promise.resolve(result(request,[candidate('size',4,4)]))});
  await dot.controller.request();assert.equal(dot.controller.choose(0,dot.controller.state.token),true);
  assert.deepEqual(dot.edits[0],{start:4,end:4,text:'size',caret:8,token:dot.edits[0].token});
  const suffix=harness({initial:context('obj.size',4),complete:request=>Promise.resolve(result(request,[candidate('length',4,4)]))});
  await suffix.controller.request();assert.deepEqual(suffix.controller.state.items[0].replaceRange,{startOffset:4,endOffset:8});
});

test('list filtering, stable sorting, limits and selection movement use provider items only', async () => {
  const h=harness({maxItems:2,complete:request=>Promise.resolve(result(request,[candidate('prism',0,3,{sortText:'2'}),
    candidate('Print',0,3,{sortText:'1'}),candidate('next'),candidate('priority',0,3,{sortText:'3'})]))});
  await h.controller.request();assert.deepEqual(h.controller.state.items.map(item=>item.id),['Print','prism']);
  assert.equal(h.controller.move(-1),true);assert.equal(h.controller.state.selectedIndex,1);
  assert.equal(h.controller.move(1),true);assert.equal(h.controller.state.selectedIndex,0);
  assert.equal(h.controller.move(0.5),false);
});

test('malformed items, snippets and multiline insertions never become writable choices', async () => {
  const h=harness({complete:request=>Promise.resolve(result(request,[candidate('print',0,3,{insertText:'print(${1:x})'}),
    candidate('priority',0,3,{insertText:'priority\nother'}),candidate('private',0,3,{kind:'not-a-kind'}),
    candidate('prism',0,3,{detail:null}),candidate('prison',0,3,{insertText:'pri\uD800'}),candidate('printf')]))});
  await h.controller.request();assert.deepEqual(h.controller.state.items.map(item=>item.id),['printf']);
  const duplicate=harness({complete:request=>Promise.resolve(result(request,[candidate(),candidate()]))});
  await duplicate.controller.request();assert.equal(duplicate.controller.state.phase,'error');assert.equal(duplicate.controller.state.items.length,0);
});

for (const status of ['failed','unsupported','cancelled']) {
  test(`${status} result keeps ordinary Tab/Enter available via an empty state`, async () => {
    const h=harness({complete:request=>Promise.resolve(result(request,[candidate()],{status}))});
    await h.controller.request();assert.notEqual(h.controller.state.phase,'open');assert.equal(h.controller.state.items.length,0);
    assert.equal(h.controller.move(1),false);assert.equal(h.controller.choose(0,h.controller.state.token),false);
  });
}

test('empty and thrown provider results clear choices; an older click token never applies', async () => {
  const h=harness();await h.controller.request();const oldToken=h.controller.state.token;
  await h.controller.request();assert.equal(h.controller.choose(0,oldToken),false);
  assert.equal(h.edits.length,0);
  const empty=harness({complete:request=>Promise.resolve(result(request,[]))});await empty.controller.request();
  assert.equal(empty.controller.state.phase,'empty');assert.equal(empty.controller.state.selectedIndex,-1);
  const thrown=harness({complete:()=>{throw new Error('provider unavailable');}});await thrown.controller.request();
  assert.equal(thrown.controller.state.phase,'error');assert.equal(thrown.controller.state.items.length,0);
});

test('apply failure reports false; reentrant notifications cannot write after context changes', async () => {
  for (const apply of [()=>false,()=>{throw new Error('native undo refused');}]) {
    const h=harness({apply});await h.controller.request();assert.equal(h.controller.choose(0,h.controller.state.token),false);
    assert.equal(h.controller.state.phase,'idle');assert.equal(h.edits.length,1);
  }
  let h,change=false;
  h=harness({onChange:state=>{if(change&&state.phase==='idle')h.live={...h.live,focused:false};}});
  await h.controller.request();change=true;
  assert.equal(h.controller.choose(0,h.controller.state.token),false);assert.equal(h.edits.length,0);
});

test('a replacement request from a synchronous close notification consumes the older choice', async () => {
  let h,reenter=false,replacement;
  h=harness({onChange:state=>{
    if(reenter&&state.phase==='idle') {reenter=false;replacement=h.controller.request();}
  }});
  await h.controller.request();reenter=true;
  assert.equal(h.controller.choose(0,h.controller.state.token),false);assert.equal(h.edits.length,0);
  await replacement;assert.equal(h.controller.state.phase,'open');
});

test('dispose cancels timers and late requests permanently', async () => {
  const pending=deferred(),h=harness({complete:()=>pending.promise});
  const request=h.controller.request();await tick();const disposed=h.controller.dispose();
  pending.resolve(result(h.requests[0]));await request;await disposed;
  await h.controller.request();h.controller.input();await sleep(5);
  assert.equal(h.requests.length,1);assert.equal(h.controller.state.phase,'idle');assert.equal(h.edits.length,0);
});

test('duplicate request IDs fail closed instead of reusing a provider identity', async () => {
  const h=harness({makeRequestId:()=> 'same'});await h.controller.request();await h.controller.request();
  assert.equal(h.requests.length,1);assert.equal(h.controller.state.phase,'error');
});

test('lexical guard accepts C/C++ identifiers and actual member operators', () => {
  for (const text of ['pri','obj.','ptr->','std::','obj.si','ptr->va','std::ve','中文','𝒫ri']) {
    assert.ok(completionLexicalContext(text,text.length),text);
  }
  assert.equal(completionLexicalContext('obj.',4).trigger,'.');
  assert.equal(completionLexicalContext('ptr->',5).trigger,'->');
  assert.equal(completionLexicalContext('std::',5).trigger,'::');
  assert.deepEqual(completionLexicalContext('print',3),{start:0,end:5,prefix:'pri',trigger:'identifier'});
  assert.equal(completionLexicalContext('𝒫ri',1,true),null);
  assert.equal(completionLexicalContext('x + ',4),null);
  assert.ok(completionLexicalContext('x + ',4,true));
});

test('lexical guard suppresses comments, escaped strings/chars, raw strings, includes and numbers', () => {
  const forbidden=['// obj.','// continued\\\nobj.','/* std::','"obj.','"escaped\\\" still.','\'x.','\'\\\' still.',
    'R"(obj.)','u8R"tag(raw \" quote\nobj.)tag','LR"d(raw\nstd::)d',
    '1.','1.2','0x1.fp+','12e+','0b101','42ULL','1\'000.','#include <vec'];
  for(const text of forbidden) {
    assert.equal(completionLexicalContext(text,text.length),null,text);
    assert.equal(completionLexicalContext(text,text.length,true),null,`manual ${text}`);
  }
  for(const text of ['// previous\nobj.','/* previous */obj.','R"(previous)";obj.','"previous";obj.',"'x';obj.","case'a':pri","sizeof'a' + pri"]) {
    assert.ok(completionLexicalContext(text,text.length),text);
  }
  assert.equal(completionLexicalContext('"',1,true),null);
  assert.equal(completionLexicalContext("'",1,true),null);
});

test('disabled, selected, composing and literal input never contacts the provider', async () => {
  const h=harness();
  for(const c of [{...context(),enabled:false},{...context(),focused:false},{...context(),composing:true},
    {...context(),selectionEnd:0},context('"hello',6),context('0.5',3)]) {
    h.live=c;h.controller.input();await h.controller.request();
  }
  await sleep(5);assert.equal(h.requests.length,0);assert.equal(h.controller.state.items.length,0);
});
