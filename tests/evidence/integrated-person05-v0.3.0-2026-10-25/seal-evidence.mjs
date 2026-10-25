// Seal this completed independent run; --verify reads files only.
import assert from 'node:assert/strict';
import {readFile, writeFile, readdir, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {platform, release, arch} from 'node:os';

const here = new URL('./', import.meta.url);
const root = new URL('../../../', here);
const repo = fileURLToPath(root).replace(/[\\/]$/, '');
const tag = 'integration-v0.3.0';
const revision = 'fff15bee97ed47cf2485b83c4344a020e9e190f7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJSON = async path => JSON.parse(await readFile(new URL(path, here), 'utf8'));
const gitBytes = (...args) => execFileSync('git', ['-c', `safe.directory=${repo}`, '-C', repo, ...args], {windowsHide:true,maxBuffer:16*1024*1024});
const git = (...args) => gitBytes(...args).toString('utf8').trim();
const saveJSON = (path, value) => writeFile(new URL(path, here), JSON.stringify(value,null,2)+'\n');
const record = (file, bytes) => ({file,byteLength:bytes.length,sha256:sha(bytes)});
const verifyRecords = async (records, base) => {
  for (const entry of records) {
    const bytes = await readFile(new URL(entry.file, base));
    assert.equal(bytes.length, entry.byteLength, entry.file+' length');
    assert.equal(sha(bytes), entry.sha256, entry.file+' hash');
  }
};
assert.equal(git('rev-parse',tag),revision);
const productPaths = ['package.json','app','scripts','compiler','debugger','ui','storage','contracts'];
assert.equal(git('diff',revision,'--',...productPaths),'','Product source changed from tested tag');

const historical = await readJSON('review/history-integrity.json');
for (const manifest of historical.historical.manifests) {
  const bytes = await readFile(new URL(manifest.manifest,root));
  assert.equal(sha(bytes),manifest.manifestSHA256,manifest.manifest+' changed');
  for (const entry of manifest.entries) {
    const bytes = await readFile(new URL(entry.path,root));
    assert.equal(bytes.length,entry.expectedByteLength,entry.path+' length');
    assert.equal(sha(bytes),entry.expectedSHA256,entry.path+' hash');
  }
}
assert.equal(historical.historical.passedEntries,107);
const automatedSeal = await readJSON('automated/SHA256SUMS.json');
await verifyRecords(automatedSeal,new URL('automated/',here));

if (process.argv.includes('--verify')) {
  const seal = await readJSON('SHA256SUMS.json');
  await verifyRecords(seal,here);
  if (process.argv.includes('--git')) {
    for (const entry of seal) {
      const file = 'tests/evidence/integrated-person05-v0.3.0-2026-10-25/'+entry.file;
      const bytes = gitBytes('show','HEAD:'+file);
      assert.equal(bytes.length,entry.byteLength,file+' Git length');
      assert.equal(sha(bytes),entry.sha256,file+' Git hash');
    }
  }
  console.log(`Read-only verified ${seal.length} sealed run files, ${automatedSeal.length} automated records and 107 historical records${process.argv.includes('--git')?' including committed bytes':''}.`);
  process.exit(0);
}
try {await access(new URL('SHA256SUMS.json',here));throw Error('Already sealed; use --verify, do not overwrite evidence');}
catch(error) {if(error.code!=='ENOENT')throw error;}

const automated = await readJSON('automated/summary.json');
assert.equal(automated.testedRevision,revision);
assert.equal(automated.allCommandsPassed,true);
assert.equal(automated.counts.deduplicatedPassed,160);
const observations = await readJSON('browser/observations.json');
assert.equal(observations.testedRevision,revision);
const observationIndex = new Map(observations.observations.map((item,index)=>[item.step,index]));
const evidence = (...steps) => steps.map(step=>{
  assert(observationIndex.has(step),'Missing observation '+step);
  return {file:'browser/observations.json',index:observationIndex.get(step),step};
});
const conflict = await readJSON('browser/conflict-results.json');
for(const field of ['mainA','recoveryB','driverA','driverB'])assert.equal(conflict[field],true);
const minimal = await readJSON('browser/val004-minimal-results.json');
assert.equal(minimal.result,'failed');
assert.equal(minimal.falseEmptyMessage,true);
assert.equal(minimal.oldSnapshotEditor.readOnly,true);
assert.equal(minimal.initialObservedI,0);
assert.equal(minimal.afterContinueObservedI,1);
assert.match(minimal.dom,/code: i\n\s+- emphasis: int\n\s+- text: "1"/);
assert.equal((await readFile(new URL('fixtures/regressions/ui-stale-breakpoints.cpp',root),'utf8')).replace(/\r\n/g,'\n'),minimal.source);

const workflows = [
  {id:'breakpoints-stepping-values-and-frame-selection',status:'passed',evidence:evidence('breakpoint-23-live-arrays-pointer-vector-string-watch17','caller-frame-selected-main-seed9','step-over-in-adjust-shifted13','step-out-before-caller-store','caller-store-complete-transformed13','recursive-second-frame-n2','recursive-caller-frame-n3')},
  {id:'edited-source-and-old-debug-snapshot-isolation',status:'passed',evidence:evidence('old-debug-snapshot-is-readonly','editing-draft-restored-with-plus5','old-snapshot-completed-ui05-13','recompiled-edited-source-ui05-14')},
  {id:'C11-input-output',status:'passed',evidence:evidence('C11-stdin14-output42')},
  {id:'stop-real-infinite-loop-edit-and-recompile',status:'passed',evidence:evidence('infinite-running-editor-responsive','infinite-stop-terminal','restart-new-source-output44')},
  {id:'editable-Solution-driver-actual-output-change',status:'passed',evidence:evidence('solution-driver-20-output41','edited-driver-21-output43')},
  {id:'diagnostic-navigation-user-and-driver',status:'passed',evidence:evidence('diagnostic-jumps-from-user-to-driver-5-18','diagnostic-jumps-from-driver-to-user-3-31'),operationFacts:'browser/operation-facts.json'},
  {id:'copy-user-source-excludes-driver',status:'passed',evidence:evidence('copy-user-source-excludes-driver'),operationFacts:'browser/operation-facts.json'},
  {id:'actual-full-file-export-import-four-fields',status:'passed',evidence:evidence('actual-complete-draft-download','actual-file-reimport-restores-all-fields'),downloadedBytes:'browser/downloaded-complete-draft.json'},
  {id:'unsupported-import-version-preserves-draft',status:'passed',evidence:evidence('invalid-import-rejected-original-user-preserved'),operationFacts:'browser/operation-facts.json'},
  {id:'page-reopen-restores-saved-draft',status:'passed',evidence:evidence('page-reopened-restores-revision13')},
  {id:'two-window-CAS-retry-recovery-and-original-preservation',status:'passed',evidence:evidence('conflict-b-opened-version13','conflict-a-saved-version14','conflict-b-cas-rejected-keeps-unsaved-text','conflict-b-retry-still-rejected','conflict-recovery-reopened','conflict-main-reopened-preserves-a-version14'),fields:'browser/conflict-results.json'},
  {id:'old-debug-snapshot-breakpoint-display',status:'failed',defect:'VAL-004',owner:'04 UI',severity:'P2',evidence:evidence('stale-snapshot-breakpoint-panel-after-editing-breakpoints','val004-minimal-breakpoint4-i0-bound','val004-minimal-readonly-snapshot-falsely-no-breakpoints','val004-minimal-hidden-breakpoint-still-stops-i1'),details:'browser/val004-minimal-results.json'}
];
await saveJSON('browser/results.json',{testedTag:tag,testedRevision:revision,environment:'Desktop IAB; browser engine version not collected',ipadTested:false,networkDisabled:false,internalBuildSessionIdsCollected:false,workflows,pending:['Browser-injected late responses (only controlled module coverage exists)','Full narrow layout, physical keyboard, Chinese IME, touch, multitasking and background','Real iPad offline cold start with auxiliary computer off','Process force-kill, quota eviction and final asynchronous save reliability','Installation and whole application resource upgrades']});

const paths = git('ls-files','--','ui/probe.html','ui/style.css','ui/src','ui/scripts/prepare-probe.mjs','ui/scripts/serve-probe.mjs','storage/src','app/integration/candidate.mjs','contracts/capabilities.json').split('\n').filter(Boolean);
const sourceFiles = [];
for (const path of paths) {
  const bytes = await readFile(new URL(path,root));
  const tagBytes = gitBytes('show',revision+':'+path);
  const lfMatch = bytes.toString('utf8').replace(/\r\n/g,'\n')===tagBytes.toString('utf8').replace(/\r\n/g,'\n');
  assert(lfMatch,'Source differs from tag: '+path);
  sourceFiles.push({...record(path,bytes),tagBlob:git('rev-parse',revision+':'+path),tagBlobSHA256:sha(tagBytes),equalAfterLFNormalization:lfMatch});
}
const candidateBytes = await readFile(new URL('ui/.local/candidate.json',root));
const candidate = JSON.parse(candidateBytes);
assert.equal(candidate.profile.compatibilityId,'integration-prototype-cf02b4efe9477db1');
assert.equal(candidate.profile.resourceManifestHash,'sha256:cf02b4efe9477db1eeda5a0d36a1066dbf67aaf6f3785c31666980ee303911ec');
assert.equal(candidate.resources.length,30);
await saveJSON('provenance.json',{recordedAt:new Date().toISOString(),timezone:'Asia/Shanghai',testedTag:tag,testedRevision:revision,headAtSeal:git('rev-parse','HEAD'),productDiffFromTag:'',environment:{node:process.version,platform:platform(),release:release(),arch:arch(),ipadTested:false,networkDisabled:false},launch:{command:"$env:UI_PROBE_PORT='4194'; npm.cmd --prefix '<05 worktree>' start",url:'http://127.0.0.1:4194/ui/probe.html',host:'static files only; compiler and runtime run in browser workers'},profile:candidate.profile,resourceCount:30,preparedCandidate:record('ui/.local/candidate.json',candidateBytes),sourceFiles,scope:'30 engine resources plus separately fingerprinted UI/storage/development host; not a complete product offline package'});
await saveJSON('summary.json',{schemaVersion:1,owner:'05 independent validation',testedTag:tag,testedRevision:revision,runDatesAsiaShanghai:['2026-10-25','2026-10-26'],evidenceDirectoryStartedOn:'2026-10-25',automated:{passed:160,failed:0,allCommandsExitZero:true,evidence:'automated/summary.json',warning:'Includes contracts and fault injection; not 160 user/device workflows'},browser:{evidence:'browser/results.json',domObservationCount:observations.observations.length,newDefects:['VAL-004'],result:'Executed desktop workflows passed except old snapshot breakpoint display; full UI acceptance not signed'},history:{manifests:9,matchedRecords:107,evidence:'review/history-integrity.json'},keyValues:'review/key-values.json',overall:'Incomplete acceptance: VAL-004 open and G2/G3 pending',productSourceModified:false,productFixImplemented:false,documentation:'docs/validation/ui-person05-v0.3.0-2026-10-26.md'});

async function list(url,prefix='') {
  const result=[];
  for (const entry of await readdir(url,{withFileTypes:true})) {
    const relative=prefix+entry.name;
    if(entry.isDirectory())result.push(...await list(new URL(entry.name+'/',url),relative+'/'));
    else if(relative!=='SHA256SUMS.json')result.push(relative);
  }
  return result.sort();
}
const seal=[];
for(const file of await list(here))seal.push(record(file,await readFile(new URL(file,here))));
await saveJSON('SHA256SUMS.json',seal);
await verifyRecords(seal,here);
console.log(`Sealed ${seal.length} run files; automated 160/160; browser VAL-004 failed; history 107 records unchanged.`);
