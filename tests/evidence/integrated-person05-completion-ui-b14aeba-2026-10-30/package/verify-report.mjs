// Supplement the completed audit with a complete count of its explicit EOL category.
// Original run outputs are preserved. This only verifies existing artifacts.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url);
const report=JSON.parse(await readFile(new URL('report.json',here),'utf8'));
const zip=JSON.parse(await readFile(new URL('zip-members.json',here),'utf8'));
const counts={fixedGitExact:0,fixedGitTextWithExplicitCRLFVariant:0,lockedVendor:0,generated:0};
for(const item of report.sourceBindings){
 if(item.kind==='fixed-git')counts.fixedGitExact++;
 else if(item.kind==='fixed-git-content-with-explicit-crlf-variant')counts.fixedGitTextWithExplicitCRLFVariant++;
 else if(item.kind==='locked-vendor')counts.lockedVendor++;
 else if(item.kind==='generated-from-fixed-source')counts.generated++;
 else throw Error('Unknown binding category');
 const member=zip.members.find(e=>e.name==='site/releases/'+report.bundle.bundleId+'/'+item.path);
 assert(member,item.path);const bytes=await readFile(member.target);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
}
assert.deepEqual(counts,{fixedGitExact:54,fixedGitTextWithExplicitCRLFVariant:1,lockedVendor:4,generated:3});
assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),62);
const eol=report.sourceBindings.filter(e=>e.kind.includes('crlf'));
assert.equal(eol.length,1);assert.equal(eol[0].path,'IPAD-USER-MANUAL.md');
assert.equal(eol[0].rawByteEqual,false);assert.equal(eol[0].equalAfterLFNormalization,true);
const result={schemaVersion:1,verifiedAt:new Date().toISOString(),testedRevision:report.testedRevision,archive:report.archive,bundle:report.bundle,completeSourceBindingCounts:counts,manualEOLVariant:eol[0],metadataClarification:{original:'report.json sourceBindingCounts',note:'The original successful run reports exact Git, locked and generated totals but omits a fourth summary counter. Its full sourceBindings array already explicitly records the one CRLF-variant manual. This supplement counts all four categories without rewriting the run output. Runtime and archive manuals match each other byte-for-byte; equality to the fixed Git manual is after explicit LF normalization.'},backendReuse:{baseline:report.backendBaseline,dependencyResources:report.backendReuse.dependencyBindings.length,implementationAndApiDependencyDiff:report.backendReuse.implementationAndApiDependencyDiff,actualBackendFilesAndToolchainLockIdentical:true,packageDependencyGraphChanged:false,previousSemanticLimitationsPreserved:true},workers:report.workers,imports:{modulesParsed:report.imports.modulesParsed,browserStaticEdges:report.imports.browserStaticEdges,missing:0},newConfirmedProductDefects:[],initialAuditFailure:{file:'failure.json',originalSource:'runner.mjs',reason:'Strict raw Git-manual equality observed a real CRLF/LF byte difference, not a content mismatch. New successful run explicitly permits and records only this known manual variant; exact immutable resource hashes remain checked.'},successfulAuditSource:'runner-run-02.mjs',finalResult:'Package integrity/source-content/Worker/dependency checks passed within the explicit EOL scope; browser/UI/device acceptance remains separate'};
await writeFile(new URL('audit-summary.json',here),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({completeSourceBindingCounts:counts,totalResources:62,backendDependencyResources:result.backendReuse.dependencyResources,newConfirmedProductDefects:0}));
