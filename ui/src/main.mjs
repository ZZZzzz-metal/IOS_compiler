import {CompilerAdapter} from '../../compiler/src/compiler-adapter.mjs';
import {createSnapshot} from '../../compiler/src/source.mjs';
import {WorkerDebuggerAdapter} from '../../debugger/src/worker-adapter.mjs';
import {digest} from '../../debugger/src/integrity.mjs';
import {SessionController} from './session-controller.mjs';
import {highlight,indentSelection,breakpointView} from './editor.mjs';
import {createDraftStore,createDraft,serializeDraft,parseImport} from '../../storage/src/draft-store.mjs';
import {createAutosave} from '../../storage/src/autosave.mjs';
import {assertTrustedOfflineWorkers} from '../../app/offline/browser/trust.mjs';

const $=id=>document.getElementById(id),uuid=()=>crypto.randomUUID();
const example='#include <cstdio>\n#include <vector>\n#include <string>\n\nint add(int left, int right) {\n    int answer = left + right;\n    return answer;\n}\n\nint main() {\n    int n = 3;\n    std::scanf("%d", &n);\n    std::vector<int> values = {1, 2, 3};\n    std::string label = "sum";\n    int array[3] = {4, 5, 6};\n    int total = add(n, values[0]);\n    for (int i = 0; i < 3; ++i) {\n        total += array[i];\n    }\n    std::printf("%s=%d\\n", label.c_str(), total);\n    return 0;\n}\n';
let draft=createDraft({userText:example,stdin:'3\n'}),currentTab='user',snapshotMode=false;
let activeSnapshot=null,diagnosticSnapshot=null,diagnostics=[],requested=[],ready=false,prepared=null,preparing=false;
let adapter=null,controller=null,compiler=null,compilation=null,restored=false,saveFailed=false;
let renderPending=false,renderedInspection='',watchKey='',watched=null,autoSave;
let unqueuedEdits=false,recovering=false;
let importSequence=0,draftGeneration=0;
const store=createDraftStore();
const fault=error=>{ $('message').hidden=false;$('message').textContent=error?.message??String(error); };
const safe=action=>(...args)=>Promise.resolve().then(()=>action(...args)).catch(fault);
const view=()=>controller?.getView()??{session:null,frames:[],scopes:[],variables:[],breakpoints:[],outputTail:[],actions:{}};
const language=()=>draft.language.language;
function filesOf(value=draft){
  const driver=Boolean(value.driverText.trim()),ext=value.language.language==='c'?'c':'cpp';
  const userPath=driver?'user.inc':`main.${ext}`,driverPath=`driver.${ext}`;
  return {userPath,driverPath,translationUnit:driver?driverPath:userPath,files:[{path:userPath,role:'user',text:value.userText},...(driver?[{path:driverPath,role:'driver',text:value.driverText}]:[])]};
}
function makeSnapshot(){const files=filesOf();return createSnapshot(files.files,files.translationUnit);}
function unchanged(snapshot){try{return snapshot?.sourceHash===makeSnapshot().sourceHash;}catch{return false;}}
function pathFor(tab=currentTab){
  if(snapshotMode&&activeSnapshot)return activeSnapshot.files.find(f=>f.role===(tab==='user'?'user':'driver'))?.path;
  return tab==='user'?filesOf().userPath:filesOf().driverPath;
}
function displayedText(){
  if(snapshotMode)return activeSnapshot?.files.find(f=>f.path===pathFor())?.text??'';
  return currentTab==='user'?draft.userText:draft.driverText;
}
function scheduleRender(){if(renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;render();});}
function scheduleSave(){
  draftGeneration++;
  draft.updatedAt=new Date().toISOString();
  try{if(!restored)throw Error('原草稿尚未成功读取。请导出当前编辑，或存为恢复副本，避免覆盖原稿。');autoSave.schedule(draft);}catch(error){unqueuedEdits=true;saveFailed=true;$('save-recovery').hidden=false;fault(error);}
}
function edited(){
  if(snapshotMode)return;
  if(currentTab==='user')draft.userText=$('source').value;else draft.driverText=$('source').value;
  scheduleSave();render();
}
function showText(){ $('source').value=displayedText();$('source').readOnly=snapshotMode;render(); }
function selectedPosition(s){return s.frames.find(f=>f.frameId===s.session?.frameId)?.position??s.session?.position;}
function displayedBreakpoints(s){
  return breakpointView({snapshotMode,requested,bindings:s.breakpoints,sourceUnchanged:unchanged(activeSnapshot),
    sessionMatchesSnapshot:Boolean(activeSnapshot&&s.session?.sourceHash===activeSnapshot.sourceHash)});
}
function renderEditor(s){
  const position=selectedPosition(s),sameSource=unchanged(activeSnapshot);
  const breakpoints=displayedBreakpoints(s);
  const line=s.actions.inspect&&position?.sourcePath===pathFor()&&(snapshotMode||sameSource)?position.line:null;
  $('highlight').innerHTML=highlight($('source').value,line);
  const gutter=$('gutter');gutter.replaceChildren();
  const lines=$('source').value.split('\n');
  for(let index=0;index<Math.min(lines.length,10000);index++){
    const lineNumber=index+1,button=document.createElement('button');button.type='button';button.tabIndex=-1;button.textContent=String(lineNumber);
    button.dataset.bp=String(breakpoints.entries.some(bp=>bp.requested.sourcePath===pathFor()&&bp.requested.line===lineNumber));
    button.dataset.current=String(lineNumber===line);button.title=`第 ${lineNumber} 行：切换断点`;
    button.disabled=breakpoints.readOnly;
    button.onclick=()=>toggleBreakpoint(lineNumber);gutter.append(button);
  }
  // Focusing a gutter button can scroll that container independently. The text
  // editor is the single scroll authority for line numbers and syntax overlay.
  syncScroll();
  $('filename').textContent=pathFor()??'此快照没有测试驱动';
  $('user-tab').setAttribute('aria-pressed',String(currentTab==='user'));
  $('driver-tab').setAttribute('aria-pressed',String(currentTab==='driver'));
  $('snapshot-toggle').disabled=!activeSnapshot;
  $('snapshot-toggle').setAttribute('aria-pressed',String(snapshotMode));
  $('snapshot-toggle').textContent=snapshotMode?'返回编辑稿':'查看调试快照';
  $('snapshot-label').textContent=snapshotMode?'调试快照 · 只读':activeSnapshot&&!sameSource?'源码已修改 · 请重新编译':'编辑中的草稿';
  $('driver-help').hidden=currentTab!=='driver'||snapshotMode;
  for(const id of ['indent','outdent','driver-template'])$(id).disabled=snapshotMode;
  $('breakpoint').disabled=breakpoints.readOnly;
}
function labelPosition(p){return p?`${p.sourcePath}:${p.line}:${p.column}`:'未提供源码位置';}
function appendEmpty(target,text){target.className='list empty';target.textContent=text;}
function renderBreakpoints(s){
  const target=$('breakpoints');target.replaceChildren();target.className='list';
  const display=displayedBreakpoints(s);
  const context=document.createElement('div');context.className='hint';
  context.textContent=display.readOnly?'当前调试快照的断点（只读）':activeSnapshot&&!unchanged(activeSnapshot)?'编辑稿断点（下次编译生效）':'编辑稿断点';
  target.append(context);
  for(const bp of display.entries){
    const text=document.createElement('div');
    const names={bound:'已绑定',invalid:'无效',pending:'待绑定'};
    text.textContent=`${labelPosition(bp.requested)} · ${names[bp.status]}${bp.actual.length?' → '+bp.actual.map(labelPosition).join('、'):''}${bp.reason?'：'+bp.reason:''}`;
    target.append(text);
  }
  if(!display.entries.length)appendEmpty(target,display.readOnly?'当前调试快照没有断点。':activeSnapshot&&!unchanged(activeSnapshot)?'编辑稿没有断点；变更在下次编译生效。':'尚未设置断点。点击行号，或使用“在当前行切换断点”。');
  const diag=$('diagnostics');diag.replaceChildren();diag.className='list';
  for(const item of diagnostics){
    const button=document.createElement('button');button.textContent=`${item.severity} · ${item.message}${item.range?' · '+labelPosition(item.range.start):''}`;
    button.disabled=!item.range;button.onclick=()=>navigate(item.range.start,diagnosticSnapshot);diag.append(button);
  }
  if(!diagnostics.length)appendEmpty(diag,'暂无编译诊断');
}
function createVariable(variable,s){
  const root=document.createElement('div');root.className='variable';
  const line=document.createElement('p'),name=document.createElement('code');name.textContent=variable.name;line.append(name);
  const type=document.createElement('em');type.textContent=` ${variable.type??''} `;line.append(type);
  const value=document.createElement('span');value.textContent=variable.availability==='available'?variable.displayValue:`不可读取：${variable.reason??variable.availability}`;line.append(value);root.append(line);
  if(variable.truncated){const hint=document.createElement('em');hint.textContent='显示已截断';root.append(hint);}
  if(variable.variablesReference&&variable.availability==='available'){
    const expand=document.createElement('button');expand.textContent='展开';const children=document.createElement('div');children.className='children';
    let opened=false,start=0;const token=inspectionKey(s);
    const load=safe(async()=>{
      expand.disabled=true;
      try{
        const reply=await controller.variables(variable.variablesReference,{start,count:50});
        if(token!==inspectionKey(view())||!reply)return;
        if(reply.kind!=='variables')throw new Error(reply.message??'变量不可读取');
        for(const child of reply.variables)children.append(createVariable(child,view()));
        start+=reply.variables.length;expand.hidden=!reply.hasMore;expand.textContent=reply.hasMore?'加载更多':'已展开';
      }finally{expand.disabled=false;}
    });
    expand.onclick=()=>{if(!opened){opened=true;children.replaceChildren();}load();};root.append(expand,children);
  }
  return root;
}
function inspectionKey(s){return [s.session?.sessionId,s.session?.pauseId,s.session?.frameId,s.actions.inspect].join('|');}
function renderInspection(s){
  const key=JSON.stringify({identity:inspectionKey(s),frames:s.frames,variables:s.variables,scopePages:s.scopePages,stackTotal:s.stackTotal});
  if(renderedInspection===key)return;renderedInspection=key;
  const stack=$('stack'),vars=$('variables');stack.replaceChildren();vars.replaceChildren();stack.className=vars.className='list';
  for(const frame of s.frames){
    const button=document.createElement('button');button.textContent=`${frame.functionName} · ${labelPosition(frame.position)}`;button.setAttribute('aria-pressed',String(frame.frameId===s.session?.frameId));button.disabled=!s.actions.inspect;
    button.onclick=safe(async()=>{
      const targetController=controller,snapshot=activeSnapshot,session=s.session;
      const reply=await targetController.selectFrame(frame.frameId),current=view();
      if(!reply||controller!==targetController||current.session?.sessionId!==session.sessionId||current.session?.pauseId!==session.pauseId||current.session?.frameId!==frame.frameId||!current.actions.inspect)return;
      navigate(frame.position,snapshot);
    });stack.append(button);
  }
  if(!s.frames.length)appendEmpty(stack,s.actions.inspect?'正在读取调用栈…':'调试暂停后显示真实调用栈');
  if(s.stackTotal>s.frames.length){const text=document.createElement('p');text.textContent=`调用栈共 ${s.stackTotal} 帧，当前只显示前 ${s.frames.length} 帧。`;stack.append(text);}
  for(const variable of s.variables)vars.append(createVariable(variable,s));
  if(!s.variables.length)appendEmpty(vars,s.actions.inspect?'当前栈帧暂无可显示变量；未提供的值不会补为 0。':'调试暂停后读取变量');
  for(const page of s.scopePages??[])if(page.hasMore){const more=document.createElement('button');more.textContent=`加载更多局部变量 · ${page.scopeName}`;more.onclick=safe(()=>controller.loadMoreScope(page.variablesReference));vars.append(more);}
  if(watchKey!==inspectionKey(s)){watchKey=inspectionKey(s);watched=null;appendEmpty($('watch'),'选择暂停栈帧后查询');}
}
function render(){
  const s=view(),active=s.session&&!['terminated','failed'].includes(s.session.state);
  document.body.dataset.executionState=preparing?'preparing':compilation?'compiling':s.session?.synchronized===false?'syncing':s.session?.state??'idle';
  document.body.dataset.resourceReady=String(ready);
  document.body.dataset.sourceView=snapshotMode?'snapshot':'draft';
  $('run').disabled=$('debug').disabled=!restored||recovering||!ready||!prepared||preparing||Boolean(compilation)||Boolean(active);
  $('prepare').disabled=!restored||recovering||preparing||Boolean(compilation)||Boolean(active);
  $('stop').disabled=!compilation&&!s.actions.stop;
  $('resync').hidden=!s.session||s.session.synchronized;
  for(const button of document.querySelectorAll('[data-command]')){
    const map={continue:'continue',stepInto:'step-into',stepOver:'step-over',stepOut:'step-out'};
    button.disabled=!s.actions[button.dataset.command]||!supports(map[button.dataset.command]);
  }
  $('evaluate').disabled=!s.actions.inspect||!s.session?.frameId||!supports('watch-basic');
  if(preparing)$('status').textContent='正在校验本机编译与调试资源…';
  else if(compilation)$('status').textContent=compilation.cancelled?'正在取消编译…':({loading:'正在准备本机编译器…',compiling:'正在编译源码…',linking:'正在生成程序…',handoff:'正在准备执行环境…'}[compilation.phase]??'正在本机编译，源码仍可编辑…');
  else if(s.session){
    const names={created:'正在创建会话',starting:'正在启动',running:'正在运行',paused:'已暂停',stopping:'正在停止',terminated:'已结束',failed:'执行失败'};
    $('status').textContent=!s.session.synchronized?'会话状态待重新同步':`${names[s.session.state]}${s.session.position?' · '+labelPosition(s.session.position):''}${s.session.pendingControl?' · 等待执行确认':''}`;
  }
  if(s.error)fault(s.error);
  const exit=s.session?.termination;
  $('exit').textContent=exit?`${exit.reason}${exit.exitCode===undefined?'':` · 返回 ${exit.exitCode}`}`:'';
  $('output').textContent=(s.outputTail.map(part=>part.stream==='stderr'?`[错误输出] ${part.text}`:part.text).join('')||'尚无输出')+(s.outputTruncated?'\n[输出已截断，仅显示保留内容]':'');
  renderEditor(s);renderBreakpoints(s);renderInspection(s);
}
function supports(id){return ['implemented-unverified','verified'].includes(prepared?.capabilities.capabilities.find(c=>c.id===id)?.status);}
async function prepare(){
  const s=view(),active=s.session&&!['terminated','failed'].includes(s.session.state);
  if(!restored||recovering||preparing||compilation||active)return;
  preparing=true;ready=false;prepared=null;
  $('message').hidden=true;$('resources').textContent='正在读取并校验本机编译与调试资源…';
  render();
  try{
    const response=await fetch('./.local/candidate.json',{cache:'no-store'});if(!response.ok)throw Error('请先运行四号原型准备步骤。');
    const candidate=await response.json();
    // Only the complete, byte-verified release may serve these execution Workers.
    // Older module experiments remain rejected without deleting their data.
    const offline=await assertTrustedOfflineWorkers(candidate,new URL('../',location.href).href);
    for(const resource of candidate.resources){
      const response=await fetch(new URL(resource.relativePath,new URL('../',location.href)),{cache:'no-store'});
      if(!response.ok)throw Error(`本地资源缺失：${resource.relativePath}`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length!==resource.byteLength||await digest(bytes)!==resource.sha256)throw Error(`本地资源校验失败：${resource.relativePath}`);
    }
    prepared=candidate;ready=true;$('resources').textContent=offline?.offline?'本版本离线资源已校验 · iPad 真机待验证':'本机资源已校验 · 完整离线状态待集成验收';$('status').textContent='可编译运行或启动调试。';
  }catch(error){ready=false;prepared=null;$('resources').textContent='资源未就绪';$('status').textContent='资源校验失败，请重试。';fault(error);}finally{preparing=false;render();}
}
async function compile(mode){
  const s=view(),active=s.session&&!['terminated','failed'].includes(s.session.state);
  if(!restored||recovering||!ready||!prepared||preparing||compilation||active)return;
  const candidate=prepared;
  $('message').hidden=true;diagnostics=[];
  const snapshot=makeSnapshot(),requestId=uuid(),task={requestId,cancelled:false};
  compilation=task;diagnosticSnapshot=snapshot;activeSnapshot=null;snapshotMode=false;
  try{
    controller?.dispose();adapter?.dispose();controller=null;adapter=null;compiler=null;
    adapter=new WorkerDebuggerAdapter({profile:candidate.profile,resources:candidate.resources,baseURL:new URL('../',location.href).href});
    controller=new SessionController({adapter,onChange:scheduleRender});
    compiler=new CompilerAdapter({profile:candidate.profile,lock:candidate.lock,
      onProgress:event=>{if(compilation===task){task.phase=event.phase;scheduleRender();}},
      writeResource:(path,bytes)=>{task.phase='handoff';scheduleRender();return adapter.registerResource(path,bytes);}});
    showText();
    const result=await compiler.compile({requestId,snapshot,...draft.language,compatibilityId:candidate.profile.compatibilityId,mode,optimization:'O0'});
    if(compilation!==task)return;
    if(task.cancelled){$('status').textContent='编译已取消，可以重新编译。';return;}
    if(result.requestId!==requestId||result.sourceHash!==snapshot.sourceHash)throw Error('编译返回的源码身份不匹配，请重新编译。');
    diagnostics=result.diagnostics;
    if(result.status!=='succeeded'){$('status').textContent=result.status==='cancelled'?'编译已取消':'编译失败，请查看诊断。';return;}
    if(!unchanged(snapshot)){$('status').textContent='编译期间源码已修改，请重新编译当前稿。';return;}
    activeSnapshot=snapshot;
    const key={sessionId:uuid(),buildId:result.build.buildId,sourceHash:snapshot.sourceHash,compatibilityId:candidate.profile.compatibilityId};
    const ack=await controller.start({...key,build:result.build,snapshot,stdin:{text:draft.stdin,encoding:'utf-8',eof:true},mode,
      initialBreakpoints:mode==='debug'?requested.filter(bp=>snapshot.files.some(f=>f.path===bp.requested.sourcePath)):[],stopOnEntry:mode==='debug',
      limits:{runningTimeMs:30000,outputBytes:65536,variablePageSize:100,memoryBytes:268435456}});
    if(!ack.accepted)throw Error(ack.message);
  }catch(error){$('status').textContent='编译或启动失败，可修正后重试。';fault(error);}finally{if(compilation===task)compilation=null;render();}
}
async function stop(){
  if(compilation&&!view().session){compilation.cancelled=true;render();await compiler.cancel(compilation.requestId);return;}
  if(view().actions.stop)await controller.control('stop');
}
function toggleBreakpoint(line){
  const sourcePath=pathFor();if(!sourcePath||snapshotMode)return;
  const existing=requested.findIndex(bp=>bp.requested.sourcePath===sourcePath&&bp.requested.line===line);
  if(existing>=0)requested.splice(existing,1);else requested.push({breakpointId:uuid(),requested:{sourcePath,line,column:1},enabled:true});
  if(view().actions.setBreakpoints&&unchanged(activeSnapshot))safe(()=>controller.setBreakpoints(sourcePath,requested.filter(bp=>bp.requested.sourcePath===sourcePath)))();
  render();
}
function navigate(position,snapshot){
  if(!position||!snapshot)return;
  if(!unchanged(snapshot)){
    // A diagnostic for an older build remains navigable without marking the edited draft.
    activeSnapshot=snapshot;snapshotMode=true;
  }
  const file=snapshot.files.find(f=>f.path===position.sourcePath);if(!file){fault('该位置没有对应源码文件。');return;}
  currentTab=file.role==='driver'?'driver':'user';showText();
  const text=$('source').value,lines=text.split('\n'),offset=lines.slice(0,position.line-1).reduce((n,l)=>n+l.length+1,0)+position.column-1;
  $('source').focus();$('source').setSelectionRange(offset,offset);$('source').scrollTop=Math.max(0,(position.line-4)*24);syncScroll();
  document.body.dataset.panel='code';$('show-code').setAttribute('aria-pressed','true');$('show-panels').setAttribute('aria-pressed','false');
}
function syncScroll(){ $('highlight').scrollTop=$('source').scrollTop;$('highlight').scrollLeft=$('source').scrollLeft;$('gutter').scrollTop=$('source').scrollTop; }
function indent(outdent){if(snapshotMode)return;const input=$('source'),next=indentSelection(input.value,input.selectionStart,input.selectionEnd,outdent);input.value=next.text;input.setSelectionRange(next.start,next.end);edited();input.focus();}
function findNext(){const text=$('source').value,term=$('find').value;if(!term)return;let offset=text.indexOf(term,$('source').selectionEnd);if(offset<0)offset=text.indexOf(term);if(offset<0){fault('没有找到这段文字。');return;}$('source').focus();$('source').setSelectionRange(offset,offset+term.length);$('source').scrollTop=Math.max(0,(text.slice(0,offset).split('\n').length-4)*24);syncScroll();}
function download(result){const url=URL.createObjectURL(new Blob([result.text],{type:result.mediaType}));const anchor=document.createElement('a');anchor.href=url;anchor.download=result.filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function manualClipboard(kind){$('clipboard-title').textContent=kind==='copy'?'复制题站源码':'粘贴题站源码';$('clipboard-text').value=kind==='copy'?draft.userText:'';$('clipboard-apply').hidden=kind==='copy';$('clipboard-dialog').showModal();$('clipboard-text').focus();if(kind==='copy')$('clipboard-text').select();}
function saveStatus(status){
  document.body.dataset.saveState=status.state;
  saveFailed=status.state==='error';const names={loading:'正在读取本地草稿…',idle:'当前为示例，编辑后自动保存',dirty:'修改待保存…',saving:'正在保存…',saved:`草稿已保存 · 版本 ${status.revision??''}`,error:status.error?.message??'保存失败，请导出当前内容。'};
  $('draft-status').textContent=names[status.state]??status.state;$('save-recovery').hidden=!saveFailed;
}
autoSave=createAutosave({store,onStatus:saveStatus,delayMs:350});
$('prepare').onclick=safe(prepare);$('run').onclick=safe(()=>compile('run'));$('debug').onclick=safe(()=>compile('debug'));$('stop').onclick=safe(stop);
$('resync').onclick=safe(()=>controller.resync());
for(const button of document.querySelectorAll('[data-command]'))button.onclick=safe(()=>controller.control(button.dataset.command));
$('source').oninput=edited;$('source').onscroll=syncScroll;
$('source').onkeydown=event=>{if(event.key==='Tab'&&!event.isComposing&&!snapshotMode){event.preventDefault();indent(event.shiftKey);}};
$('stdin').oninput=()=>{draft.stdin=$('stdin').value;scheduleSave();};
$('language').onchange=()=>{draft.language={language:$('language').value,standard:$('language').value==='c'?'c11':'c++17'};requested=[];scheduleSave();showText();};
$('user-tab').onclick=()=>{currentTab='user';showText();};$('driver-tab').onclick=()=>{currentTab='driver';showText();};
$('snapshot-toggle').onclick=()=>{snapshotMode=!snapshotMode;showText();};
$('driver-template').onclick=()=>{if(draft.driverText)return;draft.driverText='#include <stdio.h>\n#include "user.inc"\n\nint main() {\n    // 在这里填写你的函数或 Solution 调用。\n    return 0;\n}\n';scheduleSave();showText();};
$('breakpoint').onclick=()=>toggleBreakpoint($('source').value.slice(0,$('source').selectionStart).split('\n').length);
$('indent').onclick=()=>indent(false);$('outdent').onclick=()=>indent(true);$('find-next').onclick=findNext;$('find').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();findNext();}};
$('copy').onclick=safe(async()=>{try{await navigator.clipboard.writeText(draft.userText);$('draft-status').textContent='已复制题站源码';}catch{manualClipboard('copy');}});
$('paste').onclick=safe(async()=>{try{draft.userText=await navigator.clipboard.readText();currentTab='user';snapshotMode=false;scheduleSave();showText();}catch{manualClipboard('paste');}});
$('clipboard-dialog').addEventListener('close',()=>{if($('clipboard-dialog').returnValue==='apply'){draft.userText=$('clipboard-text').value;currentTab='user';snapshotMode=false;scheduleSave();showText();}});
$('import').onclick=()=>$('file').click();$('file').onchange=safe(async()=>{
  const file=$('file').files[0];if(!file||recovering)return;
  const request=++importSequence,generation=draftGeneration,target=draft;
  const isCurrent=()=>request===importSequence;
  const matchesDraft=()=>!recovering&&draft===target&&draftGeneration===generation;
  try{
    if(file.size>2*1024*1024)throw Error('原型单文件导入上限为 2 MB。');
    const text=await file.text();
    if(!isCurrent())return;
    if(!matchesDraft()){fault('读取文件期间草稿已修改或切换，已保留当前内容。请重新选择文件导入。');return;}
    const imported=parseImport(text,{filename:file.name,id:target.id});
    draft=imported;requested=[];currentTab='user';snapshotMode=false;$('language').value=language();$('stdin').value=draft.stdin;
    $('message').hidden=true;scheduleSave();showText();
  }catch(error){if(isCurrent()&&matchesDraft())fault(error);}finally{if(isCurrent())$('file').value='';}
});
$('export').onclick=safe(()=>download(serializeDraft(draft,$('export-mode').value)));
$('download-current').onclick=safe(()=>download(serializeDraft(draft,'complete-project')));
$('retry-save').onclick=safe(async()=>{
  if(!restored){
    const saved=await autoSave.restore(draft.id);
    if(saved){saveStatus({state:'error',error:new Error('已找到原草稿；当前编辑尚未保存。请先导出或存为恢复副本，再重开。')});throw Error('当前编辑尚未保存；已保留原草稿，请使用恢复操作。');}
    restored=true;
  }
  autoSave.schedule(draft);unqueuedEdits=false;await autoSave.retry();
});
$('recover-save').onclick=safe(async()=>{
  if(recovering)return;recovering=true;draftGeneration++;render();document.querySelector('main').setAttribute('inert','');document.querySelector('.execution').setAttribute('inert','');
  try{
    const recovered=createDraft({...draft,id:'recovery-'+uuid(),revision:0});await store.save(recovered,null);
    const recoveryAutosave=createAutosave({store,onStatus:saveStatus,delayMs:350});
    const saved=await recoveryAutosave.restore(recovered.id);
    autoSave.dispose();autoSave=recoveryAutosave;draft=saved;restored=true;unqueuedEdits=false;
    history.replaceState(null,'',`#draft=${encodeURIComponent(recovered.id)}`);
    $('draft-status').textContent='当前内容已存为恢复副本，重开此地址可继续恢复。';showText();
  }finally{recovering=false;document.querySelector('main').removeAttribute('inert');document.querySelector('.execution').removeAttribute('inert');render();}
});
$('evaluate').onclick=safe(async()=>{const token=inspectionKey(view()),reply=await controller.evaluate($('expression').value);if(token!==inspectionKey(view())||!reply)return;$('watch').replaceChildren();$('watch').className='list';if(reply.kind==='evaluate'){$('watch').append(createVariable(reply.result,view()));watched=reply.result;}else fault(reply.message);});
for(const [id,panel] of [['show-code','code'],['show-panels','debug']])$(id).onclick=()=>{document.body.dataset.panel=panel;$('show-code').setAttribute('aria-pressed',String(panel==='code'));$('show-panels').setAttribute('aria-pressed',String(panel==='debug'));};
document.addEventListener('keydown',event=>{
  if(event.isComposing||recovering)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&document.activeElement===$('source')){event.preventDefault();$('find').focus();}
  if(event.key==='F5'){event.preventDefault();if(view().actions.continue)safe(()=>controller.control('continue'))();else if(!$('debug').disabled)safe(()=>compile('debug'))();}
  if(event.key==='F10'&&view().actions.stepOver){event.preventDefault();safe(()=>controller.control('stepOver'))();}
  if(event.key==='F11'&&view().actions.stepInto){event.preventDefault();safe(()=>controller.control(event.shiftKey?'stepOut':'stepInto'))();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){autoSave.flush().catch(()=>{});adapter?.background();}});
window.addEventListener('pagehide',()=>{autoSave.flush().catch(()=>{});adapter?.dispose();});
window.addEventListener('beforeunload',event=>{if(autoSave.status.dirty||unqueuedEdits||recovering){event.preventDefault();event.returnValue='';}});
const draftId=new URLSearchParams(location.hash.slice(1)).get('draft')??'main';draft.id=draftId;
try{const saved=await autoSave.restore(draftId);if(saved)draft=saved;restored=true;}catch(error){fault(error);}
document.querySelector('main').removeAttribute('inert');document.querySelector('.execution').removeAttribute('inert');
$('language').value=language();$('stdin').value=draft.stdin;showText();
