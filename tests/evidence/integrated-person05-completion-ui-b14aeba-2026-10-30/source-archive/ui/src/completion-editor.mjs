import {createCompletionController} from './completion-controller.mjs';
import {createCompletionPopup} from './completion-popup.mjs';
import {createCompletionOffsetMap,applyCompletionEdit} from './completion-edit.mjs';

/** Wire the real editor to an injected semantic adapter. This module supplies no candidates. */
export function mountCompletionEditor({source,container,button,status,getContext,onEdited}){
  const document=source.ownerDocument,window=document.defaultView;
  let provider=null,providerFactory=null,composing=false,applying=false,disposed=false,releasing=0,lastContext='',releaseFailure=null;
  let releaseBarrier=Promise.resolve(),disposeBarrier=null;
  const listeners=[];
  function listen(target,type,handler,options){
    target?.addEventListener(type,handler,options);
    listeners.push(()=>target?.removeEventListener(type,handler,options));
  }
  function context(){
    const current=getContext(),focused=document.activeElement===source;
    try{
      const map=createCompletionOffsetMap(source.value),file=current.snapshot?.files.find(file=>file.path===current.sourcePath);
      return {...current,text:map.text,offset:map.editorToSnapshot(source.selectionStart),
        selectionEnd:map.editorToSnapshot(source.selectionEnd),composing,focused,
        enabled:Boolean(!disposed&&!releasing&&providerFactory&&current.enabled&&!source.readOnly&&!document.hidden&&
          !source.closest('[inert]')&&!document.querySelector('dialog[open]')&&file?.text===map.text)};
    }catch{return {...current,text:'',offset:0,selectionEnd:0,composing,focused,enabled:false};}
  }
  function fingerprint(){
    const current=getContext();
    return JSON.stringify([current.documentVersion,current.sourcePath,current.enabled,source.value,
      source.selectionStart,source.selectionEnd,document.activeElement===source,composing,source.readOnly]);
  }
  function remember(){lastContext=fingerprint();}
  function setStatus(message){status.textContent=message;}
  function failedRelease(cause){
    releaseFailure??=new Error('代码提示进程未能确认释放。请先保存或导出草稿，再重新打开页面。',{cause});
    providerFactory=null;button.disabled=true;setStatus(releaseFailure.message);
    return releaseFailure;
  }
  const popup=createCompletionPopup({source,container,
    onChoose:(index,token)=>completion.choose(index,token),onDismiss:()=>completion.invalidate()});
  const completion=createCompletionController({getContext:context,delayMs:300,
    complete:request=>(provider??=providerFactory()).complete(request),
    cancel:async requestId=>{try{await provider?.cancel(requestId);}catch(error){throw failedRelease(error);}},
    onChange:state=>{
      popup.render(state);
      const messages={pending:'正在本机分析代码…',loading:'正在本机分析代码…'};
      setStatus(releaseFailure?.message||state.message||messages[state.phase]||(state.items.length?`${state.items.length} 个提示 · ↑↓选择，Tab 或 Enter 插入`:'输入名称或成员运算符后显示提示，也可按 Ctrl+J / Ctrl+Space。'));
    },
    onApply:edit=>{
      const map=createCompletionOffsetMap(source.value);
      applying=true;
      try{
        const result=applyCompletionEdit({source,start:map.snapshotToEditor(edit.start),
          end:map.snapshotToEditor(edit.end),text:edit.text,onEdited,document});
        if(!result.applied)setStatus(result.changed?'浏览器返回了不同的编辑结果，已保留当前内容；可使用撤销检查。':'此浏览器暂不能安全撤销提示插入，请继续手动输入。');
        return result.applied;
      }finally{applying=false;remember();}
    }});
  function invalidate(){remember();return completion.invalidate();}
  function input(){remember();if(!applying)completion.input();}
  function changed(){if(fingerprint()!==lastContext)invalidate();}
  function manual(){
    if(button.disabled||disposed)return;
    source.focus({preventScroll:true});remember();completion.request();
  }
  function keydown(event){
    if(event.defaultPrevented||event.isComposing||composing||event.keyCode===229)return;
    const plain=!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey;
    if(event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&
      !event.getModifierState?.('AltGraph')&&(event.code==='Space'||event.key===' '||event.code==='KeyJ'||event.key?.toLowerCase()==='j')){
      if(!event.repeat&&!button.disabled){event.preventDefault();manual();}return;
    }
    const state=completion.state;
    if(plain&&event.key==='Escape'&&state.phase!=='idle'){event.preventDefault();invalidate();return;}
    if(!plain||!state.items.length)return;
    if(container.hidden||fingerprint()!==lastContext){invalidate();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();completion.move(event.key==='ArrowDown'?1:-1);
    }else if(event.key==='Tab'||event.key==='Enter'){
      event.preventDefault();completion.choose(state.selectedIndex,state.token);
    }
  }
  listen(source,'input',input);
  listen(source,'keydown',keydown,{capture:true});
  listen(source,'compositionstart',()=>{composing=true;invalidate();refresh();});
  listen(source,'compositionend',()=>{composing=false;refresh();input();});
  listen(source,'blur',invalidate);
  listen(source,'select',changed);
  listen(source,'keyup',changed);
  listen(source,'pointerup',changed);
  listen(source,'scroll',()=>popup.reposition(),{passive:true});
  listen(document,'selectionchange',changed);
  listen(window,'blur',invalidate);
  listen(window,'resize',()=>popup.reposition(),{passive:true});
  listen(window,'scroll',()=>popup.reposition(),{passive:true,capture:true});
  listen(window?.visualViewport,'resize',()=>popup.reposition(),{passive:true});
  listen(window?.visualViewport,'scroll',()=>popup.reposition(),{passive:true});
  listen(document,'visibilitychange',()=>{if(document.hidden)invalidate();});
  listen(button,'click',manual);
  function refresh(){
    button.disabled=Boolean(disposed||releasing||!providerFactory||!getContext().enabled||source.readOnly||composing);
    if(button.disabled)invalidate();
  }
  remember();refresh();
  setStatus('校验本地资源后启用代码提示。');
  function release(){
    releasing++;
    // Cancel while the current adapter is still reachable, then take ownership of it.
    const cancelled=invalidate(),previous=provider,prior=releaseBarrier;
    provider=null;refresh();
    releaseBarrier=(async()=>{
      try{await prior;await cancelled;}catch(error){failedRelease(error);}
      finally{
        try{await previous?.dispose?.();}catch(error){failedRelease(error);}
        finally{releasing--;if(!disposed)refresh();}
      }
      if(releaseFailure)throw releaseFailure;
    })();
    return releaseBarrier;
  }
  return {
    invalidate,refresh,release,
    async setProviderFactory(factory){
      await this.release();providerFactory=factory;
      refresh();setStatus(factory?'输入名称或成员运算符后显示提示，也可按 Ctrl+J / Ctrl+Space。':'校验本地资源后启用代码提示。');
    },
    dispose(){
      if(disposeBarrier)return disposeBarrier;disposed=true;
      disposeBarrier=release();
      completion.dispose();popup.dispose();
      for(const remove of listeners)remove();provider=null;providerFactory=null;
      return disposeBarrier;
    },
    get state(){return completion.state;},get failed(){return Boolean(releaseFailure);},get composing(){return composing;}
  };
}
