// Loopback static files only. All compilation and execution run in the browser.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const compiler=fileURLToPath(new URL('../../compiler/',import.meta.url));
const port=Number(process.env.DEBUGGER_PROBE_PORT??4173);
const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html; charset=utf-8','.json':'application/json','.wasm':'application/wasm'};
createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const peer=path.startsWith('/debugger/compiler/');
    const base=peer?compiler:root;const relative=peer?path.slice('/debugger/compiler/'.length):path.slice(1);
    if(relative.split('/').some(p=>p==='..'||p==='.'||p==='.git')||relative.includes('\\'))throw new Error('Invalid static path');
    const target=resolve(base,...relative.split('/'));
    if(!target.startsWith(base.endsWith(sep)?base:base+sep))throw new Error('Static path escaped root');
    const bytes=await readFile(target);res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'}).end('Static resource unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`Debugger probe http://127.0.0.1:${port}/debugger/probe.html (static loopback server)`));
