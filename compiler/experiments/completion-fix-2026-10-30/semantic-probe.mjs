import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {ToolFileSystem} from '../../src/wasm-host.mjs';
const root=new URL('../../',import.meta.url);
const out=new URL(`evidence/completion-fix-2026-10-30/semantic-${new Date().toISOString().replace(/[:.]/gu,'-')}/`,root);
await mkdir(out,{recursive:true});
const [clang,memfs]=await Promise.all(['clang','memfs'].map(async n=>WebAssembly.compile(await readFile(new URL(`resources/vendor/wasm-clang/${n}`,root)))));
const tar=await readFile(new URL('resources/vendor/wasm-clang/sysroot.tar',root));
const base=['clang','-cc1','-triple','wasm32-unknown-wasi','-disable-free','-isysroot','/','-internal-isystem','/include/c++/v1','-internal-isystem','/lib/clang/8.0.1/include','-internal-isystem','/include','-I','/project','-ferror-limit','0','-fmessage-length','0','-std=c++17','-x','c++','-fno-color-diagnostics'];
const decl='struct N{template<class T>void mutate(T);template<class T>int view(T)const;template<class T>int both(T);template<class T>int both(T)const;};';
const cases=[
 ['pragma-free-unavailable','__attribute__((unavailable("no"))) int blocked();__attribute__((deprecated)) int old();void f(){\n#pragma clang __debug dump blocked\n#pragma clang __debug dump old\n}'],
 ['pragma-free-overloads','__attribute__((unavailable("no"))) int alpha(int);int alpha(double);void f(){\n#pragma clang __debug dump alpha\n}'],
 ['pragma-qualified','namespace N{__attribute__((unavailable("no"))) int alpha(int);int alpha(double);}void f(){\n#pragma clang __debug dump N::alpha\n}'],
 ['pragma-member','struct N{__attribute__((unavailable("no"))) int alpha(int);int alpha(double);};void f(){N n;\n#pragma clang __debug dump n.alpha\n#pragma clang __debug dump N::alpha\n}'],
 ['pragma-type','#include <string>\nvoid f(){const std::string s;\n#pragma clang __debug dump s\n}'],
 ['pragma-expr','#include <string>\nconst std::string& get();void f(){\n#pragma clang __debug dump (get())\n}'],
 ['decltype-probe','#include <string>\nusing A=const std::string;void f(){A s;using __cc_probe=decltype((s));}',['-ast-dump','-ast-dump-filter','__cc_probe']],
 ['decltype-pointer-probe','struct N{};void f(){const N* s;using __cc_probe=decltype((s));}',['-ast-dump','-ast-dump-filter','__cc_probe']],
 ['decltype-get-probe','#include <string>\nconst std::string& get();void f(){using __cc_probe=decltype((get()));}',['-ast-dump','-ast-dump-filter','__cc_probe']],
 ['ast-removed-string','#include <string>\nvoid f(){const std::string s;s;}',['-ast-dump','-ast-dump-filter','f']],
 ['ast-removed-get','#include <string>\nconst std::string& get();void f(){get();}',['-ast-dump','-ast-dump-filter','f']],
 ['ast-removed-nested','struct N{int x;};struct O{const N n;};void f(){O o{};o.n;}',['-ast-dump']],
 ['ast-removed-pointer','struct N{int x;};void f(){const N* n=nullptr;n;}',['-ast-dump']],
 ['ast-removed-binary','struct N{operator int()const;};int operator+(int,N);void f(){const N n{};int x=1+n;}',['-ast-dump']],
 ['ast-removed-call','struct N{};void f(){const N n{};n(1);}',['-ast-dump']],
 ['user-mut-call',`${decl}void f(){const N n{};n.mutate();}`],
 ['user-view-call',`${decl}void f(){const N n{};n.view();}`],
 ['user-both-call',`${decl}void f(){const N n{};n.both();}`],
 ['user-mut-ref',`${decl}void f(){const N n{};n.mutate;}`],
 ['user-view-ref',`${decl}void f(){const N n{};n.view;}`],
 ['string-append-call','#include <string>\nvoid f(){const std::string s;s.append();}'],
 ['string-append-ref','#include <string>\nvoid f(){const std::string s;s.append;}'],
 ['string-view-call','#include <string>\nvoid f(){const std::string s;s.substr();}'],
 ['string-mutable-call','#include <string>\nvoid f(){std::string s;s.append();}'],
 ['string-alias-call','#include <string>\nusing Alias=const std::string;void f(){Alias s;s.append();}'],
 ['string-expression-call','#include <string>\nconst std::string& get();void f(){get().append();}'],
 ['user-cv-volatile','struct N{template<class T>int mutate(T);template<class T>int view(T)volatile;};void f(){volatile N n{};n.mutate();}'],
 ['deleted-mut-call','struct N{template<class T>void mutate(T)=delete;};void f(){N n{};n.mutate();}'],
];
for(const [id,source,flags=[]]of cases){
 const fs=await ToolFileSystem.create(memfs,{outputLimit:32*1024*1024});fs.loadTar(tar);fs.put('project/main.cpp',new TextEncoder().encode(source));
 const argv=[...base,'-fsyntax-only',...flags,'/project/main.cpp'];
 const result=await fs.run(clang,argv);
 await writeFile(new URL(`${id}.json`,out),JSON.stringify({id,source,argv,...result},null,2));
 console.log(id,result.exitCode,result.stderr,flags.length?result.stdout.slice(-2400):'');
}
console.log(out.href);
