// Person05 serves one independently extracted immutable release on loopback.
// Product bytes and request handlers are unchanged; no synthetic provider is added.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, realpath, open} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const bundleId='ipad-web-probe-cbe80b74ccc3d3cebece9e73';
const profile='integration-prototype-80135c59f01b26fc';
const ownRoot=await realpath(fileURLToPath(new URL('../',import.meta.url)));
assert(process.env.PERSON05_SITE_ROOT,'Set PERSON05_SITE_ROOT');
const siteRoot=await realpath(resolve(process.env.PERSON05_SITE_ROOT));
assert(siteRoot.startsWith(ownRoot+sep),'Only an extraction in the validation checkout may be served');
const releaseRoot=await realpath(resolve(siteRoot,'releases',bundleId));
const descriptor=JSON.parse(await readFile(resolve(releaseRoot,'bundle.json'),'utf8'));
assert.equal(descriptor.bundleId,bundleId);assert.equal(descriptor.compatibilityId,profile);
const port=Number(process.env.PERSON05_PORT??4255);
assert(Number.isInteger(port)&&port>1024&&port<65536);
const logPath=resolve(process.env.PERSON05_REQUEST_LOG??'');
assert((await realpath(resolve(logPath,'..'))).startsWith(resolve(ownRoot,'tests','evidence')+sep));
const log=await open(logPath,'wx');
const record=async data=>{const line=JSON.stringify({at:new Date().toISOString(),...data})+'\n';await log.write(line);process.stdout.write(line);};
const types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{
 let status=500,path=String(req.url);
 try{
  assert(['GET','HEAD'].includes(req.method));
  path=decodeURIComponent(String(req.url).split(/[?#]/,1)[0]);
  assert(path.startsWith('/releases/'+bundleId+'/'));
  assert(!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(p=>p==='.'||p==='..'));
  const target=await realpath(resolve(siteRoot,...(path.endsWith('/')?path+'index.html':path).slice(1).split('/')));
  assert(target.startsWith(releaseRoot+sep));
  const bytes=await readFile(target);
  status=200;res.writeHead(status,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(req.method==='HEAD'?undefined:bytes);
 }catch{status=404;res.writeHead(status,{'Content-Type':'text/plain'}).end('Person05 fixed-release resource not found.');}
 finally{await record({type:'request',method:req.method,path,status});}
});
server.on('error',error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>void record({type:'listening',host:'127.0.0.1',port,bundleId,profile,siteRoot,pid:process.pid}));
let closing=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;server.close(async()=>{await record({type:'stopped',signal});await log.close();process.exit(0);});});
