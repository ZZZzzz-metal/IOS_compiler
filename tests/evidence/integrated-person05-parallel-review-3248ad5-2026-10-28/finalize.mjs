// Freeze completed role-05 evidence. Never rewrites an existing seal or old rounds.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=new URL('./',import.meta.url),repo=new URL('../../../',here);
const prefix='tests/evidence/integrated-person05-parallel-review-3248ad5-2026-10-28/';
const revision='3248ad54faa5f0f3a8b6f6501829e95e4699f066';
const product=['package.json','package-lock.json','app','scripts','compiler','debugger','ui','storage','contracts'];
const gitBytes=(...args)=>execFileSync('git',['-c',`safe.directory=${fileURLToPath(repo)}`,'-C',fileURLToPath(repo),...args],{maxBuffer:32*1024*1024});
const git=(...args)=>gitBytes(...args).toString('utf8').trim();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async(file,base=here)=>JSON.parse(await readFile(new URL(file,base),'utf8'));
const save=(file,data)=>writeFile(new URL(file,here),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const digest=(file,bytes)=>({file,byteLength:bytes.length,sha256:sha(bytes)});
async function verify(entries,base,fromGit=false){for(const e of entries){const b=fromGit?gitBytes('show','HEAD:'+prefix+e.file):await readFile(new URL(e.file,base));assert.equal(b.length,e.byteLength,e.file+' size');assert.equal(sha(b),e.sha256,e.file+' SHA256');}}
assert.equal(git('diff',revision,'--',...product),'','Product source must equal fixed baseline');
if(process.argv.includes('--verify')){
 const entries=await json('SHA256SUMS.json');await verify(entries,here);
 if(process.argv.includes('--git'))await verify(entries,here,true);
 console.log(`Verified ${entries.length} sealed evidence files${process.argv.includes('--git')?' including committed Git bytes':''}`);process.exit(0);
}
try{await access(new URL('SHA256SUMS.json',here));throw Error('Already sealed; use --verify');}catch(e){if(e.code!=='ENOENT')throw e;}
const automatic=await json('automated/summary.json'),engine=await json('engine/run-01/results.json');
assert.equal(automatic.testedRevision,revision);assert(automatic.allCommandsPassed);assert.equal(automatic.commands.length,10);assert.equal(automatic.counts.deduplicatedPassed,230);assert.equal(automatic.counts.deduplicatedFailed,0);assert.equal(automatic.counts.separateOfflineWorkerCounts.passed,22);
assert.equal(engine.revision,revision);assert.deepEqual(engine.counts,{passed:14,failed:11,boundaryOnly:1});
const ui=await json('ui/clipboard-run-02/results.json');assert.equal(ui.revision,revision);
assert.equal(ui.results.length,5);assert.equal(ui.results.filter(r=>r.status==='passed').length,2);assert.equal(ui.results.filter(r=>r.status==='failed').length,3);
const offline=await json('automated/offline-review/report.json');assert.equal(offline.testedRevision,revision);assert.equal(offline.mapping.missingStaticBrowserEdges.length,0);assert.equal(offline.conclusion.realIPadTested,false);
const browser=await json('browser/observations.json');assert.equal(browser.testedRevision,revision);assert.equal(browser.observations.length,24);
const find=step=>{const o=browser.observations.find(o=>o.step===step);assert(o,step);return o;};
for(const step of ['ctrl0-stored-total11-at9','F10-stores-total11']){assert.equal(find(step).fields.bodyData.executionState,'paused');assert.match(find(step).dom,/11/);}
for(const step of ['ctrl6-real-run-output11-exit0','control-F5-run-output11-exit0']){assert.equal(find(step).fields.bodyData.executionState,'terminated');assert.match(find(step).dom,/person05-key=11/);}
assert.equal(find('standard-scheme-and-source-persist-after-reload').fields.shortcutScheme,'standard');
await writeFile(new URL('browser/keyboard-source.cpp',here),browser.observations[0].fields.source,{flag:'wx'});
await save('browser/results.json',{testedRevision:revision,observations:24,source:'keyboard-source.cpp',result:'Two seven-action shortcut schemes and recorded focus/unprepared/persistence controls passed in actual desktop IAB',steps:browser.observations.map(o=>({step:o.step,at:o.at,state:o.fields.bodyData.executionState,scheme:o.fields.shortcutScheme})),realCompilerAndDebugger:true,clipboardRaceTestedInBrowser:false,browserEngineVersionCollected:false,physicalKeyboardTested:false,ipadTested:false,networkDisabled:false,fullOfflineBundleTested:false});
const files=git('ls-files','--',...product).split('\n').filter(Boolean),fingerprints=[];
for(const file of files){const b=await readFile(new URL(file,repo)),target=gitBytes('show',revision+':'+file);assert.equal(b.toString('utf8').replace(/\r\n/g,'\n'),target.toString('utf8').replace(/\r\n/g,'\n'),file);fingerprints.push({...digest(file,b),gitBlob:git('rev-parse',revision+':'+file),gitSHA256:sha(target),equalAfterLFNormalization:true});}
await save('provenance.json',{testedRevision:revision,recordedAt:new Date().toISOString(),productDiffFromCommit:'',engineProfile:engine.profile,productFiles:fingerprints,originalEngineHarness:'engine/watch-types-run01.mjs',currentHarnessAdaptation:'tests/watch-types-independent.mjs supports explicit fixed product root/revision/profile; assertions and generated C++ checks retained',offlineBundleBuiltOrAccepted:false});
// Validate existing manifest formats we can resolve, without editing their files.
const manifests=git('ls-files','--','tests/evidence/**/SHA256SUMS.json').split('\n').filter(f=>f&&!f.startsWith(prefix));
const history=[],skipped=[];
for(const file of manifests){const base=new URL(file.replace(/[^/]+$/,''),repo),data=await json(file,repo);if(!Array.isArray(data)||!data.every(e=>typeof e.file==='string'&&typeof e.sha256==='string'&&Number.isInteger(e.byteLength))){skipped.push(file);continue;}await verify(data,base);history.push({manifest:file,entries:data.length,verified:true});}
assert.equal(git('diff','HEAD','--','tests/evidence'),'', 'No tracked historical evidence changes');
await save('history-preservation.json',{verifiedAt:new Date().toISOString(),manifests:history,manifestReferences:history.reduce((n,m)=>n+m.entries,0),skippedOtherFormats:skipped,trackedHistoricalEvidenceDiffFromHEAD:'',note:'Each supported manifest resolves relative to its own directory; repeated references are not unique file counts. Git diff also confirms no tracked old evidence changed. This is not a claim to recognize every old manifest schema.'});
await save('summary.json',{testedRevision:revision,dateAsiaShanghai:'2026-10-28',result:'3 new P2 defects confirmed and owners notified; baseline not signed fully stable',defects:[{key:'A',owner:'03',scope:'float32/integer common conversion',failedObservations:7},{key:'B',owner:'03',scope:'NaN truth/short circuit',failedObservations:4},{key:'C',owner:'04',scope:'stale clipboard completion/edit/order/error',failedScenarios:3}],defectNumbering:'Pending owner01 registration',automatic:{passed:230,failed:0,commandsExitZero:10},offlineWorkerSeparate:{passed:22,failed:0},engine:engine.counts,ui:{scenarios:5,passed:2,failed:3,runnerErrors:0},browser:{observations:24,twoShortcutSchemes:true,ipadTested:false},offlineReview:{sourceOnly:true,generatedPackageTested:false},originalFailureEvidencePreserved:true,report:'docs/validation/parallel-review-3248ad5-2026-10-28.md',pending:['Independent fixed03/04 commit retest and integration','REV-001 actual browser offline recovery and full new immutable release','Real iPad complete offline/G2/G3, physical input and full draft durability']});
async function list(url,path=''){const out=[];for(const e of await readdir(url,{withFileTypes:true})){const name=path+e.name;if(e.isDirectory())out.push(...await list(new URL(e.name+'/',url),name+'/'));else if(name!=='SHA256SUMS.json')out.push(name);}return out.sort();}
const entries=[];for(const file of await list(here))entries.push(digest(file,await readFile(new URL(file,here))));await save('SHA256SUMS.json',entries);await verify(entries,here);console.log(`Sealed ${entries.length} files; ${history.length} previous manifests verified`);
