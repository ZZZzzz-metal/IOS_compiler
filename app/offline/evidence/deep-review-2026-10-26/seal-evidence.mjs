// Run once to seal; later use --verify. Refuses to replace existing manifests.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=fileURLToPath(new URL('./',import.meta.url));
const root=resolve(directory,'../../../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const row=async(file,base)=>{const bytes=await readFile(resolve(base,file));return {file,byteLength:bytes.length,sha256:hash(bytes)};};
const sources=['AGENTS.md','README.md','package.json','package-lock.json','app/main.mjs',
 'app/offline/build.mjs','app/offline/serve.mjs','app/offline/browser/worker-template.js',
 'app/offline/browser/index.html','app/offline/browser/launcher.mjs','app/offline/browser/trust.mjs',
 'app/offline/checks/worker.test.mjs','docs/architecture/IPAD-USER-MANUAL.md',
 'docs/architecture/DEEP-REVIEW-2026-10-27.md','docs/architecture/IPAD-UPDATE-v0.4.2.md',
 'docs/architecture/REVIEW-ENGINE-2026-10-27.md','docs/architecture/REVIEW-UI-2026-10-27.md',
 'docs/architecture/STATUS.md','docs/architecture/GATES.md','docs/architecture/START-HERE.md','docs/handoffs/01.md',
 'ui/src/main.mjs','ui/src/editor.mjs','ui/src/session-controller.mjs','storage/src/draft-store.mjs','storage/src/autosave.mjs',
 'debugger/src/variables.mjs','debugger/src/worker-adapter.mjs',
 'contracts/capabilities.json','contracts/compatibility-profiles.json','contracts/offline-bundle.json'];
if(!process.argv.includes('--verify')){
 const sourceRows=await Promise.all(sources.map(file=>row(file,root)));
 const beforeWorker=execFileSync('git',['show','0e7be0b:app/offline/browser/worker-template.js'],{cwd:root});
 await writeFile(resolve(directory,'source-inputs.json'),JSON.stringify({
  schemaVersion:1,sourceBaseRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  scope:'Actual working-tree source bytes for the root fix, reports and unchanged module inputs. Build and archive hashes separately bind the generated payload; base revision excludes uncommitted root changes.',
  preFixWorker:{revision:'0e7be0bbe2fdd53f59db363a2fa3578f7b0003ae',byteLength:beforeWorker.length,sha256:hash(beforeWorker)},sources:sourceRows
 },null,2)+'\n',{flag:'wx'});
 const files=(await readdir(directory,{withFileTypes:true})).filter(item=>item.isFile()&&item.name!=='SHA256SUMS.json').map(item=>item.name).sort();
 await writeFile(resolve(directory,'SHA256SUMS.json'),JSON.stringify(await Promise.all(files.map(file=>row(file,directory))),null,2)+'\n',{flag:'wx'});
}
const rows=JSON.parse(await readFile(resolve(directory,'SHA256SUMS.json'),'utf8'));
for(const expected of rows)assert.deepEqual(await row(expected.file,directory),expected);
const input=JSON.parse(await readFile(resolve(directory,'source-inputs.json'),'utf8'));
for(const expected of input.sources)assert.deepEqual(await row(expected.file,root),expected);
const actualFiles=(await readdir(directory,{withFileTypes:true})).filter(item=>item.isFile()&&item.name!=='SHA256SUMS.json').map(item=>item.name).sort();
assert.deepEqual(actualFiles,rows.map(item=>item.file).sort());
console.log(JSON.stringify({evidenceFiles:rows.length,sourceFiles:input.sources.length,hashes:'all matched',scope:'Sealed bytes only; open defects and device limits remain as documented.'}));
