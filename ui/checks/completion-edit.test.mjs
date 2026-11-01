import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSourceText} from '../../compiler/src/source.mjs';
import {createCompletionOffsetMap,applyCompletionEdit} from '../src/completion-edit.mjs';

// Controlled editing transport verifies transaction bookkeeping only. The real
// browser's native undo stack and iPad behavior are verified separately.
function fixture({value='int ans;',selection=[4,7],emit=true,result=true,command='insert'}={}){
  const listeners=new Set(),calls={commands:0,edits:0,inputs:0,focus:0};
  const document={activeElement:null};
  const source={value,selectionStart:selection[0],selectionEnd:selection[1],selectionDirection:'backward',
    scrollTop:24,scrollLeft:5,readOnly:false,disabled:false,isConnected:true,ownerDocument:document,
    focus(){calls.focus++;document.activeElement=this;},
    setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},
    addEventListener(name,listener,capture){assert.equal(name,'input');assert.equal(capture,true);listeners.add(listener);},
    removeEventListener(name,listener,capture){assert.equal(name,'input');assert.equal(capture,true);listeners.delete(listener);}};
  document.execCommand=(name,showUI,text)=>{
    calls.commands++;assert.equal(name,'insertText');assert.equal(showUI,false);
    if(command==='throw')throw Error('Unsupported');
    if(command==='none')return result;
    source.value=source.value.slice(0,source.selectionStart)+text+source.value.slice(source.selectionEnd);
    if(command==='unexpected')source.value+=';';
    if(emit){const event={target:source};for(const listener of listeners)listener(event);calls.inputs++;calls.edits++;}
    return result;
  };
  return {source,document,calls,listeners,apply:options=>applyCompletionEdit({source,start:4,end:7,text:'answer',onEdited:()=>calls.edits++,...options})};
}

test('completion offsets normalize exactly like the compiler and preserve BOM on inverse zero',()=>{
  for(const original of ['', 'abc', '\uFEFF', '\uFEFFa\r\nb\rc\n😀x', '😀\r\n\r\n𐐀\r末', '\uFEFF\uFEFFx']){
    const map=createCompletionOffsetMap(original);
    assert.equal(map.text,normalizeSourceText(original));
    assert.equal(map.snapshotToEditor(0),original.startsWith('\uFEFF')?1:0);
    for(let offset=0;offset<=original.length;offset++){
      if(!map.isEditorBoundary(offset)){assert.throws(()=>map.editorToSnapshot(offset),RangeError);continue;}
      const normalized=map.editorToSnapshot(offset);
      assert.equal(map.text.slice(0,normalized),normalizeSourceText(original.slice(0,offset)));
      assert.equal(map.snapshotToEditor(normalized),offset===0&&original.startsWith('\uFEFF')?1:offset);
    }
    for(let offset=0;offset<=map.text.length;offset++){
      if(!map.isSnapshotBoundary(offset)){assert.throws(()=>map.snapshotToEditor(offset),RangeError);continue;}
      assert.equal(map.editorToSnapshot(map.snapshotToEditor(offset)),offset);
    }
  }
});

test('completion offsets reject CRLF interiors, surrogate interiors, invalid types and malformed Unicode',()=>{
  const map=createCompletionOffsetMap('\uFEFF😀\r\nx');
  for(const offset of [-1,NaN,Infinity,1.5,'1',null,8,2,4]){
    assert.equal(map.isEditorBoundary(offset),false);assert.throws(()=>map.editorToSnapshot(offset),RangeError);
  }
  for(const offset of [-1,NaN,Infinity,1.5,'1',null,7,1]){
    assert.equal(map.isSnapshotBoundary(offset),false);assert.throws(()=>map.snapshotToEditor(offset),RangeError);
  }
  for(const bad of [null,42,'\ud800','\udc00','a\ud800b'])assert.throws(()=>createCompletionOffsetMap(bad));
});

test('native completion insertion is one transaction and uses the existing input save once',()=>{
  const f=fixture();assert.deepEqual(f.apply(),{applied:true,changed:true,inputObserved:true});
  assert.equal(f.source.value,'int answer;');assert.equal(f.calls.commands,1);assert.equal(f.calls.edits,1);
  assert.deepEqual([f.source.selectionStart,f.source.selectionEnd],[10,10]);assert.equal(f.listeners.size,0);
});

test('a changed native edit with no input event invokes onEdited once, even when command reports false',()=>{
  const f=fixture({emit:false,result:false});assert.deepEqual(f.apply(),{applied:true,changed:true,inputObserved:false});
  assert.equal(f.calls.edits,1);assert.equal(f.calls.inputs,0);assert.equal(f.calls.commands,1);
});

test('a browser reporting false after its actual edit never causes a duplicate insertion or save',()=>{
  const f=fixture({result:false});assert.equal(f.apply().applied,true);
  assert.equal(f.source.value,'int answer;');assert.equal(f.calls.commands,1);assert.equal(f.calls.edits,1);
});

test('unsupported or throwing native command preserves source and selection without a synthetic fallback',()=>{
  for(const command of ['none','throw']){
    const f=fixture({command}),before={...f.source};
    assert.equal(f.apply().reason,'unsupported');assert.equal(f.calls.edits,0);assert.equal(f.listeners.size,0);
    for(const key of ['value','selectionStart','selectionEnd','selectionDirection','scrollTop','scrollLeft'])assert.equal(f.source[key],before[key]);
    assert.equal(f.calls.commands,1);
  }
  const f=fixture();delete f.document.execCommand;
  assert.equal(f.apply().reason,'unsupported');assert.equal(f.calls.focus,0);assert.equal(f.calls.edits,0);
});

test('readonly, disabled, disconnected and invalid ranges never invoke editing or saving',()=>{
  for(const key of ['readOnly','disabled','isConnected']){
    const f=fixture();f.source[key]=key!=='isConnected';assert.equal(f.apply().reason,'unavailable');
    assert.equal(f.calls.commands,0);assert.equal(f.calls.edits,0);
  }
  for(const [start,end] of [[7,4],[-1,2],[0,99],[1.5,3]]){
    const f=fixture();assert.equal(f.apply({start,end}).reason,'invalid-range');assert.equal(f.calls.commands,0);
  }
  for(const [value,start,end] of [['😀x',1,2],['a\r\nb',1,2]]){
    const f=fixture({value});assert.equal(f.apply({start,end}).reason,'invalid-range');assert.equal(f.calls.commands,0);
  }
  const f=fixture();assert.equal(f.apply({text:'\ud800'}).reason,'invalid-text');assert.equal(f.calls.commands,0);
});

test('a focus callback changing the editor aborts the old transaction and retains newer content',()=>{
  const f=fixture();f.source.focus=function(){f.document.activeElement=this;this.value='newer';};
  assert.equal(f.apply().reason,'context-changed');assert.equal(f.source.value,'newer');assert.equal(f.calls.commands,0);
});

test('a matching candidate with unchanged text only moves the caret and does not create a save',()=>{
  const f=fixture();assert.deepEqual(f.apply({text:'ans'}),{applied:true,changed:false,reason:'unchanged',inputObserved:false});
  assert.equal(f.calls.commands,0);assert.equal(f.calls.edits,0);assert.equal(f.source.value,'int ans;');
  assert.deepEqual([f.source.selectionStart,f.source.selectionEnd],[7,7]);
});

test('unexpected native text is preserved and saved once instead of overwritten by a fallback',()=>{
  for(const emit of [true,false]){
    const f=fixture({command:'unexpected',emit});assert.equal(f.apply().reason,'unexpected-edit');
    assert.equal(f.source.value,'int answer;;');assert.equal(f.calls.edits,1);assert.equal(f.calls.commands,1);
  }
});

test('mapped replacement keeps BOM and line endings outside the candidate intact',()=>{
  const value='\uFEFF// 😀\r\nans\r\n',map=createCompletionOffsetMap(value),start=map.text.indexOf('ans');
  const f=fixture({value});f.apply({start:map.snapshotToEditor(start),end:map.snapshotToEditor(start+3)});
  assert.equal(f.source.value,'\uFEFF// 😀\r\nanswer\r\n');assert.equal(f.calls.edits,1);
});
