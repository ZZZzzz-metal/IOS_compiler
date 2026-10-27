import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
const revision='66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9';
const base='9727c51915325732e8d1b365f5e9bf672c717aaf';
const git=(...args)=>execFileSync('git',args,{maxBuffer:16*1024*1024});
const blob=path=>git('show',revision+':'+path);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
git('merge-base','--is-ancestor',base,revision);
const changed=git('diff','--name-only',base,revision).toString().trim().split('\n');
assert(changed.every(path=>path.startsWith('ui/')||path.startsWith('storage/')||path==='docs/handoffs/04.md'));
const manifests=changed.filter(path=>path.endsWith('/SHA256SUMS.json'));
let checks=0;const files=new Set();
const summaries=[];
for(const path of manifests){
 const rows=JSON.parse(blob(path));let count=0;
 for(const [file,row] of Object.entries(rows)){
  const full=posix.join(posix.dirname(path),file),bytes=blob(full);
  const expected=typeof row==='string'?row:row.sha256;
  assert.equal(sha(bytes),expected,full);
  if(typeof row==='object')assert.equal(bytes.length,row.byteLength,full);
  files.add(full);count++;checks++;
 }
 summaries.push({manifest:path,records:count});
}
const input=JSON.parse(blob('ui/evidence/integrated-rev004005-2026-10-27/source-inputs.json'));
const sourceChecks=[];
for(const row of input.files){
 const actual=blob(row.path);assert.equal(actual.length,row.staged.byteLength,row.path);
 assert.equal(sha(actual),row.staged.sha256,row.path);
 const working=await readFile('../ipad-debugger-04/'+row.path);
 assert.equal(working.length,row.working.byteLength,row.path+' working');
 assert.equal(sha(working),row.working.sha256,row.path+' working');
 if(!actual.equals(working))assert.equal(working.toString().replaceAll('\r\n','\n'),actual.toString(),row.path+' newline-only difference');
 sourceChecks.push({path:row.path,gitMatches:true,declaredWorkingMatches:true,newlineDifference:!actual.equals(working)});
}
const ids=ref=>[...git('show',ref+':ui/probe.html').toString().matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]).sort();
assert(ids(base).every(id=>ids(revision).includes(id)),'all original application IDs are retained');
assert(ids(revision).filter(id=>!ids(base).includes(id)).every(id=>id.startsWith('icon-')),'new IDs are decorative SVG symbols only');
assert.equal(new Set(ids(revision)).size,ids(revision).length);
const commands=ref=>[...git('show',ref+':ui/probe.html').toString().matchAll(/data-command="([^"]+)"/g)].map(match=>match[1]).sort();
assert.deepEqual(commands(base),commands(revision));
const result={checkedAt:new Date().toISOString(),revision,base,changedFiles:changed.length,ownership:'all allowed',checksumManifests:summaries,targetReferences:checks,uniqueTargets:files.size,sourceChecks,originalUIIds:ids(base).length,totalIDs:ids(revision).length,addedDecorativeSymbols:ids(revision).length-ids(base).length,dataCommands:commands(revision),declaration:'Static delivery and raw Git-byte evidence audit only; not independent acceptance or iPad validation. Subagent reviews did not complete, so this is the primary integrator review.'};
const dir='app/offline/evidence/ui-race-integration-2026-10-27/';await mkdir(dir,{recursive:true});
await writeFile(dir+'delivery-audit.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
