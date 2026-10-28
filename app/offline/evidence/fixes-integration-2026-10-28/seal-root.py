from pathlib import Path
import hashlib,json,sys,subprocess
root=Path.cwd().resolve()
folders=['shortcuts-integration-2026-10-27','fixes-integration-2026-10-28','shortcuts-browser-2026-10-28','shortcuts-audit-2026-10-28','shortcuts-package-2026-10-28','shortcuts-package-r2-2026-10-28','shortcuts-package-r3-2026-10-28']
def identity(path):
 b=path.read_bytes();return {'path':path.relative_to(root).as_posix(),'byteLength':len(b),'sha256':hashlib.sha256(b).hexdigest()}
index='--index' in sys.argv;verify=index or '--verify' in sys.argv
sources=['AGENTS.md','README.md','app/main.mjs','app/offline/build.mjs','package.json','package-lock.json','docs/architecture/GATES.md','docs/architecture/STATUS.md','docs/architecture/IPAD-USER-MANUAL.md','docs/architecture/IPAD-UPDATE-v0.4.5.md','docs/architecture/SHORTCUTS-INTEGRATION-2026-10-28.md','docs/handoffs/01.md','ui/src/main.mjs','ui/src/editor.mjs','ui/SHORTCUTS.md','debugger/src/variables.mjs','debugger/src/wasm-runtime.mjs']
sourcefile=root/'app/offline/evidence/fixes-integration-2026-10-28/final-source-inputs.json'
if not verify:
 with sourcefile.open('x',encoding='utf-8',newline='\n') as f:json.dump([identity(root/s) for s in sources],f,ensure_ascii=False,indent=2);f.write('\n')
records=json.loads(sourcefile.read_bytes());manifests=[]
for folder in folders:
 base=root/'app/offline/evidence'/folder;manifest=base/'ROOT-SHA256SUMS.json'
 if not verify:
  rows=[identity(p) for p in sorted(base.rglob('*')) if p.is_file() and p!=manifest]
  with manifest.open('x',encoding='utf-8',newline='\n') as f:json.dump(rows,f,ensure_ascii=False,indent=2);f.write('\n')
 rows=json.loads(manifest.read_bytes());records+=rows;manifests.append(identity(manifest))
for row in records+manifests:
 p=root/row['path'];assert p.is_relative_to(root)
 b=subprocess.check_output(['git','show',':'+row['path']]) if index else p.read_bytes()
 assert len(b)==row['byteLength'] and hashlib.sha256(b).hexdigest()==row['sha256'],row['path']
print(json.dumps({'mode':'index' if index else 'verify' if verify else 'seal','sourceFiles':len(sources),'evidenceFiles':len(records)-len(sources),'directories':len(folders),'allHashesMatch':True}))
