import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.cwd(),out=fileURLToPath(new URL('./',import.meta.url));
const revision='309d29dd703b1bc5a5beff03a88f232764c95808';
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:100*1024*1024});
const blob=path=>git(['show',revision+':'+path]);
const measured=b=>({byteLength:b.length,sha256:sha(b)});
const base='ui/evidence/integrated-shortcuts-2026-10-27';
const manifestPaths=[base+'/SHA256SUMS.json',base+'/automated/SHA256SUMS.json',base+'/automated-final/SHA256SUMS.json'];
const targets=[];
for(const manifestPath of manifestPaths){const manifest=JSON.parse(blob(manifestPath));for(const [name,expected] of Object.entries(manifest)){const path=posix.join(posix.dirname(manifestPath),name),actual=measured(blob(path));assert.deepEqual(actual,expected,path);targets.push({manifest:manifestPath,path,...actual});}}
const sourceInput=JSON.parse(blob(base+'/source-inputs.json')),sourceRows=[];
for(const [path,item] of Object.entries(sourceInput.inputs)){const actual=measured(blob(path));assert.deepEqual(actual,item.staged,path);assert.deepEqual(measured(await readFile(resolve(root,path))),item.staged,'Merged current byte mismatch: '+path);sourceRows.push({path,gitBytes:actual,recordedWorking:item.working,difference:item.difference});}
const changed=git(['diff-tree','--no-commit-id','--name-only','-r','-z',revision]).toString('utf8').split('\0').filter(Boolean);
assert.equal(changed.length,30);assert.ok(changed.every(x=>x.startsWith('ui/')||x==='docs/handoffs/04.md'));
const checksBase='app/offline/evidence/shortcuts-integration-2026-10-27';
const result=JSON.parse(await readFile(resolve(root,checksBase,'automated-results.json')));
assert.equal(result.revision,'3248ad54faa5f0f3a8b6f6501829e95e4699f066');
assert.ok(result.commands.every(x=>x.exitCode===0));
const combined=result.commands.find(x=>x.name==='combined-121');assert.equal(combined.tests,121);
const combinedRaw=await readFile(resolve(root,checksBase,'combined-121.stdout.txt'),'utf8');assert.match(combinedRaw,/# tests 121\r?\n/);assert.match(combinedRaw,/# pass 121\r?\n/);assert.match(combinedRaw,/# fail 0\r?\n/);
assert.deepEqual({total:result.controlledUI.total,passed:result.controlledUI.passed,failed:result.controlledUI.failed,infrastructureFailures:result.controlledUI.infrastructureFailures},{total:14,passed:14,failed:0,infrastructureFailures:0});
const adaptation=JSON.parse(await readFile(resolve(root,checksBase,'ui-host-adaptation.json')));
const originalCurrent=await readFile(resolve(root,adaptation.source)),originalGit=blob(adaptation.source);
assert.equal(sha(originalCurrent),adaptation.originalSha256);assert.equal(sha(originalGit),adaptation.originalGitSha256);assert.deepEqual(originalCurrent,originalGit);
const adapter=await readFile(resolve(root,checksBase,adaptation.adapter));assert.equal(sha(adapter),adaptation.adapterSha256);assert.equal(adapter.length,adaptation.adapterByteLength);
const copied=[];for(const row of result.copiedRawFiles){const bytes=await readFile(resolve(root,checksBase,row.archive));assert.equal(bytes.length,row.byteLength);assert.equal(sha(bytes),row.sha256);let originalPresent=false;try{const original=await readFile(resolve(root,row.source));assert.deepEqual(original,bytes);originalPresent=true;}catch(error){if(error.code!=='ENOENT')throw error;}copied.push({...row,originalPresent,archiveVerified:true});}
const checksFiles=['automated-results.json','combined-121.stdout.txt','combined-121.stderr.txt','npm-check.stdout.txt','npm-check.stderr.txt','npm-test.stdout.txt','npm-test.stderr.txt','ui-host-14.stdout.txt','ui-host-14.stderr.txt','ui-host-adaptation.json',adaptation.adapter];
const hashes=[];for(const path of checksFiles)hashes.push({path:checksBase+'/'+path,...measured(await readFile(resolve(root,checksBase,path)))});
const summary={recordedAt:new Date().toISOString(),deliveryRevision:revision,changedFiles:changed,ownershipScopePassed:true,manifests:manifestPaths,manifestReferences:targets.length,uniqueManifestTargets:new Set(targets.map(x=>x.path)).size,allGitBlobTargetsVerified:true,sourceFingerprints:sourceRows,sourceFingerprintsVerified:sourceRows.length,workingLineEndingDifferences:sourceRows.filter(x=>x.difference!=='none').map(x=>x.path),integratedChecks:{revision:result.revision,tests:121,passed:121,failed:0,npmCheckExit:result.commands.find(x=>x.name==='npm-check').exitCode,npmTestExit:result.commands.find(x=>x.name==='npm-test').exitCode,controlledRootUI:result.controlledUI,originalPerson05HarnessUnchanged:true,adaptationSourceHashesVerified:true,copiedRawFiles:copied},checkArtifacts:hashes,scope:'Git blob and local byte checks. Working CRLF/LF differences were disclosed by person04; committed normalized hashes and merged current source bytes match. Root adapted UI VM results do not constitute person05 independent, real browser, IndexedDB, iPad, G2/G3 or distribution acceptance.'};
await writeFile(resolve(out,'delivery-and-checks-audit.json'),JSON.stringify(summary,null,2)+'\n');
await writeFile(resolve(out,'delivery-manifest-targets.json'),JSON.stringify(targets,null,2)+'\n');
console.log(JSON.stringify({changedFiles:changed.length,manifestReferences:targets.length,uniqueTargets:new Set(targets.map(x=>x.path)).size,sourceFingerprints:sourceRows.length,rootChecks:121,rootControlledUI:14,allPassed:true}));
