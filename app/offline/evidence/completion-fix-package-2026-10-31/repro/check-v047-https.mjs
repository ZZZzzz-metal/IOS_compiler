import {readFile,writeFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {X509Certificate,createHash} from 'node:crypto';
import {request} from 'node:https';
import assert from 'node:assert/strict';
const tls='app/offline/.local/tls/local-https-20261026T012959Z-a065aa18/';
const setup=JSON.parse(await readFile(tls+'setup.json','utf8'));
const rootBytes=await readFile(tls+'root-ca.pem');
const root=new X509Certificate(rootBytes),leaf=new X509Certificate(await readFile(tls+'server-cert.pem'));
const digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const addressPresent=Object.values(networkInterfaces()).flat().some(item=>item.address===setup.address&&!item.internal);
assert(addressPresent,'Configured interface address changed');
assert(root.ca&&leaf.verify(root.publicKey)&&leaf.checkIP(setup.address));
assert.equal(digest(root.raw),setup.rootSHA256);
assert(Date.parse(leaf.validFrom)<=Date.now()&&Date.parse(leaf.validTo)>Date.now()+24*3600e3);
const get=path=>new Promise((resolve,reject)=>{
 const req=request({hostname:setup.address,port:setup.port,path,ca:rootBytes,rejectUnauthorized:true,timeout:10000},res=>{
  const chunks=[]; const authorized=res.socket.authorized;
  res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,authorized,type:res.headers['content-type'],body:Buffer.concat(chunks)}));
 });req.on('timeout',()=>req.destroy(new Error('HTTPS timeout')));req.on('error',reject);req.end();
});
const before=process.argv.includes('--before');
const result={checkedAt:new Date().toISOString(),kind:'same-computer-strict-https-check',configuredAddressPresent:addressPresent,
 certificateRootSHA256:setup.rootSHA256,certificateExpiresAt:leaf.validTo,certificateChainAndHostnameVerified:true,ipadConnectivity:'pending-user-test'};
if(before){
 const response=await get('/');assert.equal(response.status,200);assert(response.authorized);result.siteRoot200=true;
}else{
 const build=JSON.parse(await readFile('app/offline/.local/latest-build.json','utf8'));
 const base=build.entryPath.slice(0,-'index.html'.length);
 for(const [path,expectedHash] of [[build.entryPath,null],[base+'bundle.json',build.descriptorSha256],[base+'sw.js',build.workerSha256],
   [base+'compiler/resources/completion-semantics-v1.cpp.patch',null]]){
  const response=await get(path);assert.equal(response.status,200);assert(response.authorized);
  if(expectedHash)assert.equal(digest(response.body),expectedHash);
  if(path.endsWith('.patch'))assert.match(response.type,/text\/plain/);
 }
 const descriptor=JSON.parse((await get(base+'bundle.json')).body);
 assert.equal(descriptor.resources.length,build.resourceCount);
 for(let start=0;start<descriptor.resources.length;start+=4){
  await Promise.all(descriptor.resources.slice(start,start+4).map(async resource=>{
   const response=await get(base+resource.path);assert.equal(response.status,200);assert(response.authorized);
   assert.equal(response.body.length,resource.byteLength);assert.equal(digest(response.body),resource.sha256);
  }));
 }
 for(const path of ['/server-key.pem','/.git/config','/../app/offline/.local/tls/server-key.pem'])assert.equal((await get(path)).status,404);
 Object.assign(result,{bundleId:build.bundleId,resourceCount:build.resourceCount,totalBytes:build.totalBytes,entry200:true,manifestAndWorkerHashVerified:true,
   patchMediaTypeVerified:true,allResourceHTTPSHashesVerified:build.resourceCount,privatePaths404:true});
}
await writeFile('app/offline/evidence/completion-fix-package-2026-10-31/'+(before?'https-before.json':'https.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
