// Independent loopback fixture. Serves unmodified product files; only the next
// candidate HTTP response can be held/released through visible test controls.
import {createServer} from 'node:http';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const here=new URL('./',import.meta.url),root=await realpath(fileURLToPath(new URL('../../../../',here)));
const port=4215,events=[];let arm=false,held=null,candidateRequests=0;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.md':'text/plain; charset=utf-8'};
const state=()=>({origin:`http://127.0.0.1:${port}`,nextCandidateHeld:arm,heldAttempt:held?.attempt??null,candidateRequests,events});
async function log(kind,details={}){events.push({at:new Date().toISOString(),kind,...details});await writeFile(new URL('host-events.json',here),JSON.stringify(state(),null,2)+'\n');}
const controls=()=>`<!doctype html><meta charset="utf-8"><title>5号独立HTTP夹具</title><h1>5号独立HTTP夹具</h1><p>仅控制本测试origin的下一次candidate响应；产品脚本、File.text、Worker和草稿不替换。</p><form method="post" action="/_validation/arm"><button>挂起下一次清单请求</button></form><form method="post" action="/_validation/success"><button>放行原始清单</button></form><form method="post" action="/_validation/failure"><button>以503结束当前请求</button></form><form method="get" action="/_validation/control"><button>刷新夹具状态</button></form><pre>${JSON.stringify(state(),null,2)}</pre>`;
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,`http://127.0.0.1:${port}`).pathname);
    if(pathname.startsWith('/_validation/')){
      if(req.method==='POST'){
        if(pathname==='/_validation/arm'){if(held)throw Error('A response is already held');arm=true;await log('armed');}
        else if(pathname==='/_validation/success'||pathname==='/_validation/failure'){
          if(!held)throw Error('No held response');const pending=held;held=null;
          const failed=pathname.endsWith('/failure');await log(failed?'released-503':'released-original',{attempt:pending.attempt});
          pending.res.writeHead(failed?503:200,{'Content-Type':failed?'text/plain':'application/json','Cache-Control':'no-store'}).end(failed?'Independent validation fixture: intentional 503':pending.bytes);
        }else throw Error('Unknown fixture command');
        res.writeHead(303,{Location:'/_validation/control'}).end();return;
      }
      if(req.method==='GET'&&pathname==='/_validation/control'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(controls());return;}
      res.writeHead(405).end();return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    const path=pathname==='/'?'/ui/probe.html':pathname;
    if(path.includes('\\')||path.split('/').some(s=>['.git','.agents','.codex','.aws','..','.'].includes(s)))throw Error('Invalid path');
    const target=await realpath(resolve(root,...path.slice(1).split('/')));if(!target.startsWith(root+sep))throw Error('Outside root');
    const bytes=await readFile(target);
    if(path==='/ui/.local/candidate.json'&&req.method==='GET'){
      const attempt=++candidateRequests;await log('candidate-request',{attempt,hold:arm});
      if(arm){arm=false;held={res,bytes,attempt};await log('candidate-held',{attempt});return;}
    }
    res.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}).end(req.method==='HEAD'?undefined:bytes);
  }catch(error){res.writeHead(400,{'Content-Type':'text/plain'}).end(error.message);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Independent fixture http://127.0.0.1:${port}/_validation/control ; app /ui/probe.html`));
