import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base=new URL('./',import.meta.url),cwd=fileURLToPath(new URL('../../../',base));
const old='3248ad54faa5f0f3a8b6f6501829e95e4699f066';
try{await access(new URL('comparison.json',base));throw Error('Historical evidence exists; choose a new directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
const run=(executable,args,env={})=>spawnSync(executable,args,{cwd,encoding:'utf8',env:{...process.env,...env},timeout:240000,maxBuffer:4*1024*1024});
const save=async(name,result)=>{assert.ifError(result.error);await writeFile(new URL(name,base),result.stdout+(result.stderr?'\n'+result.stderr:''));};
const args=['--test','--test-reporter=tap','ui/checks/clipboard-order.test.mjs'];
const before=run(process.execPath,args,{UI_REVIEW_REF:old});await save('before-3248ad5.tap',before);
const after=run(process.execPath,args,{UI_REVIEW_REF:''});await save('after-targeted.tap',after);
function summary(result){const number=key=>Number(result.stdout.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]);return {exitCode:result.status,tests:number('tests'),pass:number('pass'),fail:number('fail')};}
const prior=summary(before),fixed=summary(after);
assert.equal(prior.exitCode,1);assert.equal(prior.tests,20);assert.ok(prior.fail>0);
assert.doesNotMatch(before.stdout+before.stderr,/ReferenceError|SyntaxError|did not start the expected read|Historical comparison dependency changed/u);
assert.equal(fixed.exitCode,0);assert.equal(fixed.tests,20);assert.equal(fixed.fail,0);
await writeFile(new URL('comparison.json',base),JSON.stringify({baseline:old,before:prior,after:fixed,
  boundary:'Complete actual main; real editor/parser/source/controller/autosave. Controlled DOM/clipboard and CAS memory transport. Not browser, IndexedDB or iPad acceptance.'},null,2)+'\n');
for(const [name,command] of [['npm-check.txt','npm.cmd run check'],['npm-test.tap','npm.cmd test']]){
  const result=run('cmd.exe',['/d','/s','/c',command]);await save(name,result);assert.equal(result.status,0,command);
}
const destination='ui/evidence/integrated-clipboard-2026-10-28/automated-final';
await mkdir(new URL('automated-final/',base),{recursive:true});
const result=run(process.execPath,['ui/scripts/verify-probe.mjs'],{UI_EVIDENCE_DIR:destination,UI_REVIEW_REF:''});
await save('verify-command.txt',result);assert.equal(result.status,0);
console.log(JSON.stringify({before:prior,after:fixed,fullEvidence:destination}));
