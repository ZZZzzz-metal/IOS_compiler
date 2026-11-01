const ROW_HEIGHT=44, GAP=6, VIEWPORT_INSET=6;
const KIND_LABELS={unknown:'符号',variable:'变量',parameter:'参数',field:'字段',function:'函数',method:'方法',
  constructor:'构造',destructor:'析构',class:'类',struct:'结构',union:'联合',enum:'枚举',enumMember:'枚举项',
  namespace:'命名空间',type:'类型',typeAlias:'类型',typedef:'类型',keyword:'关键字',macro:'宏',template:'模板'};
let popupSequence=0;
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const px=value=>number(Number.parseFloat(value));
const rectangle=rect=>({left:rect.left,top:rect.top,right:rect.right??rect.left+rect.width,
  bottom:rect.bottom??rect.top+rect.height,width:rect.width??rect.right-rect.left,height:rect.height??rect.bottom-rect.top});
const intersect=(a,b)=>({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),
  right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});

/** Layout-viewport coordinates, matching getBoundingClientRect and fixed positioning. */
export function completionViewport(window){
  const view=window.visualViewport;
  const left=view?number(view.offsetLeft):0,top=view?number(view.offsetTop):0;
  return {left,top,right:left+(view?number(view.width):number(window.innerWidth)),
    bottom:top+(view?number(view.height):number(window.innerHeight))};
}

/** Measure the browser's textarea layout, including tabs, wrapping and scrolling. */
export function measureTextareaCaret(source){
  const document=source.ownerDocument,window=document.defaultView;
  const computed=window.getComputedStyle(source),sourceRect=rectangle(source.getBoundingClientRect());
  if(!source.clientWidth||!source.clientHeight||!sourceRect.width||!sourceRect.height)return null;
  const mirror=document.createElement('div'),marker=document.createElement('span');
  mirror.setAttribute('aria-hidden','true');
  const style=mirror.style;
  for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontVariant',
    'fontVariantLigatures','fontFeatureSettings','fontVariationSettings','lineHeight','letterSpacing',
    'wordSpacing','textIndent','textTransform','textAlign','direction','tabSize','MozTabSize',
    'paddingTop','paddingRight','paddingBottom','paddingLeft','overflowWrap','wordBreak','textRendering']){
    style[property]=computed[property];
  }
  Object.assign(style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none',
    boxSizing:'border-box',width:source.clientWidth+'px',height:'auto',minHeight:'0',maxHeight:'none',
    minWidth:'0',maxWidth:'none',border:'0',margin:'0',overflow:'visible',
    whiteSpace:source.wrap==='off'||computed.whiteSpace==='pre'?'pre':'pre-wrap'});
  const caret=Math.max(0,Math.min(source.value.length,number(source.selectionStart)));
  // Keeping the suffix in an inline span preserves the browser's word wrapping.
  // Its first fragment begins at the caret, even when later fragments wrap.
  marker.textContent=source.value.slice(caret)||'\u200b';
  mirror.append(document.createTextNode(source.value.slice(0,caret)),marker);
  document.body.append(mirror);
  try{
    const mirrorRect=mirror.getBoundingClientRect(),fragment=marker.getClientRects()[0];
    if(!fragment)return null;
    let lineHeight=px(computed.lineHeight);
    if(!lineHeight){
      const probe=document.createElement('div');probe.textContent='M';mirror.append(probe);
      lineHeight=probe.getBoundingClientRect().height;probe.remove();
    }
    if(!lineHeight)return null;
    const scaleX=source.offsetWidth?sourceRect.width/source.offsetWidth:1;
    const scaleY=source.offsetHeight?sourceRect.height/source.offsetHeight:1;
    const left=sourceRect.left+(source.clientLeft+fragment.left-mirrorRect.left-source.scrollLeft)*scaleX;
    const top=sourceRect.top+(source.clientTop+fragment.top-mirrorRect.top-
      (lineHeight-fragment.height)/2-source.scrollTop)*scaleY;
    return {left,top,right:left+Math.max(1,scaleX),bottom:top+lineHeight*scaleY,
      width:Math.max(1,scaleX),height:lineHeight*scaleY};
  }finally{mirror.remove();}
}

/** Pure placement policy; returns null when the caret/one touch row cannot fit. */
export function placeCompletionPopup({caret,editor,viewport,width=380,height=300,minHeight=ROW_HEIGHT}){
  if(!caret)return null;
  const bounds=intersect(rectangle(editor),rectangle(viewport));
  if(bounds.right<=bounds.left||bounds.bottom<=bounds.top||caret.left<bounds.left||
    caret.right>bounds.right||caret.top<bounds.top||caret.bottom>bounds.bottom)return null;
  const leftBound=bounds.left+VIEWPORT_INSET,rightBound=bounds.right-VIEWPORT_INSET;
  const topBound=bounds.top+VIEWPORT_INSET,bottomBound=bounds.bottom-VIEWPORT_INSET;
  const availableWidth=rightBound-leftBound;
  const below=bottomBound-caret.bottom-GAP,above=caret.top-GAP-topBound;
  const side=below>=height||below>=above?'below':'above';
  const availableHeight=side==='below'?below:above;
  if(availableWidth<=0||availableHeight<minHeight)return null;
  const popupWidth=Math.min(width,availableWidth),popupHeight=Math.min(height,availableHeight);
  const left=Math.max(leftBound,Math.min(caret.left,rightBound-popupWidth));
  const top=side==='below'?caret.bottom+GAP:caret.top-GAP-popupHeight;
  return {left,top,width:popupWidth,maxHeight:availableHeight,height:popupHeight,side};
}

function visibleEditor(source,window){
  const rect=rectangle(source.getBoundingClientRect());
  const scaleX=source.offsetWidth?rect.width/source.offsetWidth:1;
  const scaleY=source.offsetHeight?rect.height/source.offsetHeight:1;
  let visible={left:rect.left+source.clientLeft*scaleX,top:rect.top+source.clientTop*scaleY,
    right:rect.left+(source.clientLeft+source.clientWidth)*scaleX,
    bottom:rect.top+(source.clientTop+source.clientHeight)*scaleY};
  for(let ancestor=source.parentElement;ancestor&&ancestor!==source.ownerDocument.body;ancestor=ancestor.parentElement){
    const computed=window.getComputedStyle(ancestor),box=rectangle(ancestor.getBoundingClientRect());
    if(/^(auto|scroll|hidden|clip)$/u.test(computed.overflowX)){
      visible.left=Math.max(visible.left,box.left);visible.right=Math.min(visible.right,box.right);
    }
    if(/^(auto|scroll|hidden|clip)$/u.test(computed.overflowY)){
      visible.top=Math.max(visible.top,box.top);visible.bottom=Math.min(visible.bottom,box.bottom);
    }
  }
  return visible;
}

/** Presentation only. Keyboard navigation and candidate validity belong to the controller. */
export function createCompletionPopup({source,container,onChoose,onDismiss=()=>{}}){
  const document=source.ownerDocument,window=document.defaultView,id=++popupSequence;
  const original=new Map(['aria-controls','aria-autocomplete','aria-expanded','aria-activedescendant']
    .map(name=>[name,source.getAttribute(name)]));
  let generation=0,disposed=false,state=null,list=null,rows=[],dismissed=false;
  container.hidden=true;
  container.setAttribute('class',((container.getAttribute('class')||'')+' completion-popup').trim());
  const restore=()=>{for(const [name,value] of original){
    if(value===null)source.removeAttribute(name);else source.setAttribute(name,value);
  }};
  function hide(){generation++;container.hidden=true;state=null;list=null;rows=[];restore();}
  function dismiss(reason){
    const notify=!dismissed&&Boolean(state);hide();
    if(notify){dismissed=true;onDismiss(reason);}
  }
  function reposition(){
    if(disposed||!state||container.hidden)return false;
    if(source.readOnly||source.disabled||document.activeElement!==source){dismiss('unavailable');return false;}
    const editor=visibleEditor(source,window),viewport=completionViewport(window);
    const bounds=intersect(editor,viewport),width=Math.min(400,bounds.right-bounds.left-2*VIEWPORT_INSET);
    container.style.width=Math.max(0,width)+'px';
    const box=container.getBoundingClientRect(),hasItems=rows.length>0;
    // A previous pending/short popup may still constrain the shell. Measure its
    // independent status/footer, not shell minus list (which can be clipped).
    const chrome=hasItems?[...container.children].filter(child=>child!==list&&!child.hidden)
      .reduce((height,child)=>height+child.getBoundingClientRect().height,0):0;
    const rowHeight=hasItems?Math.max(ROW_HEIGHT,rows[0].getBoundingClientRect().height):ROW_HEIGHT;
    const placement=placeCompletionPopup({caret:measureTextareaCaret(source),editor,viewport,
      width,height:hasItems?chrome+Math.min(Math.max(rowHeight,list.scrollHeight),320):Math.max(box.height,ROW_HEIGHT),
      minHeight:hasItems?chrome+rowHeight:ROW_HEIGHT});
    if(!placement){dismiss('outside-editor');return false;}
    Object.assign(container.style,{position:'fixed',left:placement.left+'px',top:placement.top+'px',
      width:placement.width+'px',maxHeight:placement.height+'px'});
    container.dataset.placement=placement.side;
    if(list)list.style.maxHeight=Math.max(0,placement.height-chrome)+'px';
    return true;
  }
  function render(next){
    if(disposed)return;
    const phase=next?.phase||'idle',items=Array.isArray(next?.items)?next.items:[];
    if(phase==='idle'){hide();return;}
    generation++;const view=generation,token=next.token;
    state=next;dismissed=false;rows=[];
    const status=document.createElement('div'),hint=document.createElement('div');
    list=document.createElement('div');
    status.className='completion-status';status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    list.className='completion-list';list.id=`completion-list-${id}`;
    const renderedList=list;
    list.setAttribute('role','listbox');list.setAttribute('aria-label','代码提示');
    list.setAttribute('aria-busy',String(phase==='pending'||phase==='loading'));
    list.hidden=!items.length;
    hint.className='completion-hint';hint.textContent=items.length?'↑↓ 选择 · Tab / Enter 插入 · Esc 关闭':'Esc 关闭';
    status.textContent=next.message||({pending:'正在本机分析代码…',loading:'正在本机分析代码…',
      empty:'当前位置暂无代码提示。',error:'代码提示暂不可用。'}[phase]??`${items.length} 个代码提示`);
    status.hidden=items.length>0;
    const choose=index=>{
      if(disposed||view!==generation||container.hidden||source.readOnly||source.disabled||document.activeElement!==source)return;
      onChoose(index,token);
    };
    items.forEach((item,index)=>{
      const row=document.createElement('div'),kind=document.createElement('span'),label=document.createElement('span'),detail=document.createElement('span');
      row.className='completion-option'+(index===next.selectedIndex?' is-selected':'');
      row.id=`completion-option-${id}-${view}-${index}`;row.setAttribute('role','option');
      row.title=String(item.detail??'');
      row.setAttribute('aria-selected',String(index===next.selectedIndex));
      row.style.minHeight=ROW_HEIGHT+'px';
      kind.className='completion-kind';kind.textContent=KIND_LABELS[item.kind]||KIND_LABELS.unknown;
      label.className='completion-label';label.textContent=String(item.label??'');
      detail.className='completion-detail';detail.textContent=String(item.detail??'');
      row.append(kind,label,detail);list.append(row);rows.push(row);
      let gesture=null,suppressClick=false;
      row.addEventListener('mousedown',event=>event.preventDefault());
      row.addEventListener('pointerdown',event=>{
        suppressClick=false;
        gesture={id:event.pointerId,type:event.pointerType||'mouse',x:event.clientX,y:event.clientY,
          scroll:renderedList.scrollTop,moved:false};
        if(gesture.type!=='touch')event.preventDefault();
      });
      row.addEventListener('pointermove',event=>{
        if(gesture&&gesture.id===event.pointerId&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>8)gesture.moved=true;
      });
      row.addEventListener('pointercancel',()=>{gesture=null;suppressClick=true;});
      row.addEventListener('pointerup',event=>{
        if(!gesture||gesture.id!==event.pointerId)return;
        const touch=gesture.type==='touch',moved=gesture.moved||Math.abs(renderedList.scrollTop-gesture.scroll)>2;
        gesture=null;
        if(touch){
          suppressClick=true;
          if(!moved){event.preventDefault();choose(index);}
        }else if(moved)suppressClick=true;
      });
      row.addEventListener('click',event=>{
        event.preventDefault();
        if(suppressClick){suppressClick=false;return;}
        choose(index);
      });
    });
    container.replaceChildren(status,list,hint);container.dataset.phase=phase;container.hidden=false;
    source.setAttribute('aria-controls',[original.get('aria-controls'),list.id].filter(Boolean).join(' '));
    source.setAttribute('aria-autocomplete','list');source.setAttribute('aria-expanded','true');
    const active=rows[next.selectedIndex];
    if(active)source.setAttribute('aria-activedescendant',active.id);else source.removeAttribute('aria-activedescendant');
    if(reposition()&&active){
      const top=active.offsetTop,bottom=top+active.offsetHeight;
      if(top<list.scrollTop)list.scrollTop=top;
      else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=Math.max(0,bottom-list.clientHeight);
    }
  }
  return {render,reposition,hide,dispose(){if(disposed)return;hide();disposed=true;container.replaceChildren();}};
}
