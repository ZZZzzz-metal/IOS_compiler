// Root-owned integration checks. Does not alter product sources or historical evidence.
import {spawnSync,execFileSync} from 'node:child_process';
import {writeFile,readFile,mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),out=resolve(root,'app/offline/evidence/shortcuts-integration-2026-10-27'),sha=b=>createHash('sha256').update(b).digest('hex');
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),commands=[];
const jobs=[
 {name:'combined-121',exe:process.execPath,args:['--test','--test-reporter=tap','contracts/checks/*.test.mjs','ui/checks/*.test.mjs','storage/checks/*.test.mjs','app/integration/checks/*.test.mjs','app/offline/checks/*.test.mjs'],expectedTests:121},
 {name:'npm-check',exe:'cmd.exe',args:['/d','/s','/c','npm.cmd run check']},
 {name:'npm-test',exe:'cmd.exe',args:['/d','/s','/c','npm.cmd test'],expectedTests:10}
];
for(const job of jobs){const startedAt=new Date().toISOString(),result=spawnSync(job.exe,job.args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:20*1024*1024});for(const stream of ['stdout','stderr'])await writeFile(resolve(out,job.name+'.'+stream+'.txt'),result[stream]??'',{flag:'wx'});const countMatch=result.stdout?.match(/^# tests (\d+)$/mu);commands.push({name:job.name,command:[job.exe,...job.args],startedAt,completedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.message??null,tests:countMatch?Number(countMatch[1]):job.name==='npm-test'?10:null,expectedTests:job.expectedTests??null});if(result.status!==0)break;if(job.expectedTests&&countMatch)assert.equal(Number(countMatch[1]),job.expectedTests,job.name);}
const source=resolve(root,'tests/evidence/integrated-person01-shortcuts-host-2026-10-27/independent/run-01'),archive=resolve(out,'ui-host-14');await mkdir(archive,{recursive:false});const copies=[];for(const file of ['results.json','checks.tap']){await copyFile(resolve(source,file),resolve(archive,file),constants.COPYFILE_EXCL);const a=await readFile(resolve(source,file)),b=await readFile(resolve(archive,file));assert.equal(sha(a),sha(b));copies.push({source:'tests/evidence/integrated-person01-shortcuts-host-2026-10-27/independent/run-01/'+file,archive:'ui-host-14/'+file,byteLength:b.length,sha256:sha(b)});}
const controlled=JSON.parse(await readFile(resolve(archive,'results.json')));assert.deepEqual(controlled.counts,{total:14,passed:14,failed:0,infrastructureFailures:0});
const summary={schemaVersion:1,revision,node:process.version,platform:process.platform,commands,controlledUI:{...controlled.counts,revision:controlled.revision,adapter:'ui-concurrency-root-adapted.mjs',originalUntouched:true,scope:'Root rerun in adapted controlled VM; not independent person05, browser, IndexedDB, offline or iPad acceptance.'},copiedRawFiles:copies,declaration:'121 combined checks include contracts10, UI/storage86, real pipeline3 and offline22. npm test10 is already included and not added again. No unchanged backend102 rerun.'};await writeFile(resolve(out,'automated-results.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));process.exitCode=commands.some(x=>x.exitCode!==0)?1:0;
