// One completed VAL-004 independent run. --verify never writes evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {platform,release,arch} from 'node:os';
const here=new URL('./',import.meta.url),root=new URL('../../../',here);
const repo=fileURLToPath(root).replace(/[\\/]$/,'');
const revision='87973fa01b4e7065dd5a9f4a3c97c117d9e7d617';
const base='b4973e177ff6b29583fccb666fbba8f0cd1efa89';
const prefix='tests/evidence/integrated-person05-val004-87973fa-2026-10-26/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async(path,from=here)=>JSON.parse(await readFile(new URL(path,from),'utf8'));
const save=(path,value)=>writeFile(new URL(path,here),JSON.stringify(value,null,2)+'\n');
const gitBytes=(...args)=>execFileSync('git',['-c',`safe.directory=${repo}`,'-C',repo,...args],{windowsHide:true,maxBuffer:16*1024*1024});
const git=(...args)=>gitBytes(...args).toString('utf8').trim();
const digest=(file,bytes)=>({file,byteLength:bytes.length,sha256:hash(bytes)});
async function verify(entries,from){for(const entry of entries){const bytes=await readFile(new URL(entry.file,from));assert.equal(bytes.length,entry.byteLength,entry.file+' length');assert.equal(hash(bytes),entry.sha256,entry.file+' hash');}}
assert.equal(git('rev-parse','integration-v0.4.0'),base);
assert.equal(git('diff',revision,'--','package.json','package-lock.json','app','scripts','ui','storage','compiler','debugger','contracts'),'','Product differs from fixed revision');
const oldRoot=new URL('tests/evidence/integrated-person05-v0.3.0-2026-10-25/',root);
const oldSeal=await json('SHA256SUMS.json',oldRoot);
assert.equal(oldSeal.length,48);await verify(oldSeal,oldRoot);
const automatedSeal=await json('automated/SHA256SUMS.json');
assert.equal(automatedSeal.length,29);await verify(automatedSeal,new URL('automated/',here));
const historical=await json('review/all-history-integrity.json');
assert.equal(historical.summary.allPassed,true);assert.equal(historical.summary.passedRecords,235);
await verify(historical.manifestFiles,root);
if(process.argv.includes('--verify')){
  const seal=await json('SHA256SUMS.json');await verify(seal,here);
  if(process.argv.includes('--git'))for(const entry of seal){const bytes=gitBytes('show','HEAD:'+prefix+entry.file);assert.equal(bytes.length,entry.byteLength,entry.file+' Git length');assert.equal(hash(bytes),entry.sha256,entry.file+' Git hash');}
  console.log(`Verified ${seal.length} new sealed files, 29 automated records, 48 original v0.3.0 records${process.argv.includes('--git')?' and committed bytes':''}.`);process.exit(0);
}
try{await access(new URL('SHA256SUMS.json',here));throw Error('Already sealed; use --verify');}catch(error){if(error.code!=='ENOENT')throw error;}
const automatic=await json('automated/summary.json');
assert.equal(automatic.testedRevision??automatic.testedCommit,revision);assert(automatic.allCommandsPassed);assert.equal(automatic.counts.deduplicatedPassed,170);assert.equal(automatic.counts.deduplicatedFailed,0);
const record=await json('browser/observations.json');assert.equal(record.testedRevision,revision);
const observations=record.observations,map=new Map(observations.map((item,index)=>[item.step,{...item,index}]));
const get=step=>{assert(map.has(step),'Missing '+step);return map.get(step);};
const marked=o=>o.gutters.filter(line=>line.bp==='true').map(line=>line.line);
const snapshot=step=>{const o=get(step);assert.equal(o.editor.readOnly,true);assert(o.gutters.length>0);assert(o.gutters.every(line=>line.disabled));assert(o.dom.includes('button "在当前行切换断点" [disabled]'));return o;};
const oldSource=(await readFile(new URL('fixtures/regressions/ui-stale-breakpoints.cpp',root),'utf8')).replace(/\r\n/g,'\n');
const initial=get('minimal-breakpoint4-i0');assert.deepEqual(marked(initial),['4']);assert.match(initial.dom,/code: i\n\s+- emphasis: int\n\s+- text: "0"/);
assert.deepEqual(marked(snapshot('unchanged-source-snapshot-readonly')),['4']);
const empty=get('dirty-draft-breakpoints-removed');assert.deepEqual(marked(empty),[]);assert.equal(empty.editor.readOnly,false);assert(empty.dom.includes('编辑稿没有断点；变更在下次编译生效。'));
const fixed=snapshot('repaired-snapshot-retains-bound4-after-draft-removal');assert.equal(fixed.editor.value,oldSource);assert.deepEqual(marked(fixed),['4']);assert(fixed.dom.includes('main.cpp:4:1 · 已绑定 → main.cpp:4:1'));assert(!fixed.dom.includes('尚未设置断点。'));
const continued=snapshot('repaired-snapshot-continue-i1-bound4-visible');assert.deepEqual(marked(continued),['4']);assert.match(continued.dom,/code: i\n\s+- emphasis: int\n\s+- text: "1"/);assert(continued.dom.includes('main.cpp:4:1 · 已绑定 → main.cpp:4:1'));
const pending=get('dirty-draft-new6-pending-not-old4');assert.deepEqual(marked(pending),['6']);assert(pending.dom.includes('main.cpp:6:1 · 待绑定'));assert.deepEqual(marked(snapshot('snapshot-old4-not-new-draft6')),['4']);
const fresh=get('new-build-entry2-empty-breakpoints');assert.deepEqual(marked(fresh),[]);assert(fresh.dom.includes('已暂停 · main.cpp:2:1'));
const exited=get('new-build-no-old-breakpoint-exits3');assert(exited.dom.includes('程序输出 exit · 返回 3'));assert(exited.dom.includes('button "继续" [disabled]'));assert.deepEqual(marked(exited),[]);
assert.deepEqual(marked(snapshot('two-file-snapshot-driver3-only-gutter-marked')),['3']);assert.deepEqual(marked(snapshot('two-file-snapshot-user2-only-gutter-marked')),['2']);
const dual=snapshot('two-file-old-user2-binding-retained');assert.deepEqual(marked(dual),['2']);assert(dual.dom.includes('user.inc:2:1 · 已绑定'));assert(dual.dom.includes('driver.cpp:3:1 · 已绑定'));
const dualContinued=snapshot('two-file-continue-real-user2-input8');assert(dualContinued.dom.includes('已暂停 · user.inc:2:1'));assert.match(dualContinued.dom,/code: input\n\s+- emphasis: int\n\s+- text: "8"/);
const checks=[
  ['original-seven-line-failure-sequence-fixed',['minimal-breakpoint4-i0','dirty-draft-breakpoints-removed','repaired-snapshot-retains-bound4-after-draft-removal','repaired-snapshot-continue-i1-bound4-visible']],
  ['same-source-snapshot-readonly',['unchanged-source-snapshot-readonly']],
  ['new-draft6-isolated-from-old-snapshot4',['dirty-draft-new6-pending-not-old4','snapshot-old4-not-new-draft6']],
  ['stop-recompile-does-not-carry-old-breakpoints',['new-build-entry2-empty-breakpoints','new-build-no-old-breakpoint-exits3']],
  ['user-driver-file-markers-and-real-breakpoint',['two-file-snapshot-driver3-only-gutter-marked','two-file-snapshot-user2-only-gutter-marked','two-file-old-user2-binding-retained','two-file-continue-real-user2-input8']]
].map(([id,steps])=>({id,status:'passed',observations:steps.map(step=>({step,index:get(step).index}))}));
await save('browser/results.json',{testedRevision:revision,scope:'Independent real desktop browser; no internal session ID access or synthetic adapter events',checks,defect:'VAL-004',conclusion:'Confirmed fixed on this commit in tested desktop scope',collectionNotes:['First observation has no gutter metadata because the generic role locator matched no controls; later #gutter observations supply marker proof.','Initial two-file trial requested main.cpp:2 before the driver existed; stopped and cleared requests, then tested corrected user.inc:2 / driver.cpp:3 setup.','An incorrect expected exit-heading label timed out; actual subsequent DOM explicitly shows exit return 3. No product failure inferred.'],notRetested:['Real iPad offline/G2/G3','New immutable offline package or v0.4.0 offline browser increment','Actual IndexedDB import/export or cross-window workflow this round','Injected late same-source old-session events/resync DOM updates','Restoring dirty source to original bytes and associated wording']});
const paths=git('ls-files','--','ui/probe.html','ui/style.css','ui/src','ui/scripts/prepare-probe.mjs','ui/scripts/serve-probe.mjs','storage/src','app/integration/candidate.mjs').split('\n').filter(Boolean),sourceFiles=[];
for(const path of paths){const bytes=await readFile(new URL(path,root)),fixedBytes=gitBytes('show',revision+':'+path);assert.equal(bytes.toString('utf8').replace(/\r\n/g,'\n'),fixedBytes.toString('utf8').replace(/\r\n/g,'\n'),path+' source');sourceFiles.push({...digest(path,bytes),fixedGitBlob:git('rev-parse',revision+':'+path),fixedGitBlobSHA256:hash(fixedBytes),equalAfterLFNormalization:true});}
const candidateBytes=await readFile(new URL('ui/.local/candidate.json',root)),candidate=JSON.parse(candidateBytes);assert.equal(candidate.resources.length,30);
await save('provenance.json',{recordedAt:new Date().toISOString(),timezone:'Asia/Shanghai',testedRevision:revision,baseTag:'integration-v0.4.0',baseRevision:base,testedBranch:'module/04-ui',headAtSeal:git('rev-parse','HEAD'),productDiffFromCommit:'',environment:{node:process.version,platform:platform(),release:release(),arch:arch(),browser:'Codex IAB; engine version not collected',ipadTested:false,networkDisabled:false},launch:{command:"$env:UI_PROBE_PORT='4205'; npm.cmd --prefix '<05 worktree>' start",url:'http://127.0.0.1:4205/ui/probe.html',host:'static files only'},engineProfile:candidate.profile,engineResourceCount:30,preparedCandidate:digest('ui/.local/candidate.json',candidateBytes),sourceFiles,offlinePackageRebuiltOrAccepted:false});
await save('summary.json',{schemaVersion:1,owner:'05 independent validation',dateAsiaShanghai:'2026-10-26',testedRevision:revision,baseTag:'integration-v0.4.0',result:'VAL-004 confirmed fixed on this commit within tested desktop scope',automatic:{passed:170,failed:0,allCommandsExitZero:true,evidence:'automated/summary.json',warning:'Includes contracts and fault injection; not 170 device/user workflows'},browser:{checksPassed:checks.length,failed:0,domObservations:observations.length,evidence:'browser/results.json'},history:{originalV03RootRecords:48,originalFailureUnchanged:true,evidence:'automated/history-preservation.json',additionalAudit:'review/all-history-integrity.json'},integrationOrNewOfflineReleaseVerified:false,realIpadVerified:false,productModified:false,report:'docs/validation/val004-person05-87973fa-2026-10-26.md'});
async function list(url,prefix=''){const result=[];for(const entry of await readdir(url,{withFileTypes:true})){const path=prefix+entry.name;if(entry.isDirectory())result.push(...await list(new URL(entry.name+'/',url),path+'/'));else if(path!=='SHA256SUMS.json')result.push(path);}return result.sort();}
const seal=[];for(const file of await list(here))seal.push(digest(file,await readFile(new URL(file,here))));await save('SHA256SUMS.json',seal);await verify(seal,here);
console.log(`Sealed ${seal.length} files; 170 automatic checks and ${checks.length} independent browser workflow groups passed; old failure retained.`);
