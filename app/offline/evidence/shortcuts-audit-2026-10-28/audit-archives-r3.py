from pathlib import Path,PurePosixPath
import subprocess,json,hashlib,zipfile,plistlib
ROOT=Path.cwd().resolve()
OUT=ROOT/'app/offline/evidence/shortcuts-audit-2026-10-28'
PACKAGES=ROOT/'app/offline/.local/packages'
def sha(b):return hashlib.sha256(b).hexdigest()
def raw_git(path):return subprocess.check_output(['git','show','HEAD:'+path],cwd=ROOT)
tracked=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
old_reports=[]
for name in tracked:
 if name.startswith('app/offline/evidence/') and name.endswith('/package.json'):
  report=json.loads(raw_git(name))
  if report.get('version') in ['0.4.1','0.4.2','0.4.3','0.4.4']:old_reports.append((name,report))
assert sorted(x[1]['version'] for x in old_reports)==['0.4.1','0.4.2','0.4.3','0.4.4']
previous=[]
for name,report in old_reports:
 for key in ['completePackage','firstSetupPackage']:
  expected=report[key];path=PACKAGES/expected['filename'];data=path.read_bytes()
  assert len(data)==expected['byteLength'],path
  assert sha(data)==expected['sha256'],path
  previous.append({'reportGitPath':name,'reportGitSha256':sha(raw_git(name)),'version':report['version'],'filename':path.name,'byteLength':len(data),'sha256':sha(data),'unchanged':True})
assert len(previous)==8
candidate_audit=json.loads((OUT/'archives-audit.json').read_bytes())
for item in candidate_audit['newPackages']:
 path=PACKAGES/item['filename'];data=path.read_bytes()
 assert len(data)==item['byteLength'] and sha(data)==item['sha256'],path
 previous.append({'reportPath':'app/offline/evidence/shortcuts-package-2026-10-28/package.json','sourceAudit':'archives-audit.json','version':'0.4.5-initial-candidate','filename':path.name,'byteLength':len(data),'sha256':sha(data),'unchanged':True})
assert len(previous)==10
r2_audit=json.loads((OUT/'archives-r2-audit.json').read_bytes())
for item in r2_audit['newPackages']:
 path=PACKAGES/item['filename'];data=path.read_bytes()
 assert len(data)==item['byteLength'] and sha(data)==item['sha256'],path
 previous.append({'reportPath':'app/offline/evidence/shortcuts-package-r2-2026-10-28/package.json','sourceAudit':'archives-r2-audit.json','version':'0.4.5-r2-candidate','filename':path.name,'byteLength':len(data),'sha256':sha(data),'unchanged':True})
assert len(previous)==12
report_base=ROOT/'app/offline/evidence/shortcuts-package-r3-2026-10-28'
report=json.loads((report_base/'package.json').read_bytes())
build=json.loads((report_base/'build.json').read_bytes())
bundle=report['bundleId'];assert bundle=='ipad-web-probe-eb5236b6ed8f9aab4a9d9ced'
assert report['resourceCount']==51 and report['resourceBytes']==60874273
assert sorted(report['knownOpenIssues'])==['REV-006','REV-007','REV-008']
assert report['debuggerFixCommit']=='309cb45191a62fde2b13eeab9746a8d2502ef658' and report['clipboardFixCommit']=='33c16398948c102edcac4f4c794a3e1de1cb9b19'
assert build['compatibilityId']=='integration-prototype-60eb6729284e2729'
assert 'Fixes integrated' in report['knownIssueState']
expected_packages={'completePackage':(19294031,'f1877f4e031f5a46bdafab71ea5ae611a8dd74c58c7256c9ed367e92cb00c068',60),'firstSetupPackage':(19139,'3d9b89e7aa7332df00d47e090a644433458d31f87089daa6494b1f732eebec3e',6)}
new=[]
for kind,(size,digest,file_count) in expected_packages.items():
 expected=report[kind];path=PACKAGES/expected['filename'];data=path.read_bytes()
 assert (len(data),sha(data))==(size,digest)
 assert (expected['byteLength'],expected['sha256'],expected['fileCount'])==(size,digest,file_count)
 with zipfile.ZipFile(path) as archive:
  names=archive.namelist();assert len(names)==len(set(names))==file_count
  for name in names:
   p=PurePosixPath(name)
   assert not name.startswith('/') and '..' not in p.parts and '\\' not in name,name
   assert not name.endswith(('server-key.pem','.p12','.pfx')) and '/tls/' not in name and '/test-controls/' not in name,name
   b=archive.read(name)
   assert (b'-----BEGIN '+b'PRIVATE KEY-----') not in b and (b'-----BEGIN '+b'RSA PRIVATE KEY-----') not in b and (b'-----BEGIN '+b'EC PRIVATE KEY-----') not in b,name
  checks=json.loads(archive.read('SHA256SUMS.json'));assert len(checks)==file_count-1
  assert {x['path'] for x in checks}==set(names)-{'SHA256SUMS.json'}
  for row in checks:
   b=archive.read(row['path']);assert len(b)==row['byteLength'] and sha(b)==row['sha256'],row['path']
  profile=plistlib.loads(archive.read('certificates/root-only.mobileconfig'));der=archive.read('certificates/root-ca.cer')
  assert len(profile['PayloadContent'])==1 and profile['PayloadContent'][0]['PayloadType']=='com.apple.security.root'
  assert profile['PayloadContent'][0]['PayloadContent']==der and not profile['PayloadRemovalDisallowed']
  assert sha(der)=='87991d2b7d332034beddb95ed35ddabc906c0e0b2bd1dd174ec4a25b826e349f'
  notes=[archive.read(n).decode('utf-8') for n in names if n.endswith('.md')]
  assert any(all(issue in note for issue in ['REV-006','REV-007','REV-008']) for note in notes)
  resource_verified=None
  if kind=='completePackage':
   prefix='site/releases/'+bundle+'/'
   descriptor_raw=archive.read(prefix+'bundle.json');descriptor=json.loads(descriptor_raw)
   assert len(descriptor['resources'])==51 and sum(r['byteLength'] for r in descriptor['resources'])==60874273
   assert sha(descriptor_raw)==report['descriptorSha256'].removeprefix('sha256:')==build['descriptorSha256'].removeprefix('sha256:')
   assert sha(archive.read(prefix+'sw.js'))==report['workerSha256'].removeprefix('sha256:')==build['workerSha256'].removeprefix('sha256:')
   expected_release={prefix+r['path'] for r in descriptor['resources']}|{prefix+'bundle.json',prefix+'sw.js'}
   assert {n for n in names if n.startswith('site/releases/')}==expected_release
   for row in descriptor['resources']:
    b=archive.read(prefix+row['path']);assert len(b)==row['byteLength'] and 'sha256:'+sha(b)==row['sha256'],row['path']
   shortcuts=archive.read(prefix+'ui/SHORTCUTS.md');shortcuts_git=subprocess.check_output(['git','show','309d29dd703b1bc5a5beff03a88f232764c95808:ui/SHORTCUTS.md'],cwd=ROOT)
   assert shortcuts==shortcuts_git==(ROOT/'ui/SHORTCUTS.md').read_bytes()
   manual=archive.read(prefix+'IPAD-USER-MANUAL.md');assert manual==(ROOT/'docs/architecture/IPAD-USER-MANUAL.md').read_bytes()==archive.read(next(n for n in names if n.startswith('docs/') and archive.read(n)==manual))
   assert archive.read(prefix+'bundle.json')==(report_base/'bundle.json').read_bytes()
   for source_path in ['ui/src/main.mjs','debugger/src/variables.mjs','debugger/src/wasm-runtime.mjs']:
    source_git=subprocess.check_output(['git','show','c14478a49a06705cffbb536bf1bae9b4400a0e91:'+source_path],cwd=ROOT)
    assert archive.read(prefix+source_path)==source_git==(ROOT/source_path).read_bytes(),source_path
   warning=manual.decode('utf-8');assert all(issue in warning for issue in ['REV-006','REV-007','REV-008']) and '309cb45' in warning and '33c1639' in warning
   assert bundle in archive.read('site/index.html').decode('utf-8')
   resource_verified={'resourceCount':51,'resourceBytes':60874273,'allPayloadHashes':True,'controlPlaneHashes':2,'onlyCurrentRelease':True,'shortcutMatchesFixedGitAndWorking':True,'manualMatchesRuntimeDocsAndWorking':True}
 new.append({'kind':kind,'filename':path.name,'byteLength':len(data),'sha256':sha(data),'fileCount':file_count,'allZipMemberChecksums':True,'noPrivateKeyOrOutsidePath':True,'singlePublicRemovableRoot':True,'resources':resource_verified})
result={'clientDate':'2026-10-28','packageReportPath':report_base.relative_to(ROOT).as_posix()+'/package.json','bundleId':bundle,'archiveStatus':'r3 final integrated local archive; person05 independent closure and real iPad acceptance pending','knownOpenIssues':['REV-006','REV-007','REV-008'],'newPackages':new,'historicalPackages':previous,'historicalCount':len(previous),'allPassed':True,'scope':'Independent local byte, ZIP member and fixed Git report comparison only. No network POST or push. Does not certify distribution licenses, full secret discovery, independent person05, browser, real iPad or G2/G3 acceptance.'}
(OUT/'archives-r3-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'newArchives':len(new),'oldArchivesUnchanged':len(previous),'resourceCount':51,'payloadAndControlHashes':'all matched','allPassed':True}))
