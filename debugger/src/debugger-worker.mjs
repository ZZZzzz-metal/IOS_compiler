import {installWorkerBridge} from './worker-bridge.mjs';
installWorkerBridge({listen:handler=>{self.onmessage=event=>handler(event.data);},send:data=>self.postMessage(data),
  makeReader:baseURL=>async path=>{
    const base=new URL(baseURL),url=new URL(path,base);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw new Error('Resource escapes worker project root');
    const response=await fetch(url);
    if(!response.ok)throw new Error(`Local resource could not be read: ${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }});
