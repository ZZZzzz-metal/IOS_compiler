// Person 05: actual consumer input() with controlled provider and the three original fixtures.
// This proves suppression before provider invocation; it is not a browser/Worker/iPad test.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createCompletionController} from '../ui/src/completion-controller.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const target='b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const output=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30/controlled-negative');
await mkdir(output,{recursive:false});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFile(resolve(output,name),value,{flag:'wx'});
const saveJson=(name,value)=>save(name,JSON.stringify(value,null,2)+'\n');
const inputs=[];
async function fixed(path){
  const bytes=await readFile(resolve(root,path));
  const committed=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'show',`${target}:${path}`],{cwd:root});
  assert.equal(sha(bytes),sha(committed),'Fixed bytes '+path);
  inputs.push({path,byteLength:bytes.length,sha256:sha(bytes)});return bytes;
}
await fixed('ui/src/completion-controller.mjs');
const editor=(await fixed('ui/src/completion-editor.mjs')).toString('utf8');
assert.match(editor,/createCompletionController\(\{getContext:context,delayMs:300,/u,'Public editor config still uses 300ms automatic delay');
const delayMs=300,waitMs=450;
const fixtureDir='fixtures/completion-independent/',manifest=JSON.parse((await fixed(fixtureDir+'cases.json')).toString('utf8'));
assert.equal(manifest.marker,'/*<cc>*/');
const cases=['comment','string-literal','decimal'],actual=[];
let assertions=0;
for(const id of cases){
  const entry=manifest.cases.find(item=>item.id===id);assert(entry,'Original fixture '+id);assert.equal(entry.expect.trigger,'none');assert.equal(entry.files.length,1);
  const mapping=entry.files[0],raw=(await fixed(fixtureDir+mapping.file)).toString('utf8'),pieces=raw.split(manifest.marker);
  assert.equal(pieces.length,2,'Exactly one caret marker in '+id);assert.equal(mapping.path,entry.sourcePath);
  const source=pieces.join(''),offset=pieces[0].length;
  assert.equal(source[offset-1],'.','Original negative is after dot');
  const files=[{path:entry.sourcePath,role:'user',text:source}];
  const sourceHash='sha256:'+sha(Buffer.from(JSON.stringify({version:1,translationUnit:entry.translationUnit,files}),'utf8'));
  const snapshot={snapshotId:'person05-negative-'+id,sourceHash,translationUnit:entry.translationUnit,files};
  const context={enabled:true,focused:true,composing:false,documentVersion:1,text:source,offset,selectionEnd:offset,sourcePath:entry.sourcePath,language:'cpp',standard:'c++17',snapshot};
  const calls=[],states=[],controller=createCompletionController({getContext:()=>context,delayMs,complete:request=>{calls.push(request);throw Error('Negative fixture must not reach provider');},cancel:requestId=>{calls.push({unexpectedCancel:requestId});},onApply:()=>{throw Error('Negative fixture must not apply');},onChange:state=>states.push(structuredClone(state))});
  const started=performance.now();
  controller.input();
  await new Promise(resolve=>setTimeout(resolve,waitMs));
  const elapsedMs=performance.now()-started,state=structuredClone(controller.state);
  const checks={waitExceedsAutomaticDelay:elapsedMs>delayMs,providerCallsZero:calls.length===0,phaseIdle:state.phase==='idle',itemsEmpty:Array.isArray(state.items)&&state.items.length===0};
  assertions+=4;
  const row={id,target,fixturePath:fixtureDir+mapping.file,sourcePath:entry.sourcePath,marker:manifest.marker,offsetUtf16:offset,line:source.slice(0,offset).split('\n').length,columnUtf16:offset-(source.lastIndexOf('\n',offset-1)+1)+1,sourceHash,delayMs,requestedWaitMs:waitMs,elapsedMs,providerCallCount:calls.length,calls,actualState:state,states,checks,passed:Object.values(checks).every(Boolean)};
  await save(id+'.marked.cpp',raw);await save(id+'.source.cpp',source);await saveJson(id+'.actual.json',row);
  await controller.dispose();actual.push(row);
  if(!row.passed)process.exitCode=1;
  process.stdout.write((row.passed?'PASS ':'FAIL ')+id+': provider='+calls.length+', phase='+state.phase+', items='+state.items.length+'\n');
}
await save('runner.mjs',await readFile(fileURLToPath(import.meta.url)));
const summary={target,kind:'controlled-consumer-auto-trigger-negative',scope:'Actual fixed createCompletionController.input() with unchanged original three fixtures and controlled provider. No browser DOM, real Worker or physical IME/iPad claim. Complements separate real-browser no-popup observations.',delayMs,requestedWaitMs:waitMs,scenarioCount:actual.length,assertions,passed:actual.filter(item=>item.passed).length,failed:actual.filter(item=>!item.passed).length,inputs,results:actual.map(({id,providerCallCount,actualState,elapsedMs,checks,passed})=>({id,providerCallCount,actualState,elapsedMs,checks,passed}))};
await saveJson('results.json',summary);
await save('README.md','# Independent automatic-trigger negative consumer check\n\nCommand: `node tests/completion-ui-negative-independent.mjs`. Fixed source '+target+'. Output uses exclusive create and refuses overwrite.\n\nThe exact original comment/string-literal/decimal sources are loaded from the fixture manifest, their marker is removed and used as the UTF16 caret. The actual controller input() receives enabled/focused/non-composing context. After 450ms (public editor automatic delay 300ms), provider-call count, phase and items are recorded and checked. Each controller is disposed. This is a controlled consumer check, separate from the actual-browser no-popup observations and actual semantic provider evidence.\n');
process.stdout.write(JSON.stringify({scenarios:summary.scenarioCount,assertions,passed:summary.passed,failed:summary.failed,evidence:output})+'\n');
