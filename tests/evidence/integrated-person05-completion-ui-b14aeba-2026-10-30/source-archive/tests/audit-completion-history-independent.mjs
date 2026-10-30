import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dest=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30');
const dir=resolve(dest,'history-verify');await mkdir(dir);
const names=[['integrated-person05-completion-preparation-38ff307-2026-10-29',66],
 ['integrated-person05-completion-preparation-38ff307-2026-10-29-run02',67],
 ['integrated-person05-completion-runtime-bddae576-2026-10-30',452],
 ['integrated-person05-completion-gitverify-2026-10-30',33],
 ['integrated-person05-final-v045-40a079b-2026-10-28',179]];
const results=[];
for(const [name,count] of names){
 const path=resolve(root,'tests/evidence',name,'SHA256SUMS.json'),before=await readFile(path);
 assert.equal(JSON.parse(before).length,count);
 const args=['tests/seal-integrated-round.mjs',name,'--verify','--git'];
 const run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 await writeFile(resolve(dir,name+'.stdout.txt'),run.stdout??'',{flag:'wx'});
 await writeFile(resolve(dir,name+'.stderr.txt'),run.stderr??'',{flag:'wx'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(await readFile(path),before);
 results.push({name,fileCount:count,command:[process.execPath,...args],exitCode:run.status,manifestSHA256:createHash('sha256').update(before).digest('hex'),rawFilesAndManifestEqualGit:true});
}
const result={target:'b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34',scope:'Five named old evidence rounds only. Every listed file SHA/size and raw committed blob, plus manifests, verified; no old file rewritten.',results,totalFiles:results.reduce((a,r)=>a+r.fileCount,0)};
await writeFile(resolve(dest,'historical-integrity.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({rounds:5,files:result.totalFiles,passed:true}));
