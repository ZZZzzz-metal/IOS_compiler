import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=fileURLToPath(new URL('../../../../../',import.meta.url));
const output=new URL('report.json',import.meta.url);
const source=file=>fs.readFileSync(path.join(repo,file),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {createIntegrationCandidate}=await import(pathToFileURL(path.join(repo,'app/integration/candidate.mjs')));
const candidate=await createIntegrationCandidate();
const build=source('app/offline/build.mjs');
const payload=new Map(candidate.resources.map(resource=>[resource.relativePath,resource.relativePath]));
// Read the committed builder's literal input lists without calling the builder or writing .local.
const componentList=build.match(/for\(const path of \[([\s\S]*?)\]\)await add\(path\)/);assert(componentList);
for(const match of componentList[1].matchAll(/'([^']+)'/g))payload.set(match[1],match[1]);
const shellList=build.match(/for\(const name of \[([^\]]+)\]\)await add\(name,/);assert(shellList);
for(const match of shellList[1].matchAll(/'([^']+)'/g))payload.set(match[1],'app/offline/browser/'+match[1]);
for(const match of build.matchAll(/await add\('([^']+)','([^']+)'\)/g))payload.set(match[1],match[2]);
for(const match of build.matchAll(/payload\.set\('([^']+)'/g))payload.set(match[1],null);
const modules=[],edges=[];
for(const [file,input] of payload){
 if(!input||!file.endsWith('.mjs'))continue;
 const text=source(input),parsed=new vm.SourceTextModule(text,{identifier:file});
 modules.push(file);
 for(const specifier of parsed.dependencySpecifiers){
  if(specifier.startsWith('node:')){edges.push({from:file,specifier,kind:'node-only-import'});continue;}
  const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));
  edges.push({from:file,specifier,target,mapped:payload.has(target),kind:'browser-static-import'});
 }
}
const browserEdges=edges.filter(edge=>edge.kind==='browser-static-import');
assert(browserEdges.every(edge=>edge.mapped),'A static browser module dependency is absent from the committed payload');
const runtimeReferences=[
 {from:'ui/probe.html',reference:'./src/main.mjs',target:'ui/src/main.mjs'},
 {from:'ui/probe.html',reference:'./style.css',target:'ui/style.css'},
 {from:'ui/src/main.mjs (document-relative fetch)',reference:'./.local/candidate.json',target:'ui/.local/candidate.json'},
 {from:'compiler/src/compiler-probe.mjs',reference:'./compiler-worker.mjs',target:'compiler/src/compiler-worker.mjs'},
 {from:'debugger/src/worker-adapter.mjs',reference:'./debugger-worker.mjs',target:'debugger/src/debugger-worker.mjs'},
 {from:'index.html',reference:'./launcher.mjs',target:'launcher.mjs'},
 {from:'launcher.mjs',reference:'./app/offline/browser/trust.mjs',target:'app/offline/browser/trust.mjs'},
 {from:'generated service worker',reference:'bundle.json',target:'bundle.json',specialGeneratedFile:true},
 {from:'launcher.mjs',reference:'./sw.js',target:'sw.js',specialGeneratedFile:true}
].map(entry=>({...entry,mapped:entry.specialGeneratedFile||payload.has(entry.target)}));
assert(runtimeReferences.every(entry=>entry.mapped));
const primary=['app/offline/browser/worker-template.js','app/offline/build.mjs','app/offline/browser/trust.mjs','app/offline/serve.mjs','app/offline/browser/launcher.mjs'];
const sourceFingerprints=primary.map(file=>{const bytes=fs.readFileSync(path.join(repo,file));return {file,byteLength:bytes.length,sha256:hash(bytes),lineCount:bytes.toString('utf8').split(/\r?\n/).length};});
const report={schemaVersion:1,recordedAt:new Date().toISOString(),testedRevision:'3248ad54faa5f0f3a8b6f6501829e95e4699f066',method:'Read-only committed-source review and independent ECMAScript static import parsing (SourceTextModule), plus existing separately recorded 22 worker lifecycle/fault checks. The buildOfflineSite function and prepare:offline were not called.',invocation:{executable:process.execPath,execArgv:process.execArgv,argv:process.argv},sourceFingerprints,
 findings:[
 {topic:'cache version isolation',status:'no-confirmed-defect-in-reviewed-scope',locations:[{file:primary[0],lines:[3,4,5,6,18,20,23,44]},{file:primary[1],lines:[64,65,66,67,74,77,78,79,81,87]}],observations:['Descriptor identity includes resources and worker-template SHA; each release is published under bundleId. Runtime resolves resource and marker URLs relative to the worker location; cache lookup is restricted to its bundle prefix and marker identities.','Activation claims clients without skipWaiting or deleting other cache versions. Explicit repair only removes its own failed staging cache; full successful repairs preserve older caches.'],evidence:'../offline-worker.txt: new complete version preserves old version and unrelated caches; explicit repair/failure and window-race cases'},
 {topic:'corrupt startup and explicit repair',status:'no-confirmed-defect-in-reviewed-scope',locations:[{file:primary[0],lines:[12,15,27,30,32,39,46,57,58,60,61,73,94,103,104,109,110,115,123,127]}],observations:['Entry navigation checks index, launcher, trust module and descriptor before serving the launcher. Missing or modified startup bytes return a worker-generated local repair page.','Unknown/evicted/modified resources fail closed with 503; GET does not fetch replacement bytes. Explicit repair is limited to the same-version launcher and checks other windows before download and commit.'],evidence:'../offline-worker.txt: all eight missing/corrupt startup combinations; unknown/evicted bytes; explicit repair rollback and late-window conflict'},
 {topic:'workbench trust and resource mapping',status:'no-confirmed-defect-in-reviewed-scope',locations:[{file:primary[2],lines:[20,21,23,25,28,29,31,32,33]},{file:primary[1],lines:[15,16,42,43,46,47,50,53,57,60,61]}],observations:['Trust rejects foreign/overlapping covering service workers and checks exact scope, script URL, bundle, compatibilityId and resourceManifestHash.','The current committed payload has no missing parsed static browser import; document-relative candidate and worker endpoints map inside the same release. This is a source mapping audit, not a generated archive verification.'],evidence:'mapping below; ../offline-worker.txt covering-worker and handshake tests'},
 {topic:'static serving boundary',status:'no-confirmed-defect-in-reviewed-scope',locations:[{file:primary[3],lines:[7,11,12,13,17,18,19,20,21,22,24,25,26]}],observations:['Only GET/HEAD are served from the generated site root after realpath containment; traversal, staging paths and missing files fail with 404. Non-loopback binding requires both TLS inputs.','This turn did not start a server, rebuild an offline release, or inspect the separate uncommitted v0.4.5 packaging worktree.'],evidence:'read-only source review'}
 ],
 mapping:{candidateComponentResources:candidate.resources.length,payloadEntries:payload.size,sourceBackedEntries:[...payload.values()].filter(Boolean).length,generatedEntries:[...payload].filter(([,input])=>!input).map(([file])=>file),modulesParsed:modules.length,staticBrowserEdges:browserEdges.length,missingStaticBrowserEdges:browserEdges.filter(edge=>!edge.mapped),edges,runtimeReferences,resources:[...payload].map(([file,input])=>input?{path:file,source:input,byteLength:fs.statSync(path.join(repo,input)).size,sha256:hash(fs.readFileSync(path.join(repo,input)))}:{path:file,generated:true})},
 conclusion:{newConfirmedProductBugs:[],readOnlyReviewCompleted:true,separateOfflineWorkerChecks:{passed:22,failed:0,scope:'Node VM with small Cache API/network substitutes'},generatedPackageBuilt:false,browserTested:false,realIPadTested:false,knownBoundary:'This is not acceptance of the uncommitted v0.4.5 package or iPad cache eviction/HTTPS/installation behavior.'}};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({payloadEntries:payload.size,staticBrowserEdges:browserEdges.length,missingStaticBrowserEdges:report.mapping.missingStaticBrowserEdges.length,newConfirmedProductBugs:0,generatedPackageBuilt:false}));
