import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=fileURLToPath(new URL('./',import.meta.url)),root=resolve(directory,'../../../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const row=async(file,base)=>{const bytes=await readFile(resolve(base,file));return{file,byteLength:bytes.length,sha256:hash(bytes)};};
const old=JSON.parse(await readFile(resolve(root,'app/offline/evidence/ui-race-integration-2026-10-27/source-inputs.json'),'utf8'));
const paths=[...new Set([...old.sources.map(x=>x.file.replace('IPAD-UPDATE-v0.4.3.md','IPAD-UPDATE-v0.4.4.md').replace('UI-RACE-INTEGRATION-2026-10-27.md','WATCH-PUBLICATION-INTEGRATION-2026-10-27.md')),'debugger/checks/watch-semantics.test.mjs','tests/ui-concurrency-independent.mjs','docs/architecture/PROJECT-RETROSPECTIVE-2026-10-27.md',...(await readdir(resolve(root,'docs/architecture/original-plan'))).map(x=>'docs/architecture/original-plan/'+x)])];
if(!process.argv.includes('--verify')){
 const pkg=JSON.parse(await readFile(resolve(root,'package.json'))),lock=JSON.parse(await readFile(resolve(root,'package-lock.json')));
 assert.equal(pkg.version,'0.4.4');assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 const build=JSON.parse(await readFile(resolve(directory,'build.json'))),descriptor=JSON.parse(await readFile(resolve(directory,'bundle.json')));
 assert.equal(build.bundleId,'ipad-web-probe-40b0be1b9616e4ec152be87a');
 const manual=await readFile(resolve(root,'docs/architecture/IPAD-USER-MANUAL.md')),resource=descriptor.resources.find(x=>x.path==='IPAD-USER-MANUAL.md');
 assert.equal('sha256:'+hash(manual),resource.sha256);assert.equal(manual.length,resource.byteLength);
 const plan=JSON.parse(await readFile(resolve(root,'docs/architecture/original-plan/SHA256SUMS.json')));
 for(const item of plan){const actual=await row(item.path,resolve(root,'docs/architecture/original-plan'));assert.equal(actual.sha256,item.sha256);assert.equal(actual.byteLength,item.byteLength);}
 await writeFile(resolve(directory,'source-inputs.json'),JSON.stringify({schemaVersion:1,sourceBaseRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),scope:'Actual working-tree bytes sealed after integration, browser and archive checks. Source base contains both delivered modules; root increments are explicitly fingerprinted. Product capabilities and device acceptance are not changed.',sources:await Promise.all(paths.map(p=>row(p,root)))},null,2)+'\n',{flag:'wx'});
 const files=(await readdir(directory,{withFileTypes:true})).filter(x=>x.isFile()&&x.name!=='SHA256SUMS.json').map(x=>x.name).sort();
 await writeFile(resolve(directory,'SHA256SUMS.json'),JSON.stringify(await Promise.all(files.map(p=>row(p,directory))),null,2)+'\n',{flag:'wx'});
}
const sources=JSON.parse(await readFile(resolve(directory,'source-inputs.json'))).sources,evidence=JSON.parse(await readFile(resolve(directory,'SHA256SUMS.json')));
for(const item of sources)assert.deepEqual(await row(item.file,root),item);
for(const item of evidence)assert.deepEqual(await row(item.file,directory),item);
assert.deepEqual((await readdir(directory)).filter(x=>x!=='SHA256SUMS.json').sort(),evidence.map(x=>x.file).sort());
console.log(JSON.stringify({sourceFiles:sources.length,evidenceFiles:evidence.length,hashes:'all matched',scope:'Root integration verification only; new debugger/complete offline release await person05, real iPad/G2/G3 pending.'}));
