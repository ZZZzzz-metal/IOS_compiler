import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=fileURLToPath(new URL('./',import.meta.url)),root=resolve(directory,'../../../..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const row=async(file,base)=>{const bytes=await readFile(resolve(base,file));return {file,byteLength:bytes.length,sha256:digest(bytes)};};
const paths=['AGENTS.md','README.md','package.json','package-lock.json','app/main.mjs',
 'app/offline/build.mjs','app/offline/serve.mjs','app/offline/browser/worker-template.js',
 'app/offline/browser/index.html','app/offline/browser/launcher.mjs','app/offline/browser/trust.mjs',
 'app/offline/checks/worker.test.mjs','ui/probe.html','ui/style.css','ui/src/main.mjs',
 'ui/src/editor.mjs','ui/src/session-controller.mjs','ui/checks/import-order.test.mjs','ui/checks/preparation-gate.test.mjs',
 'storage/src/draft-store.mjs','storage/src/autosave.mjs','debugger/src/variables.mjs','debugger/src/worker-adapter.mjs',
 'docs/architecture/IPAD-USER-MANUAL.md','docs/architecture/IPAD-UPDATE-v0.4.3.md',
 'docs/architecture/UI-RACE-INTEGRATION-2026-10-27.md','docs/architecture/STATUS.md','docs/architecture/GATES.md',
 'docs/architecture/START-HERE.md','docs/handoffs/01.md','contracts/capabilities.json',
 'contracts/compatibility-profiles.json','contracts/offline-bundle.json'];
if(!process.argv.includes('--verify')){
 await writeFile(resolve(directory,'source-inputs.json'),JSON.stringify({
  schemaVersion:1,sourceBaseRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  deliveredUICommit:'66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9',
  scope:'Actual working-tree bytes for integrated UI, unchanged engine/trust inputs and root metadata/manual. The base commit contains delivered UI fixes; dirty root increments are separately fingerprinted here and in bundle resource hashes.',
  sources:await Promise.all(paths.map(file=>row(file,root)))
 },null,2)+'\n',{flag:'wx'});
 const files=(await readdir(directory,{withFileTypes:true})).filter(item=>item.isFile()&&item.name!=='SHA256SUMS.json').map(item=>item.name).sort();
 await writeFile(resolve(directory,'SHA256SUMS.json'),JSON.stringify(await Promise.all(files.map(file=>row(file,directory))),null,2)+'\n',{flag:'wx'});
}
const sources=JSON.parse(await readFile(resolve(directory,'source-inputs.json'),'utf8')).sources;
const evidence=JSON.parse(await readFile(resolve(directory,'SHA256SUMS.json'),'utf8'));
for(const expected of sources)assert.deepEqual(await row(expected.file,root),expected);
for(const expected of evidence)assert.deepEqual(await row(expected.file,directory),expected);
assert.deepEqual((await readdir(directory)).filter(file=>file!=='SHA256SUMS.json').sort(),evidence.map(item=>item.file).sort());
console.log(JSON.stringify({sourceFiles:sources.length,evidenceFiles:evidence.length,hashes:'all matched',scope:'Byte seal only. REV-004/005 await person05 independent verification; iPad/G2 unverified.'}));
