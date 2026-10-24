import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkerDebuggerAdapter } from '../src/worker-adapter.mjs';
import { createCandidate } from '../scripts/candidate.mjs';

let serial=0;
const id=prefix=>`${prefix}-${++serial}`;
const keyOf=value=>Object.fromEntries(['sessionId','buildId','sourceHash','compatibilityId'].map(key=>[key,value[key]]));
const pausedKey=event=>({...keyOf(event),pauseId:event.pauseId});
const projectBaseURL=new URL('../../',import.meta.url).href;
async function bounded(promise,description='worker operation',milliseconds=10000) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${description} timed out`)),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
function request(candidate,overrides={}) {
  return {
    sessionId:id('worker-session'),buildId:candidate.build.buildId,sourceHash:candidate.snapshot.sourceHash,
    compatibilityId:candidate.profile.compatibilityId,build:candidate.build,snapshot:candidate.snapshot,mode:'debug',
    stdin:{text:'',encoding:'utf-8',eof:true},initialBreakpoints:[],stopOnEntry:false,
    limits:{runningTimeMs:30000,outputBytes:65536,variablePageSize:32,memoryBytes:268435456},...overrides,
  };
}
async function harness(t,fixture='debug-handoff',options={}) {
  const candidate=await createCandidate({fixture}),workers=[];
  const adapter=new WorkerDebuggerAdapter({
    ...candidate,baseURL:projectBaseURL,sliceInstructions:1000,stopTimeoutMs:500,
    createWorker:()=>{const worker=new Worker(new URL('../src/node-worker.mjs',import.meta.url),{execArgv:[]});workers.push(worker);return worker;},...options,
  });
  const events=[],waiting=new Set();
  adapter.subscribe(event=>{events.push(event);for(const listener of [...waiting])listener(event);});
  const waitFor=(predicate)=>{
    const existing=events.find(predicate);if(existing)return Promise.resolve(existing);
    let listener;
    return bounded(new Promise(resolve=>{listener=event=>{if(predicate(event)){waiting.delete(listener);resolve(event);}};waiting.add(listener);}),'worker event',20000).finally(()=>waiting.delete(listener));
  };
  const command=(kind,extra={})=>adapter.command({kind,commandId:id(kind),...extra});
  const query=(kind,key,extra={})=>adapter.query({kind,key,requestId:id(kind),...extra});
  t.after(async()=>{adapter.dispose();waiting.clear();await Promise.all(workers.map(worker=>worker.terminate()));});
  return {candidate,adapter,events,workers,waitFor,command,query};
}
function assertOrdered(events,key) {
  const own=events.filter(event=>event.sessionId===key.sessionId);
  own.forEach((event,index)=>{assert.equal(event.eventSeq,index+1);assert.deepEqual(keyOf(event),keyOf(key));});
}

test('real Node Worker binds breakpoints, queries real locals, steps a recursive call and exits', {timeout:30000},async t=>{
  const h=await harness(t);
  const r=request(h.candidate,{initialBreakpoints:[{breakpointId:id('bp'),enabled:true,requested:{sourcePath:'main.cpp',line:21,column:1}}]});
  const ack=await bounded(h.command('start',{request:r}),'real worker start');assert.equal(ack.accepted,true,JSON.stringify(ack));
  const before=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='paused');
  assert.equal(before.reason,'breakpoint');assert.equal(before.position.line,21);
  const bindings=h.events.find(event=>event.sessionId===r.sessionId&&event.kind==='breakpoints');
  assert.equal(bindings.bindings[0].status,'bound');assert.ok(bindings.eventSeq<before.eventSeq);
  const initialStack=await h.query('stack',pausedKey(before),{start:0,count:32});assert.equal(initialStack.kind,'stack');assert.match(initialStack.frames[0].functionName,/main/);
  const step=await h.command('stepOver',{key:pausedKey(before)});assert.equal(step.accepted,true);assert.equal(step.invalidatedPauseId,before.pauseId);
  const after=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='paused'&&event.eventSeq>before.eventSeq);
  assert.equal(after.reason,'step');assert.equal(after.position.line,22);assert.notEqual(after.pauseId,before.pauseId);
  assert.equal((await h.query('stack',pausedKey(before),{start:0,count:4})).kind,'error');
  const stack=await h.query('stack',pausedKey(after),{start:0,count:32});assert.equal(stack.kind,'stack');
  const frame=stack.frames[0],key={...pausedKey(after),frameId:frame.frameId};
  const total=await h.query('evaluate',key,{expression:'total',allowSideEffects:false});
  assert.equal(total.kind,'evaluate',JSON.stringify(total));assert.equal(total.result.availability,'available');assert.equal(total.result.displayValue,'15');
  assert.equal((await h.command('continue',{key:pausedKey(after)})).accepted,true);
  const end=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='terminated');assert.equal(end.reason,'exit');assert.equal(end.exitCode,0);
  assertOrdered(h.events,r);
});

test('real Node Worker transfers batch stdin and UTF-8 stdout with authoritative resync', {timeout:30000},async t=>{
  const h=await harness(t,'stdio');
  const r=request(h.candidate,{stdin:{text:'1 2 3 4\n',encoding:'utf-8',eof:true},stopOnEntry:true});
  const ack=await h.command('start',{request:r});assert.equal(ack.accepted,true,JSON.stringify(ack));
  const pause=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='paused');assert.equal(pause.reason,'entry');
  assert.equal((await h.command('continue',{key:pausedKey(pause)})).accepted,true);
  const end=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='terminated');assert.equal(end.reason,'exit');assert.equal(end.exitCode,0);
  const output=h.events.filter(event=>event.sessionId===r.sessionId&&event.kind==='output'&&event.stream==='stdout').map(event=>event.text).join('');
  assert.equal(output,'sum=10 first=1 int64=9223372036854775806\n');
  const synced=await h.adapter.resync({key:keyOf(r),requestId:id('resync')});
  assert.equal(synced.snapshot.state,'terminated');assert.equal(synced.snapshot.termination.exitCode,0);assert.equal(synced.snapshot.eventSeq,end.eventSeq);
  assert.equal(synced.snapshot.outputTail.map(part=>part.text).join(''),output);assertOrdered(h.events,r);
});

test('real C++ STL in Node Worker transfers Chinese, emoji and exact i64 output', {timeout:30000},async t=>{
  const h=await harness(t,'stl',{sliceInstructions:5000});
  const r=request(h.candidate,{stdin:{text:'5 9 1 4 2 7\n',encoding:'utf-8',eof:true}});
  const ack=await h.command('start',{request:r});assert.equal(ack.accepted,true,JSON.stringify(ack));
  const end=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='terminated');assert.equal(end.reason,'exit');assert.equal(end.exitCode,0);
  const output=h.events.filter(event=>event.sessionId===r.sessionId&&event.kind==='output'&&event.stream==='stdout').map(event=>event.text).join('');
  assert.equal(output,'sum=23 min=1 max=9 pointer=5 map=key:2 hash=ok queue=9 heap=10\n中文😀 bytes=10 long=80 empty=0/0\ni64=9223372036854775806 u64=18446744073709551615 int=4 long=4 pointer=4\n');
  assertOrdered(h.events,r);
});

test('real infinite Wasm in Node Worker yields to Stop and permits a new real session', {timeout:30000},async t=>{
  const h=await harness(t,'infinite');
  const next=await createCandidate({fixture:'debug-handoff'});
  const r=request(h.candidate);
  assert.equal((await h.command('start',{request:r})).accepted,true);
  await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='state'&&event.state==='running');
  let heartbeat=false;await delay(30).then(()=>{heartbeat=true;});assert.equal(heartbeat,true);
  const started=performance.now(),stopped=await bounded(h.command('stop',{key:keyOf(r)}),'stop actual infinite Wasm',2000);
  assert.equal(stopped.accepted,true);assert.ok(performance.now()-started<1500);
  const end=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='terminated');assert.equal(end.reason,'stop');
  assert.equal((await h.command('stop',{key:keyOf(r)})).accepted,true);
  const newer=request(next,{stopOnEntry:true});assert.equal((await h.command('start',{request:newer})).accepted,true);
  const pause=await h.waitFor(event=>event.sessionId===newer.sessionId&&event.kind==='paused');assert.equal(pause.reason,'entry');
  assert.equal((await h.query('stack',{...keyOf(r),pauseId:'old'},{start:0,count:4})).kind,'error');
  assert.equal((await h.command('continue',{key:pausedKey(pause)})).accepted,true);
  const completed=await h.waitFor(event=>event.sessionId===newer.sessionId&&event.kind==='terminated');assert.equal(completed.reason,'exit');assert.equal(completed.exitCode,0);
  assertOrdered(h.events,r);assertOrdered(h.events,newer);
});

test('in-memory real artifacts are copied, checked by hash and executed through Node Worker', {timeout:30000},async t=>{
  const h=await harness(t,'stdio'),path='debugger/in-memory/real-stdio.wasm';
  const original=await h.candidate.readResource(h.candidate.build.executable.relativePath),bytes=original.slice();
  assert.equal(await h.adapter.registerResource(path,bytes),true);bytes.fill(0);
  const executable={...h.candidate.build.executable,relativePath:path};
  const build={...h.candidate.build,executable,debugInfo:[executable]};
  const r=request(h.candidate,{build,stdin:{text:'1 2 3 4\n',encoding:'utf-8',eof:true}});
  const ack=await h.command('start',{request:r});assert.equal(ack.accepted,true,JSON.stringify(ack));
  const end=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='terminated');assert.equal(end.exitCode,0);
  assert.equal(h.events.filter(event=>event.sessionId===r.sessionId&&event.kind==='output').map(event=>event.text).join(''),'sum=10 first=1 int64=9223372036854775806\n');
  const corrupted=original.slice();corrupted[corrupted.length-1]^=1;await h.adapter.registerResource(path,corrupted);
  const bad=request(h.candidate,{build});const rejected=await h.command('start',{request:bad});assert.equal(rejected.accepted,false);assert.match(rejected.message,/checksum/i);
  assert.equal(h.events.some(event=>event.sessionId===bad.sessionId&&event.kind==='state'&&event.state==='running'),false);
  await assert.rejects(h.adapter.registerResource('../escape.wasm',original),/virtual/);
  await assert.rejects(h.adapter.registerResource('debugger/in-memory/oversize.wasm',new Uint8Array(16*1024*1024+1)),/limit/);
});

// Fault injection below deliberately executes no guest Wasm. These checks prove
// control-transport kill behavior only, and are not real-program evidence.
class StallingWorker extends EventEmitter {
  constructor({ready=false}={}) {super();this.ready=ready;this.terminated=false;this.messages=[];}
  postMessage(message) {this.messages.push(message);if(message.kind==='init'&&this.ready)queueMicrotask(()=>this.emit('message',{kind:'ready'}));}
  terminate() {this.terminated=true;queueMicrotask(()=>this.emit('exit',0));return Promise.resolve(0);}
}

for(const ready of [false,true])test(`fault injection: Stop hard-kills ${ready?'RPC-stalled':'never-ready'} Worker before any event`, {timeout:30000},async t=>{
  const workers=[];const h=await harness(t,'debug-handoff',{stopTimeoutMs:30,createWorker:()=>{const worker=new StallingWorker({ready});workers.push(worker);return worker;}});
  const r=request(h.candidate),pending=h.command('start',{request:r});
  const stopped=await bounded(h.command('stop',{key:keyOf(r)}),'watchdog stop',1000);
  assert.equal(stopped.accepted,true);assert.equal(workers[0].terminated,true);assert.equal(h.adapter.worker,null);
  assert.equal((await bounded(pending,'cancelled startup',1000)).accepted,false);
  const end=await h.waitFor(event=>event.sessionId===r.sessionId&&event.kind==='terminated');assert.equal(end.reason,'stop');assert.match(end.message,/watchdog/);
  const snapshot=await h.adapter.resync({key:keyOf(r),requestId:id('after-hard-kill')});assert.equal(snapshot.snapshot.state,'terminated');assert.equal(snapshot.snapshot.termination.reason,'stop');
  const reused=await h.command('start',{request:r});assert.equal(reused.accepted,false);assert.match(reused.message,/reused/);assert.equal(workers.length,1);
  const next=request(h.candidate),replacementStart=h.command('start',{request:next});
  assert.equal(workers.length,2);
  const count=h.events.length;workers[0].emit('message',{kind:'event',event:{...keyOf(r),eventSeq:end.eventSeq+1,kind:'paused',pauseId:'late-dead-worker'}});
  assert.equal(h.events.length,count,'old worker generation cannot publish late events');
  const beforeBackground=performance.now();await bounded(h.adapter.background(),'background before init',1000);
  assert.ok(performance.now()-beforeBackground<1000);assert.equal(workers[1].terminated,true);
  assert.equal((await bounded(replacementStart,'background-cancelled start',1000)).accepted,false);
  const background=await h.waitFor(event=>event.sessionId===next.sessionId&&event.kind==='terminated');assert.equal(background.reason,'background');
  assertOrdered(h.events,r);assertOrdered(h.events,next);
});

test('fault injection: wrong-key Stop cannot kill the current stalled Worker', {timeout:30000},async t=>{
  const worker=new StallingWorker({ready:true});
  const h=await harness(t,'debug-handoff',{stopTimeoutMs:30,createWorker:()=>worker});
  const r=request(h.candidate),pending=h.command('start',{request:r});
  const wrong=await bounded(h.command('stop',{key:{...keyOf(r),sourceHash:'sha256:foreign'}}),'foreign stop',1000);
  assert.equal(wrong.accepted,false);assert.equal(wrong.code,'stale-context');assert.equal(worker.terminated,false);assert.equal(h.events.length,0);
  assert.equal((await bounded(h.command('stop',{key:keyOf(r)}),'valid stop',1000)).accepted,true);assert.equal(worker.terminated,true);
  assert.equal((await bounded(pending,'cancel start',1000)).accepted,false);
});
