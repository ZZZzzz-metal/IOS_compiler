// Role05 evidence seal: create once, verify worktree and optionally committed bytes.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const name=process.argv[2];assert.match(name??'',/^integrated-[a-z0-9.-]+$/);
const repo=new URL('../',import.meta.url),prefix=`tests/evidence/${name}/`,here=new URL(prefix,repo);
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${fileURLToPath(repo)}`,'-C',fileURLToPath(repo),...args],{maxBuffer:32*1024*1024});
// Windows has a per-process command-line limit. Keep evidence paths in small
// read-only batches and preserve their original order across both Git queries.
function gitLines(args,values){
 const lines=[];
 for(let start=0;start<values.length;){
   const batch=[];let chars=0;
   while(start<values.length&&batch.length<40&&(batch.length===0||chars+values[start].length<12000)){
     const value=values[start++];batch.push(value);chars+=value.length+3;
   }
   lines.push(...git(...args,...batch).toString('utf8').trim().split(/\r?\n/));
 }
 return lines;
}
async function list(dir,base=''){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){assert(!e.isSymbolicLink(),'No linked evidence entries');if(e.isDirectory())files.push(...await list(new URL(e.name+'/',dir),base+e.name+'/'));else if(base+e.name!=='SHA256SUMS.json')files.push(base+e.name);}return files.sort();}
async function verify(entries){for(const e of entries){const b=await readFile(new URL(e.file,here));assert.equal(b.length,e.byteLength,e.file+' length');assert.equal(sha(b),e.sha256,e.file+' SHA256');}}
const sealURL=new URL('SHA256SUMS.json',here);
if(process.argv.includes('--verify')){
 const entries=JSON.parse(await readFile(sealURL,'utf8'));await verify(entries);
 const files=await list(here);assert.deepEqual(files,entries.map(e=>e.file),'Unsealed extra or missing evidence file');
 if(process.argv.includes('--git')){
   const paths=entries.map(e=>prefix+e.file);
   const hashes=gitLines(['hash-object','--no-filters','--'],paths);
   const refs=gitLines(['rev-parse'],paths.map(p=>'HEAD:'+p));
   assert.deepEqual(hashes,refs,'Committed blobs must equal raw worktree bytes');
   const stored=git('show','HEAD:'+prefix+'SHA256SUMS.json');assert.deepEqual(stored,await readFile(sealURL),'Manifest must also match committed bytes');
 }
 console.log(`${name}: verified ${entries.length} files${process.argv.includes('--git')?', committed bytes identical':''}`);process.exit(0);
}
try{await access(sealURL);throw Error('Already sealed; use --verify');}catch(e){if(e.code!=='ENOENT')throw e;}
const attributes=await readFile(new URL('.gitattributes',here),'utf8');assert.match(attributes,/\*\s+-text/);
const entries=[];for(const file of await list(here)){const b=await readFile(new URL(file,here));entries.push({file,byteLength:b.length,sha256:sha(b)});}
await writeFile(sealURL,JSON.stringify(entries,null,2)+'\n',{flag:'wx'});await verify(entries);console.log(`${name}: sealed ${entries.length} files`);
