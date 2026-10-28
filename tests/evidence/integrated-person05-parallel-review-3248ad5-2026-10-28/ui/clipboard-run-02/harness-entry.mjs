// Correct-behavior clipboard assertions against a frozen actual main module.
// Usage: node tests/ui-parallel-audit.mjs NEW_RUN_NAME (refuses to overwrite).
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {host,root,revision,inputs,sha} from './lib/ui-parallel-audit-host.mjs';
const runName=process.argv[2];assert.match(runName??'',/^[a-z0-9-]+$/u);
const evidence=resolve(root,'tests/evidence/integrated-person05-parallel-review-3248ad5-2026-10-28/ui',runName);
await mkdir(resolve(evidence,'..'),{recursive:true});await mkdir(evidence,{recursive:false});
const cases=[];
const scenario=(id,title,group,action)=>cases.push({id,title,group,action});
function equal(checks,label,actual,expected){
  try{assert.deepEqual(actual,expected);checks.push({label,passed:true,actual,expected});}
  catch(error){if(error.code!=='ERR_ASSERTION')throw error;checks.push({label,passed:false,actual,expected,message:error.message});}
}
scenario('CLIP-EDIT','pending paste must preserve a later source edit','clipboard-generation',async(h,checks)=>{
  const pending=await h.paste();await h.edit('int latest_typed = 20;\n');await h.flush();const before=h.read();
  pending.request.resolve('int stale_clipboard = 10;\n');await pending.done;await h.flush();
  const after=h.read(),saved=h.records.get('main');
  equal(checks,'source edit happened before late result',before.userText,'int latest_typed = 20;\n');
  equal(checks,'late result preserves current source',after.userText,before.userText);
  equal(checks,'autosave preserves current source',saved.userText,before.userText);
  return {before,after,saved,writes:h.calls.saves};
});
scenario('CLIP-ORDER','older paste must not replace a newer completed paste','clipboard-generation',async(h,checks)=>{
  const older=await h.paste(),newer=await h.paste();
  newer.request.resolve('int newer_paste = 60;\n');await newer.done;await h.flush();const before=h.read();
  older.request.resolve('int older_paste = 50;\n');await older.done;await h.flush();
  const after=h.read(),saved=h.records.get('main');
  equal(checks,'newer paste completed first',before.userText,'int newer_paste = 60;\n');
  equal(checks,'older result preserves newer source',after.userText,before.userText);
  equal(checks,'autosave preserves newer source',saved.userText,before.userText);
  return {before,after,saved,writes:h.calls.saves};
});
scenario('CLIP-IMPORT-CONTROL','paste targeting an old draft object does not replace a later parsed import',null,async(h,checks)=>{
  const pending=await h.paste();await h.importText('int latest_import = 40;\n');await h.flush();const before=h.read();
  pending.request.resolve('int stale_clipboard = 30;\n');await pending.done;await h.flush();
  const after=h.read(),saved=h.records.get('main');
  equal(checks,'import replaced current text',before.userText,'int latest_import = 40;\n');
  equal(checks,'imported source is preserved',after.userText,before.userText);
  equal(checks,'saved imported source is preserved',saved.userText,before.userText);
  return {before,after,saved,writes:h.calls.saves};
});
scenario('CLIP-STALE-ERROR','a stale failed paste must not reopen fallback after newer paste completes','clipboard-generation',async(h,checks)=>{
  const older=await h.paste(),newer=await h.paste();
  newer.request.resolve('int newer_paste = 80;\n');await newer.done;await h.flush();const before=h.read();
  older.request.reject(Error('Clipboard permission denied for stale request'));await older.done;await h.flush();
  const after=h.read(),saved=h.records.get('main'),dialog={open:h.element('clipboard-dialog').open,title:h.element('clipboard-title').textContent,text:h.element('clipboard-text').value};
  equal(checks,'stale error preserves source',after.userText,before.userText);
  equal(checks,'stale error preserves saved source',saved.userText,before.userText);
  equal(checks,'stale request does not reopen manual fallback',dialog.open,false);
  return {before,after,saved,dialog,writes:h.calls.saves};
});
scenario('CLIP-NORMAL-CONTROL','an uncontested paste remains usable',null,async(h,checks)=>{
  const pending=await h.paste();pending.request.resolve('int accepted_paste = 90;\n');await pending.done;await h.flush();
  const after=h.read(),saved=h.records.get('main');
  equal(checks,'uncontested paste updates source',after.userText,'int accepted_paste = 90;\n');
  equal(checks,'uncontested paste is saved',saved.userText,after.userText);
  equal(checks,'success does not open manual fallback',h.element('clipboard-dialog').open,false);
  return {after,saved,writes:h.calls.saves};
});
const results=[];
for(const item of cases){let h;const checks=[];
  try{h=await host();const observations=await item.action(h,checks);const failed=checks.some(check=>!check.passed);results.push({id:item.id,title:item.title,group:item.group,status:failed?'failed':'passed',confirmedDefect:failed&&Boolean(item.group),checks,...observations});}
  catch(error){results.push({id:item.id,title:item.title,group:item.group,status:'harness-failure',checks,error:{name:error.name,code:error.code,message:error.message,stack:error.stack}});}
  finally{await h?.cleanup();}
}
const ownInputs=[];
for(const [path,archive] of [['tests/ui-parallel-audit.mjs','harness-entry.mjs'],['tests/lib/ui-parallel-audit-host.mjs','harness-host.mjs']]){
  const bytes=await readFile(resolve(root,path));ownInputs.push({path,byteLength:bytes.length,sha256:sha(bytes)});await writeFile(resolve(evidence,archive),bytes,{flag:'wx'});
}
const counts={cases:results.length,passed:results.filter(item=>item.status==='passed').length,failed:results.filter(item=>item.status==='failed').length,harnessFailures:results.filter(item=>item.status==='harness-failure').length,assertions:results.reduce((n,item)=>n+item.checks.length,0),failedAssertions:results.reduce((n,item)=>n+item.checks.filter(check=>!check.passed).length,0)};
const report={revision,date:new Date().toISOString(),kind:'Correct-behavior assertions; failures remain failures. Three failing scenarios share one clipboard-generation defect, not three independent defects.',boundary:'Complete actual frozen main module; real parser/autosave/editor/source. Controlled DOM/File/clipboard/network/trust/compiler/debugger/controller and recording memory store. No browser/IndexedDB/real compiler/iPad claim.',inputs:[...inputs,...ownInputs],counts,results};
await writeFile(resolve(evidence,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(evidence,'checks.tap'),`TAP version 13\n${results.map((item,index)=>`${item.status==='passed'?'ok':'not ok'} ${index+1} - ${item.id}: ${item.title}`).join('\n')}\n1..${results.length}\n`,{flag:'wx'});
console.log(JSON.stringify({revision,evidence,...counts}));
if(counts.harnessFailures)process.exitCode=2;else if(counts.failed)process.exitCode=1;
