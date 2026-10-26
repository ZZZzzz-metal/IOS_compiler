import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Executes the unmodified current functions with deferred I/O and DOM substitutes.
// This is a deterministic function-level reproduction, not a browser/device test.
const root=new URL('../../../../',import.meta.url);
const ref=process.argv[2];
if(ref&&!/^[a-f0-9]{7,40}$/u.test(ref))throw Error('Use a hexadecimal commit ID.');
const source=ref?execFileSync('git',['show',`${ref}:ui/src/main.mjs`],{cwd:fileURLToPath(root),encoding:'utf8'}):await readFile(new URL('ui/src/main.mjs',root),'utf8');
function fragment(start,end){
  const first=source.indexOf(start),last=source.indexOf(end,first);
  assert(first>=0&&last>first);return source.slice(first,last);
}
const selected=[fragment('function render(){','function supports(id)'),
  fragment('function supports(id)','async function prepare(){'),
  fragment('async function prepare(){','async function compile(mode){'),
  fragment('async function compile(mode){','async function stop(){')].join('\n');
const line=text=>source.slice(0,source.indexOf(text)).split('\n').length;
const old={profile:{compatibilityId:'old-verified'},resources:[],lock:{},capabilities:{capabilities:[]}};
const newer={profile:{compatibilityId:'new-verified'},resources:[],lock:{},capabilities:{capabilities:[]}};
function fixture(){
  const elements={},fetches=[],constructors=[];
  const $=id=>elements[id]??=( {disabled:false,hidden:false,textContent:''} );
  const state={ready:true,restored:true,prepared:structuredClone(old),compilation:null,controller:null,adapter:null,compiler:null,
    draft:{language:{language:'cpp',standard:'c++17'},stdin:''},requested:[],diagnostics:[],activeSnapshot:null,
    URL,location:{href:'https://example.invalid/ui/probe.html'},$,
    document:{querySelectorAll:()=>[],body:{dataset:{}}},snapshotMode:false,
    view:()=>({session:null,actions:{},outputTail:[],outputTruncated:false}),
    renderEditor(){},renderBreakpoints(){},renderInspection(){},scheduleRender(){},
    makeSnapshot:()=>({sourceHash:'snapshot-source',files:[]}),uuid:()=> 'request-1',
    fetch:()=>new Promise(resolve=>fetches.push(resolve)),assertTrustedOfflineWorkers:async()=>({offline:false}),digest:async()=>'',
    fault(error){state.error=error.message;},showText(){state.render();},
    WorkerDebuggerAdapter:class{constructor(options){constructors.push({kind:'debugger',profile:options.profile.compatibilityId});}},
    SessionController:class{},
    CompilerAdapter:class{constructor(options){constructors.push({kind:'compiler',profile:options.profile.compatibilityId});}compile(){return new Promise(()=>{});}},
  };
  vm.createContext(state);vm.runInContext(selected,state);state.render();
  return {state,elements,fetches,constructors};
}
const first=fixture();
const checking=first.state.prepare();
const during={ready:first.state.ready,prepareDisabled:first.elements.prepare.disabled,runDisabled:first.elements.run.disabled,debugDisabled:first.elements.debug.disabled};
assert.deepEqual(during,{ready:false,prepareDisabled:true,runDisabled:false,debugDisabled:false});
// compile's own gate accepts the still-enabled Run button and builds adapters from old prepared.
void first.state.compile('run');
assert.deepEqual(first.constructors,[{kind:'debugger',profile:'old-verified'},{kind:'compiler',profile:'old-verified'}]);
first.fetches[0]({ok:true,json:async()=>structuredClone(newer)});await checking;
assert.equal(first.state.prepared.profile.compatibilityId,'new-verified');
const compileDuringPrepare={during,constructors:first.constructors,afterPrepare:{prepared:first.state.prepared.profile.compatibilityId,compilationStillPending:Boolean(first.state.compilation)}};

const second=fixture(),olderCheck=second.state.prepare();
// Normal editor/tab actions call render while the network check is pending.
second.state.render();
const afterOtherRender={ready:second.state.ready,prepareDisabled:second.elements.prepare.disabled,runDisabled:second.elements.run.disabled};
assert.deepEqual(afterOtherRender,{ready:false,prepareDisabled:false,runDisabled:true});
const newerCheck=second.state.prepare();assert.equal(second.fetches.length,2);
second.fetches[1]({ok:true,json:async()=>structuredClone(newer)});await newerCheck;
second.fetches[0]({ok:false});await olderCheck;
const afterOutOfOrder={ready:second.state.ready,runDisabled:second.elements.run.disabled,resources:second.elements.resources.textContent,error:second.state.error};
assert.equal(afterOutOfOrder.ready,true);assert.equal(afterOutOfOrder.runDisabled,false);assert.equal(afterOutOfOrder.resources,'资源未就绪');
const result={kind:'executed-unmodified-prepare-render-compile-with-deferred-I/O-and-DOM-substitutes',browser:false,
  source:{path:'ui/src/main.mjs',ref:ref??'working-tree',sha256:createHash('sha256').update(source).digest('hex'),lines:{render:line('function render(){'),prepare:line('async function prepare(){'),compile:line('async function compile(mode){')}},
  compileDuringPrepare,overlappingPrepare:{afterOtherRender,fetchCalls:second.fetches.length,afterOutOfOrder},
  boundary:'Compiler/debugger constructors are instrumented substitutes. Confirms UI entry and overlapping preparation; does not establish resource integrity bypass or iPad behavior.'};
const output=resolve(process.env.UI_REVIEW_OUTPUT??fileURLToPath(new URL('./',import.meta.url)));
await mkdir(output,{recursive:true});
await writeFile(resolve(output,`ui-prepare-gating${ref?'-'+ref:''}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
