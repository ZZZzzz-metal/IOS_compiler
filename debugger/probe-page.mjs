import {CompilerProbe} from './compiler/src/compiler-probe.mjs';
import {createSnapshot} from './compiler/src/source.mjs';
import {WorkerDebuggerAdapter} from './src/worker-adapter.mjs';
import {digest} from './src/integrity.mjs';
const $=id=>document.getElementById(id);
const keyOf=s=>Object.fromEntries(['sessionId','buildId','sourceHash','compatibilityId'].map(k=>[k,s[k]]));
const pauseKey=e=>({...keyOf(e),pauseId:e.pauseId});
const id=()=>crypto.randomUUID();
let compiler,adapter,key,aborted=false;
const initial=await fetch('./fixtures/debug-handoff/snapshot.json').then(r=>r.json());
$('source').value=initial.files[0].text;
const status=text=>{$('status').textContent=text;};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
$('prepare').onclick=async()=>{
  $('prepare').disabled=true;
  try {
    status('正在校验并缓存编译器、运行器和调试资源…');
    const registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',type:'module'});
    const pending=registration.installing??registration.waiting;
    if(pending&&pending.state!=='activated')await new Promise((resolve,reject)=>{
      pending.addEventListener('statechange',()=>{if(pending.state==='activated')resolve();else if(pending.state==='redundant')reject(new Error('本地资源安装未完成'));});
    });
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    const channel=new MessageChannel();
    const verified=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('离线资源校验超时')),60000);channel.port1.onmessage=e=>{clearTimeout(timer);e.data.ok?resolve():reject(new Error(e.data.message));};});
    navigator.serviceWorker.controller.postMessage({kind:'verify'},[channel.port2]);await verified;
    $('run').disabled=false;status('本地验证资源校验通过，可断开服务器后重新打开本页');
  }catch(error){status('资源准备失败：'+error.message);}finally{$('prepare').disabled=false;}
};
const packageInfo=await fetch('./probe-candidate.json').then(r=>r.json()).catch(()=>null);
if(navigator.serviceWorker.controller&&packageInfo){$('run').disabled=false;status('已加载本地资源；运行前将重新校验实际字节');}
$('cancel').onclick=async()=>{aborted=true;await compiler?.cancel(compiler.active?.request?.requestId);if(adapter&&key)await adapter.command({commandId:id(),kind:'stop',key});status('已请求停止');};
document.addEventListener('visibilitychange',()=>{if(document.hidden)adapter?.background();});
window.addEventListener('pagehide',()=>adapter?.dispose());
$('run').onclick=async()=>{
  $('run').disabled=true;aborted=false;const started=performance.now();const records=[];
  try {
    const candidate=await fetch('./probe-candidate.json').then(r=>r.json());
    compiler=new CompilerProbe();
    adapter=new WorkerDebuggerAdapter({...candidate,baseURL:new URL('../',location.href).href});
    const events=[];adapter.subscribe(event=>events.push(event));
    const command=(kind,extra={})=>adapter.command({commandId:id(),kind,...extra});
    const wait=async(kind,after=0)=>{
      const deadline=performance.now()+30000;
      while(performance.now()<deadline){if(aborted)throw new Error('用户停止');const event=events.find(e=>e.sessionId===key.sessionId&&e.eventSeq>after&&(Array.isArray(kind)?kind.includes(e.kind):e.kind===kind));if(event)return event;await new Promise(resolve=>setTimeout(resolve,5));}
      throw new Error('等待真实执行事件超时：'+kind);
    };
    const compile=async(text,language='cpp')=>{
      status('正在浏览器 Worker 内编译新的 '+(language==='cpp'?'C++17':'C11')+' 源码…');
      text+='\n// fresh browser build '+new Date().toISOString()+' '+id()+'\n';
      const path=language==='cpp'?'main.cpp':'main.c',snapshot=createSnapshot([{path,role:'user',text}],path);
      const result=await compiler.compile({requestId:id(),snapshot,language,standard:language==='cpp'?'c++17':'c11',mode:'debug',optimization:'O0'});
      check(result.status==='compiled',result.rawDiagnostics||result.reason||'编译失败');
      check(result.compilerResourceHash===candidate.profile.compiler.buildHash&&result.linkerResourceHash===candidate.profile.linker.buildHash&&result.sysrootResourceHash===candidate.profile.sysroot.buildHash,'实际编译器与受信候选身份不一致');
      check(await digest(result.executable)===result.executableRef.sha256,'编译产物校验失败');
      const executable={...result.executableRef,relativePath:'debugger/memory-builds/'+result.artifactId+'/main.wasm'};
      await adapter.registerResource(executable.relativePath,result.executable);
      const build={buildId:'browser-'+result.artifactId,requestId:result.requestId,sourceHash:snapshot.sourceHash,snapshotId:snapshot.snapshotId,
        profile:candidate.profile,mode:'debug',language:{language,standard:language==='cpp'?'c++17':'c11'},compilerArguments:result.compilerArguments,
        linkerArguments:result.linkerArguments,executable,debugInfo:[executable],sourceMappings:[]};
      records.push({kind:'real-compile',language,sourceHash:snapshot.sourceHash,executable,metrics:result.metrics,source:snapshot});
      return {snapshot,build};
    };
    const start=async(compiled,{line,stdin=''}={})=>{
      key={sessionId:id(),buildId:compiled.build.buildId,sourceHash:compiled.snapshot.sourceHash,compatibilityId:candidate.profile.compatibilityId};
      const ack=await command('start',{request:{...key,...compiled,mode:'debug',stdin:{text:stdin,encoding:'utf-8',eof:true},
        limits:{runningTimeMs:30000,outputBytes:65536,variablePageSize:100,memoryBytes:268435456},stopOnEntry:false,
        initialBreakpoints:line?[{breakpointId:id(),requested:{sourcePath:compiled.snapshot.translationUnit,line,column:1},enabled:true}]:[]}});
      check(ack.accepted,JSON.stringify(ack));
    };
    const stack=async paused=>{const reply=await adapter.query({requestId:id(),kind:'stack',key:pauseKey(paused),start:0,count:100});check(reply.kind==='stack',JSON.stringify(reply));return reply.frames;};
    const evaluate=async(paused,frame,expression)=>{
      const reply=await adapter.query({requestId:id(),kind:'evaluate',key:{...pauseKey(paused),frameId:frame.frameId},expression,allowSideEffects:false});
      check(reply.kind==='evaluate'&&reply.result.availability==='available',JSON.stringify(reply));return reply.result;
    };
    const compiled=await compile($('source').value);
    const lines=compiled.snapshot.files[0].text.split('\n');
    const mainLine=lines.findIndex(l=>l.includes('int total = sum('))+1;
    check(mainLine>0,'自动验证样例需要保留 int total = sum(...) 行');
    await start(compiled,{line:mainLine});
    let paused=await wait('paused');check(paused.reason==='breakpoint','没有命中源码断点');
    let frames=await stack(paused);const locals={};
    for(const name of ['array','pointer','values','shortText','longText'])locals[name]=await evaluate(paused,frames[0],name);
    records.push({kind:'breakpoint-and-live-values',paused,frames,locals});
    status('断点已命中，正在验证进入、跳出和跳过…');
    check((await command('stepInto',{key:pauseKey(paused)})).accepted,'stepInto rejected');
    const inside=await wait('paused',paused.eventSeq);frames=await stack(inside);
    check(frames[0].functionName.startsWith('sum'),'单步进入未到达 sum');
    check((await evaluate(inside,frames[0],'index')).displayValue==='0','真实参数不符');
    records.push({kind:'stepInto',paused:inside,frames});
    await command('stepOut',{key:pauseKey(inside)});const outside=await wait('paused',inside.eventSeq);
    records.push({kind:'stepOut',paused:outside,frames:await stack(outside)});
    await command('stepOver',{key:pauseKey(outside)});paused=await wait('paused',outside.eventSeq);frames=await stack(paused);
    const total=await evaluate(paused,frames[0],'total');records.push({kind:'stepOver',paused,total});
    await command('continue',{key:pauseKey(paused)});const exit=await wait('terminated',paused.eventSeq);
    check(exit.reason==='exit'&&exit.exitCode===0,'C++ 计算退出状态不正确：'+JSON.stringify(exit));
    const recursiveLine=lines.findIndex(l=>l.includes('int current = values[index]'))+1;
    await start(compiled,{line:recursiveLine});paused=await wait('paused');
    for(let level=0;level<3;level++) {
      frames=await stack(paused);const recursive=frames.filter(f=>f.functionName.startsWith('sum'));
      check(recursive.length===level+1,'递归栈深度不符');
      const values=[];for(const frame of recursive)values.push(await evaluate(paused,frame,'index'));
      records.push({kind:'recursive-frame-values',level,frames:recursive,values});
      if(level<2){await command('continue',{key:pauseKey(paused)});paused=await wait('paused',paused.eventSeq);}
    }
    await command('stop',{key});
    const c=await compile('#include <stdio.h>\nint twice(int n){ return n*2; }\nint main(void){ int n; if(scanf("%d",&n)!=1)return 2; printf("result=%d\\n",twice(n)); fputs("C-stderr\\n",stderr); return 0; }\n','c');
    await start(c,{stdin:'21\n'});const cExit=await wait('terminated');
    const cOutput=events.filter(e=>e.sessionId===key.sessionId&&e.kind==='output');
    check(cExit.reason==='exit'&&cExit.exitCode===0,'C 退出状态错误');
    check(cOutput.filter(e=>e.stream==='stdout').map(e=>e.text).join('')==='result=42\n','C stdin/stdout 不符');
    check(cOutput.filter(e=>e.stream==='stderr').map(e=>e.text).join('')==='C-stderr\n','C stderr 不符');
    records.push({kind:'c-stdin-stdout-stderr',exit:cExit,output:cOutput});
    const loop=await compile('int main(void){ volatile unsigned n=0; while(1){n++;} }\n','c');
    await start(loop);let ticks=0;const ticker=setInterval(()=>ticks++,5);await new Promise(resolve=>setTimeout(resolve,50));clearInterval(ticker);
    const stopAt=performance.now();check((await command('stop',{key})).accepted,'停止死循环失败');
    const stopped=await wait('terminated');check(stopped.reason==='stop'&&ticks>0,'停止或页面响应失败');
    records.push({kind:'infinite-loop-stopped',ticks,stopMs:performance.now()-stopAt,event:stopped});
    await start(compiled,{line:mainLine});const restarted=await wait('paused');check(restarted.reason==='breakpoint','停止后新会话未命中');await command('stop',{key});
    const report={status:'passed',scope:'Desktop browser local fresh compilation + actual source debugging. iPad and full product remain unverified.',
      userAgent:navigator.userAgent,when:new Date().toISOString(),controlledByServiceWorker:!!navigator.serviceWorker.controller,
      profile:candidate.profile.compatibilityId,elapsedMs:performance.now()-started,checks:['fresh-cpp-compile','source-breakpoint','live-array-pointer-vector-string','stepInto','stepOut','stepOver','recursive-caller-values','fresh-c-stdin-stdout-stderr','stop-infinite-loop','restart-after-stop'],records,events};
    $('result').textContent=JSON.stringify({...report,records:undefined,events:undefined},null,2);$('trace').textContent=JSON.stringify(report,null,2);
    status('全部真实编译调试验证通过；iPad 真机待验证');
  }catch(error){status('验证失败：'+error.message);$('result').textContent=error.stack||error.message;$('trace').textContent=JSON.stringify(records,null,2);}
  finally{adapter?.dispose();$('run').disabled=false;}
};
