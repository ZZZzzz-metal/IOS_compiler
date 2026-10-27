import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {X509Certificate,createPrivateKey,createPublicKey,createHash,checkPrimeSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {request} from 'node:https';
import {fileURLToPath} from 'node:url';
const folders=(await readdir(new URL('./tls/',import.meta.url))).filter(s=>s.startsWith('local-https-')).sort();
const packageURL=new URL('./tls/'+folders.at(-1)+'/',import.meta.url);
const setup=JSON.parse(await readFile(new URL('setup.json',packageURL),'utf8'));
const ca=await readFile(new URL('root-ca.pem',packageURL));
const der=await readFile(new URL('root-ca.cer',packageURL));
const root=new X509Certificate(ca),leaf=new X509Certificate(await readFile(new URL('server-cert.pem',packageURL)));
assert(root.ca);assert(!leaf.ca);assert(root.verify(root.publicKey));assert(leaf.verify(root.publicKey));
assert(leaf.checkIssued(root));assert.equal(leaf.checkIP('127.0.0.1'),'127.0.0.1');assert.equal(leaf.checkHost('localhost'),'localhost');
assert.equal('sha256:'+createHash('sha256').update(der).digest('hex'),setup.rootSHA256);
assert.equal(new Date(leaf.validTo).toISOString(),new Date(setup.expiresAt).toISOString());
const privateKey=createPrivateKey(await readFile(new URL('server-key.pem',packageURL)));
assert(createPublicKey(privateKey).equals(leaf.publicKey));
assert(!(await readdir(packageURL)).some(s=>s.includes('root')&&s.includes('key')));
const processHandle=spawn(process.execPath,[fileURLToPath(new URL('../serve.mjs',import.meta.url))],{env:{...process.env,OFFLINE_HOST:'127.0.0.1',OFFLINE_PORT:'4188',OFFLINE_TLS_CERT:fileURLToPath(new URL('server-cert.pem',packageURL)),OFFLINE_TLS_KEY:fileURLToPath(new URL('server-key.pem',packageURL))},stdio:['ignore','pipe','pipe']});
const done=new Promise(resolve=>processHandle.once('exit',(code,signal)=>resolve({code,signal})));
const get=(path,trust=true)=>new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:4188,path,method:'GET',...(trust?{ca}:{}),rejectUnauthorized:true},res=>{
    res.resume();res.once('end',()=>resolve({status:res.statusCode,authorized:res.socket?.authorized}));
  });req.once('error',reject);req.end();
});
try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('HTTPS server startup timed out')),10000);processHandle.once('exit',code=>{clearTimeout(timeout);reject(new Error('HTTPS server exited '+code));});processHandle.stderr.on('data',bytes=>{clearTimeout(timeout);reject(new Error(bytes.toString()));});processHandle.stdout.on('data',bytes=>{if(bytes.toString().includes('Offline Web experiment:')){clearTimeout(timeout);resolve();}});});
  const response=await get('/');assert.equal(response.status,200);
  await assert.rejects(get('/',false),error=>['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code));
  const missing=await get('/server-key.pem');assert.equal(missing.status,404);
  const report={schemaVersion:1,checkedAt:new Date().toISOString(),packageId:setup.packageId,rootSHA256:setup.rootSHA256,
    checks:{rootSelfSignature:true,leafSignatureByRoot:true,CAConstraints:true,subjectAlternativeNameIP:true,subjectAlternativeNameLocalhost:true,privateKeyMatchesLeaf:true,fingerprintMatchesDER:true,expiryMatchesReport:true,rootKeyNotSaved:true,customCARootHTTPS200:true,systemTrustStillRejects:true,privateKeyNotServed:true},
    declaration:'Node HTTPS/X509 loopback verification only. No system certificate installation, LAN exposure, or iPad verification.'};
  await writeFile(new URL('./tls-check-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally { processHandle.kill();await done; }
