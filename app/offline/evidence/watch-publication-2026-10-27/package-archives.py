from pathlib import Path
import hashlib
import json
import plistlib
import zipfile

ROOT = Path.cwd().resolve()
PACKAGES = ROOT / 'app/offline/.local/packages'
BUILD_BYTES = (ROOT / 'app/offline/.local/latest-build.json').read_bytes()
BUILD = json.loads(BUILD_BYTES)
BUNDLE_ID = 'ipad-web-probe-40b0be1b9616e4ec152be87a'
VERSION = '0.4.4'
assert BUILD['bundleId'] == BUNDLE_ID
assert BUILD['resourceCount'] == 50 and BUILD['totalBytes'] == 60850729
RELEASE = Path(BUILD['releaseDirectory']).resolve()
assert RELEASE == (ROOT / 'app/offline/.local/site/releases' / BUNDLE_ID).resolve()
DESCRIPTOR_BYTES = (RELEASE / 'bundle.json').read_bytes()
DESCRIPTOR = json.loads(DESCRIPTOR_BYTES)
TLS = ROOT / 'app/offline/.local/tls/local-https-20261026T012959Z-a065aa18'
URL = 'https://100.65.235.35:4187' + BUILD['entryPath']
ROOT_FP = '87991d2b7d332034beddb95ed35ddabc906c0e0b2bd1dd174ec4a25b826e349f'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def source_bytes(source):
    return source.read_bytes() if isinstance(source, Path) else source


def add_hashes(entries):
    assert 'SHA256SUMS.json' not in entries
    result = dict(entries)
    result['SHA256SUMS.json'] = encoded_json([
        {'path': name, 'byteLength': len(source_bytes(source)), 'sha256': sha(source_bytes(source))}
        for name, source in sorted(entries.items())
    ])
    return result


def verify_zip(path, entries):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)) == len(entries)
        assert set(names) == set(entries)
        assert all(not name.startswith('/') and '..' not in name.split('/') and '\\' not in name for name in names)
        assert not any(name.endswith(('server-key.pem', '.pfx', '.p12')) or '/tls/' in name or '/test-controls/' in name for name in names)
        for name, source in entries.items():
            actual, expected = archive.read(name), source_bytes(source)
            assert len(actual) == len(expected) and sha(actual) == sha(expected), name
        hashes = json.loads(archive.read('SHA256SUMS.json'))
        assert len(hashes) == len(entries) - 1
        for row in hashes:
            actual = archive.read(row['path'])
            assert len(actual) == row['byteLength'] and sha(actual) == row['sha256'], row['path']
    return {'path': str(path), 'filename': path.name, 'byteLength': path.stat().st_size,
            'sha256': sha(path.read_bytes()), 'fileCount': len(entries), 'allArchivedFilesVerified': True}


def build_zip(filename, entries):
    output = PACKAGES / filename
    if not output.exists():
        with zipfile.ZipFile(output, mode='x', compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
            for name, source in sorted(entries.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 10, 27, 8, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, source_bytes(source), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return verify_zip(output, entries)


profile_bytes = (TLS / 'root-only.mobileconfig').read_bytes()
certificate_bytes = (TLS / 'root-ca.cer').read_bytes()
profile = plistlib.loads(profile_bytes)
assert len(profile['PayloadContent']) == 1
assert profile['PayloadContent'][0]['PayloadType'] == 'com.apple.security.root'
assert profile['PayloadContent'][0]['PayloadContent'] == certificate_bytes
assert profile['PayloadRemovalDisallowed'] is False
assert sha(certificate_bytes) == ROOT_FP
assert 'PRIVATE KEY' not in profile_bytes.decode('utf-8')

instructions = f'''# 算法工作台 v{VERSION}：监视修复更新与首次准备

日期：2026-10-27（北京时间）。

本包合入3号21f2135监视语义修复：010与00010按八进制得到8，077得到63，08/09明确拒绝；两个指针相加拒绝，指针相减因无法证明来自同一数组而明确不支持。有效指针加减整数仍按元素大小移动，浮点一元正负保留原类型。这些修复已经集成，等待5号独立复验；不声称完整表达式求值或完整浮点语义。

4号66db2bb的资源准备门禁、迟到导入隔离修复及浅色工作台保留。5号d12aad在66db2bb的已测桌面范围独立确认REV-004/005关闭：既有195项与新增14项竞态检查分别记录，不相加冒充新的整包独立验收。控制环境中的文件读取逆序与真实浏览器检查也各有边界；本包和真实iPad未因此通过。

REV-001离线启动恢复修复保留：当启动清单或脚本缺失、损坏时显示自包含恢复页，联网后由你主动点击“联网重新准备资源”，重新下载并逐项校验完整资源。打开恢复页本身不下载资源；重新准备保留草稿与其他版本，不恢复已经终止的调试会话。REV-001、新调试器和本次完整缓存包等待5号独立复验。

VAL-004旧快照断点显示修复仍包含在本包；5号23b8794在87973fa的已测桌面范围已确认修复。这个历史结论不扩张为本次新离线包或iPad已验收。

这是完整Web静态包，不是IPA或原生App安装包。不能在iPad解压后通过file://运行；从受信任HTTPS入口准备资源，保存成功后再从主屏入口断网使用。部署时以site/作为静态站点根目录，正确提供JavaScript MIME类型；certificates/和docs/不属于应用运行目录。本归档在本机忽略目录保存，尚未作为GitHub发行附件发布，第三方工具链分发许可仍待核对。

## 本次固定版本与操作

1. 首次准备时，iPad和电脑连接可互访的同一Wi-Fi，电脑保持开机。固定版本地址为：

   {URL}

   地址沿用本地测试服务；本归档只验证文件字节，当前电脑HTTPS可达性由1号另行记录，iPad互通仍需你实际打开确认。打不开时记录原提示，不把包生成成功当作网络连通。

2. 若尚未导入证书，只通过已信任的文件传送渠道取得certificates/root-only.mobileconfig。证书名称应为 iPad Debugger Local Test Root a065aa18，根证书DER SHA-256为 {ROOT_FP}。配置只有一个可移除根证书载荷，无VPN、代理、MDM或账户设置，没有服务器私钥。
3. 安装描述文件后，在“设置 → 通用 → 关于本机 → 证书信任设置”手动决定是否为本次根证书开启完全信任。该信任影响设备TLS信任范围，不限工作台；不能跳过浏览器安全警告替代。证书于2026-11-02北京时间09:29:59到期。已经安装并信任同名同指纹证书者无需重复安装。
4. 入口应显示 {BUNDLE_ID}，50项、60,850,729字节，约58.0 MiB。点“准备离线资源”，保持前台直至50项全量校验通过，再打开工作台并“校验本地资源”。校验期间等待结束再编译运行或调试。
5. 从固定版本准备页添加主屏图标，例如“算法工作台0.4.4”；联网从新图标重开并检查资源。更新前先导出重要完整草稿；同一HTTPS origin沿用草稿库，新版本入口及缓存独立。旧入口、旧包和旧证据保留，不自动清理。
6. 按“平板完整操作手册.md”关闭全部网络与辅助电脑，关闭重开，再输入此前未编译的新源码验证编译、断点、三种单步、变量/栈、停止恢复及草稿备份。切换到后台会终止调试会话，返回后需重新编译调试。iPad、G2/G3、正式兼容路线和产品分发条件仍待验收。
7. 若出现“本版本离线入口需要恢复”，先记录断网失败证据，关闭本版本其他窗口，恢复联网后点“联网重新准备资源”；等待完成再进入工作台。断网出现恢复页不表示已恢复离线能力。

## 监视支持边界与独立验收

- 八进制、十六进制及无后缀整数的类型选择按当前wasm32目标处理。整数字面量后缀、二进制前缀、数字分隔符未因此新增支持。
- 监视中 p+q 应拒绝；p-q 明确不支持，不能把拒绝写成距离计算成功。需要距离时把合法同数组指针计算写进C/C++源码，重新编译后读取变量或程序输出。
- 有效指针±整数保留元素缩放，浮点一元正负保留32/64位类型；这不代表任意指针、表达式或完整浮点语义均已支持。
- 资源校验期间准备/运行/调试入口应锁定，失败后只能重试校验。导入读取期间继续编辑，应保留新稿并提示重选；请先导出重要稿件。
- 新3号监视修复、REV-001恢复和本包的独立复验仍待5号执行。真实iPad、物理断网、主屏和文件选择行为均以实际记录为准。

## ZIP内容与核验

- site/index.html只指向本次固定版本；外层选择页本身不用于离线冷启动。
- site/releases/{BUNDLE_ID}/包含50项资源、bundle.json与sw.js，只有本次版本，无旧release或测试故障夹具。
- docs/包含完整平板手册与本说明；certificates/只有公开测试根证书和可移除描述文件，无私钥。
- build.json记录构建基线和实际资源身份。基线含本次两项模块合入；未提交的根手册/元数据另由资源SHA-256及1号源码指纹绑定，不冒充已提交内容。
- SHA256SUMS.json记录ZIP内其余每个文件的长度和SHA-256，不递归自哈希；1号另存本次整档校验与哈希报告。

同Wi-Fi不保证设备互通；打不开或出现证书警告时回报原提示，不关闭整个防火墙、不绕过验证、不登记为离线通过。GitHub上的源码/任务记录不构成在线编译服务或正式IPA安装交付。
'''.encode('utf-8')

manual = ROOT / 'docs/architecture/IPAD-USER-MANUAL.md'
manual_resource = next(row for row in DESCRIPTOR['resources'] if row['path'] == 'IPAD-USER-MANUAL.md')
assert len(manual.read_bytes()) == manual_resource['byteLength']
assert 'sha256:' + sha(manual.read_bytes()) == manual_resource['sha256']
assert 'sha256:' + sha(DESCRIPTOR_BYTES) == BUILD['descriptorSha256']
assert 'sha256:' + sha((RELEASE / 'sw.js').read_bytes()) == BUILD['workerSha256']

full = {'site/index.html': ROOT / 'app/offline/.local/site/index.html',
        'docs/平板完整操作手册.md': manual,
        'docs/本次更新与准备说明.md': instructions,
        'certificates/root-only.mobileconfig': profile_bytes,
        'certificates/root-ca.cer': certificate_bytes,
        'build.json': BUILD_BYTES}
all_release_files = sorted(path for path in RELEASE.rglob('*') if path.is_file())
expected_paths = {row['path'] for row in DESCRIPTOR['resources']} | {'bundle.json', 'sw.js'}
assert {path.relative_to(RELEASE).as_posix() for path in all_release_files} == expected_paths
assert len(all_release_files) == 52
for source in all_release_files:
    full[f'site/releases/{BUNDLE_ID}/{source.relative_to(RELEASE).as_posix()}'] = source
chooser = source_bytes(full['site/index.html']).decode('utf-8')
assert chooser.count('href=') == 1 and BUNDLE_ID in chooser
full = add_hashes(full)
small = add_hashes({'certificates/root-only.mobileconfig': profile_bytes,
                   'certificates/root-ca.cer': certificate_bytes,
                   '本次首次准备说明.md': instructions,
                   '平板完整操作手册.md': manual,
                   'build.json': BUILD_BYTES})
full_report = build_zip(f'ipad-offline-debugger-v{VERSION}.zip', full)
small_report = build_zip(f'ipad-first-setup-v{VERSION}.zip', small)

with zipfile.ZipFile(PACKAGES / full_report['filename']) as archive:
    prefix = f'site/releases/{BUNDLE_ID}/'
    for row in DESCRIPTOR['resources']:
        raw = archive.read(prefix + row['path'])
        assert len(raw) == row['byteLength'] and 'sha256:' + sha(raw) == row['sha256'], row['path']
    assert 'sha256:' + sha(archive.read(prefix + 'bundle.json')) == BUILD['descriptorSha256']
    assert 'sha256:' + sha(archive.read(prefix + 'sw.js')) == BUILD['workerSha256']
    assert not any(name.startswith('site/releases/') and not name.startswith(prefix) for name in archive.namelist())

report = {'schemaVersion': 1, 'kind': 'verified-static-web-archives', 'version': VERSION,
          'sourceBaseRevision': BUILD['sourceBaseRevision'],
          'sourceBaseRevisionScope': 'Merge base includes debugger 21f2135 and independent validation d12aad. Current root manual and metadata changes are additionally bound by resource hashes and separately sealed source fingerprints.',
          'uiFixCommit': '66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9',
          'independentDesktopVerificationCommit': 'd12aad000b3474f9ce597d798ecc861b57b4ea4d',
          'debuggerFixCommit': '21f21357ac728b7ddc3cd9728bf1a6fe2491b9d6',
          'independentUIChecks': {'existing': 195, 'additionalControlledUI': 14, 'scope': '66db2bb tested desktop scope only; not this complete offline package or iPad'},
          'bundleId': BUNDLE_ID, 'entryURL': URL, 'resourceCount': 50, 'resourceBytes': 60850729,
          'workerSha256': BUILD['workerSha256'], 'descriptorSha256': BUILD['descriptorSha256'],
          'completePackage': full_report, 'firstSetupPackage': small_report,
          'knownOpenIssues': [],
          'independentlyClosedInTestedDesktopScope': ['REV-004','REV-005'],
          'explicitWatchLimitations': ['pointer-pointer subtraction unsupported because common-array provenance cannot be established', 'integer literal suffixes, binary prefixes and digit separators not added', 'float unary fix is not complete floating-point semantics'],
          'integratedPendingIndependentVerification': ['REV-001','REV-002','REV-003','complete-v0.4.4-offline-package'],
          'verification': {'allRuntimeResourceHashes': 50, 'controlPlaneHashes': 2,
                           'publicRootDERMatchesProfile': True, 'profilePayloadCount': 1,
                           'rootSHA256': ROOT_FP, 'profileRemovable': True,
                           'privateKeysExcluded': True, 'onlyCurrentReleaseIncluded': True,
                           'testControlsExcluded': True, 'manualMatchesRuntimePayload': True},
          'declaration': 'Archive byte verification only, not a distribution license clearance. Current HTTPS connectivity and browser smoke are recorded separately. REV-004/005 and VAL-004 are independently closed only in their tested desktop scope; new debugger corrections, REV-001, this complete offline release, real iPad and G2/G3 remain independently unverified.'}
report_path = ROOT / 'app/offline/evidence/watch-publication-2026-10-27/package.json'
report_bytes = encoded_json(report)
if report_path.exists():
    assert report_path.read_bytes() == report_bytes, 'Refusing to replace an existing package record'
else:
    with report_path.open('xb') as output:
        output.write(report_bytes)
sidecar = PACKAGES / f'ipad-offline-debugger-v{VERSION}-SHA256.txt'
sidecar_bytes = (full_report['sha256'] + '  ' + full_report['filename'] + '\n' +
                 small_report['sha256'] + '  ' + small_report['filename'] + '\n').encode('utf-8')
if sidecar.exists():
    assert sidecar.read_bytes() == sidecar_bytes, 'Refusing to replace checksum sidecar'
else:
    with sidecar.open('xb') as output:
        output.write(sidecar_bytes)
print(json.dumps(report, ensure_ascii=False, indent=2))
