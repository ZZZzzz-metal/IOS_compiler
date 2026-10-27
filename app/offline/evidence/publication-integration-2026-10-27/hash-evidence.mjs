import {readdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
const directory=fileURLToPath(new URL('./',import.meta.url));
async function files(base){const found=[];for(const item of await readdir(base,{withFileTypes:true})){const path=resolve(base,item.name);if(item.isDirectory())found.push(...await files(path));else if(item.isFile())found.push(path);}return found;}
const manifest=[];
for(const path of (await files(directory)).sort()){
 const name=relative(directory,path).replaceAll('\\','/');if(name==='SHA256SUMS.json')continue;
 const bytes=await readFile(path);
 manifest.push({path:name,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(resolve(directory,'SHA256SUMS.json'),JSON.stringify(manifest,null,2)+'\n');
const temporary=resolve(directory,'../../../../tests/evidence/integrated-person01-publication-v044-2026-10-27');
let checked=0;
for(const row of manifest.filter(item=>item.path.startsWith('validation-raw/'))){
 const source=await readFile(resolve(temporary,row.path.slice('validation-raw/'.length)));
 if(source.length!==row.byteLength||createHash('sha256').update(source).digest('hex')!==row.sha256)throw new Error(`Copy mismatch: ${row.path}`);
 checked++;
}
console.log(JSON.stringify({manifestFiles:manifest.length,rawFilesCompared:checked,rawCopiesMatch:true}));
