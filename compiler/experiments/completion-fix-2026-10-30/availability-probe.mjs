import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ToolFileSystem } from '../../src/wasm-host.mjs';
import { completionPosition } from '../../src/completion-source.mjs';
const root = new URL('../../', import.meta.url);
const out = new URL(`evidence/completion-fix-2026-10-30/availability-${new Date().toISOString().replace(/[:.]/gu, '-')}/`, root);
await mkdir(out, { recursive: true });
const clang = await WebAssembly.compile(await readFile(new URL('resources/vendor/wasm-clang/clang', root)));
const memfs = await WebAssembly.compile(await readFile(new URL('resources/vendor/wasm-clang/memfs', root)));
const tar = await readFile(new URL('resources/vendor/wasm-clang/sysroot.tar', root));
const base = ['clang','-cc1','-triple','wasm32-unknown-wasi','-disable-free','-isysroot','/','-internal-isystem','/include/c++/v1','-internal-isystem','/lib/clang/8.0.1/include','-internal-isystem','/include','-I','/project','-ferror-limit','20','-fmessage-length','0','-std=c++17','-x','c++'];
const cases = [
 ['globals', '__attribute__((unavailable("blocked"))) int personBlocked(); __attribute__((deprecated)) int personDeprecated(); int personAllowed(); void f(){person@;}'],
 ['overloads', '__attribute__((unavailable("blocked"))) int personSame(int); int personSame(double); void f(){person@;}'],
 ['namespace', 'namespace blocked { __attribute__((unavailable("blocked"))) int personSame(); } namespace allowed { int personSame(); } void f(){allowed::person@;}'],
 ['members', 'struct N { __attribute__((unavailable("blocked"))) int personBlocked(); __attribute__((deprecated)) int personDeprecated(); int personAllowed(); }; void f(){N n;n.person@;}'],
 ['class', 'struct __attribute__((unavailable("blocked"))) PersonBad {}; struct PersonGood{}; void f(){Person@;}'],
 ['redecl', '__attribute__((unavailable("blocked"))) int personSame(); int personSame(); void f(){person@;}'],
 ['inherited', 'struct __attribute__((unavailable("blocked"))) Base {int personChild();}; struct Child:Base{}; void f(){Child c;c.person@;}'],
 ['using', 'namespace X {__attribute__((unavailable("blocked"))) int personSame();} using X::personSame; void f(){person@;}'],
 ['std', '#include <string>\n__attribute__((unavailable("blocked"))) int personBlocked(); void f(){person@;}'],
 ['member-overloads', 'struct N { __attribute__((unavailable("blocked"))) int personSame(int); int personSame(double); };void f(){N n;n.person@;}'],
 ['template', 'template<class T> __attribute__((unavailable("blocked"))) int personSame(T);void f(){person@;}'],
];
for (const [id,marked] of cases) for(const mode of ['inserted']) {
 const offset=marked.indexOf('@'),source=marked.replace('@','');
 const position=completionPosition(source,offset);
 const fs=await ToolFileSystem.create(memfs,{outputLimit:32*1024*1024}); fs.loadTar(tar);
 const replacement = id==='class' ? 'PersonBad' : ['namespace','overloads','redecl','using','member-overloads','template'].includes(id) ? 'personSame' : id==='inherited'?'personChild':'personBlocked';
 const finalSource=mode==='inserted' ? source.slice(0,offset).replace(/(?:person|Person)$/u,replacement)+source.slice(offset) : source;
 fs.put('project/main.cpp',new TextEncoder().encode(finalSource));
 const flags=mode==='inserted' ? [] : [`-code-completion-at=/project/main.cpp:${position.line}:${position.byteColumn}`];
 const argv=[...base,'-ast-dump',...(mode==='filtered'?['-ast-dump-filter','person']:[]),...flags,'/project/main.cpp'];
 const result=await fs.run(clang,argv);
 await writeFile(new URL(`${id}-${mode}.json`,out),JSON.stringify({source:finalSource,argv,...result},null,2));
 console.log(id,mode,'exit',result.exitCode,'length',result.stdout.length,'attrs',result.stdout.split('\n').filter(x=>/COMPLETION:|UnavailableAttr|DeprecatedAttr|Dumping|FunctionDecl.*person|CXXMethodDecl.*person/u.test(x)).join('\n').slice(0,4000),'stderr',result.stderr.slice(0,140));
}
console.log(out.href);
