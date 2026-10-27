// Seal this completed person-05 round. --verify reads evidence only.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {platform,release,arch} from 'node:os';
const here=new URL('./',import.meta.url),root=new URL('../../../',here);
const repo=fileURLToPath(root).replace(/[\\/]$/,''),revision='66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9';
const baseline='b9ed5d1faade2eedd7e9d840fb8e2ffa8504bebf',base='9727c51915325732e8d1b365f5e9bf672c717aaf';
const prefix='tests/evidence/integrated-person05-rev004005-66db2bb-2026-10-27/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async(path,from=here)=>JSON.parse(await readFile(new URL(path,from),'utf8'));
const save=(path,value)=>writeFile(new URL(path,here),JSON.stringify(value,null,2)+'\n');
const gitBytes=(...args)=>execFileSync('git',['-c',`safe.directory=${repo}`,'-C',repo,...args],{windowsHide:true,maxBuffer:16*1024*1024});
const git=(...args)=>gitBytes(...args).toString('utf8').trim();
const digest=(file,bytes)=>({file,byteLength:bytes.length,sha256:sha(bytes)});
const verify=async(entries,from)=>{for(const entry of entries){const bytes=await readFile(new URL(entry.file,from));assert.equal(bytes.length,entry.byteLength,entry.file+' length');assert.equal(sha(bytes),entry.sha256,entry.file+' hash');}};
assert.equal(git('rev-parse','integration-v0.4.2'),base);
assert.equal(git('diff',revision,'--','package.json','package-lock.json','app','scripts','compiler','debugger','ui','storage','contracts'),'','Product source differs from target');
const priorRounds=[['integrated-person05-v0.3.0-2026-10-25',48],['integrated-person05-val004-87973fa-2026-10-26',41]];
for(const [name,count] of priorRounds){const from=new URL('tests/evidence/'+name+'/',root);const seal=await json('SHA256SUMS.json',from);assert.equal(seal.length,count);await verify(seal,from);}
const autoSeal=await json('automated/SHA256SUMS.json');assert.equal(autoSeal.length,28);await verify(autoSeal,new URL('automated/',here));
if(process.argv.includes('--verify')){
  const seal=await json('SHA256SUMS.json');await verify(seal,here);
  if(process.argv.includes('--git')){
    for(const entry of seal){const bytes=gitBytes('show','HEAD:'+prefix+entry.file);assert.equal(bytes.length,entry.byteLength,entry.file+' Git length');assert.equal(sha(bytes),entry.sha256,entry.file+' Git hash');}
    const committed=gitBytes('show','HEAD:tests/ui-concurrency-independent.mjs').toString('utf8').replace(/\r\n/g,'\n');
    const archived=(await readFile(new URL('independent/harness-final.mjs',here),'utf8')).replace(/\r\n/g,'\n');assert.equal(committed,archived,'Committed executable must equal archived harness after LF normalization');
  }
  console.log(`Verified ${seal.length} sealed files, 28 automatic records and 89 previous-round root records${process.argv.includes('--git')?', including evidence Git bytes and normalized test source':''}.`);process.exit(0);
}
try{await access(new URL('SHA256SUMS.json',here));throw Error('Already sealed; use --verify');}catch(error){if(error.code!=='ENOENT')throw error;}
const automatic=await json('automated/summary.json');assert.equal(automatic.testedRevision,revision);assert(automatic.allCommandsPassed);assert.equal(automatic.counts.deduplicatedPassed,195);assert.equal(automatic.counts.deduplicatedFailed,0);
const positive=await json('independent/fixed-run-02/results.json'),negative=await json('independent/baseline-run-02/results.json');
assert.equal(positive.revision,revision);assert.equal(negative.revision,baseline);
assert.deepEqual(positive.counts,{total:14,passed:14,failed:0,infrastructureFailures:0});assert.deepEqual(negative.counts,{total:14,passed:1,failed:13,infrastructureFailures:0});
assert(negative.results.filter(item=>item.status==='failed').every(item=>item.error.code==='ERR_ASSERTION'));
const harness=await readFile(new URL('independent/harness-final.mjs',here));assert.equal(sha(harness),positive.inputs.find(item=>item.path==='tests/ui-concurrency-independent.mjs').sha256);assert.equal(sha(harness),negative.inputs.find(item=>item.path==='tests/ui-concurrency-independent.mjs').sha256);
assert.equal(sha(await readFile(new URL('tests/ui-concurrency-independent.mjs',root))),sha(harness));
const initialHarness=await readFile(new URL('independent/harness-run01.mjs',here));
for(const phase of ['fixed-run-01','baseline-run-01']){const early=await json('independent/'+phase+'/results.json');assert.equal(sha(initialHarness),early.inputs.find(item=>item.path==='tests/ui-concurrency-independent.mjs').sha256);}
const doc=await json('browser/observations.json');assert.equal(doc.testedRevision,revision);const observations=doc.observations;
const map=new Map(observations.map((item,index)=>[item.step,{...item,index}]));
const get=step=>{assert(map.has(step),'Missing '+step);return map.get(step);};
const disabled=(o,id)=>o.fields.buttons.find(button=>button.id===id).disabled;
const ready=get('initial-ready-with-old-verified-candidate');assert.equal(disabled(ready,'run'),false);assert.equal(disabled(ready,'debug'),false);
for(const step of ['reprepare-held-three-entries-locked','held-after-edit-tabs-and-F5-still-locked','retry-held-unready-cannot-run']){const o=get(step);assert.equal(o.fields.bodyData.executionState,'preparing');assert.equal(o.fields.bodyData.resourceReady,'false');for(const id of ['prepare','run','debug'])assert.equal(disabled(o,id),true,step+' '+id);}
const failure=get('503-recheck-failure-clears-ready-and-blocks-compile');assert(failure.dom.includes('资源未就绪'));assert.equal(failure.fields.bodyData.resourceReady,'false');assert.equal(disabled(failure,'prepare'),false);assert.equal(disabled(failure,'run'),true);assert.equal(disabled(failure,'debug'),true);
const retried=get('retry-success-restores-compile-entries');assert.equal(disabled(retried,'run'),false);assert.equal(disabled(retried,'debug'),false);
assert(get('real-run-A31-after-retry').dom.includes('person05-A=31'));
const b=get('actual-full-import-B-saved3');assert.equal(b.fields.stdin,'45\n');assert.equal(b.fields.language,'cpp');assert(b.dom.includes('草稿已保存 · 版本 3'));
const paused=get('paper-B-breakpoint5-received45');assert(paused.dom.includes('已暂停 · main.cpp:5:1'));assert.match(paused.dom,/code: received\n\s+- emphasis: int\n\s+- generic: "45"/);
const snapshot=get('paper-VAL004-old-snapshot-binding5-retained');assert.equal(snapshot.fields.sourceReadOnly,true);assert(snapshot.dom.includes('main.cpp:5:1 · 已绑定 → main.cpp:5:1'));
const output=get('paper-B-actual-output47-exit0');assert(output.dom.includes('person05-B=47'));assert(output.dom.includes('返回 0'));
const reopened=get('page-reopen-B-edited-source-stdin45-revision4');assert(reopened.fields.source.includes('edited B while paused'));assert.equal(reopened.fields.stdin,'45\n');assert(reopened.dom.includes('草稿已保存 · 版本 4'));
const host=await json('browser/host-events.json');assert.equal(host.candidateRequests,3);assert.equal(host.heldAttempt,null);assert.equal(host.events.filter(event=>event.kind==='candidate-request').length,3);assert(host.events.some(event=>event.kind==='released-503'&&event.attempt===2));assert(host.events.some(event=>event.kind==='released-original'&&event.attempt===3));
const viewport=await json('browser/viewport-note.json');assert.equal(viewport.acceptedAsNarrowTest,false);
const checks=[
  ['REV004-real-reprepare-lock-render-keyboard',['initial-ready-with-old-verified-candidate','reprepare-held-three-entries-locked','held-after-edit-tabs-and-F5-still-locked','fixture-exactly-one-held-request-after-F5']],
  ['REV004-real-503-and-retry',['503-recheck-failure-clears-ready-and-blocks-compile','retry-held-unready-cannot-run','retry-success-restores-compile-entries','real-run-A31-after-retry']],
  ['actual-import-B-debug-output-reopen',['actual-full-import-B-saved3','paper-B-breakpoint5-received45','paper-B-actual-output47-exit0','page-reopen-B-edited-source-stdin45-revision4']],
  ['VAL004-still-correct-in-paper-style',['paper-VAL004-old-snapshot-binding5-retained']]
].map(([id,steps])=>({id,status:'passed',observations:steps.map(step=>({step,index:get(step).index}))}));
await save('browser/results.json',{testedRevision:revision,checks,method:'Actual browser controls/file chooser/IndexedDB page reopen/real Worker execution; test host controls only candidate HTTP response',fileReadReorderingObservedInRealBrowser:false,controlledFileReadEvidence:'independent/fixed-run-02/results.json',viewport:{desktopWidth:reopened.fields.width,documentWidth:reopened.fields.scrollWidth,narrowAccepted:false,explanation:'viewport-note.json'},internalSessionIdsCollected:false,ipadTested:false,networkDisabled:false});
const files=git('ls-files','--','ui/probe.html','ui/style.css','ui/src','ui/scripts/prepare-probe.mjs','ui/scripts/serve-probe.mjs','storage/src','app/integration/candidate.mjs').split('\n').filter(Boolean),sourceFiles=[];
for(const file of files){const bytes=await readFile(new URL(file,root)),target=gitBytes('show',revision+':'+file);assert.equal(bytes.toString('utf8').replace(/\r\n/g,'\n'),target.toString('utf8').replace(/\r\n/g,'\n'),file+' source');sourceFiles.push({...digest(file,bytes),fixedGitBlob:git('rev-parse',revision+':'+file),fixedBlobSHA256:sha(target),equalAfterLFNormalization:true});}
const candidateBytes=await readFile(new URL('ui/.local/candidate.json',root)),candidate=JSON.parse(candidateBytes);assert.equal(candidate.resources.length,30);
await save('provenance.json',{recordedAt:new Date().toISOString(),timezone:'Asia/Shanghai',testedRevision:revision,baseTag:'integration-v0.4.2',baseRevision:base,negativeReference:baseline,headAtSeal:git('rev-parse','HEAD'),productDiffFromCommit:'',environment:{node:process.version,platform:platform(),release:release(),arch:arch(),browser:'Codex IAB; engine version not collected',ipadTested:false,networkDisabled:false},host:{url:'http://127.0.0.1:4215/ui/probe.html',controls:'http://127.0.0.1:4215/_validation/control',implementation:'browser/serve-controlled-host.mjs',altered:'only next candidate HTTP response; unmodified app/Workers/File.text'},engineProfile:candidate.profile,engineResourceCount:30,preparedCandidate:digest('ui/.local/candidate.json',candidateBytes),sourceFiles,testHarness:digest('tests/ui-concurrency-independent.mjs',harness),offlinePackageRebuiltOrAccepted:false});
await save('summary.json',{schemaVersion:1,owner:'05 independent validation',dateAsiaShanghai:'2026-10-27',testedRevision:revision,baseTag:'integration-v0.4.2',result:'REV-004/005 confirmed fixed within tested branch scope',automated:{passed:195,failed:0,evidence:'automated/summary.json',allCommandsExitZero:true},independentControlled:{fixed:{passed:14,failed:0},baseline:{passed:1,behaviorFailures:13,infrastructureFailures:0},finalEvidence:'independent/*-run-02/',intermediate13CaseRunsRetained:true},browser:{workflowGroupsPassed:checks.length,evidence:'browser/results.json',narrowViewportAccepted:false},history:{previousIndependentReferences:145,uniqueTargets:89,evidence:'review/history-preservation.json',fullHistorySweep:false,manifestVsGitComparison:false},pending:['Integration and new immutable offline release','REV-001 independent offline recovery validation','REV-002/003 debugger fixes outside this target','Real iPad offline, G2/G3, physical input and full draft durability','Full responsive and accessibility acceptance'],productModified:false,report:'docs/validation/rev004005-person05-66db2bb-2026-10-27.md'});
async function list(url,prefix=''){const result=[];for(const entry of await readdir(url,{withFileTypes:true})){const file=prefix+entry.name;if(entry.isDirectory())result.push(...await list(new URL(entry.name+'/',url),file+'/'));else if(file!=='SHA256SUMS.json')result.push(file);}return result.sort();}
const seal=[];for(const file of await list(here))seal.push(digest(file,await readFile(new URL(file,here))));await save('SHA256SUMS.json',seal);await verify(seal,here);
console.log(`Sealed ${seal.length} new files; 195 existing checks and 14 independent concurrency checks passed; baseline has 13 behavior failures; ${checks.length} real browser workflow groups passed.`);
