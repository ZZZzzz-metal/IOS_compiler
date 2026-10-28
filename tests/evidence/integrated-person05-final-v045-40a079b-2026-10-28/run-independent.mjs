// Final fixed-combination independent watch + clipboard assertions, separate from module suites.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),here=new URL('./',import.meta.url),root=new URL('../../../',here),repo=fileURLToPath(root);
const revision='40a079ba2065384572f268e4bb91bda437e46cec',profile='integration-prototype-60eb6729284e2729';
const sha=b=>createHash('sha256').update(b).digest('hex');
const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:repo};
const git=async(...args)=>(await exec('git',['-C',repo,...args],{env,encoding:'utf8',windowsHide:true})).stdout.trim();
const save=(name,data)=>writeFile(new URL(name,here),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
assert.equal(await git('rev-parse','HEAD'),revision);
const sourcePaths=['compiler','debugger','app','ui','storage','contracts','scripts','package.json','package-lock.json'];
assert.equal(await git('diff',revision,'--',...sourcePaths),'');
const startedAt=new Date().toISOString(),commands=[];
async function run(id,args,extra){
 const start=new Date().toISOString(),options={cwd:repo,env:{...env,...extra},encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:16*1024*1024};
 let stdout='',stderr='',exitCode=0,signal=null,errorMessage=null;
 try{({stdout,stderr}=await exec(process.execPath,args,options));}catch(error){stdout=error.stdout??'';stderr=error.stderr??'';exitCode=error.code??1;signal=error.signal??null;errorMessage=error.message;}
 const output=stdout+(stderr?'\n# STDERR\n'+stderr:'');await writeFile(new URL(id+'.txt',here),output,{flag:'wx'});
 const record={id,executable:process.execPath,args,environmentOverrides:extra,startedAt:start,finishedAt:new Date().toISOString(),exitCode,signal,errorMessage,outputFile:id+'.txt',outputSHA256:sha(Buffer.from(output))};
 commands.push(record);await save(id+'-command.json',record);console.log(id+': exit '+exitCode);assert.equal(exitCode,0,id+' independent run');return record;
}
await mkdir(new URL('engine/',here),{recursive:true});
await copyFile(new URL('tests/watch-types-independent.mjs',root),new URL('engine/runner.mjs',here));
await run('watch-independent',['tests/watch-types-independent.mjs'],{WATCH_TYPES_REVISION:revision,WATCH_TYPES_PROFILE:profile,WATCH_TYPES_PRODUCT_ROOT:repo,WATCH_TYPES_OUTPUT:'tests/evidence/integrated-person05-final-v045-40a079b-2026-10-28/engine/run-01/'});
await run('clipboard-independent',['tests/ui-parallel-audit.mjs','integrated-run-01'],{UI_PARALLEL_REVISION:revision,UI_PARALLEL_OUTPUT_ROOT:fileURLToPath(here)});
const json=async(name,from=here)=>JSON.parse(await readFile(new URL(name,from),'utf8'));
const watch=await json('engine/run-01/results.json'),clipboard=await json('ui/integrated-run-01/results.json');
assert.equal(watch.revision,revision);assert.equal(watch.profile.compatibilityId,profile);assert.deepEqual(watch.counts,{passed:25,failed:0,boundaryOnly:1});
assert.equal(clipboard.revision,revision);assert.equal(clipboard.results.length,8);assert(clipboard.results.every(item=>item.status==='passed'));
const checkCount=clipboard.results.reduce((n,r)=>n+r.checks.length,0);assert.equal(checkCount,25);
const baseline=new URL('tests/evidence/integrated-person05-parallel-review-3248ad5-2026-10-28/engine/run-01/',root);
const original=await json('results.json',baseline),files=[];
assert.equal(watch.build.snapshot.sourceHash,original.build.snapshot.sourceHash);
assert.equal(watch.build.snapshot.sourceHash,'sha256:8f4ea16786be3da29608a1034506eb34c2685b8d6d268e9b057942fa3a176161');
for(const name of ['source.cpp','artifact.wasm']){const bytes=await readFile(new URL('engine/run-01/'+name,here));assert.deepEqual(bytes,await readFile(new URL(name,baseline)));files.push({file:name,byteLength:bytes.length,sha256:sha(bytes),identicalToOriginalFailure:true});}
assert.equal(watch.interpreterOutput,watch.native.stdout);assert.equal(watch.native.stdout,original.native.stdout);
assert.equal(await git('rev-parse','HEAD'),revision);assert.equal(await git('diff',revision,'--',...sourcePaths),'');
await save('independent-summary.json',{testedRevision:revision,profile:watch.profile,startedAt,finishedAt:new Date().toISOString(),commands,watch:{counts:watch.counts,sourceHash:watch.build.snapshot.sourceHash,files,nativeAndInterpreterOutputIdentical:true},clipboard:{scenarios:8,passed:8,failed:0,assertions:checkCount,actualSystemClipboardTested:false,actualIndexedDBTested:false},productDiffFromCommit:'',browserTested:false,ipadTested:false,networkDisabled:false,note:'Independent checks are separate from the routine module/contract suites; sizeof remains a support-boundary record.'});
console.log('Independent final combination: watch25/0/1 boundary, clipboard8/8 with25 assertions.');
