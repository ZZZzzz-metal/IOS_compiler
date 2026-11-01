// Controlled DOM geometry for unit tests. This is not a browser layout engine.
export const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
class Target{
  listeners=new Map();
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  dispatch(type,properties={}){
    const event={type,target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...properties};
    for(const handler of this.listeners.get(type)??[])handler(event);
    this['on'+type]?.(event);return event;
  }
}
export class CompletionTestElement extends Target{
  constructor(tag,document){super();Object.assign(this,{tagName:tag.toUpperCase(),ownerDocument:document,
    children:[],attributes:new Map(),style:{},dataset:{},hidden:false,disabled:false,readOnly:false,
    value:'',textContent:'',className:'',id:'',scrollTop:0,scrollLeft:0,clientLeft:0,clientTop:0,
    offsetTop:0,offsetHeight:44,offsetWidth:600,parentElement:null,selectionStart:0,selectionEnd:0});}
  getAttribute(name){if(name==='class')return this.className||null;return this.attributes.get(name)??null;}
  setAttribute(name,value){if(name==='class')this.className=String(value);else this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  append(...children){for(const child of children){child.parentElement=this;child.offsetTop=this.children.length*44;this.children.push(child);}}
  appendChild(child){this.append(child);return child;}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}}
  contains(node){return node===this||this.children.some(child=>child.contains?.(node));}
  closest(){return null;}
  focus(){this.ownerDocument.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  get scrollHeight(){return this.className==='completion-list'?this.children.length*44:this.clientHeight;}
  get clientHeight(){return this._clientHeight??this.getBoundingClientRect().height;}
  set clientHeight(value){this._clientHeight=value;}
  get clientWidth(){return this._clientWidth??this.getBoundingClientRect().width;}
  set clientWidth(value){this._clientWidth=value;}
  getBoundingClientRect(){
    if(this.rect)return typeof this.rect==='function'?this.rect():this.rect;
    if(this.style.left==='-100000px')return rect(-100000,0,Number.parseFloat(this.style.width),24);
    if(this.className==='completion-list')return rect(0,0,400,this.hidden?0:Math.min(this.children.length*44,Number.parseFloat(this.style.maxHeight)||Infinity));
    if(this.className.includes('completion-popup')){
      const natural=this.children.reduce((sum,child)=>sum+(child.hidden?0:child.className==='completion-list'?child.getBoundingClientRect().height:24),0);
      const height=Math.min(natural,Number.parseFloat(this.style.maxHeight)||Infinity);
      return rect(Number.parseFloat(this.style.left)||0,Number.parseFloat(this.style.top)||0,Number.parseFloat(this.style.width)||400,height);
    }
    return rect(0,0,400,24);
  }
  getClientRects(){
    const f=this.ownerDocument.geometry.fragment;
    return f?[rect(-100000+f.left,f.top,f.width,f.height)]:[];
  }
}
export function createCompletionDOM(options={}){
  const document=new Target();document.geometry={fragment:options.fragment??rect(18,19,8,18)};
  document.created=[];document.hidden=false;
  document.createElement=tag=>{const element=new CompletionTestElement(tag,document);document.created.push(element);return element;};
  document.createTextNode=value=>({textContent:value,parentElement:null});
  document.body=document.createElement('body');
  document.querySelector=()=>null;document.querySelectorAll=()=>[];
  const window=new Target();window.innerWidth=1000;window.innerHeight=800;
  window.visualViewport=options.visualViewport??null;
  const computed={fontFamily:'monospace',fontSize:'16px',fontWeight:'400',fontStyle:'normal',lineHeight:'24px',
    paddingLeft:'18px',paddingRight:'18px',paddingTop:'16px',paddingBottom:'16px',tabSize:'4',
    letterSpacing:'0px',wordSpacing:'0px',whiteSpace:'pre',overflowX:'visible',overflowY:'visible',...options.computed};
  window.getComputedStyle=element=>element.computed??computed;document.defaultView=window;
  const source=document.createElement('textarea'),container=document.createElement('div');
  source.id='source';container.id='completion-popup';container.hidden=true;
  source.rect=options.sourceRect??rect(100,100,600,300);
  source.offsetWidth=source.rect.width;source.offsetHeight=source.rect.height;
  source.clientWidth=source.rect.width;source.clientHeight=source.rect.height;source.value='int value';source.wrap='off';
  document.body.append(source,container);document.activeElement=source;
  return {document,window,source,container,computed,geometry:document.geometry,
    list:()=>container.children.find(child=>child.className==='completion-list'),
    rows:()=>container.children.find(child=>child.className==='completion-list')?.children??[]};
}
