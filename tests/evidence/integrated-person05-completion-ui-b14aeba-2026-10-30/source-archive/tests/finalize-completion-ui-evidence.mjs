// One-shot final collection. Existing raw runs are never rewritten.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,copyFile,constants} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const evidence=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30');
const target='b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const gitArgs=['-c',`safe.directory=${root.replaceAll('\\','/')}`];
function git(...args){const run=spawnSync('git',[...gitArgs,...args],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(run.status,0,run.stderr);return run.stdout;}
assert.equal(git('rev-parse','HEAD').trim(),target);
const productPaths=['compiler','debugger','storage','ui','app','contracts','scripts','package.json','package-lock.json'];
assert.equal(git('diff','HEAD','--',...productPaths),'');
assert.equal(git('ls-files','--others','--exclude-standard','--',...productPaths),'');
const mandatory=resolve(evidence,'mandatory');await mkdir(mandatory);
const commands=[];
for(const [id,command] of [['check','npm.cmd run check'],['test','npm.cmd test']]){
 const begin=new Date().toISOString();
 const run=spawnSync('cmd.exe',['/d','/s','/c',command],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,timeout:600000});
 const data={command,cwd:root,target,begin,end:new Date().toISOString(),exitCode:run.status,signal:run.signal,error:run.error?.message??null};
 await writeFile(resolve(mandatory,id+'.stdout.txt'),run.stdout??'',{flag:'wx'});
 await writeFile(resolve(mandatory,id+'.stderr.txt'),run.stderr??'',{flag:'wx'});
 await writeFile(resolve(mandatory,id+'.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
 commands.push(data);assert.equal(run.status,0,command);
}
await writeFile(resolve(mandatory,'commands.json'),JSON.stringify(commands,null,2)+'\n',{flag:'wx'});
const browser=JSON.parse(await readFile(resolve(evidence,'browser/verification.json'),'utf8'));
const races=JSON.parse(await readFile(resolve(evidence,'controlled-races/run02/results.json'),'utf8'));
const edit=JSON.parse(await readFile(resolve(evidence,'controlled-edit/results.json'),'utf8'));
const negative=JSON.parse(await readFile(resolve(evidence,'controlled-negative/results.json'),'utf8'));
assert.equal(races.failed,0);assert.equal(edit.failed,0);assert.equal(negative.failed,0);assert.equal(browser.failed,0);assert.equal(browser.checks,251);
const inputs=['tests/audit-completion-package-independent.mjs','tests/audit-completion-history-independent.mjs',
 'tests/completion-browser-host.mjs','tests/completion-ui-edit-independent.mjs','tests/completion-ui-races-independent.mjs',
 'tests/completion-ui-negative-independent.mjs','tests/lib/completion-race-dom.mjs',
 'tests/run-completion-ui-stage-checks.mjs','tests/verify-completion-browser-evidence.mjs',
 'tests/finalize-completion-ui-evidence.mjs','tests/seal-integrated-round.mjs',
 'ui/src/completion-controller.mjs','ui/src/completion-editor.mjs','ui/src/completion-edit.mjs','ui/src/completion-popup.mjs',
 'ui/src/main.mjs','ui/probe.html','ui/style.css','contracts/completion.d.ts','contracts/README.md',
 'docs/validation/completion-ui-person05-b14aeba-2026-10-30.md','docs/handoffs/05.md'];
const fingerprints=[];
for(const file of inputs){
 const bytes=await readFile(resolve(root,file)),copy=resolve(evidence,'source-archive',file);
 await mkdir(dirname(copy),{recursive:true});await copyFile(resolve(root,file),copy,constants.COPYFILE_EXCL);
 fingerprints.push({file,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(resolve(evidence,'source-fingerprints.json'),JSON.stringify(fingerprints,null,2)+'\n',{flag:'wx'});
const observations=(await readdir(resolve(evidence,'browser'))).filter(f=>/^\d{3}-.+\.json$/.test(f));assert.equal(observations.length,42);
await writeFile(resolve(evidence,'browser/attempts-and-scope.json'),JSON.stringify({
 actualObservations:observations.sort(),observationCount:42,
 labelNote:'Early REPL closure captured an older numbering value: duplicate002, no005. Names and files are unique. No original record was overwritten.',
 exploratoryObservation:'015 contains ended/exit17 after two step attempts. Its expectation is not a passed assertion. 016 independently proves line4 breakpoint and alphaValue17.',
 retainedDOM:'popup.outerHTML includes hidden retained DOM. Visible body/AX and explicit geometry determine visibility, not existence alone.',
 infrastructureAttempts:[
  'First static host was sandbox-bound: browser timed out; no product evidence from that attempt. It was stopped, and only the authorized loopback server02 was used.',
  'Recovery used documented browser handles after a REPL redeclaration invalidated a variable; product pages were not reset or patched.',
  'AX exposed aria-pressed snapshot buttons as checkbox; DOM snapshot corrected locator. The active label changes to return-to-edit, and the locator was updated.',
  'First geometry read used nonexistent footer class; actual observed completion-hint was used for the saved successful geometry.',
  'Actual file chooser waited for approval. The human cleared it and the tool returned successful import; completion/run/save followed afterward.',
  'Reading the initial temporary data error page for cleanup was blocked by the browser URL policy; it was not read further or marked to persist.'
 ],
 scope:'Desktop IAB, own static server stopped with listener0. No OS physical disconnection, Safari/iPad, physical IME/touch or strong durability claim. Product workbench tabs closed and viewport reset.'
},null,2)+'\n',{flag:'wx'});
const result={requestId:'CC-20261029-05',target,kind:'DONE-INDEPENDENT-UI-PACKAGE',
 knownBackendReuse:'bddae576 actual60 responses; unchanged35 resources/API/dependency implementations',
 currentOriginal33:{passed:32,boundaryFailed:1,pendingUi:0,note:'Old29/1/3 summary preserved verbatim; these3 UI outcomes are added only here.'},
 extraAvailabilityScenario:{boundaryFailed:1,withinOriginal33:false},
 newConfirmedProductDefects:[],mandatory:commands,
 controlled:{races:{scenarios:races.scenarioCount,assertions:races.assertions,passed:races.passed},edit:{scenarios:edit.scenarios,assertions:edit.checks,passed:edit.passed},negative:{scenarios:3,assertions:12,source:'controlled-negative/results.json'}},
 browser:{observationCount:42,evidenceAssertions:browser.checks,verification:'browser/verification.json'},
 limitations:['const-string append remains confirmable despite invalid actual call','unavailable attribute candidate remains confirmable','real iPad/Safari/physical IME/touch/offline/install/eviction/durability/G2/G3 pending'],
 conclusion:'Independent tested desktop prototype scope passed with explicit known boundaries. Root integration and limited ACCEPT are separate; no complete product acceptance.'};
await writeFile(resolve(evidence,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(evidence,'README.md'),'# Person05 final completion UI and package evidence\n\nFixed b14aebab, v0.4.6 bundle cbe80b74ccc3d3cebece9e73. See result.json and the archived validation report for scope. Raw first failures, discarded hypotheses, hidden DOM and known semantic boundaries are retained. Existing evidence directories are untouched. SHA256SUMS seals every file except itself.\n',{flag:'wx'});
await writeFile(resolve(evidence,'.gitattributes'),'* -text\n',{flag:'wx'});
assert.equal(git('diff','HEAD','--',...productPaths),'');
console.log(JSON.stringify({target,mandatory:commands.map(x=>x.exitCode),races:races.passed,edit:edit.passed,browserObservations:42,newConfirmedProductDefects:0,output:relative(root,evidence)},null,2));
