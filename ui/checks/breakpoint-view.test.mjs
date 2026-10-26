// Pure display-selection checks. These do not claim browser or iPad validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {breakpointView} from '../src/editor.mjs';

const position=(line,sourcePath='main.cpp')=>({sourcePath,line,column:1});
const request=(breakpointId,line,sourcePath='main.cpp')=>({breakpointId,requested:position(line,sourcePath),enabled:true});
const binding=(bp,status='bound',actual=[bp.requested],reason)=>({breakpointId:bp.breakpointId,requested:structuredClone(bp.requested),status,actual:structuredClone(actual),...(reason?{reason}:{})});

test('VAL-004: deleting draft requests cannot hide an existing snapshot binding',()=>{
  const original=request('original',4),bound=binding(original),requested=[original],bindings=[bound];
  const before=structuredClone(bindings);
  requested.splice(0,1);
  const snapshot=breakpointView({snapshotMode:true,requested,bindings,sourceUnchanged:false,sessionMatchesSnapshot:true});
  assert.deepEqual(snapshot.entries,[bound]);
  assert.equal(snapshot.readOnly,true);
  assert.equal(snapshot.entries.some(entry=>entry.requested.sourcePath==='main.cpp'&&entry.requested.line===4),true,'the same selected entries retain the gutter request position');
  assert.equal(snapshot.entries.length===0,false,'the selected collection must not produce an empty-state message');
  const editable=breakpointView({snapshotMode:false,requested,bindings,sourceUnchanged:false,sessionMatchesSnapshot:true});
  assert.deepEqual(editable.entries,[]);
  assert.equal(editable.readOnly,false);
  assert.deepEqual(bindings,before,'display selection must not delete the old session binding');
});

test('new dirty-draft requests stay separate from the old snapshot collection',()=>{
  const old=binding(request('old',4)),next=request('next',5);
  const args={requested:[next],bindings:[old],sourceUnchanged:false,sessionMatchesSnapshot:true};
  const editable=breakpointView({...args,snapshotMode:false});
  assert.deepEqual(editable.entries,[{breakpointId:'next',requested:next.requested,status:'pending',actual:[]}]);
  assert.deepEqual(breakpointView({...args,snapshotMode:true}).entries,[old]);
});

test('editable binding status is associated only with both matching source and session',()=>{
  const bp=request('same-id',4),bound=binding(bp);
  for(const sourceUnchanged of [false,true])for(const sessionMatchesSnapshot of [false,true]){
    const selected=breakpointView({snapshotMode:false,requested:[bp],bindings:[bound],sourceUnchanged,sessionMatchesSnapshot});
    assert.equal(selected.readOnly,false);
    assert.equal(selected.entries[0].status,sourceUnchanged&&sessionMatchesSnapshot?'bound':'pending');
    assert.deepEqual(selected.entries[0].actual,sourceUnchanged&&sessionMatchesSnapshot?[bp.requested]:[]);
  }
});

test('a snapshot from a different or absent session cannot inherit its bindings',()=>{
  const bp=request('old',4),bound=binding(bp);
  for(const sourceUnchanged of [false,true]){
    const selected=breakpointView({snapshotMode:true,requested:[bp],bindings:[bound],sourceUnchanged,sessionMatchesSnapshot:false});
    assert.deepEqual(selected.entries,[]);
    assert.equal(selected.readOnly,true);
  }
});

test('snapshot remains read-only even while draft source bytes still match',()=>{
  const bp=request('same-source',4);
  const selected=breakpointView({snapshotMode:true,requested:[bp],bindings:[binding(bp)],sourceUnchanged:true,sessionMatchesSnapshot:true});
  assert.equal(selected.readOnly,true);
  assert.equal(selected.entries[0].status,'bound');
});

test('snapshot preserves pending, invalid reasons, and all relocated actual positions',()=>{
  const pending=binding(request('pending',2),'pending',[]);
  const invalid=binding(request('invalid',3),'invalid',[],'此行没有可执行代码');
  const moved=binding(request('relocated',4),'bound',[position(5),position(6)]);
  const bindings=[pending,invalid,moved];
  const result=breakpointView({snapshotMode:true,bindings,sessionMatchesSnapshot:true});
  assert.deepEqual(result.entries,bindings);
  assert.equal(result.entries[1].reason,'此行没有可执行代码');
  assert.equal(result.entries[2].requested.line,4);
  assert.deepEqual(result.entries[2].actual.map(p=>p.line),[5,6]);
});

test('user.inc and driver retain separate requested and actual source paths',()=>{
  const user=binding(request('user',3,'user.inc'));
  const driver=binding(request('driver',5,'driver.cpp'),'bound',[position(6,'driver.cpp')]);
  const selected=breakpointView({snapshotMode:true,requested:[],bindings:[user,driver],sessionMatchesSnapshot:true});
  const positionsFor=sourcePath=>selected.entries.filter(entry=>entry.requested.sourcePath===sourcePath).map(entry=>entry.requested.line);
  assert.deepEqual(positionsFor('user.inc'),[3]);
  assert.deepEqual(positionsFor('driver.cpp'),[5]);
  assert.deepEqual(positionsFor('main.cpp'),[]);
  assert.deepEqual(selected.entries[1].actual,[position(6,'driver.cpp')]);
});

test('replacement bindings and an authoritative empty resync replace the selected snapshot collection',()=>{
  const bp=request('current',4),first=binding(bp),updated=binding(bp,'invalid',[],'重新绑定失败');
  const args={snapshotMode:true,requested:[bp],sessionMatchesSnapshot:true};
  assert.deepEqual(breakpointView({...args,bindings:[first]}).entries,[first]);
  assert.deepEqual(breakpointView({...args,bindings:[updated]}).entries,[updated]);
  assert.deepEqual(breakpointView({...args,bindings:[]}).entries,[]);
});

test('display selection leaves input requests, reasons and actual arrays unchanged',()=>{
  const bp=request('unchanged',4),bound=binding(bp),requested=[bp],bindings=[bound];
  const before=structuredClone({requested,bindings});
  for(const snapshotMode of [false,true])breakpointView({snapshotMode,requested,bindings,sourceUnchanged:true,sessionMatchesSnapshot:true});
  assert.deepEqual({requested,bindings},before);
  assert.deepEqual(breakpointView({snapshotMode:false}),{entries:[],readOnly:false});
  assert.deepEqual(breakpointView({snapshotMode:true}),{entries:[],readOnly:true});
});
