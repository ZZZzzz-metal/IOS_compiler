// Read-only audit of the independently extracted FINAL r3 archive. Does not rebuild it.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {posix} from 'node:path';
import vm from 'node:vm';
const evidence=new URL('./',import.meta.url),repo=new URL('../../../../',evidence);
const revision='40a079ba2065384572f268e4bb91bda437e46cec';
const extracted=new URL('tests/.local/final-v045-r3/',repo),bundleId='ipad-web-probe-eb5236b6ed8f9aab4a9d9ced';
const release=new URL('site/releases/'+bundleId+'/',extracted);
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${fileURLToPath(repo)}`,'-C',fileURLToPath(repo),...args],{maxBuffer:32*1024*1024});
const hash=b=>createHash('sha256').update(b).digest('hex');
const prefixed=b=>'sha256:'+hash(b);
const jsonbytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const parse=async(url)=>JSON.parse(await readFile(url,'utf8'));
const gitFiles=new Set(git('ls-files').toString('utf8').trim().split(/\r?\n/));
const gitBytes=file=>git('show',revision+':'+file);
assert.equal(git('rev-parse','HEAD').toString('utf8').trim(),revision);
assert.equal(git('rev-parse','integration-v0.4.5^{}').toString('utf8').trim(),revision);
assert.equal(git('diff',revision,'--','package.json','app','compiler','debugger','ui','storage','contracts','docs/architecture').toString('utf8'),'');
const zip=await parse(new URL('zip-members.json',evidence));
assert.equal(zip.zipSHA256,'f1877f4e031f5a46bdafab71ea5ae611a8dd74c58c7256c9ed367e92cb00c068');assert.equal(zip.fileCount,60);assert.equal(zip.zipBytes,19294031);
const manifest=await parse(new URL('SHA256SUMS.json',extracted));assert.equal(manifest.length,59);
const memberNames=zip.members.map(e=>e.name).sort();
assert.deepEqual(memberNames,[...manifest.map(e=>e.path),'SHA256SUMS.json'].sort());
for(const item of manifest){const bytes=await readFile(new URL(item.path,extracted));assert.equal(bytes.length,item.byteLength,item.path);assert.equal(hash(bytes),item.sha256,item.path+' package manifest');const actual=zip.members.find(e=>e.name===item.path);assert.equal(actual.sha256,item.sha256);}
const descriptorBytes=await readFile(new URL('bundle.json',release)),descriptor=JSON.parse(descriptorBytes);
assert.equal(hash(descriptorBytes),'dddfee8ddf378f51262a0b4ab15c739f7c681cbe4961699da3077b42b3d81d72');
assert.equal(descriptor.bundleId,bundleId);assert.equal(descriptor.compatibilityId,'integration-prototype-60eb6729284e2729');
assert.equal(descriptor.resources.length,51);assert.equal(descriptor.totalBytes,60874273);assert.equal(descriptor.resources.reduce((n,r)=>n+r.byteLength,0),descriptor.totalBytes);
assert.equal(descriptor.resourceManifestHash,'sha256:60eb6729284e27295b8a76121dfe569027d8c096f9580a279021d6ada08d6789');
assert.equal(new Set(descriptor.resources.map(r=>r.path)).size,51);
for(const resource of descriptor.resources){const bytes=await readFile(new URL(resource.path,release));assert.equal(bytes.length,resource.byteLength,resource.path);assert.equal(prefixed(bytes),resource.sha256,resource.path+' descriptor digest');}
const {createIntegrationCandidate}=await import(new URL('app/integration/candidate.mjs',repo));
const candidate=await createIntegrationCandidate();assert.equal(candidate.resources.length,30);assert.equal(candidate.profile.compatibilityId,descriptor.compatibilityId);
assert.equal(candidate.profile.resourceManifestHash,descriptor.resourceManifestHash);
const packagedCandidate=await parse(new URL('ui/.local/candidate.json',release));
assert.deepEqual(packagedCandidate.profile,candidate.profile);assert.deepEqual(packagedCandidate.resources,candidate.resources);assert.deepEqual(packagedCandidate.lock,candidate.lock);
assert.deepEqual(packagedCandidate.capabilities,JSON.parse(gitBytes('contracts/capabilities.json')));
const generated=new Map();
generated.set('ui/.local/candidate.json',jsonbytes({profile:candidate.profile,resources:candidate.resources,lock:candidate.lock,capabilities:JSON.parse(gitBytes('contracts/capabilities.json')),declaration:'Versioned offline Web experiment. Real iPad offline acceptance and distribution remain unverified.'}));
generated.set('manifest.webmanifest',jsonbytes({name:'算法工作台 · 离线实验',short_name:'算法工作台',lang:'zh-CN',start_url:'./index.html',scope:'./',display:'standalone',background_color:'#f5f4ef',theme_color:'#234d3c',icons:[{src:'./icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]}));
const manual=gitBytes('docs/architecture/IPAD-USER-MANUAL.md').toString('utf8');
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
generated.set('manual.html',Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iPad 操作手册</title><link rel="stylesheet" href="./style.css"><main><a href="./index.html">返回离线入口</a><h1>iPad 操作手册</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${escape(manual)}</pre></main></html>`));
const remap=new Map([['IPAD-USER-MANUAL.md','docs/architecture/IPAD-USER-MANUAL.md'],...['index.html','launcher.mjs','style.css','icon.svg'].map(name=>[name,'app/offline/browser/'+name])]);
const sourceBindings=[];
for(const resource of descriptor.resources){
 const bytes=await readFile(new URL(resource.path,release));
 if(generated.has(resource.path)){assert.deepEqual(bytes,generated.get(resource.path),resource.path+' generated control data');sourceBindings.push({path:resource.path,kind:'deterministically-generated-from-fixed-source',sha256:hash(bytes)});continue;}
 const path=remap.get(resource.path)??resource.path;
 if(gitFiles.has(path)){const expected=gitBytes(path);assert.deepEqual(bytes,expected,resource.path+' fixed Git source');sourceBindings.push({path:resource.path,source:path,kind:'fixed-git-blob',revision,gitBlob:git('rev-parse',revision+':'+path).toString('utf8').trim(),sha256:hash(bytes)});}
 else {const filename=path.split('/').at(-1),lock=candidate.lock.files.find(e=>e.filename===filename);assert(lock,path+' must be fixed vendor entry');assert.equal(bytes.length,lock.byteLength);assert.equal(hash(bytes),lock.sha256);sourceBindings.push({path:resource.path,source:'compiler/resources/toolchain.lock.json#'+filename,kind:'locked-vendor-bytes',revision,sha256:hash(bytes)});}
}
const template=gitBytes('app/offline/browser/worker-template.js');assert.equal(prefixed(template),descriptor.workerTemplateSha256);
const expectedId='ipad-web-probe-'+prefixed(jsonbytes({resources:descriptor.resources,workerTemplateSha256:descriptor.workerTemplateSha256})).slice(7,31);assert.equal(expectedId,bundleId);
const workerBytes=await readFile(new URL('sw.js',release));assert.equal(hash(workerBytes),'fbc19966c4f21d2c0e5c4596ef52014ee89daac920a965d58ce2d8e24ff5cbe8');
assert.deepEqual(workerBytes,Buffer.from(template.toString('utf8').replace('__BUNDLE_DESCRIPTOR__',JSON.stringify(descriptor))));
assert.deepEqual(await readFile(new URL('docs/平板完整操作手册.md',extracted)),gitBytes('docs/architecture/IPAD-USER-MANUAL.md'));
// Archive-only instructions are generated by the fixed packager; they deliberately
// have a different heading/content than the root user update document.
const archiveInstructions=await readFile(new URL('docs/本次更新与准备说明.md',extracted),'utf8');
assert.match(archiveInstructions,/v0\.4\.5-r3/);assert(archiveInstructions.includes(bundleId));
assert(archiveInstructions.includes('51项、60,874,273字节'));
assert(archiveInstructions.includes('REV-006')&&archiveInstructions.includes('REV-007')&&archiveInstructions.includes('REV-008'));
assert(archiveInstructions.includes('待5号')&&archiveInstructions.includes('不是IPA'));
const packagerPath='app/offline/evidence/shortcuts-package-r3-2026-10-28/package-archives.py';
const packagerBytes=gitBytes(packagerPath);assert(packagerBytes.toString('utf8').includes("'docs/本次更新与准备说明.md': instructions"));
assert(descriptor.resources.some(r=>r.path==='ui/SHORTCUTS.md'));
assert.deepEqual((await readdir(new URL('site/releases/',extracted))),[bundleId]);
const staticEdges=[],modulePaths=[];
const paths=new Set(descriptor.resources.map(r=>r.path));
for(const path of paths){if(!path.endsWith('.mjs'))continue;const text=await readFile(new URL(path,release),'utf8'),module=new vm.SourceTextModule(text,{identifier:path});modulePaths.push(path);for(const specifier of module.dependencySpecifiers){if(specifier.startsWith('node:')){staticEdges.push({from:path,specifier,kind:'node-only'});continue;}assert(specifier.startsWith('.'),path+' external import');const target=posix.normalize(posix.join(posix.dirname(path),specifier));assert(paths.has(target),path+' missing '+target);staticEdges.push({from:path,specifier,target,kind:'browser-static',mapped:true});}}
const certificateBytes=await readFile(new URL('certificates/root-ca.cer',extracted)),cert=new X509Certificate(certificateBytes);
const mobile=await readFile(new URL('certificates/root-only.mobileconfig',extracted),'utf8');
const types=[...mobile.matchAll(/<key>PayloadType<\/key><string>([^<]+)<\/string>/g)].map(m=>m[1]);assert.deepEqual(types,['com.apple.security.root','Configuration']);
const embedded=[...mobile.matchAll(/<key>PayloadContent<\/key><data>([^<]+)<\/data>/g)];assert.equal(embedded.length,1);assert.deepEqual(Buffer.from(embedded[0][1],'base64'),certificateBytes);
assert(!zip.members.some(e=>/\.(key|p12|pfx)$/i.test(e.name)));assert(!zip.members.some(e=>/private[-_]key/i.test(e.name)));
const build=await parse(new URL('build.json',extracted));assert.equal(build.bundleId,bundleId);assert.equal(build.resourceCount,51);assert.equal(build.totalBytes,60874273);assert.equal(build.compatibilityId,descriptor.compatibilityId);
const result={schemaVersion:1,recordedAt:new Date().toISOString(),method:'Independent fresh ZIP byte/hash extraction and validation against fixed Git blobs/locked vendor hashes; no bundle rebuild, no reuse of owner audit results.',testedRevision:revision,fixedTag:'integration-v0.4.5',zip:{sha256:zip.zipSHA256,byteLength:zip.zipBytes,fileCount:60,all59ManifestEntriesVerified:true,pathContainmentBeforeExtraction:true,onlyCurrentRelease:true},bundle:{bundleId,resourceCount:51,totalBytes:60874273,compatibilityId:descriptor.compatibilityId,resourceManifestHash:descriptor.resourceManifestHash,descriptorSHA256:hash(descriptorBytes),workerSHA256:hash(workerBytes),workerTemplateSHA256:hash(template),allResourceHashesAndLengthsVerified:true,identityDerivedFromExactResources:true,embeddedWorkerMatchesFixedTemplate:true},sourceBindingCounts:{fixedGit:sourceBindings.filter(e=>e.kind==='fixed-git-blob').length,lockedVendor:sourceBindings.filter(e=>e.kind==='locked-vendor-bytes').length,generated:sourceBindings.filter(e=>e.kind.startsWith('deterministically')).length},sourceBindings,imports:{modulesParsed:modulePaths.length,browserStaticEdges:staticEdges.filter(e=>e.kind==='browser-static').length,nodeOnlyEdges:staticEdges.filter(e=>e.kind==='node-only').length,missingBrowserStaticDependencies:0,edges:staticEdges},shortcutDocumentPackagedAndMatchesGit:true,manualArchiveAndRuntimeCopiesMatchGit:true,archiveOnlyInstructions:{sha256:hash(Buffer.from(archiveInstructions)),generatedFromFixedPackager:packagerPath,packagerSHA256:hash(packagerBytes),versionBundleAndLimitsChecked:true,notAnExactCopyOfRootUpdateDocument:true},publicCertificate:{singleRemovableRootPayload:true,certificateMatchesEmbedded:true,containsPrivateKey:false,ca:cert.ca,validFrom:cert.validFrom,validTo:cert.validTo},buildMetadata:{sourceBaseRevision:build.sourceBaseRevision,note:'Original build base is metadata from packaging time. All source-backed payload bytes were independently bound above to the requested final40a079b commit.'},extraction:{siteRoot:zip.staticSiteRoot,entryPath:'/releases/'+bundleId+'/index.html'},limits:{browserTested:false,offlineColdStartTested:false,ipadTested:false,distributionLicenseCleared:false},newConfirmedDefects:[],result:'Archive and exact fixed-code resource binding passed; browser/offline/iPad evidence remains separate'};
await writeFile(new URL('report.json',evidence),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:result.result,zipFiles:60,resources:51,totalBytes:60874273,sourceBindingCounts:result.sourceBindingCounts,imports:result.imports.browserStaticEdges,newConfirmedDefects:0}));
