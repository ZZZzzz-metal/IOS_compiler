import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const base=new URL('./',import.meta.url),root=new URL('../../../',import.meta.url),cwd=fileURLToPath(root);
const manifest=new URL('SHA256SUMS.json',base);
try{await access(manifest);throw Error('Evidence already sealed; do not overwrite historical results.');}catch(error){if(error.code!=='ENOENT')throw error;}
const fingerprint=bytes=>({byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const sourcePaths=['docs/handoffs/04.md','ui/README.md','ui/SHORTCUTS.md','ui/checks/keyboard-dispatch.test.mjs','ui/checks/preparation-gate.test.mjs','ui/checks/shortcuts.test.mjs','ui/probe.html','ui/src/editor.mjs','ui/src/main.mjs','ui/style.css'];
const inputs={},differences=[];
for(const path of sourcePaths){
  const working=await readFile(new URL(path,root)),staged=execFileSync('git',['show',`:${path}`],{cwd});
  const identical=working.equals(staged);
  if(!identical&&!Buffer.from(working.toString('utf8').replace(/\r\n/g,'\n')).equals(staged))throw Error(`Unexpected staged content: ${path}`);
  if(!identical)differences.push(path);
  inputs[path]={working:fingerprint(working),staged:fingerprint(staged),difference:identical?'none':'CRLF normalized to LF'};
}
const baseline=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
await writeFile(new URL('source-inputs.json',base),JSON.stringify({baseline,testsRead:'working source bytes',inputs},null,2)+'\n');
await writeFile(new URL('source-stage-verification.json',base),JSON.stringify({baseline,sourceFilesChecked:sourcePaths.length,workingLineEndingDifferences:differences,unexpectedDifferences:[],result:'PASS'},null,2)+'\n');
async function walk(directory,prefix=''){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=prefix+entry.name;
    if(entry.isDirectory())files.push(...await walk(new URL(entry.name+'/',directory),path+'/'));
    else if(path!=='SHA256SUMS.json')files.push(path);
  }
  return files;
}
const sums={};for(const path of (await walk(base)).sort())sums[path]=fingerprint(await readFile(new URL(path,base)));
await writeFile(manifest,JSON.stringify(sums,null,2)+'\n');
console.log(`Sealed ${Object.keys(sums).length} evidence files; checked ${sourcePaths.length} source inputs.`);
