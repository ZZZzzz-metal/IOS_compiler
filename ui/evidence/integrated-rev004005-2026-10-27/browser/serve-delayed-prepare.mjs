// Test-only loopback static host. Serves the unmodified workbench and resources.
// Candidate responses wait 4s; the third candidate request returns HTTP 503.
// No browser APIs, Worker modules, File.text or application state are replaced.
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import {setTimeout} from 'node:timers/promises';
const root=await realpath(fileURLToPath(new URL('../../../../',import.meta.url)));
const types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.md':'text/plain; charset=utf-8','.wasm':'application/wasm'};
let candidateRequests=0;
createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    let pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(pathname==='/')pathname='/ui/probe.html';
    if(pathname.includes('\\')||pathname.split('/').some(s=>['.git','.agents','.codex','.aws','..','.'].includes(s)))throw Error('Invalid path');
    if(pathname==='/ui/.local/candidate.json'){
      const attempt=++candidateRequests;console.log(`candidate attempt ${attempt}`);
      await setTimeout(4000);
      if(attempt===3){res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end('Intentional test failure');return;}
    }
    const target=await realpath(resolve(root,...pathname.slice(1).split('/')));
    if(!target.startsWith(root+sep))throw Error('Outside root');
    const bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'}).end('Local resource unavailable');}
}).listen(4204,'127.0.0.1',()=>console.log('Test UI http://127.0.0.1:4204/ui/probe.html; candidate delay=4000ms; failure attempt=3'));
