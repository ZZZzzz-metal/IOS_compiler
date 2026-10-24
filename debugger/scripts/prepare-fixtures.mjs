// Rebuild real debugger fixtures using role 2's pinned Wasm Clang/LLD.
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const compilerRoot=pathToFileURL(resolve(process.argv[2]??'../ipad-debugger-02')+'/');
const {createNodeProbe}=await import(new URL('compiler/src/node-probe.mjs',compilerRoot));
const {createSnapshot}=await import(new URL('compiler/src/source.mjs',compilerRoot));
const {evidenceJSON}=await import(new URL('compiler/src/toolchain-engine.mjs',compilerRoot));
const fixtureRoot=new URL('../fixtures/',import.meta.url);
await mkdir(fixtureRoot,{recursive:true});
for(const [name,sourceName] of [['debug-handoff','debug-handoff'],['stdio','c-stdio'],['stl','stl']]) {
  const directory=new URL(name+'/',fixtureRoot);await mkdir(directory,{recursive:true});
  for(const file of ['main.wasm','snapshot.json','evidence.json']) await copyFile(new URL(`artifacts/compiler-02/${sourceName}/${file}`,compilerRoot),new URL(file,directory));
}
const cases={
  infinite:{language:'c',text:'int main(void) {\n    volatile unsigned int n = 0;\n    while (1) { n++; }\n}\n'},
  trap:{language:'c',text:'#include <stdio.h>\nint main(void) {\n    fputs("before-trap\\n", stderr);\n    __builtin_trap();\n}\n'},
  'output-flood':{language:'c',text:'#include <stdio.h>\nint main(void) {\n    for (int i=0;i<2000;i++) puts("中文😀:abcdefghijklmnopqrstuvwxyz");\n    fputs("done\\n", stderr);\n    return 7;\n}\n'},
  containers:{language:'cpp',text:'#include <vector>\n#include <string>\nint main() {\n    std::vector<int> empty;\n    std::vector<int> values = {11, 22};\n    std::string blank;\n    std::string shortText = "中文😀";\n    std::string longText(80, \'z\');\n    long long big = 9223372036854775806LL;\n    int* invalid = nullptr;\n    values.push_back(33);\n    values[0] = 99;\n    return values[0] == 99 && values.size() == 3 ? 0 : 1;\n}\n'},
};
for(const [name,input] of Object.entries(cases)) {
  const path=input.language==='c'?'main.c':'main.cpp';
  const snapshot=createSnapshot([{path,role:'user',text:input.text}],path);
  const result=await createNodeProbe().compile({requestId:crypto.randomUUID(),snapshot,language:input.language,
    standard:input.language==='c'?'c11':'c++17',mode:'debug',optimization:'O0'});
  if(result.status!=='compiled') throw new Error(name+': '+result.rawDiagnostics);
  const directory=new URL(name+'/',fixtureRoot);await mkdir(directory,{recursive:true});
  await writeFile(new URL('main.wasm',directory),result.executable);
  await writeFile(new URL('snapshot.json',directory),JSON.stringify(snapshot,null,2)+'\n');
  await writeFile(new URL('evidence.json',directory),JSON.stringify(evidenceJSON(result),null,2)+'\n');
  console.log(`${name}: real Clang/LLD build ${result.executableRef.sha256}`);
}
