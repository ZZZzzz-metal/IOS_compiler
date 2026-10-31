// Complete, immutable Web experiment package. This does not freeze an iPad route.
import {readFile, writeFile, mkdir, rename, realpath} from 'node:fs/promises';
import {resolve, relative, sep, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createIntegrationCandidate} from '../integration/candidate.mjs';
import {ISOLATED_WORKER_PATHS} from './browser/trust.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const local=resolve(root,'app/offline/.local');
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const type=path=>({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.patch':'text/plain; charset=utf-8','.wasm':'application/wasm'}[extname(path)]??'application/octet-stream');
const escapeHTML=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function safePath(path){
  if(typeof path!=='string'||/[\\%:?#\x00-\x1f]/.test(path)||path.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Invalid bundle path: '+path);
  return path;
}

export async function verifyOfflineRelease(directory){
  const descriptor=JSON.parse(await readFile(resolve(directory,'bundle.json'),'utf8'));
  for(const resource of descriptor.resources){
    const bytes=await readFile(resolve(directory,safePath(resource.path)));
    if(bytes.length!==resource.byteLength||hash(bytes)!==resource.sha256)throw Error('Offline package differs: '+resource.path);
  }
  const identity=hash(json({resources:descriptor.resources,workerTemplateSha256:descriptor.workerTemplateSha256})).slice(7,31);
  if(descriptor.bundleId!==`ipad-web-probe-${identity}`)throw Error('Offline package identity differs');
  const template=await readFile(new URL('./browser/worker-template.js',import.meta.url),'utf8');
  if(hash(Buffer.from(template))!==descriptor.workerTemplateSha256)throw Error('Offline worker template identity differs');
  const expected=template.replace('__BUNDLE_DESCRIPTOR__',JSON.stringify(descriptor));
  if(await readFile(resolve(directory,'sw.js'),'utf8')!==expected)throw Error('Offline worker differs from embedded bundle');
  return descriptor;
}

export async function buildOfflineSite({outputDirectory=resolve(local,'site')}={}){
  outputDirectory=resolve(outputDirectory);
  if(!outputDirectory.startsWith(local+sep))throw Error('Output must stay inside app/offline/.local/');
  const candidate=await createIntegrationCandidate();
  const capabilities=JSON.parse(await readFile(resolve(root,'contracts/capabilities.json'),'utf8'));
  const payload=new Map();
  const add=async(path,source=path)=>payload.set(safePath(path),await readFile(resolve(root,source)));
  for(const resource of candidate.resources)await add(resource.relativePath);
  for(const path of ['ui/probe.html','ui/style.css','ui/src/main.mjs','ui/src/session-controller.mjs','ui/src/editor.mjs',
    'ui/src/completion-controller.mjs','ui/src/completion-popup.mjs','ui/src/completion-edit.mjs','ui/src/completion-editor.mjs',
    'storage/src/draft-store.mjs','storage/src/autosave.mjs','ui/README.md','ui/SHORTCUTS.md','ui/COMPLETION.md','storage/README.md',
    'compiler/README.md','compiler/COMPLETION.md','compiler/resources/completion-semantics-v1.md',
    'compiler/resources/completion-semantics-v1.cpp.patch','debugger/README.md','app/offline/browser/trust.mjs'])await add(path);
  for(const name of ['index.html','launcher.mjs','style.css','icon.svg'])await add(name,`app/offline/browser/${name}`);
  await add('IPAD-USER-MANUAL.md','docs/architecture/IPAD-USER-MANUAL.md');
  const manual=payload.get('IPAD-USER-MANUAL.md').toString('utf8');
  payload.set('manual.html',Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iPad 操作手册</title><link rel="stylesheet" href="./style.css"><main><a href="./index.html">返回离线入口</a><h1>iPad 操作手册</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${escapeHTML(manual)}</pre></main></html>`));
  payload.set('ui/.local/candidate.json',json({profile:candidate.profile,resources:candidate.resources,lock:candidate.lock,capabilities,
    declaration:'Versioned offline Web experiment. Real iPad offline acceptance and distribution remain unverified.'}));
  payload.set('manifest.webmanifest',json({name:'算法工作台 · 离线实验',short_name:'算法工作台',lang:'zh-CN',start_url:'./index.html',scope:'./',display:'standalone',background_color:'#f5f4ef',theme_color:'#234d3c',icons:[{src:'./icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]}));
  // Worker URLs are dynamic and cannot be discovered by the static import check.
  for(const path of ISOLATED_WORKER_PATHS)if(!payload.has(path))throw Error('Unpackaged isolated worker: '+path);
  // Relative module imports must resolve inside this package. Node branches are unused in browsers.
  for(const [path,bytes] of payload){
    if(!path.endsWith('.mjs'))continue;
    const text=bytes.toString('utf8');
    for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)){
      const target=match[1];if(target.startsWith('node:'))continue;
      if(!target.startsWith('.'))throw Error(`External module in ${path}: ${target}`);
      const dependency=relative(root,resolve(root,dirname(path),target)).split(sep).join('/');
      if(!payload.has(dependency))throw Error(`Unpackaged module in ${path}: ${dependency}`);
    }
  }
  const resources=[...payload].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length,mediaType:type(path)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const template=await readFile(new URL('./browser/worker-template.js',import.meta.url),'utf8');
  const workerTemplateSha256=hash(Buffer.from(template));
  const descriptor={schemaVersion:1,kind:'offline-web-probe',status:'device-unverified',bundleId:'ipad-web-probe-'+hash(json({resources,workerTemplateSha256})).slice(7,31),workerTemplateSha256,
    compatibilityId:candidate.profile.compatibilityId,resourceManifestHash:candidate.profile.resourceManifestHash,
    resources,totalBytes:resources.reduce((sum,r)=>sum+r.byteLength,0)};
  if(template.split('__BUNDLE_DESCRIPTOR__').length!==2)throw Error('Worker template must have one descriptor placeholder');
  await mkdir(resolve(outputDirectory,'releases'),{recursive:true});
  const actualOutput=await realpath(outputDirectory), actualLocal=await realpath(local);
  if(!actualOutput.startsWith(actualLocal+sep))throw Error('Output resolves outside local package directory');
  const release=resolve(actualOutput,'releases',descriptor.bundleId);
  let exists=false;
  try{await realpath(release);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(exists){
    const existing=await verifyOfflineRelease(release);
    if(JSON.stringify(existing)!==JSON.stringify(descriptor))throw Error('Refusing to replace immutable release');
  }else{
    const stage=resolve(actualOutput,'releases','.building-'+randomUUID());
    await mkdir(stage);
    for(const [path,bytes] of payload){const target=resolve(stage,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
    await writeFile(resolve(stage,'bundle.json'),json(descriptor),{flag:'wx'});
    await writeFile(resolve(stage,'sw.js'),template.replace('__BUNDLE_DESCRIPTOR__',JSON.stringify(descriptor)),{flag:'wx'});
    await verifyOfflineRelease(stage);
    await rename(stage,release);
  }
  await writeFile(resolve(actualOutput,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>算法工作台离线实验入口</title><body><h1>算法工作台离线实验</h1><p>首次准备需要联网。请打开下面固定版本入口，并把固定版本入口添加到主屏幕。</p><p><a href="./releases/${descriptor.bundleId}/index.html">打开当前版本 ${descriptor.bundleId}</a></p><p>iPad 真机离线尚待验证。本页不自动更新或替换已有会话。</p></body></html>\n`);
  let revision='unknown';try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),sourceBaseRevision:revision,bundleId:descriptor.bundleId,
    compatibilityId:descriptor.compatibilityId,resourceManifestHash:descriptor.resourceManifestHash,
    resourceCount:resources.length,totalBytes:descriptor.totalBytes,releaseDirectory:release,
    entryPath:`/releases/${descriptor.bundleId}/index.html`,workerSha256:hash(await readFile(resolve(release,'sw.js'))),
    descriptorSha256:hash(await readFile(resolve(release,'bundle.json'))),
    declaration:'Local Web experiment package only. No hosted iPad URL, G2 result, frozen profile or distribution license clearance is implied.'};
  await writeFile(resolve(local,'latest-build.json'),json(report));
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildOfflineSite(),null,2));
