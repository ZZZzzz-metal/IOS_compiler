import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ToolFileSystem } from '../../src/wasm-host.mjs';
const root = new URL('../../', import.meta.url);
const out = new URL(`evidence/completion-fix-2026-10-30/probe-${new Date().toISOString().replace(/[:.]/gu, '-')}/`, root);
await mkdir(out, { recursive: true });
const bytes = await readFile(new URL('resources/vendor/wasm-clang/clang', root));
const clang = await WebAssembly.compile(bytes);
const names = WebAssembly.Module.customSections(clang, 'name');
function leb(b, p) { let v=0,s=0,x; do {x=b[p.i++];v+=(x&127)*2**s;s+=7;}while(x&128);return v; }
const decoder=new TextDecoder();
const functions=[];
for(const raw of names) {
 const b=new Uint8Array(raw),p={i:0};
 while(p.i<b.length) {
  const id=b[p.i++],n=leb(b,p),end=p.i+n;
  if(id===1) { const count=leb(b,p);for(let i=0;i<count;i++){const index=leb(b,p),len=leb(b,p),name=decoder.decode(b.subarray(p.i,p.i+len));p.i+=len;if(/CodeComplete|AddResult|CursorKindAndAvailability/u.test(name))functions.push({index,name});} }
  p.i=end;
 }
}
await writeFile(new URL('names.json',out),JSON.stringify(functions,null,2));
console.log('name sections',names.length,'matching functions',functions.length,functions.slice(0,12));
const memfs=await WebAssembly.compile(await readFile(new URL('resources/vendor/wasm-clang/memfs', root)));
const tar=await readFile(new URL('resources/vendor/wasm-clang/sysroot.tar', root));
const base=['clang','-cc1','-triple','wasm32-unknown-wasi','-disable-free','-isysroot','/','-internal-isystem','/include/c++/v1','-internal-isystem','/lib/clang/8.0.1/include','-internal-isystem','/include','-I','/project','-ferror-limit','20','-fmessage-length','0','-std=c++17','-x','c++'];
for(const [id,source,flags] of [
 ['ast-json','struct N{template<class T>void mutate(T);template<class T>int view(T)const;};void f(){const N n{};n.mu;}', ['-ast-dump=json']],
 ['ast-text','__attribute__((unavailable)) int blocked();__attribute__((deprecated)) int old();struct N{template<class T>void mutate(T);template<class T>int view(T)const;};void f(){const N n{};n.mu;}', ['-ast-dump']],
 ['completion-ast','__attribute__((unavailable)) int blocked();__attribute__((deprecated)) int old();void f(){bl;}', ['-ast-dump','-code-completion-at=/project/main.cpp:1:90']],
 ['const-ast','#include <string>\nvoid f(){const std::string s;s.ap;}', ['-ast-dump','-ast-dump-filter','f']],
]) {
 const fs=await ToolFileSystem.create(memfs,{outputLimit:32*1024*1024});fs.loadTar(tar);fs.put('project/main.cpp',new TextEncoder().encode(source));
 const argv=[...base,...flags,'/project/main.cpp'];
 const result=await fs.run(clang,argv);
 await writeFile(new URL(`${id}.json`,out),JSON.stringify({source,argv,...result},null,2));
 console.log(id,result.exitCode,result.stdout.length,result.stdout.slice(-2200),result.stderr.slice(0,1000));
}
console.log(out.href);
