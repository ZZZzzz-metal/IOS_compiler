// Role05: independently audit the immutable completion UI archive; never builds it.
// Run: node --experimental-vm-modules tests/audit-completion-package-independent.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {createHash,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {posix} from 'node:path';
import vm from 'node:vm';

const repo=new URL('../',import.meta.url);
const evidence=new URL('tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30/package/',repo);
const extracted=new URL('tests/.local/completion-v046-b14aeba-person05/',repo);
const revision='b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const backendBaseline='bddae57653bede9a38a3510006d761e2a9d19a04';
const bundleId='ipad-web-probe-cbe80b74ccc3d3cebece9e73';
const profileId='integration-prototype-80135c59f01b26fc';
const release=new URL('site/releases/'+bundleId+'/',extracted);
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${fileURLToPath(repo)}`,'-C',fileURLToPath(repo),...args],{maxBuffer:32*1024*1024});
const gitText=(...args)=>git(...args).toString('utf8').trim();
const gitBytes=(file,ref=revision)=>git('show',ref+':'+file);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const prefixed=bytes=>'sha256:'+hash(bytes);
const jsonbytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const parse=async url=>JSON.parse(await readFile(url,'utf8'));
const equalBytes=(actual,expected,message)=>assert(actual.equals(expected),message+' (actual '+hash(actual)+', expected '+hash(expected)+')');
const save=(name,value)=>writeFile(new URL(name,evidence),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const startedAt=new Date().toISOString();
const productPaths=['package.json','package-lock.json','compiler','debugger','contracts','app/integration','app/offline','ui','storage'];
assert.equal(gitText('rev-parse','HEAD'),revision,'Use fixed b14aebab');
assert.equal(gitText('diff',revision,'--',...productPaths),'','Product files must remain fixed');
try{await access(new URL('report.json',evidence));throw Error('Refusing to overwrite completed audit');}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(new URL('runner.mjs',evidence),await readFile(new URL(import.meta.url)),{flag:'wx'});
try {
 const zip=await parse(new URL('zip-members.json',evidence));
 assert.equal(zip.zipSHA256,'7cb501a11ebde61b26d019a711aa822d3fc03b5e3d22be759a05860502fa78e5');
 assert.equal(zip.zipBytes,19330126);assert.equal(zip.fileCount,71);assert(zip.allPathsContained&&!zip.duplicateOrLinkedEntries);
 assert.equal(hash(await readFile(zip.sourceArchive)),zip.zipSHA256,'Original ZIP still matches');
 const manifest=await parse(new URL('SHA256SUMS.json',extracted));assert.equal(manifest.length,70);
 assert.deepEqual(zip.members.map(e=>e.name).sort(),[...manifest.map(e=>e.path),'SHA256SUMS.json'].sort());
 for(const item of manifest){const bytes=await readFile(new URL(item.path,extracted));assert.equal(bytes.length,item.byteLength,item.path);assert.equal(hash(bytes),item.sha256,item.path+' manifest hash');assert.equal(zip.members.find(e=>e.name===item.path).sha256,item.sha256);}
 const descriptorBytes=await readFile(new URL('bundle.json',release)),descriptor=JSON.parse(descriptorBytes);
 assert.equal(hash(descriptorBytes),'67fdcb80c27d17b25fd9c43ba0e0bbf93090e82191446ab862b7bb9440d82268');
 assert.equal(descriptor.bundleId,bundleId);assert.equal(descriptor.compatibilityId,profileId);
 assert.equal(descriptor.resources.length,62);assert.equal(descriptor.totalBytes,60964100);
 assert.equal(descriptor.resources.reduce((n,r)=>n+r.byteLength,0),60964100);
 const resourcePaths=new Set(descriptor.resources.map(r=>r.path));assert.equal(resourcePaths.size,62);
 for(const r of descriptor.resources){assert(!r.path.startsWith('/')&&!r.path.split('/').some(p=>!p||p==='.'||p==='..')&&!/[\\:\x00-\x1f]/.test(r.path));const bytes=await readFile(new URL(r.path,release));assert.equal(bytes.length,r.byteLength,r.path);assert.equal(prefixed(bytes),r.sha256,r.path+' descriptor hash');}
 const {createIntegrationCandidate}=await import(new URL('app/integration/candidate.mjs',repo));
 const candidate=await createIntegrationCandidate();assert.equal(candidate.profile.compatibilityId,profileId);assert.equal(candidate.resources.length,35);
 assert.equal(descriptor.resourceManifestHash,candidate.profile.resourceManifestHash);
 const packagedCandidate=await parse(new URL('ui/.local/candidate.json',release));
 assert.deepEqual(packagedCandidate.profile,candidate.profile);assert.deepEqual(packagedCandidate.resources,candidate.resources);assert.deepEqual(packagedCandidate.lock,candidate.lock);
 const capabilities=JSON.parse(gitBytes('contracts/capabilities.json'));assert.deepEqual(packagedCandidate.capabilities,capabilities);
 const generated=new Map();
 generated.set('ui/.local/candidate.json',jsonbytes({profile:candidate.profile,resources:candidate.resources,lock:candidate.lock,capabilities,declaration:'Versioned offline Web experiment. Real iPad offline acceptance and distribution remain unverified.'}));
 generated.set('manifest.webmanifest',jsonbytes({name:'算法工作台 · 离线实验',short_name:'算法工作台',lang:'zh-CN',start_url:'./index.html',scope:'./',display:'standalone',background_color:'#f5f4ef',theme_color:'#234d3c',icons:[{src:'./icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]}));
 const manual=gitBytes('docs/architecture/IPAD-USER-MANUAL.md').toString('utf8');
 const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 generated.set('manual.html',Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iPad 操作手册</title><link rel="stylesheet" href="./style.css"><main><a href="./index.html">返回离线入口</a><h1>iPad 操作手册</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${escape(manual)}</pre></main></html>`));
 const remap=new Map([['IPAD-USER-MANUAL.md','docs/architecture/IPAD-USER-MANUAL.md'],...['index.html','launcher.mjs','style.css','icon.svg'].map(name=>[name,'app/offline/browser/'+name])]);
 const tracked=new Set(gitText('ls-files').split(/\r?\n/)),sourceBindings=[];
 for(const resource of descriptor.resources){const bytes=await readFile(new URL(resource.path,release));
  if(generated.has(resource.path)){equalBytes(bytes,generated.get(resource.path),resource.path+' generated control');sourceBindings.push({path:resource.path,kind:'generated-from-fixed-source',sha256:hash(bytes)});continue;}
  const path=remap.get(resource.path)??resource.path;
  if(tracked.has(path)){const expected=gitBytes(path);equalBytes(bytes,expected,resource.path+' fixed Git binding');sourceBindings.push({path:resource.path,source:path,kind:'fixed-git',revision,gitBlob:gitText('rev-parse',revision+':'+path),sha256:hash(bytes)});}
  else {const filename=path.split('/').at(-1),lock=candidate.lock.files.find(e=>e.filename===filename);assert(lock,path+' locked resource');assert.equal(bytes.length,lock.byteLength);assert.equal(hash(bytes),lock.sha256);sourceBindings.push({path:resource.path,source:'compiler/resources/toolchain.lock.json#'+filename,kind:'locked-vendor',sha256:hash(bytes)});}
 }
 const template=gitBytes('app/offline/browser/worker-template.js');assert.equal(prefixed(template),descriptor.workerTemplateSha256);
 const computedId='ipad-web-probe-'+prefixed(jsonbytes({resources:descriptor.resources,workerTemplateSha256:descriptor.workerTemplateSha256})).slice(7,31);assert.equal(computedId,bundleId);
 const workerBytes=await readFile(new URL('sw.js',release));assert.equal(hash(workerBytes),'c2182a6fd7e369cd01c9de3fcec1489dfca261988b555e0e05b035173521de22');
 equalBytes(workerBytes,Buffer.from(template.toString('utf8').replace('__BUNDLE_DESCRIPTOR__',JSON.stringify(descriptor))),'Embedded service worker');
 equalBytes(await readFile(new URL('docs/平板完整操作手册.md',extracted)),gitBytes('docs/architecture/IPAD-USER-MANUAL.md'),'Archived full manual');
 for(const path of ['ui/SHORTCUTS.md','ui/COMPLETION.md','compiler/COMPLETION.md'])assert(resourcePaths.has(path),path+' documentation included');
 assert.deepEqual(await readdir(new URL('site/releases/',extracted)),[bundleId]);
 const modules=[],edges=[],dynamicImports=[],workerReferences=[];
 for(const path of resourcePaths){if(!path.endsWith('.mjs'))continue;const text=await readFile(new URL(path,release),'utf8');const module=new vm.SourceTextModule(text,{identifier:path});modules.push(path);
  for(const specifier of module.dependencySpecifiers){if(specifier.startsWith('node:')){edges.push({from:path,specifier,kind:'node-only'});continue;}assert(specifier.startsWith('.'),path+' external import');const target=posix.normalize(posix.join(posix.dirname(path),specifier));assert(resourcePaths.has(target),path+' missing static dependency '+target);edges.push({from:path,specifier,target,kind:'browser-static',mapped:true});}
  for(const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)){const specifier=match[1];if(specifier.startsWith('node:')){dynamicImports.push({from:path,specifier,kind:'node-only'});continue;}const target=posix.normalize(posix.join(posix.dirname(path),specifier));assert(specifier.startsWith('.')&&resourcePaths.has(target));dynamicImports.push({from:path,specifier,target,kind:'browser-dynamic',mapped:true});}
  for(const match of text.matchAll(/new Worker\(new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\)/g)){const target=posix.normalize(posix.join(posix.dirname(path),match[1]));assert(resourcePaths.has(target),path+' missing Worker '+target);workerReferences.push({from:path,target,mapped:true});}
 }
 const {ISOLATED_WORKER_PATHS}=await import(new URL('app/offline/browser/trust.mjs',repo));
 assert.deepEqual([...ISOLATED_WORKER_PATHS],['compiler/src/compiler-worker.mjs','compiler/src/completion-worker.mjs','debugger/src/debugger-worker.mjs']);
 for(const path of ISOLATED_WORKER_PATHS){assert(resourcePaths.has(path)&&candidate.resources.some(r=>r.relativePath===path),'Worker in both bundle and trusted backend: '+path);assert(workerReferences.some(r=>r.target===path),'Concrete Worker constructor reference: '+path);}
 for(const name of ['memfs','sysroot.tar','clang']){const path='compiler/resources/'+candidate.lock.vendorDirectory+'/'+name;assert(resourcePaths.has(path)&&candidate.resources.some(r=>r.relativePath===path),'Completion runtime resource: '+path);}
 // Exact byte equality across the old fixed backend covers its actual dependencies,
 // request/result APIs, parser, Workers, toolchain lock and runtime—not only a label.
 const unchangedRoots=['compiler','debugger','app/integration','contracts/protocol.d.ts','contracts/invariants.mjs'];
 assert.equal(gitText('diff',backendBaseline,revision,'--',...unchangedRoots),'','Backend implementations/API dependencies changed');
 const dependencyBindings=[];
 for(const resource of candidate.resources){const path=resource.relativePath;if(tracked.has(path)){const before=gitBytes(path,backendBaseline),after=gitBytes(path);equalBytes(before,after,path+' backend baseline');dependencyBindings.push({path,sha256:hash(after),baselineGitBlob:gitText('rev-parse',backendBaseline+':'+path),targetGitBlob:gitText('rev-parse',revision+':'+path),unchanged:true});}else dependencyBindings.push({path,sha256:resource.sha256,lockedVendor:true,unchanged:true});}
 const previousCapabilities=JSON.parse(gitBytes('contracts/capabilities.json',backendBaseline));
 assert.equal(previousCapabilities.protocolVersion,capabilities.protocolVersion);assert.equal(previousCapabilities.declaration,capabilities.declaration);
 for(const record of previousCapabilities.capabilities)assert.deepEqual(capabilities.capabilities.find(r=>r.id===record.id),record,'Existing capability changed: '+record.id);
 assert.equal(capabilities.capabilities.length,previousCapabilities.capabilities.length+1);
 assert.equal(capabilities.capabilities.find(r=>r.id==='editor-code-completion').status,'implemented-unverified');
 const packageOld=JSON.parse(gitBytes('package.json',backendBaseline)),packageNew=JSON.parse(gitBytes('package.json'));
 assert.equal(packageOld.version,'0.4.5');assert.equal(packageNew.version,'0.4.6');
 const normalizedPackage=structuredClone(packageNew);normalizedPackage.version=packageOld.version;assert.deepEqual(normalizedPackage,packageOld,'Package change only version/formatting');
 const lockOld=JSON.parse(gitBytes('package-lock.json',backendBaseline)),lockNew=JSON.parse(gitBytes('package-lock.json'));
 const normalizedLock=structuredClone(lockNew);normalizedLock.version=lockOld.version;normalizedLock.packages[''].version=lockOld.packages[''].version;assert.deepEqual(normalizedLock,lockOld,'Lock change only package version');
 const backendDiff=gitText('diff','--name-status',backendBaseline,revision,'--','compiler','debugger','app/integration','contracts','package.json','package-lock.json');
 const certBytes=await readFile(new URL('certificates/root-ca.cer',extracted)),certificate=new X509Certificate(certBytes),mobile=await readFile(new URL('certificates/root-only.mobileconfig',extracted),'utf8');
 const payloadTypes=[...mobile.matchAll(/<key>PayloadType<\/key><string>([^<]+)<\/string>/g)].map(m=>m[1]);assert.deepEqual(payloadTypes,['com.apple.security.root','Configuration']);
 const embedded=[...mobile.matchAll(/<key>PayloadContent<\/key><data>([^<]+)<\/data>/g)];assert.equal(embedded.length,1);equalBytes(Buffer.from(embedded[0][1],'base64'),certBytes,'Single public root payload');
 assert(!zip.members.some(e=>/\.(key|p12|pfx)$/i.test(e.name)||/private[-_]key/i.test(e.name)));
 const instructions=await readFile(new URL('本次首次准备说明.md',extracted),'utf8');assert(instructions.includes(bundleId)&&instructions.includes('0.4.6'));
 const build=await parse(new URL('build.json',extracted));assert.equal(build.sourceBaseRevision,revision);assert.equal(build.bundleId,bundleId);assert.equal(build.resourceCount,62);assert.equal(build.totalBytes,60964100);
 assert.equal(gitText('rev-parse','HEAD'),revision);assert.equal(gitText('diff',revision,'--',...productPaths),'');
 const result={schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),testedRevision:revision,backendBaseline,method:'Independent immutable ZIP validation and direct fixed Git/lock binding; no bundle rebuild, no owner pre-recorded tests used as acceptance.',archive:{fileCount:71,byteLength:19330126,sha256:zip.zipSHA256,manifestEntriesVerified:70,pathsValidatedBeforeExtraction:true,onlyCurrentRelease:true},bundle:{bundleId,resourceCount:62,totalBytes:60964100,compatibilityId:profileId,resourceManifestHash:descriptor.resourceManifestHash,descriptorSHA256:hash(descriptorBytes),workerSHA256:hash(workerBytes),workerTemplateSHA256:hash(template),derivedIdentityMatches:true,allResourcesVerified:true},sourceBindingCounts:{fixedGit:sourceBindings.filter(r=>r.kind==='fixed-git').length,lockedVendor:sourceBindings.filter(r=>r.kind==='locked-vendor').length,generated:sourceBindings.filter(r=>r.kind==='generated-from-fixed-source').length},sourceBindings,imports:{modulesParsed:modules.length,browserStaticEdges:edges.filter(r=>r.kind==='browser-static').length,missingBrowserStaticDependencies:0,edges,dynamicImports},workers:{isolatedWorkerPaths:[...ISOLATED_WORKER_PATHS],constructors:workerReferences,allTrustedAndPackaged:true,completionToolResources:['memfs','sysroot.tar','clang']},backendReuse:{baseline:backendBaseline,target:revision,implementationAndApiDependencyDiff:'',dependencyBindings,actualBackendFilesAndToolchainLockIdentical:true,rootPackageChanges:'Version 0.4.5→0.4.6 and JSON formatting only; scripts, engines and dependency graph unchanged.',capabilityChanges:'Date and new editor-code-completion implemented-unverified declaration only; previous entries and protocol preserved.',diff:backendDiff,conclusion:'Prior fixed backend semantic/lifecycle evidence applies to byte-identical backend dependencies. This does not erase previously recorded const-string/unavailable/deprecated boundaries or accept the new UI/integration/device workflows.'},documentation:{shortcutAndBothCompletionGuidesPackaged:true,fullArchiveAndRuntimeManualMatchFixedGit:true,archiveOnlySetupInstructionsBoundByZipManifest:true},publicCertificate:{ca:certificate.ca,validFrom:certificate.validFrom,validTo:certificate.validTo,singleRemovableRoot:true,embeddedMatchesDER:true,privateKeyPresent:false,installedOrTrusted:false},extraction:{siteRoot:zip.staticSiteRoot,entryPath:'/releases/'+bundleId+'/index.html'},productDiffFromCommit:'',runnerSHA256:hash(await readFile(new URL(import.meta.url))),newConfirmedDefects:[],limits:{browserTested:false,actualOfflineColdStartTested:false,ipadTested:false,distributionLicenseCleared:false},result:'Archive, source binding, import/Worker completeness and fixed-backend reuse checks passed; UI/browser/device acceptance is separate'};
 await save('report.json',result);
 console.log(JSON.stringify({result:result.result,sourceBindingCounts:result.sourceBindingCounts,imports:result.imports.browserStaticEdges,isolatedWorkers:3,backendImplementationChanged:false,newConfirmedDefects:0}));
} catch(error) {
 await save('failure.json',{schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),name:error.name,code:error.code,message:error.message,stack:error.stack});
 throw error;
}
