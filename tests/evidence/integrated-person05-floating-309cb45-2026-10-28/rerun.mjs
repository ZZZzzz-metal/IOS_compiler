// Independent read-only rerun against the fixed role-03 product checkout.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const here=new URL('./',import.meta.url),own=new URL('../../../',here);
const repo=fileURLToPath(own),product=resolve(repo,'../ipad-debugger-03');
const target='309cb45191a62fde2b13eeab9746a8d2502ef658';
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${product}`,'-C',product,...args],{encoding:'utf8'}).trim();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFile(new URL(name,here),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const baseline=new URL('tests/evidence/integrated-person05-parallel-review-3248ad5-2026-10-28/engine/run-01/',own);
assert.equal(git('rev-parse','HEAD'),target);const statusBefore=git('status','--short');assert.equal(statusBefore,'','Product checkout must start clean');
const protectedPaths=['package.json','package-lock.json','app','compiler','debugger','contracts'];
assert.equal(git('diff',target,'--',...protectedPaths),'');
await mkdir(new URL('engine/',here),{recursive:true});await mkdir(new URL('automated/',here),{recursive:true});
await copyFile(new URL('tests/watch-types-independent.mjs',own),new URL('engine/runner.mjs',here));
const runnerBytes=await readFile(new URL('engine/runner.mjs',here));
const npmCli=resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const commands=[];
async function run(id,args,cwd=product,env={}){
 const startedAt=new Date().toISOString();let stdout='',stderr='';const started=performance.now();
 const result=await new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd,env:{...process.env,...env},windowsHide:true});child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);child.on('error',error=>resolve({exitCode:null,signal:null,error:error.message}));child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));});
 const bytes=Buffer.from(stdout+(stderr?'\n--- stderr ---\n'+stderr:''));
 const record={id,executable:process.execPath,args,cwd,explicitEnvironment:env,startedAt,finishedAt:new Date().toISOString(),durationMs:performance.now()-started,...result,outputFile:`automated/${id}.txt`,outputSHA256:sha(bytes)};
 await writeFile(new URL(record.outputFile,here),bytes,{flag:'wx'});await save(`automated/${id}-command.json`,record);commands.push(record);console.log(JSON.stringify({id,exitCode:record.exitCode}));return record;
}
const watch=await run('watch-independent',[fileURLToPath(new URL('tests/watch-types-independent.mjs',own))],repo,{
 WATCH_TYPES_PRODUCT_ROOT:product,WATCH_TYPES_REVISION:target,WATCH_TYPES_PROFILE:'integration-prototype-60eb6729284e2729',
 WATCH_TYPES_OUTPUT:'tests/evidence/integrated-person05-floating-309cb45-2026-10-28/engine/run-01/'
});
assert.equal(watch.exitCode,0,'Independent semantic checks must pass');
const current=JSON.parse(await readFile(new URL('engine/run-01/results.json',here),'utf8'));
const previous=JSON.parse(await readFile(new URL('results.json',baseline),'utf8'));
assert.deepEqual(current.counts,{passed:25,failed:0,boundaryOnly:1});
assert.equal(current.revision,target);assert.equal(current.runnerSHA256,sha(runnerBytes));
const byteComparison=[];
for(const file of ['source.cpp','artifact.wasm']){const before=await readFile(new URL(file,baseline)),after=await readFile(new URL(`engine/run-01/${file}`,here));assert.deepEqual(after,before,file+' should have identical bytes');byteComparison.push({file,byteLength:after.length,sha256:sha(after),identical:true});}
assert.match(current.build.snapshot.sourceHash,/^sha256:[0-9a-f]{64}$/u);
assert.equal(current.build.snapshot.sourceHash,previous.build.snapshot.sourceHash);
assert.equal(current.native.stdout,previous.native.stdout);assert.equal(current.interpreterOutput,current.native.stdout);
await save('engine/comparison.json',{baselineRevision:previous.revision,targetRevision:current.revision,before:previous.counts,after:current.counts,sourceHash:current.build.snapshot.sourceHash,files:byteComparison,nativeStdoutIdentical:true,interpreterStdoutEqualsNative:true,previousFailures:previous.failures.map(f=>({id:f.id,before:f.result,after:current.observations.find(o=>o.id===f.id).result}))});
await Promise.all([run('check',[npmCli,'run','check']),run('contracts',[npmCli,'test'])]);
await Promise.all([run('debugger',[ '--test','--test-reporter=tap','debugger/checks/*.test.mjs']),run('integration',[npmCli,'run','test:integration'])]);
const statusAfter=git('status','--short');assert.equal(statusAfter,statusBefore,'Read-only checkout must remain clean');assert.equal(git('rev-parse','HEAD'),target);assert.equal(git('diff',target,'--',...protectedPaths),'');
await save('summary.json',{schemaVersion:1,testedRevision:target,productRoot:product,validationRoot:repo,recordedAt:new Date().toISOString(),commands,allCommandsPassed:commands.every(c=>c.exitCode===0),independentWatch:current.counts,profile:current.profile,variablesSHA256:current.variablesSHA256,sourceAndWasmUnchanged:true,productStatusBefore:statusBefore,productStatusAfter:statusAfter,productTrackedDiffFromCommit:'',environment:{node:process.version,platform:process.platform,arch:process.arch,ipadTested:false,browserTested:false,networkDisabled:false},limits:['Branch-level fixed product rerun, not a new integrated release acceptance','No browser/iPad/offline cache/clipboard execution']});
assert(commands.every(c=>c.exitCode===0));
console.log('All independent fixed-branch checks completed.');
