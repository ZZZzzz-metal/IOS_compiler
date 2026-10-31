// Capture final mandatory checks without modifying any previous observations.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const repo=new URL('../',import.meta.url);
const round=new URL('tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/',repo);
const out=new URL('final/',round);await mkdir(out,{recursive:true});
const git=(...args)=>spawnSync('git',['-c',`safe.directory=${fileURLToPath(repo)}`,...args],{cwd:fileURLToPath(repo),encoding:'utf8'});
const head=git('rev-parse','HEAD');assert.equal(head.status,0);assert.equal(head.stdout.trim(),'912a23bf14cd6e48a0adb7ec119f4ce86bc58f93');
const results=[];
for(const [id,command] of [['check','npm.cmd run check'],['test','npm.cmd test']]){
 const startedAt=new Date().toISOString();
 const result=spawnSync('cmd.exe',['/d','/s','/c',command],{cwd:fileURLToPath(repo),encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
 const metadata={id,command,startedAt,endedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.message??null};
 await writeFile(new URL(id+'.stdout.txt',out),result.stdout??'',{flag:'wx'});
 await writeFile(new URL(id+'.stderr.txt',out),result.stderr??'',{flag:'wx'});
 await writeFile(new URL(id+'.command.json',out),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
 results.push(metadata);
}
const inputs=[];
for(const path of ['tests/audit-completion-v047-package.mjs','tests/lib/inspect-v047-zip.py','tests/completion-v047-browser-host.mjs','tests/run-completion-v047-checks.mjs','tests/verify-completion-v047-browser.mjs','tests/finalize-completion-v047-evidence.mjs']){
 const bytes=await readFile(new URL(path,repo));
 const target=new URL('inputs/'+path,out);await mkdir(new URL('./',target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
 inputs.push({path,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(new URL('summary.json',out),JSON.stringify({testedRevision:head.stdout.trim(),passed:results.every(r=>r.exitCode===0),commands:results,inputs,physicalIpadTested:false},null,2)+'\n',{flag:'wx'});
assert(results.every(r=>r.exitCode===0),'Final check/test failed; preserve raw results');
console.log('Final mandatory check/test passed; six executed/support scripts archived byte-for-byte.');
