import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { inspectWasm } from '../../src/wasm-inspect.mjs';
import { ToolFileSystem } from '../../src/wasm-host.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
const root = new URL('../../', import.meta.url);
if (process.argv.includes('--archive-reports')) {
 const evidence = new URL('evidence/completion-fix-2026-10-30/', root);
 const archived=[];
 const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const entry of await readdir(evidence,{withFileTypes:true})) {
  if(!entry.isDirectory()||!/^binary-2026-[0-9TZ-]+$/u.test(entry.name))continue;
  const directory=new URL(`${entry.name}/`,evidence),rawPath=new URL('report.json',directory);
  let raw;
  try { raw=await readFile(rawPath); } catch(error) { if(error.code==='ENOENT')continue;throw error; }
  if(raw.length<1024*1024)continue;
  const gzip=gzipSync(raw,{level:9});
  assert.deepEqual(gunzipSync(gzip),raw,'gzip in-memory roundtrip is lossless');
  await writeFile(new URL('report.json.gz',directory),gzip,{flag:'wx'});
  const saved=await readFile(new URL('report.json.gz',directory));
  assert.deepEqual(gunzipSync(saved),raw,'persisted gzip roundtrip is lossless');
  const manifest={operation:'lossless archive of reconstructable full Wasm function-index report',originalFilename:'report.json',originalSha256:sha256(raw),originalByteLength:raw.length,archivedFilename:'report.json.gz',archivedSha256:sha256(saved),archivedByteLength:saved.length,exactByteRoundtripVerified:true,rawCasesAndFunctionDisassemblyChanged:false};
  await writeFile(new URL('report.archive.json',directory),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  if(!rawPath.href.startsWith(evidence.href)||rawPath.pathname.split('/').at(-1)!=='report.json')throw Error('archive path guard');
  await unlink(rawPath);
  archived.push({directory:entry.name,...manifest});
 }
 console.log(JSON.stringify(archived,null,2));
 process.exit(0);
}
const b = new Uint8Array(await readFile(new URL('resources/vendor/wasm-clang/clang', root)));
const out = new URL(`evidence/completion-fix-2026-10-30/binary-${new Date().toISOString().replace(/[:.]/gu, '-')}/`, root);
await mkdir(out, { recursive: true });
const d = new TextDecoder();
const sections=inspectWasm(b).sections;
console.log('sections',sections.map(x=>[x.id,x.byteLength]));
const u = p => {let n=0,s=0,x;do{x=b[p.i++];n+=(x&127)*2**s;s+=7;}while(x&128);return n;};
const s = p => {let n=0,shift=0,x;do{x=b[p.i++];n+=(x&127)*2**shift;shift+=7;}while(x&128);return shift<53&&(x&64)?n-2**shift:n;};
const str = p => {const n=u(p),v=d.decode(b.subarray(p.i,p.i+n));p.i+=n;return v;};
const sec = id=>sections.find(x=>x.id===id);
const p={i:sec(2).payloadOffset},imports=[];
for(let n=u(p);n--;){const module=str(p),name=str(p),kind=b[p.i++];if(kind!==0)throw Error('unexpected import');imports.push({module,name,type:u(p)});}
const t={i:sec(1).payloadOffset},types=[];
for(let n=u(t);n--;){if(b[t.i++]!==96)throw Error('type');const params=Array.from({length:u(t)},()=>b[t.i++]),results=Array.from({length:u(t)},()=>b[t.i++]);types.push({params,results});}
const f={i:sec(3).payloadOffset},functionTypes=Array.from({length:u(f)},()=>u(f));
const data={i:sec(11).payloadOffset},segments=[];
for(let n=u(data);n--;){const mem=u(data);if(b[data.i++]!==65)throw Error('data offset expr');const address=s(data);if(b[data.i++]!==11)throw Error('data offset end');const length=u(data),start=data.i;segments.push({mem,address,start,length});data.i+=length;}
const needles=['COMPLETION: ','Inaccessible','(Hidden)','OVERLOAD: ','(InBase)','CodeCompleteConsumer','AddResult','SemaCodeComplete.cpp'];
console.log('data segments',segments.length);
const strings=[];
for(const needle of needles){const x=new TextEncoder().encode(needle);for(const segment of segments){const view=Buffer.from(b.buffer,segment.start,segment.length);let start=0;while((start=view.indexOf(x,start))>=0){strings.push({needle,address:segment.address+start,fileOffset:segment.start+start});start+=x.length;}}}
const opNames={0:'unreachable',1:'nop',2:'block',3:'loop',4:'if',5:'else',11:'end',12:'br',13:'br_if',14:'br_table',15:'return',16:'call',17:'call_indirect',26:'drop',27:'select',32:'local.get',33:'local.set',34:'local.tee',35:'global.get',36:'global.set',40:'i32.load',41:'i64.load',42:'f32.load',43:'f64.load',44:'i32.load8_s',45:'i32.load8_u',46:'i32.load16_s',47:'i32.load16_u',48:'i64.load8_s',49:'i64.load8_u',50:'i64.load16_s',51:'i64.load16_u',52:'i64.load32_s',53:'i64.load32_u',54:'i32.store',55:'i64.store',56:'f32.store',57:'f64.store',58:'i32.store8',59:'i32.store16',60:'i64.store8',61:'i64.store16',62:'i64.store32',63:'memory.size',64:'memory.grow',65:'i32.const',66:'i64.const',67:'f32.const',68:'f64.const',69:'i32.eqz',70:'i32.eq',71:'i32.ne',72:'i32.lt_s',73:'i32.lt_u',74:'i32.gt_s',75:'i32.gt_u',76:'i32.le_s',77:'i32.le_u',78:'i32.ge_s',79:'i32.ge_u',103:'i32.clz',104:'i32.ctz',105:'i32.popcnt',106:'i32.add',107:'i32.sub',108:'i32.mul',109:'i32.div_s',110:'i32.div_u',111:'i32.rem_s',112:'i32.rem_u',113:'i32.and',114:'i32.or',115:'i32.xor',116:'i32.shl',117:'i32.shr_s',118:'i32.shr_u',119:'i32.rotl',120:'i32.rotr'};
const code={i:sec(10).payloadOffset},functions=[],targets=[];
for(let count=u(code),j=0;j<count;j++){
 const size=u(code),start=code.i,end=start+size,locals=[];
 for(let n=u(code);n--;){locals.push({count:u(code),type:b[code.i++]});}
 const ins=[];
 while(code.i<end){const offset=code.i,op=b[code.i++],args=[];
 if(op===2||op===3||op===4)args.push(s(code));
 else if([12,13,16,32,33,34,35,36,63,64].includes(op))args.push(u(code));
 else if(op===14){for(let n=u(code);n>=0;n--)args.push(u(code));}
 else if(op===17)args.push(u(code),u(code));
 else if(op>=40&&op<=62)args.push(u(code),u(code));
 else if(op===65||op===66)args.push(s(code));
 else if(op===67){args.push(new DataView(b.buffer).getFloat32(code.i,true));code.i+=4;}
 else if(op===68){args.push(new DataView(b.buffer).getFloat64(code.i,true));code.i+=8;}
 else if(op===252){const sub=u(code);args.push(sub);if(sub>7)throw Error('extended '+sub);}
 else if(op>191)throw Error('opcode '+op+' at '+offset);
 ins.push({offset,op:opNames[op]??`op${op}`,args});
 }
 const info={index:imports.length+j,type:types[functionTypes[j]],start,end,locals};
 if(ins.some(i=>i.op==='i32.const'&&strings.some(x=>x.needle==='COMPLETION: '&&x.address===i.args[0]))||process.argv.slice(2).map(Number).includes(info.index)) { info.ins=ins; targets.push(info); }
 functions.push(info);
}
const report={sections,imports,strings,targets,nearbyFunctions:targets};
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));
await writeFile(new URL('function-index.json.gz',out),gzipSync(JSON.stringify(functions)));
for(const f of report.nearbyFunctions)await writeFile(new URL(`function-${f.index}.txt`,out),JSON.stringify({index:f.index,type:f.type,locals:f.locals})+'\n'+f.ins.map(i=>`${i.offset.toString(16)} ${i.op} ${i.args.join(' ')}`).join('\n')+'\n');
console.log(JSON.stringify({sections,strings,targetFunctions:targets.map(x=>({index:x.index,start:x.start,end:x.end})),out:out.href},null,2));
// Experimental in-memory transform only; no vendor bytes or lock are changed.
const patchOffset=0x1144a22;
if(Buffer.from(b.subarray(patchOffset,patchOffset+3)).toString('hex')!=='410347')throw Error('patch pattern mismatch');
let patched=b.slice();patched[patchOffset+1]=1;patched[patchOffset+2]=0x4d;
const insertion=0x11e7953,inserted=Uint8Array.from(Buffer.from('200228021041ff00714119460440200228021821020b','hex'));
const encode=n=>{const bytes=[];do{let v=n&127;n=Math.floor(n/128);if(n)v|=128;bytes.push(v);}while(n);return Uint8Array.from(bytes);};
const target=functions.find(x=>x.index===40648),oldBodySize=target.end-target.start,bodyHeader=encode(oldBodySize),codeHeader=encode(sec(10).byteLength);
assert.equal(oldBodySize,1400);assert.equal(Buffer.from(b.subarray(insertion,insertion+4)).toString('hex'),'20022802');
const combined=new Uint8Array(patched.length+inserted.length);combined.set(patched.subarray(0,insertion));combined.set(inserted,insertion);combined.set(patched.subarray(insertion),insertion+inserted.length);
combined.set(encode(oldBodySize+inserted.length),target.start-bodyHeader.length);combined.set(encode(sec(10).byteLength+inserted.length),sec(10).payloadOffset-codeHeader.length);patched=combined;
await writeFile(new URL('patch.json',out),JSON.stringify({scope:'in-memory experiment; original vendor and lock unchanged',inputSha256:createHash('sha256').update(b).digest('hex'),outputSha256:createHash('sha256').update(patched).digest('hex'),inputByteLength:b.length,outputByteLength:patched.length,availability:{patchOffset,original:'410347',replacement:'41014d',meaning:'Availability > Deprecated receives existing Inaccessible marker; ordinary and deprecated remain selectable.'},constTemplate:{insertion,inserted:Buffer.from(inserted).toString('hex'),targetFunction:40648,oldBodySize,newBodySize:oldBodySize+inserted.length}},null,2));
const clang=await WebAssembly.compile(patched);
const memfs=await WebAssembly.compile(await readFile(new URL('resources/vendor/wasm-clang/memfs',root)));
const sysroot=await readFile(new URL('resources/vendor/wasm-clang/sysroot.tar',root));
const observed=[];
for(const [id,marked] of [
 ['availability','int personAllowed();\n__attribute__((unavailable("person05-unavailable"))) int personBlocked();\n__attribute__((deprecated)) int personDeprecated();\nvoid f(){person@;}'],
 ['const-user','struct Box{int value;template<class T>void mutate(T);template<class T>int view(T)const;};void f(){const Box b{};b.@;}'],
 ['mutable-user','struct Box{int value;template<class T>void mutate(T);template<class T>int view(T)const;};void f(){Box b{};b.@;}'],
 ['const-string','#include <string>\nvoid f(){const std::string s;s.ap@;}'],
 ['mutable-string','#include <string>\nvoid f(){std::string s;s.ap@;}'],
 ['mixed-overloads','__attribute__((unavailable)) int alpha(int);double alpha(double);__attribute__((deprecated)) float alpha(float);void f(){al@;}'],
 ['member-availability','struct N{int alphaAllowed();__attribute__((unavailable)) int alphaBlocked();__attribute__((deprecated)) int alphaOld();};void f(){N n;n.al@;}'],
 ['static-member-availability','struct N{static int alphaAllowed();__attribute__((unavailable)) static int alphaBlocked();__attribute__((deprecated)) static int alphaOld();};void f(){N::al@;}'],
 ['template-member-availability','struct N{template<class T>int alphaAllowed(T);template<class T>__attribute__((unavailable)) int alphaBlocked(T);template<class T>__attribute__((deprecated)) int alphaOld(T);};void f(){N n;n.al@;}'],
 ['template-global-availability','template<class T>int alphaAllowed(T);template<class T>__attribute__((unavailable)) int alphaBlocked(T);template<class T>__attribute__((deprecated)) int alphaOld(T);void f(){al@;}'],
 ['namespace-alias-availability','namespace detail {int alphaAllowed();__attribute__((unavailable)) int alphaBlocked();__attribute__((deprecated)) int alphaOld();} namespace alias=detail;void f(){alias::al@;}'],
 ['using-availability','namespace detail {int alphaAllowed();__attribute__((unavailable)) int alphaBlocked();__attribute__((deprecated)) int alphaOld();} using detail::alphaAllowed;using detail::alphaBlocked;using detail::alphaOld;void f(){al@;}'],
 ['inherited-availability','struct B{int alphaAllowed();__attribute__((unavailable)) int alphaBlocked();__attribute__((deprecated)) int alphaOld();};struct N:B{};void f(){N n;n.al@;}'],
 ['field-availability','struct N{int alphaAllowed;__attribute__((unavailable)) int alphaBlocked;__attribute__((deprecated)) int alphaOld;};void f(){N n;n.al@;}'],
 ['enum-availability','enum N{alphaAllowed,alphaBlocked __attribute__((unavailable)),alphaOld __attribute__((deprecated))};void f(){al@;}'],
 ['redecl-earlier','__attribute__((unavailable)) int alphaBlocked();int alphaBlocked();__attribute__((deprecated)) int alphaOld();int alphaOld();int alphaAllowed();void f(){al@;}'],
 ['redecl-later','int alphaBlocked();__attribute__((unavailable)) int alphaBlocked();int alphaOld();__attribute__((deprecated)) int alphaOld();int alphaAllowed();void f(){al@;}'],
 ['platform-unrelated','__attribute__((availability(macos,unavailable))) int alphaPlatform();__attribute__((unavailable)) int alphaBlocked();__attribute__((deprecated)) int alphaOld();int alphaAllowed();void f(){al@;}'],
 ['declaration-alias','struct __attribute__((unavailable)) AlphaBlocked{};struct __attribute__((deprecated)) AlphaOld{};struct AlphaAllowed{};void f(){Al@;}'],
]){
 const at=marked.indexOf('@'),source=marked.replace('@',''),line=source.slice(0,at).split('\n').length,column=at-source.lastIndexOf('\n',at-1);
 const argv=['clang','-cc1','-fsyntax-only','-triple','wasm32-unknown-wasi','-disable-free','-isysroot','/','-internal-isystem','/include/c++/v1','-internal-isystem','/lib/clang/8.0.1/include','-internal-isystem','/include','-I','/project','-std=c++17','-x','c++',`-code-completion-at=/project/main.cpp:${line}:${column}`,'/project/main.cpp'];
 const fs=await ToolFileSystem.create(memfs);fs.loadTar(sysroot);fs.put('project/main.cpp',new TextEncoder().encode(source));
 const native=await fs.run(clang,argv);await writeFile(new URL(`${id}.json`,out),JSON.stringify({source,argv,...native},null,2));console.log(id,native.exitCode,native.stdout);
 observed.push(id);
 if(!['const-user','mutable-user','const-string','mutable-string','mixed-overloads'].includes(id)) {
  const lines=native.stdout.split('\n').filter(x=>x.startsWith('COMPLETION: '));
  const blocked=lines.filter(x=>/Blocked/u.test(x)),ordinary=lines.filter(x=>/Allowed/u.test(x)),deprecated=lines.filter(x=>/Old|Deprecated/u.test(x));
  assert.ok(blocked.length>0,id+' has native unavailable candidate');
  assert.ok(blocked.every(x=>/\([^)]*\bInaccessible\b[^)]*\)/u.test(x)),id+' unavailable metadata is marked');
  assert.ok(ordinary.length>0&&ordinary.every(x=>!x.includes('Inaccessible')),id+' ordinary survives');
  assert.ok(deprecated.length>0&&deprecated.every(x=>!x.includes('Inaccessible')),id+' deprecated survives');
 }
 if(id==='mixed-overloads') {
  assert.match(native.stdout,/COMPLETION: alpha \(Inaccessible\) : \[#int#\]alpha/u);
  assert.match(native.stdout,/COMPLETION: alpha : \[#double#\]alpha/u);
  assert.match(native.stdout,/COMPLETION: alpha : \[#float#\]alpha/u);
 }
 if(id==='platform-unrelated')assert.match(native.stdout,/COMPLETION: alphaPlatform :/u);
 if(id==='const-user'){assert.ok(!native.stdout.includes('COMPLETION: mutate'));assert.match(native.stdout,/COMPLETION: view :/u);}
 if(id==='mutable-user'){assert.match(native.stdout,/COMPLETION: mutate :/u);assert.match(native.stdout,/COMPLETION: view :/u);}
 if(id==='const-string')assert.ok(!native.stdout.includes('COMPLETION: append'));
 if(id==='mutable-string')assert.match(native.stdout,/COMPLETION: append :/u);
}
await writeFile(new URL('summary.json',out),JSON.stringify({observed,availabilityChecked:observed.filter(id=>!['const-user','mutable-user','const-string','mutable-string'].includes(id)),availabilityChecksPassed:true,constTemplateIssueFixed:true,note:'Combined experimental memory-only transform. All 19 cases assert real native eligibility or availability markers. Production integration and independent verification still pending.'},null,2));
