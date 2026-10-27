import {DebuggerAdapter} from './debugger-adapter.mjs';
import {virtualPath} from './integrity.mjs';
export function installWorkerBridge({listen,send,makeReader}) {
  let adapter;const memoryResources=new Map();
  listen(async message=>{
    if(message.kind==='init') {
      try {
        adapter?.dispose();
        const reader=makeReader(message.baseURL);
        for(const item of message.memoryResources??[])memoryResources.set(virtualPath(item.path),item.bytes);
        adapter=new DebuggerAdapter({profile:message.profile,resources:message.resources,
          readResource:path=>memoryResources.has(path)?memoryResources.get(path).slice():reader(path),sliceInstructions:message.sliceInstructions});
        adapter.subscribe(event=>send({kind:'event',event}));send({kind:'ready'});
      }catch(error){send({kind:'init-error',message:error.message});}
      return;
    }
    if(message.kind!=='rpc')return;
    try {
      if(message.method==='putResource') {
        const {path,bytes}=message.input;virtualPath(path);
        if(!(bytes instanceof Uint8Array)||bytes.length>16*1024*1024||memoryResources.size>=8&&!memoryResources.has(path))throw new Error('In-memory build resource limit');
        memoryResources.set(path,bytes.slice());send({kind:'reply',id:message.id,result:true});return;
      }
      if(!adapter||!['command','query','resync','background'].includes(message.method))throw new Error('Worker is not initialized or RPC is unsupported');
      const result=await adapter[message.method](message.input);
      send({kind:'reply',id:message.id,result});
    }catch(error){send({kind:'rpc-error',id:message.id,message:error.message});}
  });
}
