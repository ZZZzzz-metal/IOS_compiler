// Loopback static development host. Compilation/execution stays in browser Workers.
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
const port=Number(process.env.UI_PROBE_PORT??4184);
const types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.md':'text/plain; charset=utf-8','.wasm':'application/wasm'};
createServer(async(req,res)=>{
  try{
    if(process.env.UI_PROBE_TRACE==='1')console.log(`${req.method} ${req.url}`);
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    let path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(path==='/')path='/ui/probe.html';
    if(path.includes('\\')||path.split('/').some(s=>['.git','.agents','.codex','.aws','..','.'].includes(s)))throw Error('Invalid path');
    const target=await realpath(resolve(root,...path.slice(1).split('/')));
    if(!target.startsWith(root+sep))throw Error('Outside root');
    const bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'}).end('Local resource unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`UI prototype http://127.0.0.1:${port}/ui/probe.html (development computer only)`));
