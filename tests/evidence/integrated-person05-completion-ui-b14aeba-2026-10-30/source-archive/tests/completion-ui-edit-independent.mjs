// Person 05: controlled transports for editor policy, never browser undo/device evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import {createCompletionOffsetMap,applyCompletionEdit} from '../ui/src/completion-edit.mjs';
import {completionLexicalContext,createCompletionController} from '../ui/src/completion-controller.mjs';
import {completionViewport,placeCompletionPopup,createCompletionPopup} from '../ui/src/completion-popup.mjs';
import {createSnapshot} from '../compiler/src/source.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const revision='b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const evidence=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30/controlled-edit');
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,...args],{cwd:root,encoding:'utf8'}).trim();
assert.equal(git('rev-parse','HEAD'),revision,'Keep fixed product target');
const dependencies=['ui/src/completion-edit.mjs','ui/src/completion-popup.mjs','ui/src/completion-controller.mjs','compiler/src/source.mjs'];
git('diff','--exit-code','HEAD','--',...dependencies);
await mkdir(evidence,{recursive:true});
const records=[],inputs=[];
for(const path of [...dependencies,'tests/completion-ui-edit-independent.mjs']){
  const bytes=await readFile(resolve(root,path));
  inputs.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
let checks=null;
function check(label,actual,expected){
  const record={label,actual,expected};checks.push(record);
  try{assert.deepEqual(actual,expected);record.verdict='passed';}
  catch(error){record.verdict='failed';throw error;}
}
async function scenario(id,body){
  checks=[];const record={id,scope:'controlled-editor-and-geometry',checks};records.push(record);
  try{record.observation=await body();record.verdict='passed';}
  catch(error){record.verdict='failed';record.error={message:error.message,stack:error.stack};}
}
const boundary=(text,offset)=>Number.isSafeInteger(offset)&&offset>=0&&offset<=text.length&&
  !(offset>0&&offset<text.length&&text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff&&
    text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff)&&!(text[offset-1]==='\r'&&text[offset]==='\n');
// Independent prefix-count model, not the product sparse checkpoint algorithm.
function referenceOffset(raw,limit){
  let size=0,index=raw.startsWith('\uFEFF')?1:0;
  for(;index<limit;index++){
    if(raw[index]==='\r'&&raw[index+1]==='\n')index++;
    size++;
  }
  return size;
}
function transport(value,{behavior='normal',input=true,focusChange}={}){
  const events=new Map(),calls=[],document={activeElement:null};let saves=0;
  const source={value,selectionStart:1,selectionEnd:2,selectionDirection:'backward',scrollTop:31,scrollLeft:9,
    readOnly:false,disabled:false,isConnected:true,ownerDocument:document,
    focus(){document.activeElement=this;focusChange?.(this);},
    setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},
    addEventListener(type,handler){const set=events.get(type)??new Set();set.add(handler);events.set(type,set);},
    removeEventListener(type,handler){events.get(type)?.delete(handler);}};
  document.execCommand=(command,showUI,text)=>{
    calls.push({command,showUI,text,start:source.selectionStart,end:source.selectionEnd});
    if(behavior==='refuse')return false;
    if(behavior==='throw-before')throw Error('controlled unsupported native command');
    const prefix=source.value.slice(0,source.selectionStart),suffix=source.value.slice(source.selectionEnd);
    source.value=prefix+(behavior==='unexpected'?'different':text)+suffix;
    if(input)for(const handler of events.get('input')??[])handler({target:source});
    if(behavior==='throw-after')throw Error('controlled command threw after change');
    return behavior!=='false-after';
  };
  return {source,document,calls,onEdited(){saves++;},get saves(){return saves;}};
}
const edit=(host,range)=>applyCompletionEdit({...host,...range});

await scenario('offsets-exhaustive-mixed-newlines-and-unicode',()=>{
  const texts=['','\uFEFF','\uFEFF中😀\r\npriNT\r后\n末','a\rb\r\nc\nd','😀甲𐐀z','\uFEFF\r\n\r\n中'];
  let accepted=0,rejected=0;
  for(const text of texts){
    const map=createCompletionOffsetMap(text);
    check('normalized text',map.text,text.replace(/^\uFEFF/u,'').replace(/\r\n?/gu,'\n'));
    for(let index=0;index<=text.length;index++){
      check(`editor boundary ${JSON.stringify(text)}@${index}`,map.isEditorBoundary(index),boundary(text,index));
      if(!boundary(text,index)){
        check('invalid editor boundary throws',(()=>{try{map.editorToSnapshot(index);return false;}catch{return true;}})(),true);rejected++;continue;
      }
      const wanted=referenceOffset(text,index);check('prefix model offset',map.editorToSnapshot(index),wanted);
      check('round trip canonical BOM boundary',map.snapshotToEditor(wanted),index===0&&text.startsWith('\uFEFF')?1:index);accepted++;
    }
    for(let index=0;index<=map.text.length;index++){
      const valid=boundary(map.text,index);check('snapshot scalar boundary',map.isSnapshotBoundary(index),valid);
      if(valid)check('snapshot round trip',map.editorToSnapshot(map.snapshotToEditor(index)),index);
    }
    for(const invalid of [-1,0.5,text.length+1,NaN])check('out of range editor offset rejected',map.isEditorBoundary(invalid),false);
  }
  return {texts,acceptedBoundaries:accepted,rejectedInteriorBoundaries:rejected};
});

await scenario('middle-of-token-full-replacement-with-bom-crlf-and-nonbmp',()=>{
  const raw='\uFEFF// 中文😀\r\nint main(){ int printValue=1; priNT; }\r\n';
  const normalized=raw.replace(/^\uFEFF/u,'').replace(/\r\n?/gu,'\n');
  const rawStart=raw.indexOf('priNT'),rawEnd=rawStart+5,map=createCompletionOffsetMap(raw);
  const caret=normalized.indexOf('priNT')+3,lexical=completionLexicalContext(normalized,caret);
  check('entire identifier lexical extent',lexical,{start:normalized.indexOf('priNT'),end:normalized.indexOf('priNT')+5,prefix:'pri',trigger:'identifier'});
  const host=transport(raw);host.source.setSelectionRange(rawStart+3,rawStart+3);
  const result=edit(host,{start:map.snapshotToEditor(lexical.start),end:map.snapshotToEditor(lexical.end),text:'printValue'});
  check('full native replacement applied',result,{applied:true,changed:true,inputObserved:true});
  check('outside source exact, including BOM and CRLF',host.source.value,raw.slice(0,rawStart)+'printValue'+raw.slice(rawEnd));
  check('one native transaction',host.calls,[{command:'insertText',showUI:false,text:'printValue',start:rawStart,end:rawEnd}]);
  check('no fallback save after normal input',host.saves,0);
  check('caret after inserted name',[host.source.selectionStart,host.source.selectionEnd],[rawStart+10,rawStart+10]);
  return {before:raw,after:host.source.value,normalizedCaret:caret,nativeCommand:host.calls[0]};
});

for(const behavior of ['refuse','throw-before'])await scenario(`native-${behavior}-leaves-source-selection-scroll`,()=>{
  const host=transport('alphaXYZomega',{behavior});host.source.setSelectionRange(5,8,'backward');
  const result=edit(host,{start:5,end:8,text:'Name'});
  check('safe refusal',result,{applied:false,reason:'unsupported',inputObserved:false});
  check('source unchanged',host.source.value,'alphaXYZomega');
  check('selection and scroll restored',[host.source.selectionStart,host.source.selectionEnd,host.source.selectionDirection,host.source.scrollTop,host.source.scrollLeft],[5,8,'backward',31,9]);
  check('only one command, no retry',host.calls.length,1);check('no save',host.saves,0);
});
for(const behavior of ['normal','false-after','throw-after'])await scenario(`native-${behavior}-single-edit-and-save-fallback`,()=>{
  const host=transport('alphaXYZomega',{behavior,input:false});
  const result=edit(host,{start:5,end:8,text:'Name'});
  check('actual native text wins over boolean/throw',result,{applied:true,changed:true,inputObserved:false});
  check('one edit',host.source.value,'alphaNameomega');check('one command',host.calls.length,1);check('one save fallback',host.saves,1);
});
await scenario('missing-native-command-never-emulates-value-or-range-edit',()=>{
  const host=transport('original');delete host.document.execCommand;
  host.source.setRangeText=()=>{throw Error('must not emulate native undo');};
  const result=edit(host,{start:0,end:8,text:'replacement'});
  check('safe refusal',result,{applied:false,reason:'unsupported',inputObserved:false});check('original text',host.source.value,'original');check('no command',host.calls.length,0);
});
await scenario('invalid-text-surrogate-and-crlf-interiors-never-edit',()=>{
  for(const range of [{start:2,end:2,text:'x'},{start:4,end:4,text:'x'},{start:0,end:1,text:'\uD800'},{start:6,end:5,text:'x'}]){
    const host=transport('a😀\r\nz');const result=edit(host,range);
    check('refused invalid edit',result.applied,false);check('text unchanged',host.source.value,'a😀\r\nz');check('no native command',host.calls.length,0);
  }
});
await scenario('readonly-disabled-detached-and-focus-race-refuse',()=>{
  for(const field of ['readOnly','disabled','isConnected']){
    const host=transport('original');host.source[field]=field==='isConnected'?false:true;
    check('context blocked',edit(host,{start:0,end:8,text:'x'}).applied,false);check('no native command',host.calls.length,0);check('text unchanged',host.source.value,'original');
  }
  for(const focusChange of [source=>{source.readOnly=true;},source=>{source.value='new-import';},source=>{source.ownerDocument.activeElement=null;}]){
    const host=transport('original',{focusChange});const afterFocus=focusChange.toString().includes('new-import')?'new-import':'original';
    check('focus-time context refused',edit(host,{start:0,end:8,text:'x'}),{applied:false,reason:'context-changed',inputObserved:false});
    check('no native command',host.calls.length,0);check('race-owned source retained',host.source.value,afterFocus);
  }
});
await scenario('unexpected-native-result-preserves-observed-text-and-saves-once',()=>{
  const host=transport('abc',{behavior:'unexpected',input:false});
  check('unexpected result marked changed failure',edit(host,{start:0,end:3,text:'wanted'}),{applied:false,changed:true,reason:'unexpected-edit',inputObserved:false});
  check('actual text retained',host.source.value,'different');check('no second replacement',host.calls.length,1);check('save observed mutation once',host.saves,1);
});

function contextFixture(){
  const text='int main(){ priNT; }',offset=text.indexOf('priNT')+3;
  const snapshot=createSnapshot([{path:'main.cpp',role:'user',text}],'main.cpp',{snapshotId:'independent-edit-snapshot'});
  return {enabled:true,focused:true,composing:false,documentVersion:4,sourcePath:'main.cpp',language:'cpp',standard:'c++17',text,offset,selectionEnd:offset,snapshot};
}
async function openedController(){
  let context=contextFixture(),request,applied=[];
  const controller=createCompletionController({getContext:()=>context,onApply:edit=>{applied.push(edit);return true;},
    complete:async value=>{request=value;return {status:'succeeded',requestId:value.requestId,documentVersion:value.documentVersion,snapshotId:value.snapshot.snapshotId,
      sourceHash:value.snapshot.sourceHash,sourcePath:value.sourcePath,offset:value.offset,isIncomplete:false,diagnostics:[],items:[{id:'prefix-only',label:'printValue',insertText:'printValue',kind:'variable',detail:'int printValue',replaceRange:{startOffset:value.offset-3,endOffset:value.offset}}]};}});
  await controller.request();check('provider candidate opened',controller.state.phase,'open');
  return {controller,applied,get request(){return request;},get context(){return context;},set context(value){context=value;}};
}
await scenario('prefix-only-provider-range-expands-over-complete-suffix',async()=>{
  const host=await openedController(),start=host.context.text.indexOf('priNT'),token=host.controller.state.token;
  check('visible replacement covers suffix',host.controller.state.items[0].replaceRange,{startOffset:start,endOffset:start+5});
  check('choose allowed once',host.controller.choose(0,token),true);check('no duplicate choose',host.controller.choose(0,token),false);
  check('one full-token edit',host.applied,[{start,end:start+5,text:'printValue',caret:start+10,token}]);await host.controller.dispose();
});
for(const [name,mutate] of [
  ['focus',value=>{value.focused=false;}],['readonly-or-snapshot-disabled',value=>{value.enabled=false;}],
  ['language',value=>{value.language='c';value.standard='c11';}],['source-file',value=>{value.sourcePath='other.cpp';}],
  ['import-same-text-new-document',value=>{value.documentVersion++;}],['import-same-text-new-snapshot',value=>{value.snapshot.snapshotId+='-new';}],
  ['caret',value=>{value.offset--;value.selectionEnd--;}],['range-selection',value=>{value.selectionEnd++;}]
])await scenario(`already-open-result-cannot-edit-after-${name}`,async()=>{
  const host=await openedController(),token=host.controller.state.token;
  const replacement=structuredClone(host.context);mutate(replacement);host.context=replacement;
  check('old choose rejected',host.controller.choose(0,token),false);check('no edit callback',host.applied,[]);check('old popup invalidated',host.controller.state.phase,'idle');await host.controller.dispose();
});

await scenario('viewport-and-footer-placement-with-zoom-keyboard-and-clipping',()=>{
  check('layout viewport fallback',completionViewport({innerWidth:390,innerHeight:844}),{left:0,top:0,right:390,bottom:844});
  const viewport=completionViewport({visualViewport:{offsetLeft:15,offsetTop:100,width:360,height:330},innerWidth:1000,innerHeight:900});
  check('visual viewport offsets',viewport,{left:15,top:100,right:375,bottom:430});
  const editor={left:0,top:50,right:390,bottom:800},footer=37,row=48;
  for(const caret of [{left:30,top:200,right:31,bottom:220},{left:340,top:390,right:341,bottom:410}]){
    const box=placeCompletionPopup({caret,editor,viewport,width:400,height:357,minHeight:footer+row});
    check('one row and full footer fit',box.height>=footer+row,true);
    check('inside visible editor/viewport',box.left>=21&&box.left+box.width<=369&&box.top>=106&&box.top+box.height<=424,true);
    check('footer reserved before list',box.height-footer>=row,true);
  }
  check('insufficient row/footer room closes',placeCompletionPopup({caret:{left:30,top:140,right:31,bottom:160},editor,viewport:{left:15,top:100,right:375,bottom:200},width:400,height:357,minHeight:footer+row}),null);
  check('caret hidden behind keyboard closes',placeCompletionPopup({caret:{left:30,top:500,right:31,bottom:520},editor,viewport,width:400,height:357,minHeight:footer+row}),null);
});

// This small explicit geometry transport tests listener/generation and chrome allocation.
// It does not claim to reproduce CSS layout, browser pointer routing, or actual touch.
function popupTransport(){
  const document={activeElement:null,defaultView:null};let serial=0;
  class Node{
    constructor(tag='div'){Object.assign(this,{tag,serial:++serial,ownerDocument:document,children:[],style:{},attributes:{},dataset:{},listeners:new Map(),hidden:false,className:'',parentElement:null,scrollTop:0,offsetTop:0,offsetHeight:44,clientHeight:44});}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
    addEventListener(key,listener){const list=this.listeners.get(key)??[];list.push(listener);this.listeners.set(key,list);}
    emit(key,extras={}){const event={pointerId:1,pointerType:'mouse',clientX:55,clientY:65,preventDefault(){this.defaultPrevented=true;},...extras};for(const listener of this.listeners.get(key)??[])listener(event);return event;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);}
    get scrollHeight(){return this.className==='completion-list'?this.children.length*44+8:44;}
    getBoundingClientRect(){
      if(this===source)return {left:10,top:20,right:380,bottom:420,width:370,height:400};
      if(this.tag==='span')return {left:-99950,top:80,right:-99949,bottom:96,width:1,height:16};
      if(this.style.left==='-100000px')return {left:-100000,top:0,right:-99630,bottom:200,width:370,height:200};
      const height=this.hidden?0:this.className==='completion-hint'?37:this.className==='completion-status'?36:this.className==='completion-list'?this.scrollHeight:44;
      return {left:0,top:0,right:370,bottom:height,width:370,height};
    }
    getClientRects(){return [this.getBoundingClientRect()];}
  }
  document.createElement=tag=>new Node(tag);document.createTextNode=text=>({textContent:text});
  const source=new Node('textarea'),container=new Node();document.body=new Node('body');
  Object.assign(source,{value:'pri',selectionStart:3,clientWidth:370,clientHeight:400,offsetWidth:370,offsetHeight:400,clientLeft:0,clientTop:0,scrollLeft:0,readOnly:false,disabled:false,wrap:'off'});
  source.parentElement=document.body;document.activeElement=source;
  document.defaultView={innerWidth:390,innerHeight:844,getComputedStyle:()=>({lineHeight:'20px',whiteSpace:'pre',overflowX:'visible',overflowY:'visible'})};
  return {source,container,document};
}
const popupState=(token=1)=>({phase:'open',token,selectedIndex:0,items:[{label:'printValue',detail:'int printValue',kind:'unknown'}]});
await scenario('pending-short-shell-to-open-reserves-independent-footer',()=>{
  const host=popupTransport(),popup=createCompletionPopup({...host,onChoose(){}});
  popup.render({phase:'pending',token:1,items:[],selectedIndex:-1});
  check('pending visible',host.container.hidden,false);
  popup.render({...popupState(),items:Array.from({length:15},(_,index)=>({label:`print${index}`,detail:'int',kind:'unknown'}))});
  const list=host.container.children.find(node=>node.className==='completion-list'),footer=host.container.children.find(node=>node.className==='completion-hint');
  check('open visible',host.container.hidden,false);check('footer hint present',footer.textContent.includes('Tab / Enter'),true);
  check('list reserves measured footer',Number.parseFloat(host.container.style.maxHeight)-Number.parseFloat(list.style.maxHeight),37);
  check('list keeps one row',Number.parseFloat(list.style.maxHeight)>=44,true);
  const observed={shell:host.container.style.maxHeight,list:list.style.maxHeight,footerHeight:37,placement:host.container.dataset.placement};popup.dispose();return observed;
});
await scenario('popup-old-dom-focus-readonly-and-scroll-gesture-gates',()=>{
  const host=popupTransport(),calls=[],popup=createCompletionPopup({...host,onChoose:(index,token)=>calls.push({index,token})});
  popup.render(popupState(10));const old=host.container.children.find(node=>node.className==='completion-list').children[0];
  popup.render(popupState(11));const current=host.container.children.find(node=>node.className==='completion-list').children[0];
  old.emit('click');check('old DOM does not choose',calls,[]);
  host.source.readOnly=true;current.emit('click');check('readonly does not choose',calls,[]);
  host.source.readOnly=false;host.document.activeElement=null;current.emit('click');check('lost focus does not choose',calls,[]);
  host.document.activeElement=host.source;
  current.emit('pointerdown',{pointerType:'touch'});current.emit('pointermove',{pointerType:'touch',clientY:100});current.emit('pointerup',{pointerType:'touch',clientY:100});current.emit('click');check('touch scroll is not selection',calls,[]);
  current.emit('pointerdown',{pointerType:'touch'});current.emit('pointerup',{pointerType:'touch'});current.emit('click');
  check('touch tap plus compatibility click selects once',calls,[{index:0,token:11}]);
  popup.dispose();current.emit('click');check('disposed DOM cannot select',calls,[{index:0,token:11}]);
});

const result={revision,scope:'controlled transports/pure geometry only; no real native undo, IME, browser layout, iPad or offline acceptance',inputs,
  scenarios:records.length,passed:records.filter(record=>record.verdict==='passed').length,failed:records.filter(record=>record.verdict==='failed').length,
  checks:records.reduce((sum,record)=>sum+record.checks.length,0),records};
await writeFile(resolve(evidence,'results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(evidence,'README.md'),`# Independent editor policy checks\n\nFixed target: ${revision}.\n\nRun: node tests/completion-ui-edit-independent.mjs\n\n${result.passed}/${result.scenarios} scenarios; ${result.checks} checks. Controlled editor/native-command transports and explicit geometry only. Actual browser native undo, CSS layout, input method, keyboard routing and device behavior must be separately observed. No product module was patched.\n`,{flag:'wx'});
console.log(JSON.stringify({revision,evidence:relative(root,evidence),scenarios:result.scenarios,passed:result.passed,failed:result.failed,checks:result.checks},null,2));
if(result.failed)process.exitCode=1;
