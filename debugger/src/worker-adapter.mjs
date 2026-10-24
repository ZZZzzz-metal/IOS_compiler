import {copy,virtualPath} from './integrity.mjs';
const names=['sessionId','buildId','sourceHash','compatibilityId'];
const keyOf=s=>Object.fromEntries(names.map(k=>[k,s[k]]));
const matches=(a,b)=>!!a&&!!b&&names.every(k=>a[k]===b[k]);
export class WorkerDebuggerAdapter {
  constructor({profile,resources,baseURL,createWorker,sliceInstructions=5000,stopTimeoutMs=500}={}) {
    if(!profile||!resources||!baseURL)throw new Error('Worker needs trusted profile/resources and project baseURL');
    this.options={profile:copy(profile),resources:copy(resources),baseURL:String(baseURL),sliceInstructions};
    this.createWorker=createWorker??(()=>new Worker(new URL('./debugger-worker.mjs',import.meta.url),{type:'module'}));
    this.stopTimeoutMs=stopTimeoutMs;this.listeners=new Set();this.pending=new Map();this.acks=new Map();
    this.shadows=new Map();this.serial=0;this.worker=null;this.generation=0;
    this.memoryResources=new Map();
    this.usedSessionIds=new Set();
  }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  _publish(event) {
    let s=this.shadows.get(event.sessionId);
    if(!s){s={...keyOf(event),state:'created',eventSeq:0,breakpoints:[],outputTail:[],outputTruncated:false};this.shadows.set(event.sessionId,s);}
    if(!matches(s,event)||event.eventSeq<=s.eventSeq)return;
    if(event.eventSeq!==s.eventSeq+1){this._failWorker('Worker event sequence gap');return;}
    s.eventSeq=event.eventSeq;
    if(event.kind==='state'){s.state=event.state;delete s.pause;}
    if(event.kind==='paused'){s.state='paused';s.pause={pauseId:event.pauseId,reason:event.reason,...(event.position?{position:event.position}:{})};}
    if(event.kind==='breakpoints')s.breakpoints=copy(event.bindings);
    if(event.kind==='terminated'){s.state='terminated';delete s.pause;s.termination={reason:event.reason,...(event.exitCode===undefined?{}:{exitCode:event.exitCode}),...(event.message?{message:event.message}:{})};}
    if(event.kind==='error'&&event.fatal){s.state='failed';delete s.pause;s.failure={code:event.code,message:event.message};}
    if(event.kind==='output'){s.outputTail.push({eventSeq:event.eventSeq,stream:event.stream,text:event.text});while(s.outputTail.length>128||s.outputTail.reduce((sum,p)=>sum+new TextEncoder().encode(p.text).length,0)>65536){s.outputTail.shift();s.outputTruncated=true;}}
    if(event.kind==='output-truncated')s.outputTruncated=true;
    for(const listener of this.listeners){try{listener(copy(event));}catch{/* independent observer */}}
  }
  _ensure() {
    if(this.worker)return this.ready;
    const worker=this.createWorker(),generation=++this.generation;this.worker=worker;
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    const receive=data=>{
      if(generation!==this.generation)return;
      if(data.kind==='ready'){this.readyResolve();return;}
      if(data.kind==='init-error'){this.readyReject(new Error(data.message));this._failWorker(data.message);return;}
      if(data.kind==='event'){this._publish(data.event);return;}
      const pending=this.pending.get(data.id);if(!pending)return;this.pending.delete(data.id);
      if(data.kind==='rpc-error')pending.reject(new Error(data.message));else pending.resolve(data.result);
    };
    const failure=error=>{if(generation===this.generation)this._failWorker(error?.message??'Worker failed');};
    if(typeof worker.on==='function'){worker.on('message',receive);worker.on('error',failure);worker.on('exit',code=>{if(generation===this.generation)failure(new Error('Worker exited unexpectedly: '+code));});}
    else{worker.onmessage=event=>receive(event.data);worker.onerror=failure;worker.onmessageerror=failure;}
    worker.postMessage({kind:'init',...this.options,memoryResources:[...this.memoryResources].map(([path,bytes])=>({path,bytes}))});return this.ready;
  }
  async _rpc(method,input) {
    const ready=this._ensure(),worker=this.worker,generation=this.generation;
    await ready;
    if(worker!==this.worker||generation!==this.generation)throw new Error('Worker was replaced before RPC dispatch');
    const id=++this.serial;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{worker.postMessage({kind:'rpc',id,method,input:copy(input)});}catch(error){this.pending.delete(id);reject(error);}});
  }
  _failWorker(message,reason='trap') {
    const worker=this.worker;this.worker=null;++this.generation;worker?.terminate();
    this.readyReject?.(new Error(message));
    for(const pending of this.pending.values())pending.reject(new Error(message));this.pending.clear();
    for(const s of this.shadows.values())if(!['terminated','failed'].includes(s.state)) {
      if(s.state==='created')this._publish({...keyOf(s),eventSeq:s.eventSeq+1,kind:'state',state:'starting'});
      this._publish({...keyOf(s),eventSeq:s.eventSeq+1,kind:'terminated',reason,message});
    }
  }
  command(command) {
    const c=copy(command),sid=c.kind==='start'?c.request?.sessionId:c.key?.sessionId;
    const replay=JSON.stringify([sid,c.commandId]);if(this.acks.has(replay))return this.acks.get(replay).then(copy);
    if(this.acks.size>=4096)return Promise.resolve({commandId:c.commandId,accepted:false,code:'resource-error',message:'Replay capacity reached; create a new worker adapter'});
    if(c.kind==='start') {
      if(this.usedSessionIds.has(sid))return Promise.resolve({commandId:c.commandId,accepted:false,code:'invalid-state',message:'Worker sessionId cannot be reused'});
      if(!sid)return Promise.resolve({commandId:c.commandId,accepted:false,code:'invalid-state',message:'sessionId is required'});
      this.usedSessionIds.add(sid);
      this.shadows.set(sid,{...keyOf(c.request),state:'created',eventSeq:0,breakpoints:[],outputTail:[],outputTruncated:false});
    }
    const result=(async()=>{
      // After a watchdog kill the old terminal snapshot remains authoritative.
      const shadow=this.shadows.get(sid);
      if(c.kind==='stop'&&shadow&&matches(shadow,c.key)&&['terminated','failed'].includes(shadow.state))return {commandId:c.commandId,accepted:true,key:keyOf(shadow),acceptedAtEventSeq:shadow.eventSeq};
      let timer;
      const rpc=this._rpc('command',c).then(ack=>{
        if(c.kind==='start'&&!ack.accepted&&this.shadows.get(sid)?.eventSeq===0)this.shadows.delete(sid);
        return ack;
      }).catch(error=>({commandId:c.commandId,accepted:false,code:'resource-error',message:error.message}));
      if(c.kind!=='stop')return rpc;
      const watchdog=new Promise(resolve=>{timer=setTimeout(()=>{
        const current=this.shadows.get(sid);
        if(!current||!matches(current,c.key)){resolve({commandId:c.commandId,accepted:false,code:'stale-context',message:'Stop context mismatch'});return;}
        this._failWorker('Execution Worker was terminated by Stop watchdog','stop');
        resolve({commandId:c.commandId,accepted:true,key:keyOf(current),acceptedAtEventSeq:current.eventSeq});
      },this.stopTimeoutMs);});
      try{return await Promise.race([rpc,watchdog]);}finally{clearTimeout(timer);}
    })();
    this.acks.set(replay,result);return result.then(copy);
  }
  query(query){const s=this.shadows.get(query.key?.sessionId);if(s&&['terminated','failed'].includes(s.state))return Promise.resolve({requestId:query.requestId,kind:'error',key:copy(query.key),code:'stale-context',message:'Worker session has terminated'});return this._rpc('query',query);}
  resync(request) {
    const s=this.shadows.get(request.key?.sessionId);
    if(!this.worker&&matches(s,request.key))return Promise.resolve({requestId:request.requestId,snapshot:copy(s)});
    return this._rpc('resync',request);
  }
  async background(){
    if(!this.worker)return;
    let timer;
    try{await Promise.race([this._rpc('background',{}).catch(()=>{}),new Promise(resolve=>{timer=setTimeout(()=>{this._failWorker('Host entered background; execution Worker terminated','background');resolve();},this.stopTimeoutMs);})]);}
    finally{clearTimeout(timer);}
  }
  async registerResource(path,bytes) {
    virtualPath(path);
    if(!(bytes instanceof Uint8Array)||bytes.length>16*1024*1024||this.memoryResources.size>=8&&!this.memoryResources.has(path))throw new Error('In-memory build resource limit');
    this.memoryResources.set(path,bytes.slice());return this._rpc('putResource',{path,bytes});
  }
  dispose(){this._failWorker('Execution Worker disposed','stop');this.listeners.clear();}
}
