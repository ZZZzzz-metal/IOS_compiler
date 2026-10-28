// Read-only historical manifests; output is JSON on stdout, no history is edited.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${repo}`,'-C',repo,...args],{maxBuffer:32*1024*1024});
const fixed='40a079ba2065384572f268e4bb91bda437e46cec';
assert.equal(git('rev-parse','HEAD').toString().trim(),fixed);
assert.equal(git('rev-parse','integration-v0.4.5^{}').toString().trim(),fixed);
assert.equal(git('rev-parse','--show-object-format').toString().trim(),'sha1');
const tree=new Map();
for(const record of git('ls-tree','-r','-z','HEAD').toString('utf8').split('\0').filter(Boolean)){
 const m=record.match(/^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/);if(m)tree.set(m[2],m[1]);
}
const excluded='tests/evidence/integrated-person05-final-v045-40a079b-2026-10-28/';
const manifests=[...tree.keys()].filter(f=>/SHA256SUMS[^/]*\.json$/i.test(path.basename(f))&&!f.startsWith(excluded));
const sha=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
let references=0,lengthAndSHA256=0,SHA256Only=0,referenceGitBlobMatches=0,manifestRawGitMatches=0,testsManifests=0,testsReferences=0;
const aliases=[],normalized=[],unique=new Set(),results=[];
for(const manifest of manifests){
 const manifestBytes=await readFile(path.join(repo,manifest));
 if(blob(manifestBytes)===tree.get(manifest))manifestRawGitMatches++;
 else{
  const stored=git('show','HEAD:'+manifest);
  assert.equal(manifestBytes.toString('utf8').replace(/\r\n/g,'\n'),stored.toString('utf8').replace(/\r\n/g,'\n'));
  const attrs=git('check-attr','text','eol','--',manifest).toString('utf8').trim();
  assert.equal(manifest,'tests/evidence/SHA256SUMS.json');
  normalized.push({manifest,attributes:attrs,note:'Index LF/worktree CRLF under declared text=auto/eol=lf; no tracked change.'});
 }
 const data=JSON.parse(manifestBytes);
 const entries=Array.isArray(data)?data:Object.entries(data).map(([file,value])=>typeof value==='string'?{file,sha256:value}:{file,...value});
 const checked=[];
 for(const e of entries){
  const entry=e.file??e.path;assert.equal(typeof entry,'string');
  let target=path.basename(manifest).startsWith('ROOT-')?entry:path.posix.join(path.posix.dirname(manifest),entry);
  if(manifest==='tests/evidence/integrated-v0.3.0-2026-10-25/initial-SHA256SUMS.json'&&entry==='summary.json'){
   const original=target;target=path.posix.join(path.posix.dirname(manifest),'initial-summary.json');
   aliases.push({manifest,original,retainedAlias:target,expectedByteLength:e.byteLength,expectedSHA256:e.sha256,note:'Existing historical summary preserved as initial-summary.json; current summary covered by current SHA256SUMS.json.'});
  }
  const bytes=await readFile(path.join(repo,target));references++;unique.add(target);
  const lengthRecorded=Number.isInteger(e.byteLength);
  if(lengthRecorded){assert.equal(bytes.length,e.byteLength,manifest+':'+target+' length');lengthAndSHA256++;}else SHA256Only++;
  assert.equal(sha(bytes),e.sha256.replace(/^sha256:/,''),manifest+':'+target+' SHA256');
  assert.equal(blob(bytes),tree.get(target),target+' Git blob bytes');referenceGitBlobMatches++;
  checked.push({target,byteLength:bytes.length,lengthRecorded,sha256:sha(bytes),gitBlob:tree.get(target),matched:true});
 }
 if(manifest.startsWith('tests/evidence/')){testsManifests++;testsReferences+=entries.length;}
 results.push({manifest,entries:entries.length,passed:checked.length,checked});
}
assert.equal(git('diff',fixed,'--','tests/evidence').toString(),'');
assert.equal(manifests.length,51);assert.equal(references,987);assert.equal(unique.size,858);assert.equal(lengthAndSHA256,970);assert.equal(SHA256Only,17);assert.equal(referenceGitBlobMatches,987);
console.log(JSON.stringify({schemaVersion:1,verifiedAt:new Date().toISOString(),testedRevision:fixed,readOnly:true,allPassed:true,manifests:manifests.length,references,uniqueTargets:unique.size,lengthAndSHA256,SHA256Only,referenceGitBlobMatches,manifestRawGitMatches,normalizedManifestMatches:normalized,retainedHistoricalAliasChecks:aliases,testsManifests,testsReferences,trackedHistoricalEvidenceDiff:'',currentFinalDirectoryExcluded:excluded,results},null,2));
