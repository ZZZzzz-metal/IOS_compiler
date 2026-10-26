// Real Node Worker compilation/execution plus the UI display selector.
// This does not exercise a browser DOM and does not claim iPad validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import {createIntegrationCandidate} from '../../app/integration/candidate.mjs';
import {createNodeHost,bounded,breakpoint} from '../../app/integration/node-host.mjs';
import {WorkerDebuggerAdapter} from '../../debugger/src/worker-adapter.mjs';
import {SessionController} from '../src/session-controller.mjs';
import {breakpointView} from '../src/editor.mjs';

async function until(controller,predicate,description){
  const deadline=performance.now()+20000;
  while(performance.now()<deadline){
    const view=controller.getView();
    if(predicate(view))return view;
    if(view.session?.state==='failed')throw Error(`${description}: ${JSON.stringify(view.session.failure??view.error)}`);
    await delay(5);
  }
  throw Error(`${description}: timed out; ${JSON.stringify(controller.getView())}`);
}
const inspected=view=>view.actions.inspect&&view.session.frameId&&view.variables.some(variable=>variable.name==='i');

test('VAL-004 real session keeps deleted-draft breakpoint at i=0/i=1; a new build has no breakpoint and exits 3',{timeout:180000},async()=>{
  const candidate=await createIntegrationCandidate(),host=createNodeHost(candidate);
  const fixture=await readFile(new URL('../../fixtures/regressions/ui-stale-breakpoints.cpp',import.meta.url),'utf8');
  const original=await host.compile({text:fixture});
  const workers=[],events=[];
  const adapter=new WorkerDebuggerAdapter({profile:candidate.profile,resources:candidate.resources,baseURL:candidate.baseURL,
    createWorker:()=>{const worker=new Worker(new URL('../../debugger/src/node-worker.mjs',import.meta.url),{execArgv:[]});workers.push(worker);return worker;}});
  const unsubscribe=adapter.subscribe(event=>events.push(event));
  // Controller subscribes before start, including the initial binding event.
  const controller=new SessionController({adapter});
  const requestFor=(compiled,requests,stopOnEntry)=>({
    sessionId:randomUUID(),buildId:compiled.result.build.buildId,sourceHash:compiled.snapshot.sourceHash,compatibilityId:candidate.profile.compatibilityId,
    build:compiled.result.build,snapshot:compiled.snapshot,mode:'debug',stdin:{text:'',encoding:'utf-8',eof:true},
    initialBreakpoints:requests,stopOnEntry,
    limits:{runningTimeMs:30000,outputBytes:65536,variablePageSize:32,memoryBytes:268435456},
  });
  try{
    await bounded(adapter.registerResource(original.result.build.executable.relativePath,original.bytes),'register original build');
    const requested=[breakpoint(4,'main.cpp')],oldRequest=requestFor(original,requested,false);
    assert.equal((await bounded(controller.start(oldRequest),'start original session')).accepted,true);
    let current=await until(controller,inspected,'first L4 breakpoint and real locals');
    assert.equal(current.session.reason,'breakpoint');
    assert.equal(current.session.position.sourcePath,'main.cpp');assert.equal(current.session.position.line,4);
    assert.equal(current.breakpoints.length,1);assert.equal(current.breakpoints[0].status,'bound');
    assert.ok(current.breakpoints[0].actual.some(p=>p.sourcePath==='main.cpp'&&p.line===4));
    assert.equal((await controller.evaluate('i')).result.displayValue,'0');
    const originalBinding=structuredClone(current.breakpoints),oldPause=current.session.pauseId;

    // This is a changed editor draft with its breakpoint deleted, not a command to the old session.
    const editedSource=fixture+`// changed editor draft ${randomUUID()}\n`;
    requested.splice(0,1);
    const snapshotModel=breakpointView({snapshotMode:true,requested,bindings:current.breakpoints,sourceUnchanged:false,
      sessionMatchesSnapshot:current.session.sourceHash===original.snapshot.sourceHash});
    assert.equal(snapshotModel.readOnly,true);assert.deepEqual(snapshotModel.entries,originalBinding);
    assert.ok(snapshotModel.entries.some(entry=>entry.requested.sourcePath==='main.cpp'&&entry.requested.line===4),'snapshot gutter/list share the retained request');
    assert.deepEqual(breakpointView({snapshotMode:false,requested,bindings:current.breakpoints,sourceUnchanged:false,sessionMatchesSnapshot:true}).entries,[]);
    assert.deepEqual(controller.getView().breakpoints,originalBinding,'deleting an editor request must not mutate the live binding');

    assert.equal((await bounded(controller.control('continue'),'continue old session')).accepted,true);
    current=await until(controller,v=>inspected(v)&&v.session.pauseId!==oldPause,'second real L4 breakpoint');
    assert.equal(current.session.reason,'breakpoint');assert.equal(current.session.position.line,4);
    assert.equal((await controller.evaluate('i')).result.displayValue,'1');
    assert.deepEqual(breakpointView({snapshotMode:true,requested,bindings:current.breakpoints,sourceUnchanged:false,sessionMatchesSnapshot:true}).entries,originalBinding);
    assert.equal((await bounded(controller.control('stop'),'stop old session')).accepted,true);
    const stopped=await until(controller,v=>v.session?.state==='terminated','old session stopped');
    assert.equal(stopped.session.termination.reason,'stop');

    const changed=await host.compile({text:editedSource});
    assert.notEqual(changed.snapshot.sourceHash,original.snapshot.sourceHash);
    assert.notEqual(changed.result.build.buildId,original.result.build.buildId);
    await bounded(adapter.registerResource(changed.result.build.executable.relativePath,changed.bytes),'register changed build');
    const newRequest=requestFor(changed,requested,true);
    assert.notEqual(newRequest.sessionId,oldRequest.sessionId);
    assert.equal((await bounded(controller.start(newRequest),'start new session without editor breakpoint')).accepted,true);
    current=await until(controller,v=>v.actions.inspect&&v.session.frameId,'new build entry pause');
    assert.equal(current.session.reason,'entry');assert.deepEqual(current.breakpoints,[]);
    assert.equal(current.session.sourceHash,changed.snapshot.sourceHash);
    assert.deepEqual(breakpointView({snapshotMode:true,requested,bindings:current.breakpoints,sourceUnchanged:true,sessionMatchesSnapshot:true}).entries,[]);
    assert.equal((await bounded(controller.control('continue'),'continue new session')).accepted,true);
    current=await until(controller,v=>v.session.state==='terminated'||v.actions.inspect,'new build exits without the removed breakpoint');
    assert.equal(current.session.state,'terminated','no L4 pause may survive into the new session');
    assert.equal(current.session.termination.reason,'exit');assert.equal(current.session.termination.exitCode,3);
    const oldPauses=events.filter(event=>event.sessionId===oldRequest.sessionId&&event.kind==='paused');
    const newPauses=events.filter(event=>event.sessionId===newRequest.sessionId&&event.kind==='paused');
    assert.deepEqual(oldPauses.map(event=>event.reason),['breakpoint','breakpoint']);
    assert.deepEqual(newPauses.map(event=>event.reason),['entry']);
    assert.ok(events.some(event=>event.sessionId===oldRequest.sessionId&&event.kind==='breakpoints'&&event.bindings[0]?.status==='bound'));
    assert.ok(events.some(event=>event.sessionId===newRequest.sessionId&&event.kind==='breakpoints'&&event.bindings.length===0));
  }finally{
    controller.dispose();unsubscribe();adapter.dispose();
    await Promise.allSettled(workers.map(worker=>worker.terminate()));
  }
});
