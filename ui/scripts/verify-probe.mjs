// Reproducible module evidence. Runs real compiler/debugger cases, no network preparation.
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),evidence=new URL('ui/evidence/',root);
await mkdir(evidence,{recursive:true});
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
const files=(await readdir(evidence)).filter(name=>name!=='SHA256SUMS.json').sort(),sums={};
for(const file of files){const bytes=await readFile(new URL(file,evidence));sums[file]={byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
await writeFile(new URL('SHA256SUMS.json',evidence),JSON.stringify(sums,null,2)+'\n');
console.log('UI/storage development evidence saved; iPad and independent acceptance remain pending.');
