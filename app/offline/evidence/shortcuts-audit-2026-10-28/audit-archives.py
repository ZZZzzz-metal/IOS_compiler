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
report_base=ROOT/'app/offline/evidence/shortcuts-package-2026-10-28'
report=json.loads((report_base/'package.json').read_bytes())
build=json.loads((report_base/'build.json').read_bytes())
bundle=report['bundleId'];assert bundle=='ipad-web-probe-d62dc8a59f565ee8ea469473'
assert report['resourceCount']==51 and report['resourceBytes']==60870883
expected_packages={'completePackage':(19292110,'aebdbd56183939742dff98e0b869eed42fadf70c4c94ae49456b92b3343a3692',60),'firstSetupPackage':(18522,'a29cc8fd8915e284f9c77a681f36b7504526aba7e952ea61a678898568d7ad4f',6)}
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
  resource_verified=None
  if kind=='completePackage':
   prefix='site/releases/'+bundle+'/'
   descriptor_raw=archive.read(prefix+'bundle.json');descriptor=json.loads(descriptor_raw)
   assert len(descriptor['resources'])==51 and sum(r['byteLength'] for r in descriptor['resources'])==60870883
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
   assert bundle in archive.read('site/index.html').decode('utf-8')
   resource_verified={'resourceCount':51,'resourceBytes':60870883,'allPayloadHashes':True,'controlPlaneHashes':2,'onlyCurrentRelease':True,'shortcutMatchesFixedGitAndWorking':True,'manualMatchesRuntimeDocsAndWorking':True}
 new.append({'kind':kind,'filename':path.name,'byteLength':len(data),'sha256':sha(data),'fileCount':file_count,'allZipMemberChecksums':True,'noPrivateKeyOrOutsidePath':True,'singlePublicRemovableRoot':True,'resources':resource_verified})
result={'clientDate':'2026-10-28','packageReportPath':report_base.relative_to(ROOT).as_posix()+'/package.json','bundleId':bundle,'newPackages':new,'historicalPackages':previous,'historicalCount':len(previous),'allPassed':True,'scope':'Independent local byte, ZIP member and fixed Git report comparison only. No network POST or push. Does not certify distribution licenses, full secret discovery, independent person05, browser, real iPad or G2/G3 acceptance.'}
(OUT/'archives-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'newArchives':len(new),'oldArchivesUnchanged':len(previous),'resourceCount':51,'payloadAndControlHashes':'all matched','allPassed':True}))
