import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCandidate,MODULE_FILES} from './candidate.mjs';
const root=new URL('../../',import.meta.url),compilerRoot=new URL('../../../ipad-debugger-02/compiler/',import.meta.url);
const candidate=await createCandidate();
await writeFile(new URL('debugger/probe-candidate.json',root),JSON.stringify({profile:candidate.profile,resources:candidate.resources},null,2)+'\n');
const compilerPackage=JSON.parse(await readFile(new URL('probe-package.json',compilerRoot),'utf8'));
const compilerFiles=compilerPackage.resources.map(r=>['debugger/compiler/'+r.path,new URL(r.path,compilerRoot)]);
const own=[...MODULE_FILES,'debugger/probe.html','debugger/probe-page.mjs','debugger/probe-candidate.json',
  'debugger/fixtures/debug-handoff/snapshot.json'];
const resources=[];
for(const [path,url] of [...own.map(path=>[path,new URL(path,root)]),...compilerFiles]) {
  const bytes=await readFile(url);resources.push({path,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const logic=await readFile(new URL('debugger/src/service-worker-template.js',root),'utf8');
const version=createHash('sha256').update(JSON.stringify(resources)).update(logic).digest('hex');
await writeFile(new URL('debugger/service-worker.js',root),`const VERSION=${JSON.stringify(version)};\nconst RESOURCES=${JSON.stringify(resources,null,2)};\n`+logic);
await writeFile(new URL('debugger/probe-package.json',root),JSON.stringify({schemaVersion:1,version,
  scope:'debugger-module-experiment-not-product-bundle',byteLength:resources.reduce((s,r)=>s+r.byteLength,0),resources},null,2)+'\n');
console.log(`Browser joint probe: ${resources.length} checked files, ${resources.reduce((s,r)=>s+r.byteLength,0)} bytes; ${version}`);
