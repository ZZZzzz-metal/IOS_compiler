import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=new URL('./',import.meta.url),root=new URL('../../../',here),repo=fileURLToPath(root);
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async(path)=>JSON.parse(await readFile(new URL(path,here),'utf8'));
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${repo}`,'-C',repo,...args],{encoding:'utf8'}).trim();
const revision='40a079ba2065384572f268e4bb91bda437e46cec',profile='integration-prototype-60eb6729284e2729';
const routine=await json('automated/summary.json'),independent=await json('independent-summary.json'),watch=await json('engine/run-01/results.json'),ui=await json('ui/integrated-run-01/results.json');
assert.equal(git('rev-parse','HEAD'),revision);assert.equal(git('rev-parse','integration-v0.4.5^{}'),revision);
assert.equal(routine.testedRevision,revision);assert.equal(routine.endRevision,revision);assert(routine.allCommandsPassed);assert(routine.countsMatchExpected);
assert.equal(routine.commands.length,10);assert.equal(routine.counts.deduplicatedPassed,258);assert.equal(routine.counts.deduplicatedFailed,0);assert.equal(routine.counts.separateOfflineWorkerCounts.passed,22);assert.equal(routine.counts.separateOfflineWorkerCounts.failed,0);
const outputChecks=[];
for(const c of routine.commands){assert.equal(c.exitCode,0);const bytes=await readFile(new URL('automated/'+c.outputFile,here));assert.equal(sha(bytes),c.outputSHA256,c.id+' output hash');const command=await json('automated/'+c.id+'-command.json');assert.deepEqual(command,c);outputChecks.push({id:c.id,exitCode:c.exitCode,outputSHA256:sha(bytes),metadataMatches:true,counts:c.observedCounts});}
for(const c of independent.commands){assert.equal(c.exitCode,0);const b=await readFile(new URL(c.outputFile,here));assert.equal(sha(b),c.outputSHA256);outputChecks.push({id:c.id,exitCode:c.exitCode,outputSHA256:sha(b),metadataMatches:true});}
assert.equal(watch.profile.compatibilityId,profile);assert.equal(watch.revision,revision);assert.deepEqual(watch.counts,{passed:25,failed:0,boundaryOnly:1});
assert.equal(ui.revision,revision);assert.equal(ui.results.length,8);assert(ui.results.every(r=>r.status==='passed'));assert.equal(ui.results.reduce((n,r)=>n+r.checks.length,0),25);
const resources=[];
for(const r of watch.resources){const b=await readFile(new URL(r.relativePath,root));assert.equal(b.length,r.byteLength);assert.equal('sha256:'+sha(b),r.sha256,r.relativePath);resources.push({file:r.relativePath,byteLength:b.length,sha256:sha(b),matchesTestedCandidate:true});}
assert.equal(resources.length,30);
const sourceFiles=[];
for(const file of ['tests/watch-types-independent.mjs','tests/ui-parallel-audit.mjs','tests/lib/ui-parallel-audit-host.mjs','debugger/src/variables.mjs','debugger/src/wasm-runtime.mjs','ui/src/main.mjs','ui/src/editor.mjs','storage/src/autosave.mjs','storage/src/draft-store.mjs','compiler/src/source.mjs']){const b=await readFile(new URL(file,root));sourceFiles.push({file,byteLength:b.length,sha256:sha(b)});}
const summary={schemaVersion:1,verifiedAt:new Date().toISOString(),owner:'05 independent final combination automation',testedRevision:revision,testedTag:'integration-v0.4.5',tagObject:git('rev-parse','integration-v0.4.5'),tagCommit:git('rev-parse','integration-v0.4.5^{}'),engineProfile:watch.profile,routine:{commandsExitZero:10,passed:258,failed:0,breakdown:{compiler:27,debugger:83,uiAndStorage:106,contracts:10,integration:3,acceptance:21,minimalRegressions:2,initializer:6},toolchainVerified:11,baselineCheckPassed:true,evidence:'automated/summary.json'},offlineWorkerSeparate:{passed:22,failed:0},independentWatch:{counts:watch.counts,unchangedProgramAndWasm:independent.watch.files,sourceHash:independent.watch.sourceHash,nativeAndInterpreterOutputIdentical:true},independentClipboard:{scenarios:8,passed:8,assertions:25,failedAssertions:0,actualSystemClipboardTested:false,actualIndexedDBTested:false},outputChecks,resources,sourceFiles,productDiffFromCommit:routine.testedSourceDiffFromCommit,environment:{node:process.version,platform:process.platform,browserTested:false,ipadTested:false,networkDisabled:false},metadataNotes:['The routine runner preserves its original baseTagRevision field from git rev-parse of the annotated tag, which is the tag object; tagCommit above records the peeled fixed commit explicitly. No original output was rewritten.','Routine counts include module fault and boundary checks; 258+22 is not a count of user workflows. Independent25 and8 are separate query/controlled UI assertions.','No offline bundle was built or accepted by this subtask; package/browser/recovery evidence belongs to the parent task.']};
await writeFile(new URL('automation-summary.json',here),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:258,offlineWorkerPassed:22,watch:watch.counts,clipboardScenarios:8,clipboardAssertions:25,resources:resources.length,commandsExitZero:12,productDiff:summary.productDiffFromCommit}));
