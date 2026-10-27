// Re-runnable integration verification; writes only into a newly named run.
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,cp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root=process.cwd(), directory=resolve(root,'app/offline/evidence/publication-integration-2026-10-27');
const temporary=resolve(root,'tests/evidence/integrated-person01-publication-v044-2026-10-27');
await mkdir(temporary); // Refuse to overwrite a prior run.
const revision=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
const startedAt=new Date().toISOString();
const commands=[
 ['baseline',['scripts/check-baseline.mjs']],
 ['contracts',['--test','contracts/checks/*.test.mjs']],
 ['combined',['--test','contracts/checks/*.test.mjs','compiler/checks/*.test.mjs','debugger/checks/*.test.mjs','ui/checks/*.test.mjs','storage/checks/*.test.mjs','app/integration/checks/*.test.mjs','app/offline/checks/*.test.mjs']],
 ['acceptance',['tests/run-validation.mjs']],
 ['regression-shadow',['tests/reproduce.mjs','shadow']],
 ['regression-loop-header',['tests/reproduce.mjs','loop-header']],
 ['initializer',['tests/initializer-lifetime.mjs']],
 ['ui-independent',['tests/ui-concurrency-independent.mjs','--ref',revision,'--out','tests/evidence/integrated-person01-publication-v044-2026-10-27/independent/run-01']],
];
const results=[];
for(const [name,args] of commands){
 const start=Date.now();
 const result=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,VALIDATION_EVIDENCE_DIR:temporary},encoding:'utf8',maxBuffer:100*1024*1024});
 const stdout=result.stdout??'',stderr=result.stderr??'';
 await writeFile(resolve(directory,`${name}.stdout.txt`),stdout);
 await writeFile(resolve(directory,`${name}.stderr.txt`),stderr);
 const hashes=Object.fromEntries([['stdout',stdout],['stderr',stderr]].map(([kind,text])=>[kind,{byteLength:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}]));
 const row={name,command:[process.execPath,...args],equivalentNpmScript:name==='baseline'?'npm run check':name==='contracts'?'npm test':undefined,exitCode:result.status,signal:result.signal,error:result.error?.message,durationMs:Date.now()-start,hashes};
 results.push(row);console.log(JSON.stringify({name,exitCode:result.status,durationMs:row.durationMs,tail:stdout.slice(-850),stderr:stderr.slice(-700)}));
}
await cp(temporary,resolve(directory,'validation-raw'),{recursive:true,errorOnExist:true,force:false});
const summary={schemaVersion:1,startedAt,completedAt:new Date().toISOString(),revision,node:process.version,platform:process.platform,architecture:process.arch,commands:results,allCommandsPassed:results.every(row=>row.exitCode===0),boundary:'Desktop Node tests include real freshly compiled Wasm and direct/Node Worker execution. Independent UI 14 scenarios use controlled DOM/File/network/compiler/debugger/storage transports and real parsing/autosave/editor/source modules. No browser, physical iPad, offline cold start or system storage durability result.',temporaryEvidenceDirectory:temporary,archivedRawDirectory:'validation-raw'};
await writeFile(resolve(directory,'run-summary.json'),JSON.stringify(summary,null,2)+'\n');
process.exitCode=summary.allCommandsPassed?0:1;
