import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompletionPopup,measureTextareaCaret,placeCompletionPopup,completionViewport} from '../src/completion-popup.mjs';
import {createCompletionDOM,rect} from './helpers/completion-dom.mjs';

// All rectangles below are controlled unit-test inputs, not real browser evidence.
const item=(label='value',kind='variable',detail='int value')=>({label,kind,detail});
const state=(overrides={})=>({phase:'open',items:[item(),item('member','field')],selectedIndex:0,token:{request:'A'},message:'',...overrides});
function fixture(options={}){
  const dom=createCompletionDOM(options),chosen=[],dismissed=[];
  const popup=createCompletionPopup({...dom,onChoose:(...args)=>chosen.push(args),onDismiss:reason=>dismissed.push(reason)});
  return {...dom,popup,chosen,dismissed};
}
const pointer=(type='mouse',overrides={})=>({pointerType:type,pointerId:1,clientX:150,clientY:160,...overrides});

test('popup: safe plain labels and real details have independent listbox/status/hint nodes',()=>{
  const f=fixture(),label='<img src=x onerror=alert(1)>';
  f.popup.render(state({items:[item(label,'enumMember','Kind::Value(int)')]}));
  assert.equal(f.container.hidden,false);
  assert.equal(f.container.getAttribute('role'),null);
  assert.equal(f.list().getAttribute('role'),'listbox');
  assert.equal(f.rows()[0].getAttribute('role'),'option');
  assert.equal(f.rows()[0].children[1].textContent,label);
  assert.equal(f.rows()[0].children[1].children.length,0);
  assert.equal(f.rows()[0].children[0].textContent,'枚举项');
  assert.equal(f.rows()[0].children[2].textContent,'Kind::Value(int)');
  assert.equal(f.rows()[0].title,'Kind::Value(int)');
  assert.equal(f.rows()[0].style.minHeight,'44px');
  assert.equal(f.container.children[0].getAttribute('role'),'status');
  assert.equal(f.container.children[2].className,'completion-hint');
});

test('popup: showing, selecting and disposing preserve textarea semantics and original ARIA',()=>{
  const f=createCompletionDOM();
  const originals={'aria-controls':'existing-help','aria-autocomplete':'both','aria-expanded':'false',
    'aria-activedescendant':'existing-selection','role':'textbox','aria-label':'源码','aria-describedby':'help'};
  for(const [name,value] of Object.entries(originals))f.source.setAttribute(name,value);
  const popup=createCompletionPopup({...f,onChoose(){}});
  popup.render(state({selectedIndex:1}));
  assert.equal(f.source.getAttribute('role'),'textbox');
  assert.equal(f.source.getAttribute('aria-controls'),'existing-help '+f.list().id);
  assert.equal(f.source.getAttribute('aria-activedescendant'),f.rows()[1].id);
  assert.equal(f.rows()[1].getAttribute('aria-selected'),'true');
  assert.equal(f.rows()[0].getAttribute('aria-selected'),'false');
  assert.equal(f.document.activeElement,f.source);
  popup.hide();
  for(const [name,value] of Object.entries(originals))assert.equal(f.source.getAttribute(name),value,name);
  popup.render(state());popup.dispose();popup.dispose();
  assert.equal(f.container.hidden,true);assert.equal(f.container.children.length,0);
  for(const [name,value] of Object.entries(originals))assert.equal(f.source.getAttribute(name),value,name);
});

test('popup: mouse down keeps focus and a click chooses the rendered index and token once',()=>{
  const f=fixture(),next=state();f.popup.render(next);
  const row=f.rows()[1];
  assert.equal(row.dispatch('pointerdown',pointer()).defaultPrevented,true);
  assert.equal(row.dispatch('mousedown').defaultPrevented,true);
  assert.equal(f.chosen.length,0);
  row.dispatch('pointerup',pointer());row.dispatch('click');
  assert.deepEqual(f.chosen,[[1,next.token]]);
  assert.equal(f.document.activeElement,f.source);
});

test('popup: detached old rows and old pointer sequences cannot use the new render token',()=>{
  const f=fixture(),first=state();f.popup.render(first);
  const old=f.rows()[0];old.dispatch('pointerdown',pointer('touch'));
  const second=state({token:{request:'B'}});f.popup.render(second);
  old.dispatch('pointerup',pointer('touch'));old.dispatch('click');
  assert.equal(f.chosen.length,0);
  f.rows()[0].dispatch('click');assert.deepEqual(f.chosen,[[0,second.token]]);
  const current=f.rows()[0];current.dispatch('pointerdown',pointer('touch'));f.popup.hide();
  assert.doesNotThrow(()=>current.dispatch('pointerup',pointer('touch')));
  current.dispatch('click');assert.equal(f.chosen.length,1);
});

test('popup: touch tap selects on release, keeps textarea focus and suppresses synthetic click',()=>{
  const f=fixture(),next=state();f.popup.render(next);const row=f.rows()[0];
  assert.equal(row.dispatch('pointerdown',pointer('touch')).defaultPrevented,false);
  assert.equal(f.chosen.length,0);
  assert.equal(row.dispatch('pointerup',pointer('touch')).defaultPrevented,true);
  row.dispatch('click');
  assert.deepEqual(f.chosen,[[0,next.token]]);assert.equal(f.document.activeElement,f.source);
});

for(const gesture of ['move','scroll','cancel']){
  test(`popup: touch ${gesture} allows panning and does not insert a candidate`,()=>{
    const f=fixture();f.popup.render(state());const row=f.rows()[0];
    const down=row.dispatch('pointerdown',pointer('touch'));assert.equal(down.defaultPrevented,false);
    if(gesture==='move')row.dispatch('pointermove',pointer('touch',{clientY:180}));
    if(gesture==='scroll')f.list().scrollTop=20;
    if(gesture==='cancel')row.dispatch('pointercancel',pointer('touch'));
    row.dispatch('pointerup',pointer('touch',{clientY:180}));row.dispatch('click');
    assert.equal(f.chosen.length,0);assert.equal(f.document.activeElement,f.source);
  });
}

test('popup: readonly/disabled/blurred input cannot choose and dismisses visible candidates',()=>{
  for(const unavailable of ['readOnly','disabled','blur']){
    const f=fixture();f.popup.render(state());const row=f.rows()[0];
    if(unavailable==='blur')f.document.activeElement=f.container;else f.source[unavailable]=true;
    row.dispatch('click');assert.equal(f.chosen.length,0);
    assert.equal(f.popup.reposition(),false);assert.equal(f.container.hidden,true);
    assert.deepEqual(f.dismissed,['unavailable']);
    f.popup.reposition();assert.equal(f.dismissed.length,1);
  }
});

for(const [phase,message] of [['pending','正在本机分析代码…'],['loading','正在本机分析代码…'],
  ['empty','当前位置暂无代码提示。'],['error','代码提示暂不可用。']]){
  test(`popup: ${phase} provides status without a fake selectable result`,()=>{
    const f=fixture();f.popup.render(state({phase,items:[],selectedIndex:-1}));
    assert.equal(f.container.hidden,false);assert.equal(f.list().hidden,true);assert.equal(f.rows().length,0);
    assert.equal(f.container.children[0].textContent,message);
    assert.equal(f.source.getAttribute('aria-activedescendant'),null);
    f.popup.render(state({phase:'idle'}));assert.equal(f.container.hidden,true);
    assert.equal(f.source.getAttribute('aria-controls'),null);
  });
}

test('caret mirror: measured fragment reuses typography, tabs and padding with both scroll offsets',()=>{
  const f=createCompletionDOM({sourceRect:rect(100,200,600,300)});
  f.source.clientLeft=2;f.source.clientTop=3;f.source.scrollLeft=20;f.source.scrollTop=48;
  f.source.value='\t中文🙂\n  member';f.source.selectionStart=5;
  const caret=measureTextareaCaret(f.source);
  assert.deepEqual(caret,{left:100,top:171,right:101,bottom:195,width:1,height:24});
  const mirror=f.document.created.find(node=>node.style.left==='-100000px');
  assert.equal(mirror.style.fontFamily,'monospace');assert.equal(mirror.style.fontSize,'16px');
  assert.equal(mirror.style.tabSize,'4');assert.equal(mirror.style.lineHeight,'24px');
  assert.equal(mirror.style.paddingLeft,'18px');assert.equal(mirror.style.whiteSpace,'pre');
  assert.equal(mirror.style.width,'600px');assert.equal(mirror.parentElement,null);
  assert.equal(mirror.children[0].textContent,f.source.value.slice(0,5));
  assert.equal(mirror.children[1].textContent,f.source.value.slice(5));
});

test('caret mirror: honors soft wrapping, normal line height, transforms and zero-width end marker',()=>{
  const f=createCompletionDOM({computed:{whiteSpace:'pre-wrap',lineHeight:'normal'}});
  f.source.wrap='soft';f.source.value='\tname\n';f.source.selectionStart=f.source.value.length;
  f.source.offsetWidth=300;f.source.offsetHeight=150;
  const caret=measureTextareaCaret(f.source);
  assert.equal(caret.left,136);assert.equal(caret.top,132);assert.equal(caret.height,48);
  const mirror=f.document.created.find(node=>node.style.left==='-100000px');
  assert.equal(mirror.style.whiteSpace,'pre-wrap');assert.equal(mirror.children[1].textContent,'\u200b');
  assert.equal(mirror.parentElement,null);
});

test('caret mirror: missing or collapsed geometry returns null and removes the measurement node',()=>{
  const f=createCompletionDOM();f.source.clientHeight=0;
  assert.equal(measureTextareaCaret(f.source),null);
  f.source.clientHeight=300;f.geometry.fragment=null;
  assert.equal(measureTextareaCaret(f.source),null);
  assert.equal(f.document.body.children.length,2);
});

test('placement policy: flips above, clamps left/right and reserves a complete 44px touch row',()=>{
  const editor=rect(100,100,500,400),viewport=rect(0,0,1000,800);
  const above=placeCompletionPopup({caret:rect(580,450,1,24),editor,viewport,width:380,height:200});
  assert.equal(above.side,'above');assert.equal(above.left,214);assert.equal(above.top,244);
  assert.equal(above.top+above.height,444);
  const below=placeCompletionPopup({caret:rect(110,120,1,24),editor,viewport,width:380,height:200});
  assert.equal(below.side,'below');assert.equal(below.top,150);assert.equal(below.left,110);
  assert.equal(placeCompletionPopup({caret:rect(100,140,1,24),editor:rect(100,100,100,80),viewport}),null);
});

test('placement policy: visual viewport offset and keyboard height reduce available space',()=>{
  const viewport=completionViewport({visualViewport:{offsetLeft:30,offsetTop:200,width:500,height:250},innerWidth:1000,innerHeight:900});
  assert.deepEqual(viewport,{left:30,top:200,right:530,bottom:450});
  const placed=placeCompletionPopup({caret:rect(500,400,1,24),editor:rect(100,100,700,600),viewport,width:400,height:300});
  assert.equal(placed.side,'above');assert.equal(placed.left,124);assert.equal(placed.top,206);
  assert.equal(placed.height,188);
  assert.equal(placeCompletionPopup({caret:rect(500,180,1,24),editor:rect(100,100,700,600),viewport}),null);
  assert.deepEqual(completionViewport({innerWidth:800,innerHeight:600}),{left:0,top:0,right:800,bottom:600});
});

test('popup: reposition preserves list scroll and hides when source scrolling removes the caret',()=>{
  const f=fixture({sourceRect:rect(100,100,600,600)});
  f.popup.render(state({items:Array.from({length:20},(_,index)=>item('v'+index)),selectedIndex:12}));
  const list=f.list();assert.ok(list.scrollTop>0);
  list.scrollTop=88;const before=list.style.maxHeight;
  assert.equal(f.popup.reposition(),true);assert.equal(list.scrollTop,88);assert.equal(list.style.maxHeight,before);
  f.source.scrollTop=200;
  assert.equal(f.popup.reposition(),false);assert.equal(f.container.hidden,true);
  assert.deepEqual(f.dismissed,['outside-editor']);
  assert.equal(f.source.getAttribute('aria-activedescendant'),null);
});

test('popup: flipped actual list height fits the computed top and editor clipping hides the caret',()=>{
  const f=fixture({sourceRect:rect(100,100,600,600),fragment:rect(18,519,8,18)});
  f.popup.render(state({items:Array.from({length:20},()=>item())}));
  assert.equal(f.container.dataset.placement,'above');
  const box=f.container.getBoundingClientRect(),caret=measureTextareaCaret(f.source);
  assert.ok(Math.abs(box.bottom-(caret.top-6))<0.001);
  const clip=f.document.createElement('div');clip.rect=rect(100,100,600,200);
  clip.computed={...f.computed,overflowY:'hidden'};f.document.body.append(clip);clip.append(f.source);
  assert.equal(f.popup.reposition(),false);assert.equal(f.container.hidden,true);
});

test('popup: a short pending shell cannot clip the footer when candidates replace it',()=>{
  const f=fixture({sourceRect:rect(100,100,600,600)});
  f.popup.render(state({phase:'pending',items:[],selectedIndex:-1}));
  f.popup.render(state({items:[item('one'),item('two'),item('three')]}));
  const hint=f.container.children.find(child=>child.className==='completion-hint');
  assert.ok(f.container.getBoundingClientRect().height>=f.list().getBoundingClientRect().height+hint.getBoundingClientRect().height);
});
