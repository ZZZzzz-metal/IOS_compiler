from pathlib import Path
import json,subprocess,hashlib
root=Path.cwd().resolve();out=root/'app/offline/evidence/final-person05-integration-2026-10-28'
fixed='40a079ba2065384572f268e4bb91bda437e46cec';person05='e4ce50722f76f63d7b313dd7fe6d676342d133d8'
def blob(rev,path):return subprocess.check_output(['git','show',rev+':'+path])
def check(rev,row):
 path=row.get('path') or row.get('file');b=blob(rev,path)
 assert len(b)==row['byteLength'] and hashlib.sha256(b).hexdigest()==row['sha256'],path
folders=['shortcuts-integration-2026-10-27','fixes-integration-2026-10-28','shortcuts-browser-2026-10-28','shortcuts-audit-2026-10-28','shortcuts-package-2026-10-28','shortcuts-package-r2-2026-10-28','shortcuts-package-r3-2026-10-28']
n=0
for folder in folders:
 path='app/offline/evidence/'+folder+'/ROOT-SHA256SUMS.json'
 for row in json.loads(blob(fixed,path)):check(fixed,row);n+=1
sources=json.loads(blob(fixed,'app/offline/evidence/fixes-integration-2026-10-28/final-source-inputs.json'))
for row in sources:check(fixed,row)
base='tests/evidence/integrated-person05-final-v045-40a079b-2026-10-28/'
rows=json.loads(blob(person05,base+'SHA256SUMS.json'))
for row in rows:
 item={**row,'path':base+row['file']};check(person05,item)
 assert (root/item['path']).read_bytes()==blob(person05,item['path'])
changed=subprocess.check_output(['git','diff','--name-only',fixed,person05],text=True).splitlines()
assert all(p.startswith(('tests/','docs/validation/')) or p=='docs/handoffs/05.md' for p in changed)
assert all('tests/scratch/' not in p for p in changed)
subprocess.run(['git','diff','--exit-code',fixed,'HEAD','--','app/main.mjs','app/offline/build.mjs','compiler','debugger/src','ui/src','storage/src','contracts'],check=True,stdout=subprocess.PIPE)
result={'frozenRevision':fixed,'frozenEvidenceFiles':n,'frozenSourceFiles':len(sources),'frozenHashesMatchGit':True,'person05Commit':person05,'person05EvidenceFiles':len(rows),'person05HashesAndCurrentGitBytesMatch':True,'person05ChangedFiles':len(changed),'scopeOnlyOwner05':True,'scratchExcluded':True,'runtimeMatchesFrozen40a079b':True,'declaration':'Current shared-status documents deliberately advance after fixed tag; original 40a079b seal verified against its Git blobs, never rewritten.'}
with (out/'fixed-delivery-audit.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
