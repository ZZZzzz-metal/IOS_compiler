import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const expected='b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const git=spawnSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
assert.equal(git.status,0);assert.equal(git.stdout.trim(),expected);
const dest=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30/verification');
await mkdir(dest,{recursive:true});
const commands=[['check','scripts/check-baseline.mjs'],['contracts','--test','contracts/checks/*.test.mjs'],['ui-storage','--test','ui/checks/*.test.mjs','storage/checks/*.test.mjs'],['offline','--test','app/offline/checks/*.test.mjs']];
const results=[];
for(const [id,...args] of commands){
 const begin=new Date().toISOString();const run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000});
 await writeFile(resolve(dest,id+'.stdout.txt'),run.stdout??'',{flag:'wx'});await writeFile(resolve(dest,id+'.stderr.txt'),run.stderr??'',{flag:'wx'});
 const item={id,command:[process.execPath,...args],cwd:root,target:expected,begin,end:new Date().toISOString(),exitCode:run.status,signal:run.signal,error:run.error?.message??null};
 results.push(item);await writeFile(resolve(dest,id+'.json'),JSON.stringify(item,null,2)+'\n',{flag:'wx'});
 console.log(id,run.status);
}
await writeFile(resolve(dest,'commands.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
