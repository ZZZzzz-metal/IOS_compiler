import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),baseline=new URL('../integrated-person05-parallel-review-3248ad5-2026-10-28/engine/run-01/',here);
const json=async(name,root=here)=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const previous=await json('results.json',baseline),current=await json('engine/run-01/results.json'),summary=await json('summary.json');
assert.equal(summary.testedRevision,'309cb45191a62fde2b13eeab9746a8d2502ef658');
assert.equal(summary.productStatusBefore,'');assert.equal(summary.productStatusAfter,'');
assert.deepEqual(current.counts,{passed:25,failed:0,boundaryOnly:1});
assert.match(current.build.snapshot.sourceHash,/^sha256:[0-9a-f]{64}$/u);
assert.equal(current.build.snapshot.sourceHash,previous.build.snapshot.sourceHash);
assert.equal(current.build.snapshot.sourceHash,'sha256:8f4ea16786be3da29608a1034506eb34c2685b8d6d268e9b057942fa3a176161');
assert.equal(current.build.build.sourceHash,current.build.snapshot.sourceHash);
assert.equal(current.build.persistedSHA256,previous.build.persistedSHA256);
const files=[];
for(const name of ['source.cpp','artifact.wasm']){const bytes=await readFile(new URL(`engine/run-01/${name}`,here));assert.deepEqual(bytes,await readFile(new URL(name,baseline)));files.push({file:name,byteLength:bytes.length,sha256:sha(bytes),identicalToBaseline:true});}
const counts={};
for(const cmd of summary.commands){assert.equal(cmd.exitCode,0);const bytes=await readFile(new URL(cmd.outputFile,here));assert.equal(sha(bytes),cmd.outputSHA256);const out=bytes.toString('utf8');if(['debugger','contracts','integration'].includes(cmd.id)){const fields={};for(const name of ['tests','pass','fail','skipped']){const match=out.match(new RegExp('(?:#|ℹ) '+name+' (\\d+)'));assert(match,cmd.id+' '+name);fields[name]=Number(match[1]);}counts[cmd.id]=fields;assert.equal(fields.fail,0);assert.equal(fields.skipped,0);}}
assert.equal(counts.debugger.tests,83);assert.equal(counts.integration.tests,3);assert.equal(counts.contracts.tests,10);
assert.equal(current.interpreterOutput,current.native.stdout);assert.equal(current.native.stdout,previous.native.stdout);
const report={schemaVersion:1,verifiedAt:new Date().toISOString(),testedRevision:summary.testedRevision,sourceHash:current.build.snapshot.sourceHash,files,observations:current.counts,commandsChecked:summary.commands.length,counts,allPassed:true,metadataCorrection:{original:'rerun-executed.mjs',corrected:'rerun.mjs',reason:'The executed wrapper read build.sourceHash instead of build.snapshot.sourceHash, so comparison.json omitted this metadata field. This verification explicitly validates both snapshot/build sourceHash and the known expected hash. Original outputs remain unchanged; source.cpp and Wasm bytes were already compared correctly during execution.'}};
await writeFile(new URL('verification.json',here),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
