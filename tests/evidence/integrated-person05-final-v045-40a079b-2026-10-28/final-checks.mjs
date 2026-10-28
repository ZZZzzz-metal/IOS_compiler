import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url),repo=new URL('../../../',here);
const sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(new URL('final-checks/',here),{recursive:true});
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${fileURLToPath(repo)}`,'-C',fileURLToPath(repo),...args],{encoding:'utf8'}).trim();
const target='40a079ba2065384572f268e4bb91bda437e46cec';
assert.equal(git('rev-parse','HEAD'),target);
assert.equal(git('rev-parse','integration-v0.4.5^{commit}'),target);
const results=[];
for(const [id,command,args] of [
 ['check','cmd.exe',['/d','/s','/c','npm.cmd run check']],
 ['test','cmd.exe',['/d','/s','/c','npm.cmd test']],
 ['fixture-host-syntax',process.execPath,['--check','tests/offline-browser-host.mjs']],
 ['diff-check','git',['-c',`safe.directory=${fileURLToPath(repo)}`,'diff','--check']],
]) {
 const startedAt=new Date().toISOString();
 const run=spawnSync(command,args,{cwd:fileURLToPath(repo),windowsHide:true,maxBuffer:16*1024*1024});
 const stdout=run.stdout??Buffer.alloc(0),stderr=run.stderr??Buffer.alloc(0);
 await writeFile(new URL(`final-checks/${id}.stdout.log`,here),stdout,{flag:'wx'});
 await writeFile(new URL(`final-checks/${id}.stderr.log`,here),stderr,{flag:'wx'});
 results.push({id,command,args,startedAt,finishedAt:new Date().toISOString(),exitCode:run.status,error:run.error?.message,stdoutSHA256:sha(stdout),stderrSHA256:sha(stderr)});
}
const productDiff=git('diff',target,'--','compiler','debugger','ui','storage','app','scripts','contracts','package.json','AGENTS.md');
const summary={testedRevision:target,recordedAt:new Date().toISOString(),results,productDiffFromTarget:productDiff};
await writeFile(new URL('final-checks/summary.json',here),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
assert(results.every(r=>r.exitCode===0));assert.equal(productDiff,'');
console.log('check, test, fixture syntax and diff whitespace passed; product files equal fixed 40a079b.');
