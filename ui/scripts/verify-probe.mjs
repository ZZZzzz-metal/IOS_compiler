// Reproducible module evidence. Runs real compiler/debugger cases, no network preparation.
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
const root=new URL('../../',import.meta.url),rootPath=fileURLToPath(root);
const evidenceBase=resolve(rootPath,'ui/evidence');
const evidencePath=resolve(rootPath,process.env.UI_EVIDENCE_DIR??'ui/evidence/integrated-v0.3.0-2026-10-25');
const destination=relative(evidenceBase,evidencePath);
if(!evidencePath.startsWith(evidenceBase+sep)||!destination.split(sep)[0].startsWith('integrated-'))
  throw Error('UI_EVIDENCE_DIR must be inside ui/evidence/integrated-*; historical evidence is read-only.');
const evidence=pathToFileURL(evidencePath+sep);
await mkdir(evidence,{recursive:true});
const existing=await readdir(evidence,{withFileTypes:true});
if(existing.some(entry=>entry.isFile()&&entry.name!=='.gitattributes'))
  throw Error('Evidence directory already contains a run. Choose a new UI_EVIDENCE_DIR to preserve its results.');
const checks=[
  ['baseline-check.txt',['scripts/check-baseline.mjs']],
  ['contracts.tap',['--test','--test-reporter=tap','contracts/checks/*.test.mjs']],
  ['module-tests.tap',['--test','--test-reporter=tap','ui/checks/*.test.mjs','storage/checks/*.test.mjs']],
  ['integration.tap',['--test','--test-reporter=tap','app/integration/checks/*.test.mjs']],
];
for(const [filename,args] of checks){
  const result=spawnSync(process.execPath,args,{cwd:fileURLToPath(root),encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
  await writeFile(new URL(filename,evidence),result.stdout+(result.stderr?`\n${result.stderr}`:''));
  if(result.error||result.status!==0){console.error(result.error??result.stdout.slice(-6000));process.exit(1);}
  console.log(`${filename}: PASS`);
}
const files=(await readdir(evidence,{withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name!=='SHA256SUMS.json').map(entry=>entry.name).sort(),sums={};
for(const file of files){const bytes=await readFile(new URL(file,evidence));sums[file]={byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
await writeFile(new URL('SHA256SUMS.json',evidence),JSON.stringify(sums,null,2)+'\n');
console.log(`UI/storage development evidence saved to ${destination}; iPad and independent acceptance remain pending.`);
