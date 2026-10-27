// Serves only generated experiment resources. There are no compiler or draft APIs.
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await realpath(fileURLToPath(new URL('./.local/site/',import.meta.url)));
const host=process.env.OFFLINE_HOST??'127.0.0.1';
const port=Number(process.env.OFFLINE_PORT??4187);
const cert=process.env.OFFLINE_TLS_CERT,key=process.env.OFFLINE_TLS_KEY;
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid OFFLINE_PORT');
if(Boolean(cert)!==Boolean(key))throw Error('Provide both OFFLINE_TLS_CERT and OFFLINE_TLS_KEY');
if(!['127.0.0.1','localhost','::1'].includes(host)&&!cert)throw Error('iPad/LAN service requires trusted HTTPS. Plain LAN HTTP cannot install the offline worker.');
const types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.wasm':'application/wasm'};
const handler=async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end();return;}
    let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path.includes('\\')||path.split('/').some(s=>s==='..'||s==='.'||s.startsWith('.building-')))throw Error('Invalid resource path');
    if(path.endsWith('/'))path+='index.html';
    const target=await realpath(resolve(root,...path.slice(1).split('/')));
    if(!target.startsWith(root+sep))throw Error('Outside generated package');
    const bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('离线实验资源不存在。');}
};
const server=cert?httpsServer({cert:await readFile(cert),key:await readFile(key)},handler):httpServer(handler);
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,host,()=>console.log(`Offline Web experiment: ${cert?'https':'http'}://${host.includes(':')?'['+host+']':host}:${port}/\n${cert?'iPad must trust this HTTPS certificate and reach this address.':'Desktop localhost only; this is not an iPad URL.'}\nCompilation and execution remain inside the browser.`));
