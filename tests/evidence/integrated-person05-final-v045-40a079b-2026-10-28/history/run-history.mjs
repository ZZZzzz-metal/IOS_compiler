// Execute and archive read-only history checks into this new directory, exclusively.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),here=new URL('./',import.meta.url),root=new URL('../../../../',here),repo=fileURLToPath(root);
const fixed='40a079ba2065384572f268e4bb91bda437e46cec';
const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:repo};
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=(name,data)=>writeFile(new URL(name,here),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const git=async(...args)=>(await exec('git',['-C',repo,...args],{env,windowsHide:true,encoding:'utf8'})).stdout.trim();
assert.equal(await git('rev-parse','HEAD'),fixed);
const commands=[];
async function run(id,args,extension='txt'){
 const startedAt=new Date().toISOString();let stdout='',stderr='',exitCode=0,errorMessage=null,signal=null;
 try{({stdout,stderr}=await exec(process.execPath,args,{cwd:repo,env,windowsHide:true,encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000}));}
 catch(error){stdout=error.stdout??'';stderr=error.stderr??'';exitCode=error.code??1;errorMessage=error.message;signal=error.signal??null;}
 const outputFile=id+'.stdout.'+extension,errorFile=id+'.stderr.txt';
 await writeFile(new URL(outputFile,here),stdout,{flag:'wx'});await writeFile(new URL(errorFile,here),stderr,{flag:'wx'});
 const record={id,executable:process.execPath,args,cwd:repo,startedAt,finishedAt:new Date().toISOString(),exitCode,errorMessage,signal,outputFile,outputSHA256:sha(Buffer.from(stdout)),errorFile,errorSHA256:sha(Buffer.from(stderr))};
 commands.push(record);console.log(id+': exit '+exitCode);return record;
}
await run('full-history',['tests/evidence/integrated-person05-final-v045-40a079b-2026-10-28/history/audit-history.mjs'],'json');
await run('verify-parallel',['tests/seal-integrated-round.mjs','integrated-person05-parallel-review-3248ad5-2026-10-28','--verify','--git']);
await run('verify-floating',['tests/seal-integrated-round.mjs','integrated-person05-floating-309cb45-2026-10-28','--verify','--git']);
await run('verify-clipboard',['tests/seal-integrated-round.mjs','integrated-person05-clipboard-33c1639-2026-10-28','--verify','--git']);
await save('commands.json',{testedRevision:fixed,commands});
assert(commands.every(c=>c.exitCode===0),'Read-only checks must all pass');
const full=JSON.parse(await readFile(new URL('full-history.stdout.json',here),'utf8'));
assert(full.allPassed);assert.equal(await git('rev-parse','HEAD'),fixed);
const summary={schemaVersion:1,recordedAt:new Date().toISOString(),testedRevision:fixed,allCommandsPassed:true,commandsExitZero:4,manifests:full.manifests,references:full.references,uniqueTargets:full.uniqueTargets,lengthAndSHA256:full.lengthAndSHA256,SHA256Only:full.SHA256Only,referenceGitBlobMatches:full.referenceGitBlobMatches,manifestRawGitMatches:full.manifestRawGitMatches,normalizedManifestMatches:full.normalizedManifestMatches,retainedHistoricalAliasChecks:full.retainedHistoricalAliasChecks,testsManifests:full.testsManifests,testsReferences:full.testsReferences,recentRoundFiles:{parallel:58,floating:22,clipboard:19},oldEvidenceModified:false,currentFinalDirectorySealed:false,notes:['All writes in this rerun are exclusive wx files inside this new history directory; the audit script itself only reads old evidence.','The earlier exploratory stdin verifier initially assumed byteLength in every manifest and the pre-rename summary path; those were verifier assumptions. This archived rerun handles hash-only entries and the explicitly preserved historical alias without modifying old manifests.','SHA256Only records have no length field, so no recorded-length claim is made for those17 entries.']};
await save('summary.json',summary);console.log(JSON.stringify({manifests:summary.manifests,references:summary.references,uniqueTargets:summary.uniqueTargets,commandsExitZero:4,recentRoundFiles:summary.recentRoundFiles}));
