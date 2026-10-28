// Person05 localhost-only static host and visible, bounded Cache API fault fixture.
// The archived product files are served byte-for-byte. No product handler is patched.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,realpath,open} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const bundleId='ipad-web-probe-eb5236b6ed8f9aab4a9d9ced';
const expectedProfile='integration-prototype-60eb6729284e2729';
assert(process.env.PERSON05_SITE_ROOT,'Set PERSON05_SITE_ROOT to the independently extracted site directory');
const siteRoot=await realpath(resolve(process.env.PERSON05_SITE_ROOT));
const ownRoot=await realpath(fileURLToPath(new URL('../',import.meta.url)));
assert(siteRoot.startsWith(ownRoot+sep),'Fixture serves only a site extracted inside this validation checkout');
const releaseRoot=resolve(siteRoot,'releases',bundleId);
const descriptor=JSON.parse(await readFile(resolve(releaseRoot,'bundle.json'),'utf8'));
assert.equal(descriptor.bundleId,bundleId);assert.equal(descriptor.compatibilityId,expectedProfile);
const port=Number(process.env.PERSON05_PORT??4235);
assert(Number.isInteger(port)&&port>0&&port<65536,'Invalid PERSON05_PORT');
let requestLog=null;
if(process.env.PERSON05_REQUEST_LOG){
 const logPath=resolve(process.env.PERSON05_REQUEST_LOG),logParent=await realpath(resolve(logPath,'..'));
 assert(logParent.startsWith(resolve(ownRoot,'tests','evidence')+sep),'Request log must be inside tests/evidence');
 requestLog=await open(logPath,'wx');
}
const record=async value=>{const line=JSON.stringify({at:new Date().toISOString(),...value})+'\n';process.stdout.write(line);if(requestLog)await requestLog.write(line);};
const controlHTML=(await readFile(new URL('./offline-cache-control.html',import.meta.url),'utf8')).replaceAll('__PERSON05_TEST_PORT__',String(port));
const types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.wasm':'application/wasm'};
const headers=type=>({'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
const server=createServer(async(req,res)=>{
 let status=500,resource='unparsed';
 try{
  if(!['GET','HEAD'].includes(req.method)){status=405;res.writeHead(status,{'Allow':'GET, HEAD'}).end();return;}
  // Check the raw path before URL normalization can hide dot segments.
  const rawPath=String(req.url).split(/[?#]/,1)[0];
  const path=decodeURIComponent(rawPath);
  assert(path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0'),'Invalid path');
  assert(!path.split('/').some(part=>part==='.'||part==='..'||part.startsWith('.building-')),'Invalid path');
  resource=path;
  if(path==='/_person05/cache-control.html'){
    status=200;res.writeHead(status,headers('text/html; charset=utf-8'));res.end(req.method==='HEAD'?undefined:controlHTML);return;
  }
  // Restrict the static host to this single audited immutable release.
  const releasePrefix='/releases/'+bundleId+'/';
  assert(path.startsWith(releasePrefix),'Only the chosen release is served');
  const withIndex=path.endsWith('/')?path+'index.html':path;
  const target=await realpath(resolve(siteRoot,...withIndex.slice(1).split('/')));
  const realRelease=await realpath(releaseRoot);
  assert(target.startsWith(realRelease+sep),'Outside selected release');
  const bytes=await readFile(target);
  status=200;res.writeHead(status,headers(types[extname(target)]??'application/octet-stream'));
  res.end(req.method==='HEAD'?undefined:bytes);
 }catch{
  status=404;res.writeHead(status,headers('text/plain; charset=utf-8')).end('Person05 static test resource not found.');
 }finally{
  await record({type:'request',method:req.method,path:resource,status});
 }
});
server.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>void record({type:'listening',host:'127.0.0.1',port,bundleId,profile:expectedProfile,siteRoot,releaseURL:`http://127.0.0.1:${port}/releases/${bundleId}/index.html`,controlURL:`http://127.0.0.1:${port}/_person05/cache-control.html`}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(async()=>{await record({type:'stopped',signal});await requestLog?.close();process.exit(0);});});
