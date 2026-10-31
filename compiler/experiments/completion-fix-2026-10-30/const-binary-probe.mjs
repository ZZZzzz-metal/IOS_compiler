import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inspectWasm } from '../../src/wasm-inspect.mjs';
import { ToolFileSystem } from '../../src/wasm-host.mjs';
import { completionPosition } from '../../src/completion-source.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const b = new Uint8Array(await readFile(new URL('resources/vendor/wasm-clang/clang', root)));
const out = new URL(`evidence/completion-fix-2026-10-30/const-binary-${new Date().toISOString().replace(/[:.]/gu, '-')}/`, root);
await mkdir(out,{recursive:true});
const sections=inspectWasm(b).sections,sec=id=>sections.find(x=>x.id===id),d=new TextDecoder();
const u=p=>{let n=0,s=0,x;do{x=b[p.i++];n+=(x&127)*2**s;s+=7;}while(x&128);return n;};
const s=p=>{let n=0,k=0,x;do{x=b[p.i++];n+=(x&127)*2**k;k+=7;}while(x&128);return k<53&&(x&64)?n-2**k:n;};
const str=p=>{const n=u(p),v=d.decode(b.subarray(p.i,p.i+n));p.i+=n;return v;};
const p={i:sec(2).payloadOffset},imports=[];
for(let n=u(p);n--;){const module=str(p),name=str(p),kind=b[p.i++];if(kind!==0)throw Error('import');imports.push({module,name,type:u(p)});}
const t={i:sec(1).payloadOffset},types=[];
for(let n=u(t);n--;){if(b[t.i++]!==96)throw Error('type');types.push({params:Array.from({length:u(t)},()=>b[t.i++]),results:Array.from({length:u(t)},()=>b[t.i++])});}
const f={i:sec(3).payloadOffset},functionTypes=Array.from({length:u(f)},()=>u(f));
const opNames={0:'unreachable',1:'nop',2:'block',3:'loop',4:'if',5:'else',11:'end',12:'br',13:'br_if',14:'br_table',15:'return',16:'call',17:'call_indirect',26:'drop',27:'select',32:'local.get',33:'local.set',34:'local.tee',35:'global.get',36:'global.set',40:'i32.load',41:'i64.load',42:'f32.load',43:'f64.load',44:'i32.load8_s',45:'i32.load8_u',46:'i32.load16_s',47:'i32.load16_u',54:'i32.store',55:'i64.store',58:'i32.store8',59:'i32.store16',65:'i32.const',66:'i64.const',69:'i32.eqz',70:'i32.eq',71:'i32.ne',72:'i32.lt_s',73:'i32.lt_u',74:'i32.gt_s',75:'i32.gt_u',76:'i32.le_s',77:'i32.le_u',78:'i32.ge_s',79:'i32.ge_u',106:'i32.add',107:'i32.sub',108:'i32.mul',113:'i32.and',114:'i32.or',115:'i32.xor',116:'i32.shl',117:'i32.shr_s',118:'i32.shr_u'};
const code={i:sec(10).payloadOffset},candidates=[],all=[];
for(let count=u(code),j=0;j<count;j++){
 const size=u(code),start=code.i,end=start+size,locals=[];
 for(let n=u(code);n--;)locals.push({count:u(code),type:b[code.i++]});
 const ins=[];
 while(code.i<end){const offset=code.i,op=b[code.i++],args=[];
  if(op===2||op===3||op===4)args.push(s(code));
  else if([12,13,16,32,33,34,35,36,63,64].includes(op))args.push(u(code));
  else if(op===14){for(let n=u(code);n>=0;n--)args.push(u(code));}
  else if(op===17)args.push(u(code),u(code));
  else if(op>=40&&op<=62)args.push(u(code),u(code));
  else if(op===65||op===66)args.push(s(code));
  else if(op===67)code.i+=4;else if(op===68)code.i+=8;
  else if(op===252){const sub=u(code);args.push(sub);if(sub>7)throw Error('extended '+sub);}
  else if(op>191)throw Error('opcode '+op);
  ins.push({offset,opcode:op,op:opNames[op]??`op${op}`,args});
 }
 const index=imports.length+j,type=types[functionTypes[j]],info={index,type,start,end,locals,calls:ins.filter(i=>i.opcode===16).map(i=>i.args[0]),constants:ins.filter(i=>i.opcode===65).map(i=>i.args[0])};
 if(process.argv.slice(2).map(Number).includes(index)||(type.params.length===5&&type.results.length===0&&info.constants.includes(75)&&info.constants.includes(56))) {
  candidates.push({...info,ins});
  await writeFile(new URL(`function-${index}.txt`,out),JSON.stringify(info)+'\n'+ins.map(i=>`${i.offset.toString(16)} ${i.op} ${i.args.join(' ')}`).join('\n')+'\n');
 }
 all.push(info);
}
await writeFile(new URL('report.json',out),JSON.stringify({candidates,all},null,2));
console.log(JSON.stringify({candidates:candidates.map(x=>({index:x.index,start:x.start,end:x.end,calls:x.calls})),out:out.href},null,2));
const encode=n=>{const a=[];do{let v=n&127;n=Math.floor(n/128);if(n)v|=128;a.push(v);}while(n);return new Uint8Array(a);};
// Experimental memory-only transform: unwrap FunctionTemplateDecl in the local
// Method variable before the existing CXXMethodDecl/instance/qualifier checks.
const insertion=0x11e7953,inserted=new Uint8Array([0x20,2,0x28,2,16,0x41,0xff,0,0x71,0x41,25,0x46,0x04,0x40,0x20,2,0x28,2,24,0x21,2,0x0b]);
if(Buffer.from(b.subarray(insertion,insertion+4)).toString('hex')!=='20022802')throw Error('insertion guard');
const target=all.find(x=>x.index===40648),oldBodySize=target.end-target.start,newBodySize=encode(oldBodySize+inserted.length),oldBodyHeader=encode(oldBodySize),codeSec=sec(10),oldCodeHeader=encode(codeSec.byteLength),newCodeHeader=encode(codeSec.byteLength+inserted.length);
if(newBodySize.length!==oldBodyHeader.length||newCodeHeader.length!==oldCodeHeader.length)throw Error('header width change');
const patched=new Uint8Array(b.length+inserted.length);patched.set(b.subarray(0,insertion));patched.set(inserted,insertion);patched.set(b.subarray(insertion),insertion+inserted.length);
patched.set(newBodySize,target.start-oldBodyHeader.length);patched.set(newCodeHeader,codeSec.payloadOffset-oldCodeHeader.length);
patched[0x1144a22+1]=1;patched[0x1144a22+2]=0x4d;
const clang=await WebAssembly.compile(patched),memfs=await WebAssembly.compile(await readFile(new URL('resources/vendor/wasm-clang/memfs',root))),tar=await readFile(new URL('resources/vendor/wasm-clang/sysroot.tar',root));
const observations=[];
for(const [id,marked] of [
 ['const-string','#include <string>\nvoid f(){const std::string s;s.ap@;}'],
 ['mutable-string','#include <string>\nvoid f(){std::string s;s.ap@;}'],
 ['const-box','struct N{template<class T>void mutate(T);template<class T>int view(T)const;static int factory();};void f(){const N n{};n.@;}'],
 ['mutable-box','struct N{template<class T>void mutate(T);template<class T>int view(T)const;static int factory();};void f(){N n{};n.@;}'],
 ['volatile-box','struct N{template<class T>void mutate(T);template<class T>int view(T)const;template<class T>int vol(T)volatile;};void f(){volatile N n{};n.@;}'],
 ['const-alias','#include <string>\nusing S=std::string;void f(){const S s;s.@;}'],
 ['const-return','#include <string>\nconst std::string& get();void f(){get().@;}'],
 ['availability','int personAllowed();__attribute__((unavailable)) int personBlocked();__attribute__((deprecated)) int personDeprecated();void f(){person@;}'],
]){
 const offset=marked.indexOf('@'),source=marked.replace('@',''),position=completionPosition(source,offset);
 const argv=['clang','-cc1','-fsyntax-only','-triple','wasm32-unknown-wasi','-disable-free','-isysroot','/','-internal-isystem','/include/c++/v1','-internal-isystem','/lib/clang/8.0.1/include','-internal-isystem','/include','-I','/project','-std=c++17','-x','c++',`-code-completion-at=/project/main.cpp:${position.line}:${position.byteColumn}`,'/project/main.cpp'];
 const fs=await ToolFileSystem.create(memfs);fs.loadTar(tar);fs.put('project/main.cpp',new TextEncoder().encode(source));
 const native=await fs.run(clang,argv);await writeFile(new URL(`${id}.json`,out),JSON.stringify({source,argv,...native},null,2));
 assert.equal(native.exitCode,0,id);
 const labels=native.stdout.split('\n').flatMap(line=>/^COMPLETION: (\w+) :/u.exec(line)?.[1]??[]);
 if(id==='const-string')assert.ok(!labels.includes('append'),id);
 if(id==='mutable-string')assert.equal(labels.filter(x=>x==='append').length,10,id);
 if(id==='const-box'){assert.ok(labels.includes('view')&&labels.includes('factory'),id);assert.ok(!labels.includes('mutate'),id);}
 if(id==='mutable-box')assert.ok(labels.includes('view')&&labels.includes('factory')&&labels.includes('mutate'),id);
 if(id==='volatile-box'){assert.ok(labels.includes('vol'),id);assert.ok(!labels.includes('view')&&!labels.includes('mutate'),id);}
 if(id==='const-alias'||id==='const-return'){assert.ok(labels.includes('find')&&labels.includes('compare'),id);for(const name of ['append','assign','replace','insert'])assert.ok(!labels.includes(name),`${id} ${name}`);}
 if(id==='availability'){assert.ok(labels.includes('personAllowed')&&labels.includes('personDeprecated'),id);assert.ok(!labels.includes('personBlocked'),id);assert.match(native.stdout,/personBlocked \(Inaccessible\)/u);}
 observations.push({id,passed:true,exitCode:native.exitCode,labels});console.log(id,'passed',labels.length);
}
await writeFile(new URL('patch.json',out),JSON.stringify({insertion,inserted:[...inserted],targetFunction:40648,oldBodySize,newBodySize:oldBodySize+inserted.length,oldCodeLength:codeSec.byteLength,newCodeLength:codeSec.byteLength+inserted.length,availabilityOffset:0x1144a22},null,2));
await writeFile(new URL('summary.json',out),JSON.stringify({observations,originalSha256:createHash('sha256').update(b).digest('hex'),patchedSha256:createHash('sha256').update(patched).digest('hex'),patchedBytes:patched.length,passed:observations.length},null,2));
