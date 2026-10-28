// Reproduces newly audited UI data races. Existing product/tests are untouched.
// Usage: node tests/ui-parallel-audit.mjs NEW_RUN_NAME
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {host,root,revision,inputs,sha,tick} from './lib/ui-parallel-audit-host.mjs';

const runName=process.argv[2];assert.match(runName??'',/^[a-z0-9-]+$/u);
const evidence=resolve(root,'tests/evidence/integrated-person05-parallel-review-3248ad5-2026-10-28/ui',runName);
await mkdir(resolve(evidence,'..'),{recursive:true});
await mkdir(evidence,{recursive:false});
const cases=[];
const scenario=(id,title,action)=>cases.push({id,title,action});
scenario('CLIP-EDIT','older clipboard read overwrites a later source edit and is saved',async h=>{
  const pending=await h.paste();await h.edit('int latest_typed = 20;\n');await h.flush();const before=h.read();
  pending.request.resolve('int stale_clipboard = 10;\n');await pending.done;await h.flush();
  const after=h.read(),saved=h.records.get('main');assert.equal(before.userText,'int latest_typed = 20;\n');
  assert.equal(after.userText,'int stale_clipboard = 10;\n','Confirms unguarded late clipboard commit');assert.equal(saved.userText,after.userText);
  return {confirmedDefect:true,before,after,saved,writes:h.calls.saves};
});
scenario('CLIP-IMPORT','older clipboard read overwrites a later actual parsed file import and is saved',async h=>{
  const pending=await h.paste();await h.importText('int latest_import = 40;\n');await h.flush();const before=h.read();
  pending.request.resolve('int stale_clipboard = 30;\n');await pending.done;await h.flush();
  const after=h.read(),saved=h.records.get('main');assert.equal(before.userText,'int latest_import = 40;\n');
  assert.equal(after.userText,'int stale_clipboard = 30;\n');assert.equal(saved.userText,after.userText);
  return {confirmedDefect:true,before,after,saved,writes:h.calls.saves};
});
const results=[];
for(const item of cases){let h;try{h=await host();results.push({id:item.id,title:item.title,status:'observed',...await item.action(h)});}catch(error){results.push({id:item.id,title:item.title,status:'harness-failure',error:{name:error.name,code:error.code,message:error.message,stack:error.stack}});}finally{await h?.cleanup();}}
const ownInputs=[];for(const path of ['tests/ui-parallel-audit.mjs','tests/lib/ui-parallel-audit-host.mjs']){const bytes=await readFile(resolve(root,path));ownInputs.push({path,byteLength:bytes.length,sha256:sha(bytes)});}
const report={revision,date:new Date().toISOString(),kind:'deterministic defect reproductions, not correct-behavior acceptance checks',boundary:'Complete actual main module with real parser/autosave/editor/source. Controlled DOM/File/clipboard/network/trust/compiler/debugger/controller and recording memory store. No browser/IndexedDB/real compiler/iPad claim.',inputs:[...inputs,...ownInputs],results};
await writeFile(resolve(evidence,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({revision,evidence,observed:results.filter(item=>item.status==='observed').length,failures:results.filter(item=>item.status==='harness-failure').length}));
if(results.some(item=>item.status==='harness-failure'))process.exitCode=2;
