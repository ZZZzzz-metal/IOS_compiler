import {WasmRuntime} from './wasm-runtime.mjs';
import {DwarfSymbols} from './dwarf.mjs';
import {VariableInspector} from './variables.mjs';
import {copy,verifyStart,virtualPath} from './integrity.mjs';

const keys=['sessionId','buildId','sourceHash','compatibilityId'];
const terminal=s=>s.state==='terminated'||s.state==='failed';
const encoder=new TextEncoder();
const uuid=()=>crypto.randomUUID();
const keyOf=s=>Object.fromEntries(keys.map(k=>[k,s.key[k]]));
const reject=(commandId,code,message)=>({commandId,accepted:false,code,message});
const errorReply=(q,code,message)=>({requestId:q?.requestId??'',kind:'error',key:q?.key??{},code,message});
const finiteInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const lineKey=p=>p?`${p.sourcePath}:${p.line}`:'';

// Both run and debug execute the same actual Wasm instructions. Chunks yield to
// the host event loop; the worker facade additionally provides hard termination.
export class DebuggerAdapter {
  constructor({profile,resources,readResource,sliceInstructions=5000,
    now=()=>performance.now(),schedule=callback=>setTimeout(callback,0)}={}) {
    if(typeof readResource!=='function'||!profile||!Array.isArray(resources)) throw new Error('Trusted profile, module resources and byte reader are required');
    this.profile=copy(profile);this.resources=copy(resources);this.readResource=readResource;
    this.sliceInstructions=Math.min(20000,Math.max(1,sliceInstructions|0));this.now=now;this.schedule=schedule;
    this.listeners=new Set();this.sessions=new Map();this.usedSessionIds=new Set();
    this.acks=new Map();this.pendingStarts=new Map();this.cancelStarts=new Map();this.pendingStops=new Set();
    this.queue=Promise.resolve();this.active=null;
  }
  subscribe(listener) {if(typeof listener!=='function') throw new Error('Listener must be a function');this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  _ordered(fn) {const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
  command(input) {
    let c;try{c=copy(input);}catch{return Promise.resolve(reject('', 'resource-error','Command is not serializable'));}
    if(!c||typeof c.commandId!=='string'||!c.commandId||c.commandId.length>256) return Promise.resolve(reject(c?.commandId??'','invalid-state','A bounded commandId is required'));
    const sid=c.kind==='start'?c.request?.sessionId:c.key?.sessionId;
    const cacheKey=JSON.stringify([sid,c.commandId]);
    if(this.acks.has(cacheKey)) return this.acks.get(cacheKey).then(copy);
    if(this.acks.size>=4096) return Promise.resolve(reject(c.commandId,'resource-error','Command replay capacity reached; create a new adapter'));
    if(c.kind==='start') {
      if(this.pendingStarts.has(sid))return Promise.resolve(reject(c.commandId,'invalid-state','Start already pending for this session'));
      this.pendingStarts.set(sid,c.request);
    }
    if(c.kind==='stop') {
      const session=this.sessions.get(sid);
      const pending=this.pendingStarts.get(sid);
      if(session?this._matches(session,c.key):pending&&keys.every(k=>pending[k]===c.key?.[k])) {
        this.pendingStops.add(sid);
        if(session) session.stopRequested=true;
        this.cancelStarts.get(sid)?.();
      }
    }
    const promise=this._ordered(async()=>{
      try{return await this._command(c);}
      catch(error){return reject(c.commandId,'resource-error',error.message);}
      finally{if(c.kind==='start')this.pendingStarts.delete(sid);}
    });
    this.acks.set(cacheKey,promise);return promise.then(copy);
  }
  _matches(s,key) {return !!key&&keys.every(k=>key[k]===s.key[k]);}
  _ack(s,id,extra={}) {return {commandId:id,accepted:true,key:keyOf(s),acceptedAtEventSeq:s.eventSeq,...extra};}
  _emit(s,event) {
    const message={...keyOf(s),eventSeq:++s.eventSeq,...event};
    if(event.kind==='output') {
      s.outputTail.push({eventSeq:message.eventSeq,stream:event.stream,text:event.text});
      s.tailBytes+=encoder.encode(event.text).byteLength;
      while(s.outputTail.length>256||s.tailBytes>65536) {
        const removed=s.outputTail.shift();s.tailBytes-=encoder.encode(removed.text).byteLength;s.outputTruncated=true;
      }
    }
    for(const listener of this.listeners){try{listener(copy(message));}catch{/* Observers cannot alter the executing session. */}}
  }
  _invalidate(s) {const old=s.pause?.pauseId;s.pause=undefined;s.frames.clear();s.references.clear();return old;}
  async _command(c) {
    if(c.kind==='start') return this._start(c);
    const s=this.sessions.get(c.key?.sessionId);
    if(!s||!this._matches(s,c.key))return reject(c.commandId,'stale-context','Session/build/source identity mismatch');
    if(c.kind==='stop') {
      if(!terminal(s)) {
        this._charge(s);this._invalidate(s);s.state='stopping';this._emit(s,{kind:'state',state:'stopping'});
        this._terminate(s,{reason:'stop',message:'Stopped by user'});
      }
      return this._ack(s,c.commandId);
    }
    if(c.kind==='setBreakpoints') {
      if(terminal(s)||s.request.mode!=='debug') return reject(c.commandId,'invalid-state','No active debug session');
      virtualPath(c.sourcePath);
      if(!Array.isArray(c.breakpoints)||c.breakpoints.some(b=>b.requested?.sourcePath!==c.sourcePath))return reject(c.commandId,'invalid-state','Breakpoint sourcePath mismatch');
      const next=this._bind(s,c.breakpoints);
      s.bindings=s.bindings.filter(b=>b.binding.requested.sourcePath!==c.sourcePath).concat(next);
      this._emit(s,{kind:'breakpoints',bindings:s.bindings.map(b=>b.binding)});
      return this._ack(s,c.commandId);
    }
    if(c.kind==='pause')return reject(c.commandId,'unsupported','Use source breakpoints or Stop; asynchronous Pause is not enabled');
    if(!['continue','stepInto','stepOver','stepOut'].includes(c.kind))return reject(c.commandId,'unsupported','Unknown debug command');
    if(s.state!=='paused'||!s.pause||c.key.pauseId!==s.pause.pauseId)return reject(c.commandId,'stale-context','Control requires the current pauseId');
    const frame=s.runtime.frames.at(-1);
    const previous=s.pause;const invalidatedPauseId=this._invalidate(s);
    s.control={kind:c.kind,frameId:frame.id,depth:s.runtime.frames.length,position:previous.position,
      pc:frame.pc,executed:false};
    s.skipOnce={frameId:frame.id,pc:frame.pc};
    s.state='running';s.runStart=this.now();this._emit(s,{kind:'state',state:'running'});
    const ack=this._ack(s,c.commandId,{invalidatedPauseId});this._schedule(s);return ack;
  }
  _validateConfig(r) {
    if(!r||typeof r.sessionId!=='string'||!r.sessionId||r.sessionId.length>256)throw new Error('A bounded sessionId is required');
    if(keys.some(k=>typeof r[k]!=='string'||!r[k]||r[k].length>256)||!/^sha256:[0-9a-f]{64}$/u.test(r.sourceHash))throw new Error('Complete bounded session/build/source/compatibility identity is required');
    if(r.stdin?.encoding!=='utf-8'||r.stdin.eof!==true||typeof r.stdin.text!=='string'||!r.stdin.text.isWellFormed()||encoder.encode(r.stdin.text).length>1024*1024)throw new Error('Complete UTF-8 stdin (up to 1 MiB) and EOF are required');
    if(!Array.isArray(r.initialBreakpoints)||r.initialBreakpoints.length>1000||typeof r.stopOnEntry!=='boolean')throw new Error('Initial breakpoint/entry configuration missing');
    const l=r.limits;
    if(!l||!Number.isFinite(l.runningTimeMs)||l.runningTimeMs<=0||l.runningTimeMs>3600000||
      !finiteInt(l.outputBytes,0,8*1024*1024)||!finiteInt(l.variablePageSize,1,1000)||
      l.memoryBytes!==undefined&&!finiteInt(l.memoryBytes,65536,268435456))throw new Error('Invalid execution/output/variable/memory limits');
    if(r.mode!=='debug'&&(r.stopOnEntry||r.initialBreakpoints.length))throw new Error('Run mode cannot use debug entry/breakpoints');
  }
  async _start(c) {
    const r=c.request;
    try{this._validateConfig(r);}catch(error){return reject(c.commandId,'invalid-state',error.message);}
    if(this.usedSessionIds.has(r.sessionId))return reject(c.commandId,'invalid-state','Session IDs cannot be reused; restart with a new sessionId');
    if(this.active&&!terminal(this.active))return reject(c.commandId,'invalid-state','Stop the active session before starting another');
    const s={key:Object.fromEntries(keys.map(k=>[k,r[k]])),request:r,state:'starting',eventSeq:0,
      outputTail:[],tailBytes:0,outputTruncated:false,outputBytes:0,bindings:[],frames:new Map(),references:new Map(),
      elapsed:0,runStart:null,scheduled:false,stopRequested:this.pendingStops.has(r.sessionId),
      decoders:{stdout:new TextDecoder(),stderr:new TextDecoder()},decoderTruncated:new Set(),pendingOutput:[],droppedBytes:0};
    this.usedSessionIds.add(r.sessionId);this.sessions.set(r.sessionId,s);this.active=s;
    if(this.sessions.size>32)for(const [id,old] of this.sessions){if(old!==s&&terminal(old)){this.sessions.delete(id);break;}}
    this._emit(s,{kind:'state',state:'starting'});
    let cancel;
    const cancelled=new Promise((_,rejectCancel)=>{cancel=()=>rejectCancel(new Error('start-cancelled'));});
    this.cancelStarts.set(r.sessionId,cancel);
    const check=()=>{if(s.stopRequested)throw new Error('start-cancelled');};
    try {
      check();
      const bytes=await Promise.race([verifyStart(r,this.profile,this.resources,this.readResource,check),cancelled]);
      check();
      s.runtime=new WasmRuntime(bytes,{stdin:r.stdin.text,memoryBytes:r.limits.memoryBytes??268435456,
        onOutput:(stream,data)=>this._output(s,stream,data)});
      if(r.mode==='debug'){s.symbols=new DwarfSymbols(bytes,r.snapshot);s.inspector=new VariableInspector(s.symbols,s.runtime);}
      s.bindings=this._bind(s,r.initialBreakpoints);
      this._emit(s,{kind:'breakpoints',bindings:s.bindings.map(b=>b.binding)});
      s.runtime.start();s.waitForEntry=r.stopOnEntry;
      s.control={kind:'continue',executed:false};
      // Initial bindings precede any running/paused event and user instruction.
      s.state='running';s.runStart=this.now();this._emit(s,{kind:'state',state:'running'});
      const ack=this._ack(s,c.commandId);this._schedule(s);return ack;
    } catch(error) {
      if(error.message==='start-cancelled')return reject(c.commandId,'invalid-state','Start cancelled by Stop');
      s.state='failed';s.failure={code:'start-error',message:error.message};this._invalidate(s);
      this._emit(s,{kind:'error',fatal:true,...s.failure});
      return reject(c.commandId,/profile|context|snapshot|checksum|resource|target|build|DWARF|feature/iu.test(error.message)?'incompatible-build':'resource-error',error.message);
    } finally {this.cancelStarts.delete(r.sessionId);}
  }
  _bind(s,requests) {
    if(requests.length>1000)throw new Error('Breakpoint count limit exceeded');
    const ids=new Set();
    return requests.map(b=>{
      if(typeof b.breakpointId!=='string'||!b.breakpointId||ids.has(b.breakpointId)||typeof b.enabled!=='boolean'||
        !finiteInt(b.requested?.line,1,10000000)||!finiteInt(b.requested?.column,1,10000000))throw new Error('Invalid breakpoint request');
      ids.add(b.breakpointId);virtualPath(b.requested.sourcePath);
      const result=b.enabled&&s.symbols?s.symbols.bindBreakpoint(b.requested):{actual:[],pcs:[],verified:false,reason:'Breakpoint disabled'};
      return {pcs:b.enabled?result.pcs:[],binding:{breakpointId:b.breakpointId,requested:copy(b.requested),
        status:result.verified?'bound':'invalid',actual:result.actual??[],...(result.verified?{}:{reason:result.reason??'No executable location'})}};
    });
  }
  _charge(s) {
    if(s.runStart!==null){s.elapsed+=Math.max(0,this.now()-s.runStart);s.runStart=null;}
  }
  _schedule(s) {
    if(s.scheduled||s.state!=='running'||s.stopRequested)return;
    s.scheduled=true;this.schedule(()=>{s.scheduled=false;this._tick(s);});
  }
  _position(s,frame) {return frame&&s.symbols?s.symbols.location(frame.pc):undefined;}
  _tick(s) {
    if(s!==this.active||s.state!=='running'||s.stopRequested)return;
    try{
      for(let i=0;i<this.sliceInstructions;i++) {
        if(s.stopRequested)break;
        if(s.elapsed+Math.max(0,this.now()-s.runStart)>=s.request.limits.runningTimeMs){this._terminate(s,{reason:'resource-limit',message:'Execution time budget exceeded'});return;}
        const frame=s.runtime.frames.at(-1),position=this._position(s,frame);
        if(position&&frame) {
          const signature=frame.id+':'+lineKey(position);
          const backward=s.previousPC!==undefined&&s.previousFrame===frame.id&&frame.pc<s.previousPC;
          const changed=signature!==s.previousLocation||backward;
          const skip=s.skipOnce&&s.skipOnce.frameId===frame.id&&s.skipOnce.pc===frame.pc;
          s.skipOnce=null;
          const breakpoint=!skip&&changed&&s.bindings.some(b=>b.pcs.includes(frame.pc));
          const control=s.control;
          const stepped=control?.executed&&control.kind!=='continue'&&(
            control.kind==='stepInto'&&(frame.id!==control.frameId||lineKey(position)!==lineKey(control.position)||backward)||
            control.kind==='stepOver'&&(s.runtime.frames.length<control.depth||frame.id===control.frameId&&(lineKey(position)!==lineKey(control.position)||backward))||
            control.kind==='stepOut'&&!s.runtime.frames.some(f=>f.id===control.frameId));
          if(s.waitForEntry||breakpoint||stepped) {
            const reason=s.waitForEntry?'entry':breakpoint?'breakpoint':'step';
            s.waitForEntry=false;this._pause(s,reason,position);return;
          }
          s.previousLocation=signature;s.previousPC=frame.pc;s.previousFrame=frame.id;
        } else {s.skipOnce=null;}
        s.runtime.step();if(s.control)s.control.executed=true;
        if(s.runtime.done){this._terminate(s,s.runtime.trap?{reason:'trap',message:s.runtime.trap.message}:{reason:'exit',exitCode:s.runtime.exitCode??0});return;}
      }
      this._flushOutput(s);this._schedule(s);
    }catch(error){this._terminate(s,{reason:'trap',message:error.message});}
  }
  _pause(s,reason,position) {
    this._charge(s);this._flushOutput(s);s.state='paused';this._invalidate(s);
    s.pause={pauseId:uuid(),reason,position:copy(position)};this._emit(s,{kind:'paused',...s.pause});
  }
  _output(s,stream,data) {
    if(terminal(s)||s.stopRequested)return;
    const room=Math.max(0,s.request.limits.outputBytes-s.outputBytes),take=Math.min(room,data.byteLength);
    s.outputBytes+=take;
    if(take){const text=s.decoders[stream].decode(data.subarray(0,take),{stream:true});if(text)s.pendingOutput.push({stream,text});}
    if(take<data.byteLength){s.outputTruncated=true;s.decoderTruncated.add(stream);s.droppedBytes+=data.byteLength-take;}
  }
  _flushOutput(s,final=false) {
    if(final)for(const stream of ['stdout','stderr']) {
      // A cap may cut a UTF-8 code point. Drop that incomplete suffix rather than
      // invent a replacement character for bytes deliberately not retained.
      if(!s.decoderTruncated.has(stream)){const text=s.decoders[stream].decode();if(text)s.pendingOutput.push({stream,text});}
    }
    let group;
    for(const part of s.pendingOutput) {
      if(group&&group.stream===part.stream)group.text+=part.text;
      else{if(group)this._emit(s,{kind:'output',...group});group={...part};}
    }
    if(group)this._emit(s,{kind:'output',...group});s.pendingOutput=[];
    if(s.droppedBytes){this._emit(s,{kind:'output-truncated',droppedBytes:s.droppedBytes});s.droppedBytes=0;}
  }
  _terminate(s,details) {
    if(terminal(s))return;
    this._charge(s);this._flushOutput(s,true);this._invalidate(s);s.state='terminated';s.termination=details;
    // No scheduled chunk can execute again; release the actual interpreter.
    s.runtime=null;s.inspector=null;this._emit(s,{kind:'terminated',...details});
  }
  query(input) {
    let q;try{q=copy(input);}catch{return Promise.resolve(errorReply(input,'invalid-query','Query is not serializable'));}
    return this._ordered(()=>{try{return this._query(q);}catch(error){return errorReply(q,'query-error',error.message);}}).then(copy);
  }
  _query(q) {
    const s=this.sessions.get(q.key?.sessionId);
    if(!s||!this._matches(s,q.key)||s.state!=='paused'||s.pause?.pauseId!==q.key.pauseId)return errorReply(q,'stale-context','Query requires the active pause');
    if(typeof q.requestId!=='string'||!q.requestId)return errorReply(q,'invalid-query','requestId is required');
    const page=(maximum=s.request.limits.variablePageSize)=>{if(!finiteInt(q.start,0,10000000)||!finiteInt(q.count,1,maximum))throw new Error('Invalid variable/stack page');};
    if(q.kind==='stack') {
      page(1000);const frames=[...s.runtime.frames].reverse();
      const visible=frames.map(frame=>{
        const frameId=s.pause.pauseId+':'+frame.id;s.frames.set(frameId,frame);
        const pc=frame===s.runtime.frames.at(-1)?frame.pc:frame.callPC??frame.lastPC??frame.pc;
        const position=s.symbols.location(pc);
        return {frameId,functionName:s.symbols.functionName(pc)??s.runtime.functions[frame.funcIndex]?.name??`wasm-function[${frame.funcIndex}]`,
          ...(position?{position}:{}),module:s.request.build.executable.id};
      });
      return {requestId:q.requestId,kind:'stack',key:copy(q.key),frames:visible.slice(q.start,q.start+q.count),total:visible.length};
    }
    const frame=s.frames.get(q.key.frameId);
    if(!frame)return errorReply(q,'stale-context','Unknown frameId; query the current stack first');
    const frameKey=q.key.frameId;
    if(q.kind==='scopes') {
      const reference=this._reference(s,frameKey,{scope:true,frame});
      return {requestId:q.requestId,kind:'scopes',key:copy(q.key),scopes:[{name:'Locals',variablesReference:reference,expensive:false}]};
    }
    if(q.kind==='variables') {
      page();const record=s.references.get(q.variablesReference);
      if(!record||record.frameKey!==frameKey)return errorReply(q,'stale-context','Variable reference belongs to another frame or pause');
      const all=record.value.scope?s.inspector.locals(frame):null;
      const descriptors=all?all.slice(q.start,q.start+q.count):s.inspector.children(record.value,q.start,q.count);
      const total=all?all.length:(record.value.namedVariables??0)+(record.value.indexedVariables??0);
      return {requestId:q.requestId,kind:'variables',key:copy(q.key),variables:descriptors.map(v=>this._variable(s,frameKey,v)),total,hasMore:q.start+descriptors.length<total};
    }
    if(q.kind==='evaluate') {
      if(q.allowSideEffects!==false||typeof q.expression!=='string'||q.expression.length>512)return errorReply(q,'unsupported','Bounded expressions with allowSideEffects=false are required');
      return {requestId:q.requestId,kind:'evaluate',key:copy(q.key),result:this._variable(s,frameKey,s.inspector.evaluate(frame,q.expression))};
    }
    return errorReply(q,'unsupported','Unknown query');
  }
  _reference(s,frameKey,value) {
    if(s.references.size>=4096)throw new Error('Paused variable reference limit exceeded');
    const reference=uuid();s.references.set(reference,{frameKey,value});return reference;
  }
  _variable(s,frameKey,v) {
    const out={name:v.name??'',type:v.type??'unknown',truncated:!!v.truncated,availability:v.state??'unavailable'};
    if(out.availability==='available')out.displayValue=String(v.value);else out.reason=v.reason??'Value is not available at this instruction';
    if(v.evaluateName)out.evaluateName=v.evaluateName;
    if(v.namedVariables!==undefined)out.namedCount=v.namedVariables;
    if(v.indexedVariables!==undefined)out.indexedCount=v.indexedVariables;
    if((v.namedVariables??0)+(v.indexedVariables??0)>0&&out.availability==='available')out.variablesReference=this._reference(s,frameKey,v);
    return out;
  }
  resync(input) {
    const r=copy(input);
    return this._ordered(()=>{
      const s=this.sessions.get(r.key?.sessionId);
      if(!s||!this._matches(s,r.key)||!r.requestId)throw new Error('Resync session identity mismatch');
      // Revoke handles while preserving the authoritative pause identity.
      s.frames.clear();s.references.clear();
      return {requestId:r.requestId,snapshot:{...keyOf(s),state:s.state,eventSeq:s.eventSeq,
        breakpoints:s.bindings.map(b=>copy(b.binding)),...(s.pause?{pause:copy(s.pause)}:{}),
        ...(s.termination?{termination:copy(s.termination)}:{}),...(s.failure?{failure:copy(s.failure)}:{}),
        outputTail:copy(s.outputTail),outputTruncated:s.outputTruncated}};
    });
  }
  // A host visibilitychange/pagehide handler calls this. No automatic fake resume.
  background() {
    const current=this.active;
    if(current&&!terminal(current)){current.stopRequested=true;this.cancelStarts.get(current.key.sessionId)?.();}
    return this._ordered(()=>{const s=this.active;if(s&&!terminal(s))this._terminate(s,{reason:'background',message:'Host entered background; restart with a new session'});});
  }
  dispose() {const s=this.active;if(s&&!terminal(s)){s.stopRequested=true;this.cancelStarts.get(s.key.sessionId)?.();this._terminate(s,{reason:'stop',message:'Adapter disposed'});}this.listeners.clear();}
}
