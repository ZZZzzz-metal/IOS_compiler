import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

repo=Path.cwd()
out=repo/'app/offline/evidence/completion-fix-package-2026-10-31'
expected=sys.argv[1]
assert re.fullmatch(r'[0-9a-f]{40}',expected)
def h(data): return hashlib.sha256(data).hexdigest()
def save(name,value):
    with (out/name).open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2);stream.write('\n')
build=json.loads((repo/'app/offline/.local/latest-build.json').read_text(encoding='utf-8'))
assert build['sourceBaseRevision']==expected
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()==expected
assert json.loads((repo/'package.json').read_text(encoding='utf-8'))['version']=='0.4.7'
release=Path(build['releaseDirectory'])
descriptor=json.loads((release/'bundle.json').read_text(encoding='utf-8'))
assert descriptor['bundleId']==build['bundleId']
assert build['resourceCount']==len(descriptor['resources'])==65
assert build['compatibilityId']=='integration-prototype-c3e9a2fea60c51b3'
assert build['resourceManifestHash']=='sha256:c3e9a2fea60c51b357384059523151619b4987ddfd2629e80f2bd870c3a8e81e'
tracked=set(subprocess.check_output(['git','ls-tree','-r','--name-only',expected]).decode('utf-8').splitlines())
lock=json.loads((release/'compiler/resources/toolchain.lock.json').read_text(encoding='utf-8'))
locked={'compiler/resources/'+lock['vendorDirectory']+'/'+item['filename']:item for item in lock['files']}
generated={'ui/.local/candidate.json','manual.html','manifest.webmanifest'}
records=[]
for resource in descriptor['resources']:
    path=resource['path'];data=(release/path).read_bytes()
    assert len(data)==resource['byteLength'] and 'sha256:'+h(data)==resource['sha256'],path
    original='app/offline/browser/'+path if path in {'index.html','launcher.mjs','style.css','icon.svg'} else 'docs/architecture/IPAD-USER-MANUAL.md' if path=='IPAD-USER-MANUAL.md' else path
    if path in generated:
        kind='generated'
    elif original in tracked:
        assert subprocess.check_output(['git','show',expected+':'+original])==data,path
        kind='fixed-git-exact-bytes'
    else:
        pin=locked[path];assert pin['byteLength']==len(data) and pin['sha256']==h(data),path
        kind='locked-vendor-exact-bytes'
    records.append({'path':path,'byteLength':len(data),'sha256':h(data),'source':kind})
assert sum(x['source']=='generated' for x in records)==3
assert sum(x['source']=='locked-vendor-exact-bytes' for x in records)==4
for name,key in [('bundle.json','descriptorSha256'),('sw.js','workerSha256')]:
    assert 'sha256:'+h((release/name).read_bytes())==build[key]
for path in ['compiler/src/compiler-worker.mjs','compiler/src/completion-worker.mjs','debugger/src/debugger-worker.mjs',
             'compiler/src/completion-semantics.mjs','compiler/resources/completion-semantics-v1.md','compiler/resources/completion-semantics-v1.cpp.patch']:
    assert any(row['path']==path for row in records)
prior=json.loads((out/'prior-archives.json').read_text(encoding='utf-8'))
for item in prior:
    data=(repo/'app/offline/.local/packages'/item['file']).read_bytes()
    assert len(data)==item['byteLength'] and h(data)==item['sha256']
save('prior-archives-after.json',{'verifiedUnchanged':len(prior),'archives':prior})
save('payload-source-audit.json',{'sourceBaseRevision':expected,'bundleId':build['bundleId'],'resources':records,
      'fixedGitExactBytes':58,'lockedVendorResources':4,'generatedResources':3,'controlPlaneHashesVerified':2,
      'manualGitExactBytes':True,'allThreeWorkersAndSemanticsRecipeIncluded':True,'priorArchivesUnchanged':len(prior),
      'researchEvidenceLinks':'Repository research references are not included in the runtime archive.',
      'declaration':'Byte/source audit only; actual desktop browser workflow and iPad validation are separate.'})
save('build.json',{key:value for key,value in build.items() if key!='releaseDirectory'})
setup=json.loads((repo/'app/offline/.local/tls/local-https-20261026T012959Z-a065aa18/setup.json').read_text(encoding='utf-8'))
config={'tlsDir':'app/offline/.local/tls/local-https-20261026T012959Z-a065aa18','entryURL':setup['httpsURL'].rstrip('/')+build['entryPath']}
with (repo/'app/offline/.local/completion-setup-v0.4.7.json').open('x',encoding='utf-8',newline='\n') as stream:
    json.dump(config,stream,ensure_ascii=False,indent=2);stream.write('\n')
print(json.dumps({'bundleId':build['bundleId'],'resources':len(records),'manualGitExactBytes':True,'priorArchivesUnchanged':len(prior)}))
