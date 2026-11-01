import {readFile,writeFile,readdir,access,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url),root=new URL('../../../',here);
try{await access(new URL('SHA256SUMS.json',here));throw Error('Evidence is already sealed; choose a new directory.');}
catch(error){if(error.code!=='ENOENT')throw error;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const observations=JSON.parse(await readFile(new URL('browser-observations.json',here),'utf8'));
const observation=name=>{const item=observations.find(item=>item.name===name);assert.ok(item,name);return item;};
assert.ok(observation('real-dot-members').items.some(item=>item.label==='count'));
assert.ok(observation('member-tab-insert').source.includes('    p.count\n'));
assert.equal(observation('native-undo').source,observation('real-dot-members').source);
assert.equal(observation('native-redo').source,observation('member-tab-insert').source);
for(const label of ['doubleScore','doubleTotal'])assert.ok(observation('automatic-function-variable-prefix').items.some(item=>item.label===label));
assert.ok(observation('function-enter-insert').source.endsWith('doubleScore'));
assert.ok(observation('real-arrow-ctrl-j').items.some(item=>item.label==='size'));
assert.ok(observation('mouse-member-insert').source.endsWith('pointer->size'));
assert.ok(observation('namespace-scope').items.some(item=>item.label==='show'));
assert.ok(observation('middle-identifier-no-suffix-loss').source.endsWith('printNumber'));
for(const name of ['escape-dismiss','caret-change-invalidates','comment-no-popup','decimal-no-popup','compile-lock-no-completion','driver-tab-invalidates'])assert.equal(observation(name).popupHidden,true,name);
for(const name of ['included-user-file-members','manual-button-restores-caret-focus'])assert.ok(observation(name).items.some(item=>item.label==='member'));
assert.deepEqual(JSON.parse(await readFile(new URL('browser-console.json',here),'utf8')),[]);
await copyFile(new URL('ui/.local/candidate.json',root),new URL('candidate.json',here));
const sourcePaths=['ui/probe.html','ui/style.css','ui/src/main.mjs','ui/src/editor.mjs','ui/src/session-controller.mjs',
  ...['controller','editor','edit','popup'].map(name=>`ui/src/completion-${name}.mjs`),
  ...['controller','editor','edit','popup'].map(name=>`ui/checks/completion-${name}.test.mjs`),
  'ui/checks/helpers/completion-dom.mjs','ui/checks/clipboard-order.test.mjs','ui/checks/import-order.test.mjs','ui/checks/keyboard-dispatch.test.mjs','ui/checks/preparation-gate.test.mjs',
  'storage/src/autosave.mjs','storage/src/draft-store.mjs','contracts/completion.d.ts',
  ...['adapter','worker','engine','source','output'].map(name=>`compiler/src/completion-${name}.mjs`)];
const fingerprints={};
for(const path of sourcePaths){const bytes=await readFile(new URL(path,root));fingerprints[path]={rawByteLength:bytes.length,rawSHA256:sha(bytes),gitLFSHA256:sha(Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')))};}
await writeFile(new URL('SOURCE-FINGERPRINTS.json',here),JSON.stringify(fingerprints,null,2)+'\n');
const sums={};
async function collect(folder,prefix=''){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=prefix+entry.name,url=new URL(entry.name,folder);
    if(entry.isDirectory())await collect(new URL(entry.name+'/',folder),path+'/');
    else{const bytes=await readFile(url);sums[path]={byteLength:bytes.length,sha256:sha(bytes)};}
  }
}
await collect(here);
await writeFile(new URL('SHA256SUMS.json',here),JSON.stringify(sums,null,2)+'\n');
console.log(`Sealed ${Object.keys(sums).length} files, ${sourcePaths.length} source fingerprints, ${observations.length} real browser observations; independent/iPad/offline package acceptance pending.`);
