// Development-only Node transport. The interpreter/parser/adapter stay portable.
import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {installWorkerBridge} from './worker-bridge.mjs';
installWorkerBridge({listen:handler=>parentPort.on('message',handler),send:data=>parentPort.postMessage(data),
  makeReader:baseURL=>async path=>{
    const base=new URL(baseURL),url=new URL(path,base);
    if(url.protocol!=='file:'||!url.href.startsWith(base.href))throw new Error('Resource escapes Node worker project root');
    return new Uint8Array(await readFile(url));
  }});
