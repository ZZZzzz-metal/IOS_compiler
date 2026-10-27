import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WasmRuntime } from '../src/wasm-runtime.mjs';

// These little bytecode modules are independent inputs to both engines. They
// exercise machine semantics, not invented source-level pause/output events.
const i32=0x7f, i64=0x7e, f32=0x7d, f64=0x7c;
function uint(value) {
  const result=[]; do { const byte=value%128; value=Math.floor(value/128); result.push(byte|(value?128:0)); } while(value); return result;
}
function signed(value) {
  value=BigInt(value); const result=[];
  for(;;) { const byte=Number(value&127n); value>>=7n; const done=(value===0n&&!(byte&64))||(value===-1n&&!!(byte&64)); result.push(byte|(done?0:128)); if(done)return result; }
}
const text=value=>{ const bytes=[...new TextEncoder().encode(value)]; return [...uint(bytes.length),...bytes]; };
const vector=items=>[...uint(items.length),...items.flat()];
const section=(id,payload)=>[id,...uint(payload.length),...payload];
const constant=value=>[0x41,...signed(value)];
const local=index=>[0x20,...uint(index)];
function moduleBytes({types=[{params:[],results:[]}],functions=[{type:0,body:[0x0b]}],memory,table,elements,data,globals,start,exports:explicitExports,imports=[]}={}) {
  const pieces=[[0,97,115,109,1,0,0,0],section(1,vector(types.map(type=>[0x60,...vector(type.params.map(t=>[t])),...vector(type.results.map(t=>[t]))])))];
  if(imports.length)pieces.push(section(2,vector(imports.map(item=>[...text(item.module??'wasi_snapshot_preview1'),...text(item.name),0,...uint(item.type)]))));
  pieces.push(section(3,vector(functions.map(fn=>uint(fn.type)))));
  if(table)pieces.push(section(4,[1,0x70,1,...uint(table.min),...uint(table.max??table.min)]));
  if(memory)pieces.push(section(5,[1,memory.max===undefined?0:1,...uint(memory.min),...(memory.max===undefined?[]:uint(memory.max))]));
  if(globals)pieces.push(section(6,vector(globals.map(g=>[g.type,g.mutable?1:0,...g.expr,0x0b]))));
  const exports=explicitExports??[{name:'run',kind:0,index:imports.length},...(memory?[{name:'memory',kind:2,index:0}]:[])];
  pieces.push(section(7,vector(exports.map(item=>[...text(item.name),item.kind,...uint(item.index)]))));
  if(start!==undefined)pieces.push(section(8,uint(start)));
  if(elements)pieces.push(section(9,vector(elements.map(item=>[0,...constant(item.offset??0),0x0b,...vector(item.functions.map(uint))]))));
  pieces.push(section(10,vector(functions.map(fn=>{ const body=[...vector((fn.locals??[]).map(type=>[1,type])),...fn.body]; return [...uint(body.length),...body]; }))));
  if(data)pieces.push(section(11,vector(data.map(item=>[0,...constant(item.offset),0x0b,...uint(item.bytes.length),...item.bytes]))));
  const result=new Uint8Array(pieces.flat()); assert.equal(WebAssembly.validate(result),true,'test bytecode must be natively valid'); return result;
}
function run(bytes,args=[],options={},budget=1000000) {
  const runtime=new WasmRuntime(bytes,options); runtime.start('run',args);
  while(!runtime.done&&runtime.instructionsExecuted<budget)runtime.step();
  assert.ok(runtime.done,`Instruction budget ${budget} exhausted`); return runtime;
}
async function nativeExport(bytes,args=[]) { const {instance}=await WebAssembly.instantiate(bytes); return instance.exports.run(...args); }

test('native validation rejects malformed binaries; unsupported imports fail explicitly',()=>{
  assert.throws(()=>new WasmRuntime(new Uint8Array([0,1,2])),/validation/);
  const bytes=moduleBytes({imports:[{module:'host',name:'magic',type:0}],exports:[{name:'run',kind:0,index:1}]});
  assert.throws(()=>new WasmRuntime(bytes),/Unsupported.*import module host/);
});

test('one step means one instruction and recursion retains distinct frame locals',async()=>{
  // factorial(n) = n == 0 ? 1 : n * factorial(n - 1)
  const bytes=moduleBytes({types:[{params:[i32],results:[i32]}],functions:[{type:0,body:[...local(0),0x45,0x04,i32,...constant(1),0x05,...local(0),...local(0),...constant(1),0x6b,0x10,0,0x6c,0x0b,0x0b]}]});
  const runtime=new WasmRuntime(bytes); runtime.start('run',[5]);
  assert.equal(runtime.instructionsExecuted,0); assert.equal(runtime.frames[0].locals[0],5);
  const initialPC=runtime.locationPC, first=runtime.step();
  assert.equal(first.pc,initialPC); assert.equal(first.opcode,0x20); assert.equal(runtime.instructionsExecuted,1);
  assert.deepEqual(runtime.frames[0].stack,[5]);
  let sawRecursion=false;
  while(!runtime.done) {
    if(runtime.frames.length===6) {
      sawRecursion=true;
      assert.deepEqual(runtime.frames.map(frame=>frame.locals[0]),[5,4,3,2,1,0]);
      assert.equal(new Set(runtime.frames.map(frame=>frame.id)).size,6);
      for(const frame of runtime.frames)assert.equal(frame.absolutePC,runtime.codeSectionOffset+frame.pc);
    }
    runtime.step();
  }
  assert.equal(sawRecursion,true); assert.equal(runtime.trap,null);
  assert.equal(runtime.returnValue,await nativeExport(bytes,[5])); assert.equal(runtime.returnValue,120);
  assert.throws(()=>runtime.start(),/cannot be restarted/);
});

test('br_if and br_table preserve label results and discard intermediate operands',async()=>{
  const conditional=moduleBytes({types:[{params:[i32],results:[i32]}],functions:[{type:0,body:[0x02,i32,...constant(7),...local(0),0x0d,0,0x1a,...constant(9),0x0b,0x0b]}]});
  const table=moduleBytes({types:[{params:[i32],results:[i32]}],functions:[{type:0,body:[0x02,i32,0x02,i32,0x02,i32,...constant(30),...local(0),0x0e,2,0,1,2,0x0b,...constant(10),0x6a,0x0b,...constant(20),0x6a,0x0b,0x0b]}]});
  for(const bytes of [conditional,table])for(const arg of [0,1,2,-1])assert.equal(run(bytes,[arg]).returnValue,await nativeExport(bytes,[arg]));
});

test('call_indirect resolves real table entries and checks null, bounds and signature',async()=>{
  const make=(mode)=>moduleBytes({
    types:[{params:[i32],results:[i32]},{params:[],results:[i32]}],table:{min:2},
    functions:[{type:0,body:[...local(0),...constant(mode==='bounds'?2:mode==='null'?1:0),0x11,0,0,0x0b]},
      mode==='type'?{type:1,body:[...constant(9),0x0b]}:{type:0,body:[...local(0),...constant(5),0x6a,0x0b]}],
    elements:[{functions:[1]}],
  });
  const normal=make('normal'); assert.equal(run(normal,[4]).returnValue,await nativeExport(normal,[4]));
  for(const [mode,code] of [['bounds','out-of-bounds-table-access'],['null','uninitialized-element'],['type','indirect-call-type-mismatch']]) {
    const bytes=make(mode),runtime=run(bytes,[4]);
    assert.equal(runtime.trap.code,code); assert.equal(runtime.exitCode,null);
    const {instance}=await WebAssembly.instantiate(bytes); assert.throws(()=>instance.exports.run(4),WebAssembly.RuntimeError);
  }
});

test('all MVP integer and floating point instructions agree with the native engine',async()=>{
  const nanBits=new DataView(new ArrayBuffer(8));nanBits.setBigUint64(0,0xfff8000000000000n,true);const negativeNaN=nanBits.getFloat64(0,true);
  const unaryCases=[
    [0x45,i32,i32,[0,1,-1]], [0x50,i64,i32,[0n,1n,-1n]],
    ...[0x67,0x68,0x69].map(op=>[op,i32,i32,[0,1,-1,0x80000000,0x70010000]]),
    ...[0x79,0x7a,0x7b].map(op=>[op,i64,i64,[0n,1n,-1n,0x8000000000000000n,0x7001000000000000n]]),
    ...Array.from({length:7},(_,i)=>[0x8b+i,f32,f32,[-0,0,-1.5,2.5,3.5,Infinity,NaN]]),
    ...Array.from({length:7},(_,i)=>[0x99+i,f64,f64,[-0,0,-1.5,2.5,3.5,Infinity,NaN]]),
    [0xa7,i64,i32,[0n,-1n,0x1234567887654321n]],
    ...[0xa8,0xa9].map(op=>[op,f32,i32,[0,-0.5,12345.75,-123.5,NaN,Infinity,2**32]]),
    ...[0xaa,0xab].map(op=>[op,f64,i32,[0,-0.5,12345.75,-123.5,NaN,Infinity,2**32,-(2**31)]]),
    [0xac,i32,i64,[-1,0,2147483647]], [0xad,i32,i64,[-1,0,2147483647]],
    ...[0xae,0xaf].map(op=>[op,f32,i64,[0,-0.5,10000,-123,Infinity,NaN,2**64]]),
    ...[0xb0,0xb1].map(op=>[op,f64,i64,[0,-0.5,10000,-123,2**63,-(2**63),2**64,NaN]]),
    [0xb2,i32,f32,[-1,2147483647]], [0xb3,i32,f32,[-1,2147483647]],
    ...[0xb4,0xb5].map(op=>[op,i64,f32,[-1n,0n,0x7fffffffffffffffn,(1n<<63n)-(1n<<38n)-1n]]),
    [0xb6,f64,f32,[0,-0,1e300,1/3,NaN]], [0xb7,i32,f64,[-1,0,2147483647]], [0xb8,i32,f64,[-1,0,2147483647]],
    ...[0xb9,0xba].map(op=>[op,i64,f64,[-1n,0n,0x7fffffffffffffffn]]), [0xbb,f32,f64,[0,-0,1/3,NaN]],
    [0xbc,f32,i32,[-0,1,NaN]], [0xbd,f64,i64,[-0,1,NaN]], [0xbe,i32,f32,[0,-2147483648,0x7f800000]], [0xbf,i64,f64,[0n,-(1n<<63n),0x7ff0000000000000n]],
    [0xc0,i32,i32,[128,255,65535]], [0xc1,i32,i32,[32768,65535]], [0xc2,i64,i64,[128n,255n]], [0xc3,i64,i64,[32768n,65535n]], [0xc4,i64,i64,[0xffffffffn]],
  ];
  const binaryCases=[
    ...Array.from({length:10},(_,i)=>[0x46+i,i32,i32,[[1,2],[-1,1],[0,0]]]),
    ...Array.from({length:10},(_,i)=>[0x51+i,i64,i32,[[1n,2n],[-1n,1n],[0n,0n]]]),
    ...Array.from({length:6},(_,i)=>[0x5b+i,f32,i32,[[1,2],[-0,0],[NaN,1]]]),
    ...Array.from({length:6},(_,i)=>[0x61+i,f64,i32,[[1,2],[-0,0],[NaN,1]]]),
    ...Array.from({length:15},(_,i)=>[0x6a+i,i32,i32,[[1,2],[-1,5],[-2147483648,-1],[123,0],[0x70000001,31],[0x70000001,32]]]),
    ...Array.from({length:15},(_,i)=>[0x7c+i,i64,i64,[[1n,2n],[-1n,5n],[-(1n<<63n),-1n],[123n,0n],[0x7000000000000001n,63n],[0x7000000000000001n,64n]]]),
    ...Array.from({length:7},(_,i)=>[0x92+i,f32,f32,[[1,3],[-0,0],[0,-0],[NaN,1],[1,negativeNaN],[Infinity,0]]]),
    ...Array.from({length:7},(_,i)=>[0xa0+i,f64,f64,[[1,3],[-0,0],[0,-0],[NaN,1],[1,negativeNaN],[Infinity,0]]]),
  ];
  for(const [op,input,output,cases] of [...unaryCases,...binaryCases]) {
    const arity=Array.isArray(cases[0])?2:1;
    const bytes=moduleBytes({types:[{params:Array(arity).fill(input),results:[output]}],functions:[{type:0,body:[...local(0),...(arity===2?local(1):[]),op,0x0b]}]});
    const {instance}=await WebAssembly.instantiate(bytes);
    for(const values of cases) {
      const args=arity===2?values:[values],runtime=run(bytes,args);
      let nativeValue,nativeError;
      try{nativeValue=instance.exports.run(...args);}catch(error){nativeError=error;}
      const label=`opcode 0x${op.toString(16)} args ${args.map(String).join(',')}`;
      if(nativeError) { assert.ok(nativeError instanceof WebAssembly.RuntimeError,label); assert.ok(runtime.trap,label); }
      else { assert.equal(runtime.trap,null,label); assert.equal(runtime.returnValue,nativeValue,label); }
    }
  }
});

test('memory loads, stores, growth, wrapping addresses and traps agree with native',async()=>{
  const cases=[
    [0x36,0x28,i32,-123456789,4], [0x37,0x29,i64,-0x123456789abcdefn,8], [0x38,0x2a,f32,1/3,4], [0x39,0x2b,f64,-Math.PI,8],
    [0x3a,0x2c,i32,255,1], [0x3a,0x2d,i32,255,1], [0x3b,0x2e,i32,65535,2], [0x3b,0x2f,i32,65535,2],
    [0x3c,0x30,i64,255n,1], [0x3c,0x31,i64,255n,1], [0x3d,0x32,i64,65535n,2], [0x3d,0x33,i64,65535n,2], [0x3e,0x34,i64,0xffffffffn,4], [0x3e,0x35,i64,0xffffffffn,4],
  ];
  for(const [store,load,type,value] of cases) {
    const bytes=moduleBytes({types:[{params:[type],results:[type]}],memory:{min:1,max:2},functions:[{type:0,body:[...constant(101),...local(0),store,0,0,...constant(101),load,0,0,0x0b]}]});
    const runtime=run(bytes,[value]),{instance}=await WebAssembly.instantiate(bytes);
    assert.equal(runtime.returnValue,instance.exports.run(value));
    assert.deepEqual(runtime.memory,new Uint8Array(instance.exports.memory.buffer));
  }
  const grow=moduleBytes({types:[{params:[i32],results:[i32]}],memory:{min:1,max:2},functions:[{type:0,body:[...local(0),0x40,0,0x0b]}]});
  assert.equal(run(grow,[1]).returnValue,1); assert.equal(run(grow,[1]).memory.length,131072);
  assert.equal(run(grow,[2]).returnValue,-1); assert.equal(run(grow,[1],{memoryBytes:65536}).returnValue,-1);
  for(const [address,offset] of [[65535,0],[-1,1]]) {
    const bytes=moduleBytes({types:[{params:[],results:[i32]}],memory:{min:1},functions:[{type:0,body:[...constant(address),0x28,0,...uint(offset),0x0b]}]});
    const runtime=run(bytes),{instance}=await WebAssembly.instantiate(bytes);
    assert.equal(runtime.trap.code,'out-of-bounds-memory-access'); assert.throws(()=>instance.exports.run(),WebAssembly.RuntimeError);
    assert.equal(runtime.frames.at(-1).pc,runtime.trap.pc,'faulting instruction stays inspectable');
  }
});

test('signaling and payload NaN bits survive reinterpretation, constants, memory and calls',async()=>{
  for(const [integer,float,toFloat,toInteger,abs,neg,store,load,patterns] of [
    [i32,f32,0xbe,0xbc,0x8b,0x8c,0x38,0x2a,[0x7f800001,0xff800001,0x7fc12345,0xffc12345]],
    [i64,f64,0xbf,0xbd,0x99,0x9a,0x39,0x2b,[0x7ff0000000000001n,0xfff0000000000001n,0x7ff8123456789abcn,0xfff8123456789abcn]],
  ])for(const bits of patterns) {
    const type={params:[integer],results:[integer]};
    for(const operation of [[],[abs],[neg]]) {
      const bytes=moduleBytes({types:[type],functions:[{type:0,body:[...local(0),toFloat,...operation,toInteger,0x0b]}]});
      assert.equal(run(bytes,[bits]).returnValue,await nativeExport(bytes,[bits]));
    }
    const called=moduleBytes({types:[type,{params:[float],results:[float]}],functions:[{type:0,body:[...local(0),toFloat,0x10,1,toInteger,0x0b]},{type:1,body:[...local(0),0x0b]}]});
    assert.equal(run(called,[bits]).returnValue,await nativeExport(called,[bits]));
    const stored=moduleBytes({types:[type],memory:{min:1},functions:[{type:0,body:[...constant(0),...local(0),toFloat,store,0,0,...constant(0),load,0,0,toInteger,0x0b]}]});
    assert.equal(run(stored,[bits]).returnValue,await nativeExport(stored,[bits]));
    const bitView=new DataView(new ArrayBuffer(integer===i32?4:8));
    if(integer===i32)bitView.setUint32(0,bits,true);else bitView.setBigUint64(0,bits,true);
    const fromConstant=moduleBytes({types:[{params:[],results:[integer]}],functions:[{type:0,body:[float===f32?0x43:0x44,...new Uint8Array(bitView.buffer),toInteger,0x0b]}]});
    assert.equal(run(fromConstant).returnValue,await nativeExport(fromConstant));
  }
});

test('module start, mutable globals, active data and loop budgets are actual execution',async()=>{
  const bytes=moduleBytes({types:[{params:[],results:[]},{params:[],results:[i32]}],start:0,memory:{min:1},globals:[{type:i32,mutable:true,expr:constant(3)}],data:[{offset:10,bytes:[42]}],exports:[{name:'run',kind:0,index:1}],functions:[
    {type:0,body:[...constant(7),0x24,0,0x0b]},
    {type:1,body:[0x23,0,...constant(10),0x2d,0,0,0x6a,0x0b]},
  ]});
  const runtime=new WasmRuntime(bytes); assert.equal(runtime.globals[0],3); runtime.start('run'); assert.equal(runtime.globals[0],3);
  while(!runtime.done)runtime.step(); assert.equal(runtime.returnValue,await nativeExport(bytes)); assert.equal(runtime.returnValue,49);
  const infinite=moduleBytes({functions:[{type:0,body:[0x03,0x40,0x0c,0,0x0b,0x0b]}]});
  const looping=new WasmRuntime(infinite); looping.start('run');
  for(let count=0;count<20000;count++)looping.step();
  assert.equal(looping.done,false); assert.equal(looping.instructionsExecuted,20000); assert.equal(looping.frames.length,1);
  assert.equal(looping.frames[0].controls.length,2,'branches reuse the loop label rather than leaking controls');
});

test('memory initialization evidence records real stores and child constructor writes',()=>{
  const bytes=moduleBytes({memory:{min:1},functions:[
    {type:0,body:[...constant(100),...constant(1),0x3a,0,0,0x10,1,0x0b]},
    {type:0,body:[...constant(101),...constant(2),0x3a,0,0,0x0b]},
  ]});
  const runtime=new WasmRuntime(bytes);runtime.start('run');const parent=runtime.frames[0];
  assert.equal(runtime.wasMemoryWritten(parent,100,2),false);
  while(!runtime.done)runtime.step();
  assert.deepEqual(parent.memoryWrites,[[100,102]]);
  assert.equal(runtime.wasMemoryWritten(parent,100,2),true);
  assert.equal(runtime.wasMemoryWritten(parent,102,1),false);
  parent.memoryWritesComplete=false;
  assert.equal(runtime.wasMemoryWritten(parent,102,1),null,'Missing evidence is unknown after bounded history overflow');
});

test('declaration epochs reject previous-iteration bytes even when no intermediate variables were queried',async()=>{
  const bytes=moduleBytes({types:[{params:[],results:[i32]},{params:[i32],results:[i32]}],memory:{min:1},functions:[
    {type:0,locals:[i32],body:[
      ...constant(0),0x21,0,...constant(104),...constant(0),0x36,0,0,
      0x02,0x40,0x03,0x40,0x01,...constant(100),...local(0),0x10,1,0x36,0,0,0x01,
      ...constant(104),...local(0),...constant(1),0x6a,0x22,0,0x36,0,0,
      ...local(0),...constant(3),0x48,0x0d,0,0x0b,0x0b,...constant(100),0x28,0,0,...constant(104),0x28,0,0,0x6a,0x0b,
    ]},
    {type:1,body:[...local(0),...constant(10),0x6a,0x0b]},
  ]});
  const runtime=new WasmRuntime(bytes),fn=runtime.functions[0];
  const [declaration,body]=[...fn.instructions.values()].filter(ins=>ins.op===0x01);
  const store=[...fn.instructions.values()].filter(ins=>ins.op===0x36)[1];
  runtime.registerDeclarationSites([{pc:fn.codeStart},{pc:declaration.pc}]);runtime.start('run');
  const parent=runtime.frames[0];let observedSeed=false,observedBeforeStore=false,observedBody=false;
  while(!runtime.done) {
    // Deliberately perform no provenance queries during iterations zero/one.
    if(parent.locals[0]===2) {
      const epoch=runtime.declarationEpoch(parent,declaration.pc);
      if(runtime.frames.length===2) {
        observedSeed=true;
        assert.equal(new DataView(runtime.memory.buffer).getInt32(100,true),11,'old guest bytes remain unchanged while seed runs');
        assert.equal(runtime.wasMemoryWritten(parent,100,4),true,'whole-activation coverage alone is insufficient');
        assert.equal(runtime.wasMemoryWrittenSince(parent,100,4,epoch),false);
        assert.equal(runtime.declarationEpoch(parent,fn.codeStart),1,'for-init site is not re-executed with its condition');
        assert.equal(runtime.wasMemoryWrittenSince(parent,104,4,1),true);
      }
      if(runtime.frames.length===1&&parent.pc===store.pc) {
        observedBeforeStore=true;assert.equal(runtime.wasMemoryWrittenSince(parent,100,4,epoch),false,'seed return does not replace the pending target store');
      }
      if(runtime.frames.length===1&&parent.pc===body.pc) {
        observedBody=true;assert.equal(runtime.wasMemoryWrittenSince(parent,100,4,epoch),true);assert.equal(new DataView(runtime.memory.buffer).getInt32(100,true),12);
      }
    }
    runtime.step();
  }
  assert.deepEqual([observedSeed,observedBeforeStore,observedBody],[true,true,true]);
  const {instance}=await WebAssembly.instantiate(bytes);assert.equal(runtime.returnValue,instance.exports.run());
  assert.deepEqual(runtime.memory,new Uint8Array(instance.exports.memory.buffer),'observation has no guest memory effects');
  assert.equal(runtime.declarationEpoch(parent,declaration.pc),null,'returned activations release observation state');
});

test('epoch coverage combines overlapping partial writes from real descendants and excludes older bytes',async()=>{
  const bytes=moduleBytes({memory:{min:1},functions:[
    {type:0,body:[0x01,...constant(200),0x42,...signed(-1),0x37,0,0,0x01,...constant(200),...constant(0x1234),0x3b,0,0,0x10,1,0x01,0x0b]},
    {type:0,body:[...constant(201),...constant(0x12345678),0x36,0,0,0x01,...constant(204),...constant(0x11223344),0x36,0,0,0x0b]},
  ]});
  const runtime=new WasmRuntime(bytes),markers=[...runtime.functions[0].instructions.values()].filter(ins=>ins.op===0x01);
  runtime.registerDeclarationSites([{pc:markers[1].pc}]);runtime.start('run');const parent=runtime.frames[0];
  let partial=false,complete=false;
  while(!runtime.done) {
    const top=runtime.frames.at(-1),ins=runtime.functions[top.funcIndex].instructions.get(top.pc);
    const epoch=runtime.declarationEpoch(parent,markers[1].pc);
    if(top!==parent&&ins.op===0x01) {
      partial=true;assert.equal(runtime.wasMemoryWrittenSince(parent,200,5,epoch),true);
      assert.equal(runtime.wasMemoryWrittenSince(parent,200,8,epoch),false,'the untouched suffix is old initialization');
      assert.equal(runtime.declarationEpoch(top,markers[1].pc),null,'unregistered callees need no activation metadata');
    }
    if(top===parent&&top.pc===markers[2].pc) {
      complete=true;assert.equal(runtime.wasMemoryWrittenSince(parent,200,8,epoch),true,'new writes of different widths/epochs cover every byte');
    }
    runtime.step();
  }
  assert.equal(partial,true);assert.equal(complete,true);
  const {instance}=await WebAssembly.instantiate(bytes);instance.exports.run();assert.deepEqual(runtime.memory,new Uint8Array(instance.exports.memory.buffer));
});

test('declaration observation is per recursive activation and expires when each real frame returns',async()=>{
  const bytes=moduleBytes({types:[{params:[i32,i32],results:[i32]}],memory:{min:1},functions:[{type:0,body:[
    0x01,...local(1),...local(0),0x36,0,0,...local(0),0x45,0x04,i32,...constant(1),0x05,
    ...local(0),...local(0),...constant(1),0x6b,...local(1),...constant(8),0x6a,0x10,0,0x6c,0x0b,0x0b,
  ]}]});
  const runtime=new WasmRuntime(bytes),site=runtime.functions[0].codeStart;
  const store=[...runtime.functions[0].instructions.values()].find(ins=>ins.op===0x36);
  runtime.registerDeclarationSites([{pc:site}]);runtime.start('run',[3,200]);
  while(!(runtime.frames.length===4&&runtime.frames.at(-1).pc===store.nextPC))runtime.step();
  const frames=[...runtime.frames],epochs=frames.map(frame=>runtime.declarationEpoch(frame,site));
  assert.equal(new Set(epochs).size,4);
  frames.forEach((frame,index)=>assert.equal(runtime.wasMemoryWrittenSince(frame,200+index*8,4,epochs[index]),true));
  const leaf=frames.at(-1);while(runtime.frames.includes(leaf))runtime.step();
  assert.equal(runtime.declarationEpoch(leaf,site),null);assert.equal(runtime.wasMemoryWrittenSince(leaf,224,4,epochs[3]),null);
  assert.equal(runtime.declarationEpoch(frames[0],site),epochs[0]);
  while(!runtime.done)runtime.step();
  const {instance}=await WebAssembly.instantiate(bytes);assert.equal(runtime.returnValue,instance.exports.run(3,200));assert.deepEqual(runtime.memory,new Uint8Array(instance.exports.memory.buffer));
  assert.ok(frames.every(frame=>runtime.declarationEpoch(frame,site)===null));
});

test('WASI writes performed by the declaration instruction count in that exact epoch',()=>{
  const bytes=moduleBytes({
    types:[{params:[i32,i32,i32,i32],results:[i32]},{params:[],results:[]}],imports:[{name:'fd_read',type:0}],memory:{min:1},
    data:[{offset:0,bytes:[200,0,0,0,2,0,0,0,202,0,0,0,2,0,0,0]}],
    functions:[{type:1,body:[...constant(0),...constant(0),...constant(2),...constant(16),0x10,0,0x1a,0x0b]}],
  });
  const runtime=new WasmRuntime(bytes,{stdin:'abcd'}),call=[...runtime.functions[1].instructions.values()].find(ins=>ins.op===0x10);
  runtime.registerDeclarationSites([{pc:call.pc}]);runtime.start('run');const frame=runtime.frames[0];
  while(frame.pc!==call.pc)runtime.step();
  assert.equal(runtime.declarationEpoch(frame,call.pc),0);runtime.step();
  const epoch=runtime.declarationEpoch(frame,call.pc);assert.equal(epoch,runtime.instructionsExecuted);
  assert.equal(runtime.wasMemoryWrittenSince(frame,200,4,epoch),true);assert.equal(runtime.wasMemoryWrittenSince(frame,16,4,epoch),true);
  assert.equal(new TextDecoder().decode(runtime.memory.subarray(200,204)),'abcd');
  while(!runtime.done)runtime.step();assert.equal(runtime.declarationEpoch(frame,call.pc),null);
});

test('bounded epoch history reports pruned coverage unknown while retaining newer writes',async()=>{
  const stores=Array.from({length:2200},(_,index)=>[...constant(index*2),...constant(127),0x3a,0,0]).flat();
  const bytes=moduleBytes({memory:{min:1},functions:[{type:0,body:[0x01,...stores,0x01,0x0b]}]});
  const runtime=new WasmRuntime(bytes),site=runtime.functions[0].codeStart;
  const stop=[...runtime.functions[0].instructions.values()].filter(ins=>ins.op===0x01)[1].pc;
  runtime.registerDeclarationSites([{pc:site}]);runtime.start('run');const frame=runtime.frames[0];
  while(frame.pc!==stop)runtime.step();const epoch=runtime.declarationEpoch(frame,site);
  assert.equal(runtime.wasMemoryWrittenSince(frame,0,1,epoch),null,'discarded observations must never become initialized proof');
  assert.equal(runtime.wasMemoryWrittenSince(frame,4398,1,epoch),true,'epoch history keeps recording after activation-wide coverage fills');
  assert.equal(runtime.wasMemoryWrittenSince(frame,50000,1,epoch),null,'incomplete history cannot prove absence');
  assert.ok(runtime._writeEpochs.get(frame).ranges.length<=2048,'metadata is bounded without an instruction trace');
  while(!runtime.done)runtime.step();
  const {instance}=await WebAssembly.instantiate(bytes);instance.exports.run();assert.deepEqual(runtime.memory,new Uint8Array(instance.exports.memory.buffer));
});

test('declaration registration is bounded, atomic, deduplicated and limited to actual instruction PCs',()=>{
  const bytes=moduleBytes({functions:[{type:0,body:[0x01,...constant(128),0x1a,0x0b]}]}),runtime=new WasmRuntime(bytes);
  const pc=runtime.functions[0].codeStart;
  assert.throws(()=>runtime.registerDeclarationSites([{pc},{pc:pc+2}]),/not an executable instruction/);
  assert.equal(runtime._declarationSiteCount,0,'failed registration cannot install a partial observation plan');
  assert.throws(()=>runtime.registerDeclarationSites(Array.from({length:16385},()=>({pc}))),/limit/);
  assert.deepEqual(runtime.registerDeclarationSites([{pc},{pc}]),{registered:[pc]});
  runtime.start('run');const frame=runtime.frames[0];assert.equal(runtime.declarationEpoch(frame,pc),0);
  assert.throws(()=>runtime.registerDeclarationSites([{pc}]),/before/);runtime.step();assert.equal(runtime.declarationEpoch(frame,pc),1);
});

test('WASI stdin/output, arguments and proc_exit execute at their real call instructions',()=>{
  const bytes=moduleBytes({
    types:[{params:[i32,i32,i32,i32],results:[i32]},{params:[i32],results:[]},{params:[],results:[]}],
    imports:[{name:'fd_read',type:0},{name:'fd_write',type:0},{name:'proc_exit',type:1}],
    functions:[{type:2,body:[...constant(0),...constant(0),...constant(1),...constant(8),0x10,0,0x1a,...constant(1),...constant(0),...constant(1),...constant(8),0x10,1,0x1a,...constant(17),0x10,2,0x00,0x0b]}],
    memory:{min:1},data:[{offset:0,bytes:[32,0,0,0,5,0,0,0]}],
  });
  const chunks=[],runtime=run(bytes,[],{stdin:'hello',onOutput:(stream,bytes)=>chunks.push({stream,bytes})});
  assert.equal(runtime.exitCode,17); assert.equal(runtime.trap,null); assert.equal(runtime.stdinOffset,5);
  assert.equal(chunks.length,1); assert.equal(chunks[0].stream,'stdout'); assert.equal(new TextDecoder().decode(chunks[0].bytes),'hello');
  const argumentBytes=moduleBytes({types:[{params:[i32,i32],results:[i32]},{params:[],results:[i32]}],imports:[{name:'args_sizes_get',type:0}],functions:[{type:1,body:[...constant(0),...constant(4),0x10,0,0x1a,...constant(0),0x28,0,0,0x0b]}],memory:{min:1}});
  assert.equal(run(argumentBytes,[],{args:['one','two']}).returnValue,2);
});

test('one WASI I/O instruction uses bounded iovecs, short writes and bounded chunks',()=>{
  const make=count=>moduleBytes({
    types:[{params:[i32,i32,i32,i32],results:[i32]},{params:[],results:[i32]}],imports:[{name:'fd_write',type:0}],
    memory:{min:17},data:[{offset:0,bytes:[64,0,0,0,20,0,16,0]}],
    functions:[{type:1,body:[...constant(1),...constant(0),...constant(count),...constant(8),0x10,0,...(count===1?[0x1a,...constant(8),0x28,0,0]:[]),0x0b]}],
  });
  const chunks=[],runtime=run(make(1),[],{onOutput:(_,bytes)=>chunks.push(bytes.length)});
  assert.equal(runtime.returnValue,1048576);assert.equal(chunks.reduce((sum,size)=>sum+size,0),1048576);assert.ok(chunks.every(size=>size<=65536));
  let called=false;const excessive=run(make(1025),[],{onOutput:()=>{called=true;}});
  assert.equal(excessive.returnValue,28);assert.equal(called,false);
});

// This native host is intentionally independent of the interpreter. It provides
// only the imports the pinned real C/STL programs actually request.
async function nativeWasi(bytes,stdin) {
  let memory,inputOffset=0,exitCode=0; const output={stdout:[],stderr:[]};
  const input=new TextEncoder().encode(stdin),arg=new TextEncoder().encode('program\0');
  const mem=()=>new Uint8Array(memory.buffer),view=()=>new DataView(memory.buffer);
  const wasi={
    fd_prestat_get:()=>8,fd_prestat_dir_name:()=>8,
    environ_sizes_get:(count,size)=>{view().setUint32(count,0,true);view().setUint32(size,0,true);return 0;},environ_get:()=>0,
    args_sizes_get:(count,size)=>{view().setUint32(count,1,true);view().setUint32(size,arg.length,true);return 0;},
    args_get:(pointers,buffer)=>{view().setUint32(pointers,buffer,true);mem().set(arg,buffer);return 0;},
    proc_exit:code=>{throw {nativeWasiExit:code};},
    fd_fdstat_get:(fd,ptr)=>{if(fd>2)return 8;mem().fill(0,ptr,ptr+24);mem()[ptr]=2;view().setBigUint64(ptr+8,fd===0?2n:64n,true);return 0;},
    fd_close:fd=>fd<=2?0:8,fd_seek:fd=>fd<=2?70:8,
    fd_write:(fd,iovs,count,written)=>{
      if(fd!==1&&fd!==2)return 8; let total=0;
      for(let i=0;i<count;i++){const pointer=view().getUint32(iovs+i*8,true),length=view().getUint32(iovs+i*8+4,true);output[fd===1?'stdout':'stderr'].push(mem().slice(pointer,pointer+length));total+=length;}
      view().setUint32(written,total,true);return 0;
    },
    fd_read:(fd,iovs,count,read)=>{
      if(fd!==0)return 8;let total=0;
      for(let i=0;i<count;i++){const pointer=view().getUint32(iovs+i*8,true),length=Math.min(view().getUint32(iovs+i*8+4,true),input.length-inputOffset);mem().set(input.subarray(inputOffset,inputOffset+length),pointer);inputOffset+=length;total+=length;}
      view().setUint32(read,total,true);return 0;
    },
  };
  const module=await WebAssembly.compile(bytes);
  for(const item of WebAssembly.Module.imports(module))assert.equal(typeof wasi[item.name],'function',`Independent native test host missing ${item.name}`);
  const instance=await WebAssembly.instantiate(module,{wasi_unstable:wasi,wasi_snapshot_preview1:wasi});memory=instance.exports.memory;
  try{instance.exports._start();}catch(error){if(error.nativeWasiExit!==undefined)exitCode=error.nativeWasiExit;else throw error;}
  return {exitCode,memory:mem(),stdout:Buffer.concat(output.stdout).toString('utf8'),stderr:Buffer.concat(output.stderr).toString('utf8')};
}

const compilerArtifacts=process.env.WASM_COMPILER_ARTIFACTS;
const bundledArtifacts=fileURLToPath(new URL('../fixtures/',import.meta.url));
for(const [sample,stdin,expected] of [
  ['debug-handoff','', ''],
  ['c-stdio','1 2 3 4\n','sum=10 first=1 int64=9223372036854775806\n'],
  ['stl','5 9 1 4 2 7\n','sum=23 min=1 max=9 pointer=5 map=key:2 hash=ok queue=9 heap=10\n中文😀 bytes=10 long=80 empty=0/0\ni64=9223372036854775806 u64=18446744073709551615 int=4 long=4 pointer=4\n'],
])test(`real compiler artifact ${sample}: exit, output and linear memory match native WebAssembly`,async t=>{
  const path=compilerArtifacts?resolve(compilerArtifacts,sample,'main.wasm'):
    resolve(bundledArtifacts,sample==='c-stdio'?'stdio':sample,'main.wasm');
  await access(path); // The committed real fixtures are required, never silently skipped.
  const bytes=await readFile(path),native=await nativeWasi(bytes,stdin),chunks={stdout:[],stderr:[]};
  const runtime=new WasmRuntime(bytes,{stdin,onOutput:(stream,bytes)=>chunks[stream].push(bytes)});runtime.start();
  let sawRecursion=false;
  while(!runtime.done&&runtime.instructionsExecuted<5000000) {
    const recursive=runtime.frames.filter(frame=>/^(sum|recursiveSum)\b|^_Z(?:3sum|12recursiveSum)/.test(frame.name));
    if(recursive.length>1) {sawRecursion=true;assert.equal(new Set(recursive.map(frame=>frame.id)).size,recursive.length);}
    runtime.step();
  }
  assert.equal(runtime.done,true,'Actual program must finish within instruction budget');assert.equal(runtime.trap,null);
  assert.equal(runtime.exitCode,native.exitCode);assert.equal(runtime.exitCode,0);
  assert.equal(Buffer.concat(chunks.stdout).toString('utf8'),native.stdout);assert.equal(native.stdout,expected);
  assert.equal(Buffer.concat(chunks.stderr).toString('utf8'),native.stderr);
  assert.deepEqual(runtime.memory,native.memory,'All final memory bytes match independent native execution');
  assert.equal(sawRecursion,true,'Observe actual recursive call frames');
  t.diagnostic(`${runtime.instructionsExecuted} real Wasm instructions; ${runtime.memory.length} final linear memory bytes`);
});
