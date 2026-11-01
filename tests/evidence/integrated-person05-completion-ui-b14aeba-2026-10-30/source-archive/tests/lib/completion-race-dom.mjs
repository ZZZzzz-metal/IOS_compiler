// Person 05 controlled transport. This is not a browser, layout, native undo or Worker proof.
// Event capture/property/bubble order and editing are explicit test inputs.
class Target {
  constructor(){this.handlers=new Map();}
  addEventListener(type,callback,options){const rows=this.handlers.get(type)??[];rows.push({callback,capture:options===true||Boolean(options?.capture)});this.handlers.set(type,rows);}
  removeEventListener(type,callback){this.handlers.set(type,(this.handlers.get(type)??[]).filter(row=>row.callback!==callback));}
  fire(type,options={}){
    const event={type,target:this,key:'',code:'',keyCode:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false,defaultPrevented:false,getModifierState:()=>false,...options,preventDefault(){this.defaultPrevented=true;}};
    for(const row of [...this.handlers.get(type)??[]].filter(row=>row.capture))row.callback(event);
    this['on'+type]?.(event);
    for(const row of [...this.handlers.get(type)??[]].filter(row=>!row.capture))row.callback(event);
    return event;
  }
}
class Node extends Target {
  constructor(document,tag='div'){super();Object.assign(this,{ownerDocument:document,tagName:tag.toUpperCase(),children:[],attributes:new Map(),style:{},dataset:{},hidden:false,disabled:false,readOnly:false,value:'',textContent:'',selectionStart:0,selectionEnd:0,selectionDirection:'none',scrollLeft:0,scrollTop:0,offsetWidth:700,offsetHeight:400,clientWidth:700,clientHeight:400,clientLeft:0,clientTop:0,offsetTop:0,isConnected:true,parentElement:null,wrap:'off'});}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
  get scrollHeight(){return Math.max(44,this.children.length*44);}
  get offsetHeight(){return this._height??44;}
  set offsetHeight(value){this._height=value;}
  getBoundingClientRect(){return this.tagName==='TEXTAREA'?{left:10,top:10,right:710,bottom:410,width:700,height:400}:{left:0,top:0,right:400,bottom:44,width:400,height:44};}
  getClientRects(){return [{left:20,top:20,right:21,bottom:40,width:1,height:20}];}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);}
  closest(selector){if(selector!=='[inert]')throw Error('Unexpected selector: '+selector);for(let node=this;node;node=node.parentElement)if(node.attributes.has('inert'))return node;return null;}
  focus(){const old=this.ownerDocument.activeElement;this.ownerDocument.activeElement=this;if(old&&old!==this)old.fire('blur');}
  setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
}
export function createRaceDocument(){
  const document=new Target(),window=new Target();
  window.innerWidth=1000;window.innerHeight=800;
  window.getComputedStyle=()=>({lineHeight:'20px',fontSize:'16px',whiteSpace:'pre',overflowX:'visible',overflowY:'visible'});
  document.defaultView=window;document.activeElement=null;document.hidden=false;document.dialog=false;
  document.body=new Node(document,'body');document.createElement=tag=>new Node(document,tag);document.createTextNode=text=>Object.assign(new Node(document,'#text'),{textContent:text});
  document.querySelector=selector=>{if(selector!=='dialog[open]')throw Error('Unexpected query: '+selector);return document.dialog?{}:null;};
  const source=new Node(document,'textarea'),container=new Node(document),button=new Node(document,'button'),status=new Node(document);
  document.body.append(source,container,button,status);
  let writes=0;
  document.execCommand=(command,_ui,text)=>{
    if(command!=='insertText')throw Error('Unsupported command');
    const start=source.selectionStart,end=source.selectionEnd;
    source.value=source.value.slice(0,start)+text+source.value.slice(end);source.setSelectionRange(start+text.length,start+text.length);writes++;source.fire('input');return true;
  };
  return {document,window,source,container,button,status,get writes(){return writes;}};
}
