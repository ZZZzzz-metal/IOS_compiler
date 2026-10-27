import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createIntegrationCandidate} from '../../app/integration/candidate.mjs';
import {createNodeHost,bounded,breakpoint} from '../../app/integration/node-host.mjs';
import {CompilerAdapter} from '../../compiler/src/compiler-adapter.mjs';
import {createSnapshot} from '../../compiler/src/source.mjs';
import {WorkerDebuggerAdapter} from '../../debugger/src/worker-adapter.mjs';
import {SessionController} from '../src/session-controller.mjs';
const fresh=()=>crypto.randomUUID();
async function until(controller,predicate){
  return bounded((async()=>{
    for(;;){const view=controller.getView();if(predicate(view))return view;if(view.session?.state==='failed')throw Error(JSON.stringify(view));await new Promise(resolve=>setTimeout(resolve,5));}
  })(),'UI consumer real execution',20000);
}
test('UI consumer reads a fresh actual C++ build, bound breakpoint, all steps, caller, containers and output',{timeout:120000},async()=>{
  const candidate=await createIntegrationCandidate(),host=createNodeHost(candidate);
  const source=`#include <cstdio>
#include <vector>
#include <string>
int add(int left, int right) {
    int answer = left + right;
    return answer;
}
int main() {
    int n = 3;
    std::vector<int> values = {1, 2, 3};
    std::string label = "sum";
    int array[3] = {4, 5, 6};
    int total = add(n, values[0]);
    total += array[1];
    std::printf("%s=%d\\n", label.c_str(), total);
    return 0;
}
// fresh ${fresh()}
`;
  const compiled=await host.compile({text:source}),adapter=new WorkerDebuggerAdapter({profile:candidate.profile,resources:candidate.resources,baseURL:candidate.baseURL,
    createWorker:()=>new Worker(new URL('../../debugger/src/node-worker.mjs',import.meta.url),{execArgv:[]})});
  const controller=new SessionController({adapter});
  try{
    await adapter.registerResource(compiled.result.build.executable.relativePath,compiled.bytes);
    const request={sessionId:fresh(),buildId:compiled.result.build.buildId,sourceHash:compiled.snapshot.sourceHash,compatibilityId:candidate.profile.compatibilityId,
      build:compiled.result.build,snapshot:compiled.snapshot,mode:'debug',stdin:{text:'',encoding:'utf-8',eof:true},
      limits:{runningTimeMs:30000,outputBytes:65536,variablePageSize:32,memoryBytes:268435456},initialBreakpoints:[breakpoint(13,'main.cpp')],stopOnEntry:false};
    assert.equal((await controller.start(request)).accepted,true);
    let view=await until(controller,v=>v.actions.inspect&&v.variables.some(x=>x.name==='values'));
    assert.equal(view.session.reason,'breakpoint');assert.equal(view.breakpoints[0].status,'bound');assert.ok(view.breakpoints[0].actual.length);
    assert.equal((await controller.evaluate('values[0]')).result.displayValue,'1');
    assert.equal((await controller.evaluate('array[1]')).result.displayValue,'5');
    assert.match((await controller.evaluate('label')).result.displayValue,/sum/);
    let oldPause=view.session.pauseId;assert.equal((await controller.control('stepInto')).accepted,true);
    view=await until(controller,v=>v.actions.inspect&&v.session.pauseId!==oldPause&&v.frames.length>=2&&v.session.frameId);
    assert.match(view.frames[0].functionName,/^add/);
    await controller.selectFrame(view.frames[1].frameId);
    assert.equal((await controller.evaluate('n')).result.displayValue,'3');
    await controller.selectFrame(view.frames[0].frameId);
    oldPause=view.session.pauseId;assert.equal((await controller.control('stepOut')).accepted,true);
    view=await until(controller,v=>v.actions.inspect&&v.session.pauseId!==oldPause&&v.frames.length&&v.session.frameId);
    oldPause=view.session.pauseId;assert.equal((await controller.control('stepOver')).accepted,true);
    await until(controller,v=>v.actions.inspect&&v.session.pauseId!==oldPause&&v.session.frameId);
    assert.equal((await controller.evaluate('total')).result.displayValue,'4');
    assert.equal((await controller.control('continue')).accepted,true);
    view=await until(controller,v=>v.session.state==='terminated');
    assert.equal(view.session.termination.exitCode,0);assert.equal(view.outputTail.map(p=>p.text).join(''),'sum=9\n');
    assert.equal(view.actions.inspect,false);assert.deepEqual(view.variables,[]);
  }finally{controller.dispose();adapter.dispose();}
});
test('editable driver compiles real separate user.inc and driver.cpp and preserves driver edit identity',{timeout:120000},async()=>{
  const candidate=await createIntegrationCandidate(),artifacts=new Map();
  const compiler=new CompilerAdapter({profile:candidate.profile,lock:candidate.lock,
    createWorker:()=>new Worker(new URL('../../compiler/src/compiler-worker.mjs',import.meta.url),{execArgv:[]}),writeResource:async(path,bytes)=>artifacts.set(path,bytes)});
  const files=[{path:'user.inc',role:'user',text:'class Solution { public: int solve(int x) { return x * 2; } };\n'},
    {path:'driver.cpp',role:'driver',text:'#include <cstdio>\n#include "user.inc"\nint main() { Solution s; std::printf("%d\\n", s.solve(21)); return 0; }\n'}];
  const snapshot=createSnapshot(files,'driver.cpp');
  const request={requestId:fresh(),snapshot,compatibilityId:candidate.profile.compatibilityId,language:'cpp',standard:'c++17',mode:'debug',optimization:'O0'};
  const result=await compiler.compile(request);assert.equal(result.status,'succeeded',JSON.stringify(result));assert.ok(artifacts.has(result.build.executable.relativePath));
  async function runActual(compiled,source,expected){
    const adapter=new WorkerDebuggerAdapter({profile:candidate.profile,resources:candidate.resources,baseURL:candidate.baseURL,
      createWorker:()=>new Worker(new URL('../../debugger/src/node-worker.mjs',import.meta.url),{execArgv:[]})});
    const controller=new SessionController({adapter});
    try{
      await adapter.registerResource(compiled.build.executable.relativePath,artifacts.get(compiled.build.executable.relativePath));
      assert.equal((await controller.start({sessionId:fresh(),buildId:compiled.build.buildId,sourceHash:source.sourceHash,
        compatibilityId:candidate.profile.compatibilityId,build:compiled.build,snapshot:source,mode:'debug',
        stdin:{text:'',encoding:'utf-8',eof:true},initialBreakpoints:[],stopOnEntry:false,
        limits:{runningTimeMs:30000,outputBytes:65536,variablePageSize:32,memoryBytes:268435456}})).accepted,true);
      const view=await until(controller,v=>v.session?.state==='terminated');
      assert.equal(view.session.sourceHash,source.sourceHash);
      assert.equal(view.session.termination.reason,'exit');assert.equal(view.session.termination.exitCode,0);
      assert.equal(view.outputTail.map(part=>part.text).join(''),expected);
    }finally{controller.dispose();adapter.dispose();}
  }
  await runActual(result,snapshot,'42\n');
  const changed=createSnapshot(files.map(f=>f.role==='driver'?{...f,text:f.text.replace('21','22')}:f),'driver.cpp');
  assert.notEqual(changed.sourceHash,snapshot.sourceHash);
  const recompiled=await compiler.compile({...request,requestId:fresh(),snapshot:changed});
  assert.equal(recompiled.status,'succeeded',JSON.stringify(recompiled));
  assert.notEqual(recompiled.build.buildId,result.build.buildId);
  assert.notEqual(recompiled.build.executable.sha256,result.build.executable.sha256);
  await runActual(recompiled,changed,'44\n');
  const bad=createSnapshot(files.map(f=>f.role==='driver'?{...f,text:f.text.replace('return 0;','return missing;')}:f),'driver.cpp');
  const failure=await compiler.compile({...request,requestId:fresh(),snapshot:bad});assert.equal(failure.status,'failed');
  assert.ok(failure.diagnostics.some(d=>d.range?.start.sourcePath==='driver.cpp'),JSON.stringify(failure.diagnostics));
});
