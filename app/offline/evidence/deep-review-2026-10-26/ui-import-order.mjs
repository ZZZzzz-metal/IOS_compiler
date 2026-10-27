import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseImport,createDraft} from '../../../../storage/src/draft-store.mjs';
import {createAutosave} from '../../../../storage/src/autosave.mjs';

const root=new URL('../../../../',import.meta.url);
const ref=process.argv[2];
if(ref&&!/^[a-f0-9]{7,40}$/u.test(ref))throw Error('Use a hexadecimal commit ID.');
const source=ref?execFileSync('git',['show',`${ref}:ui/src/main.mjs`],{cwd:fileURLToPath(root),encoding:'utf8'}):await readFile(new URL('ui/src/main.mjs',root),'utf8');
const first=source.indexOf("$('file').onchange=safe(async()=>{"),after=source.indexOf("$('export').onclick=",first);
assert(first>0&&after>first);const fragment=source.slice(first,after);
const control={file:{files:[],value:'A'},language:{},stdin:{}};
const saves=[];
const autosave=createAutosave({store:{async load(){return null;},async save(draft,expected){saves.push({text:draft.userText,expected});return{revision:saves.length};}},delayMs:60000});
await autosave.restore('main');
const sandbox={draft:createDraft({userText:'int original;'}),requested:[],currentTab:'user',snapshotMode:false,
  $:id=>control[id],safe:fn=>(...args)=>Promise.resolve().then(()=>fn(...args)),parseImport,
  language(){return sandbox.draft.language.language;},scheduleSave(){autosave.schedule(sandbox.draft);},showText(){}};
vm.createContext(sandbox);vm.runInContext(fragment,sandbox);
let resolveA;control.file.files=[{name:'A.cpp',size:20,text:()=>new Promise(resolve=>{resolveA=resolve;})}];
const older=control.file.onchange();await Promise.resolve();
control.file.files=[{name:'B.cpp',size:20,text:async()=> 'int intended_B;'}];
const newer=control.file.onchange();await newer;assert.equal(sandbox.draft.userText,'int intended_B;');
resolveA('int stale_A;');await older;await autosave.flush();
assert.equal(sandbox.draft.userText,'int stale_A;');assert.equal(saves.at(-1).text,'int stale_A;');
const result={kind:'executed-unmodified-onchange-with-out-of-order-File-text-promises-and-real-parser-autosave',browser:false,
  source:{path:'ui/src/main.mjs',ref:ref??'working-tree',sha256:createHash('sha256').update(source).digest('hex'),line:source.slice(0,first).split('\n').length},
  selectedOrder:['A.cpp','B.cpp'],resolvedOrder:['B.cpp','A.cpp'],expectedFinal:'int intended_B;',actualDraft:sandbox.draft.userText,actualAutosave:saves.at(-1),
  boundary:'File.text and DOM are controlled substitutes. parseImport and createAutosave are real modules; store.save is instrumented memory storage. Confirms stale import reaching autosave, not an IndexedDB durability or device result.'};
const output=resolve(process.env.UI_REVIEW_OUTPUT??fileURLToPath(new URL('./',import.meta.url)));
await mkdir(output,{recursive:true});
await writeFile(resolve(output,`ui-import-order${ref?'-'+ref:''}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));autosave.dispose();
