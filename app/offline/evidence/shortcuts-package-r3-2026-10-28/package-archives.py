from pathlib import Path
import hashlib
import json
import plistlib
import zipfile

ROOT = Path.cwd().resolve()
PACKAGES = ROOT / 'app/offline/.local/packages'
BUILD_BYTES = (ROOT / 'app/offline/.local/latest-build.json').read_bytes()
BUILD = json.loads(BUILD_BYTES)
BUNDLE_ID = 'ipad-web-probe-eb5236b6ed8f9aab4a9d9ced'
VERSION = '0.4.5-r3'
assert BUILD['bundleId'] == BUNDLE_ID
assert BUILD['resourceCount'] == 51 and BUILD['totalBytes'] == 60874273
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
                info = zipfile.ZipInfo(name, date_time=(2026, 10, 28, 0, 0, 0))
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

instructions = f'''# 算法工作台 v{VERSION}：实体键盘与首次准备

日期：2026-10-28（北京时间）。本版合入4号309d29d，保留VS风格标准七种快捷键，默认增加不依赖Fn的Control数字行方案。真实iPad键盘是否能把组合传给页面仍待实机确认；桌面或受控测试不能替代真机。

## 本轮新修复及复验范围

本归档为v0.4.5第三次本地打包（r3），前两份候选包与旧版本保留。REV-006浮点/整数混合监视、REV-007 NaN真值/短路已合入3号309cb45；REV-008迟到粘贴覆盖期间新编辑、旧粘贴覆盖后发粘贴、旧失败弹出手动框已合入4号33c1639。开发者前后对照通过，三项仍待5号对新固定集成提交独立复验。重要草稿定期导出；浮点边界可用源码实际输出交叉核对。程序本身的原生Wasm与解释输出保持一致，不将监视错误描述成编译器错误。已有自动检查与桌面停服通过均不表示iPad验收通过。

## 平板步骤

1. 旧工作台先导出完整草稿到“我的iPad”，停止调试并关闭窗口，保留旧入口与网站数据。
2. 电脑开机，与iPad接能互访的同一Wi-Fi，用Safari打开本轮固定入口：

   {URL}

   核对 {BUNDLE_ID}，51项、60,874,273字节。电脑严格HTTPS由1号另记，平板互通不能由同Wi-Fi或ZIP生成推断。
3. 首次核对公开测试根证书iPad Debugger Local Test Root a065aa18，DER SHA-256为 {ROOT_FP}，2026-11-02北京时间09:29:59到期。配置只有一个可移除根证书，无VPN、代理、MDM、账户或私钥。已信任同指纹证书者不用重复安装。按完整手册手动决定是否开启完全信任；这影响设备TLS信任范围，不能绕过浏览器警告。
4. 点“准备离线资源”，保持前台直到51项校验通过；给本版固定准备页添加主屏图标，从新图标联网重开并检查，再打开工作台点“校验本地资源”。重要稿件先备份。
5. 展开“键盘快捷键”，默认“无F键：Control＋数字行”。Control不是Command：Ctrl+5开始或继续，Ctrl+6编译运行，Ctrl+Shift+5停止，Ctrl+9当前行断点，Ctrl+0跳过，Ctrl+-进入，Ctrl+Shift+-跳出。数字用字母上方一行，减号在0右边。不需要Fn或Option，不推断Fn+数字能产生F键。
6. 每次动作等真实状态更新；断点前点源码并放好光标。输入样例/查找/监视、弹窗、中文组合输入不触发调试，长按不连发，等待命令确认时不堆积单步；只读快照不能改断点。无响应时使用按钮并记下按键、焦点与系统表现，不记为通过。
7. 可选“仅标准F键”，此时关闭Control数字替代，保留F5、Ctrl+F5、Shift+F5、F9、F10、F11、Shift+F11；方案按当前浏览器来源保存，无法保存时本次选择仍有效。重启与运行至光标未实现。
8. 离线可打开工作台的完整快捷键速查和缓存手册。按手册P01–P10关闭网络和辅助电脑，关闭重开，输入全新源码实测编译调试与草稿恢复；另执行键盘七动作小操作单。Safari/主屏、VoiceOver和iPad物理键盘均待验。

## 已有修复与限制

3号监视修复仍包含：010/00010=8，077=63，08/09拒绝，p+q拒绝，p-q因无法证明同数组归属而明确不支持；有效指针加减整数按元素缩放，float一元符号保留类型。新调试器、REV-001恢复、快捷键与本完整包待5号独立复验；5号d12aad仅在66db2bb已测桌面范围独立关闭REV-004/005，原195项和新增14项分列，未扩张新包或iPad签收。

启动链损坏显示自包含恢复页时，记录错误，关闭本版本其他窗口，再联网主动点“联网重新准备资源”。重备保留草稿和其他版本；出现恢复页不等于离线恢复通过。

## 归档与部署

完整ZIP是Web静态部署/备份包，不是IPA，不能在iPad解压以file://运行。以site/作为静态根目录，正确提供JS MIME类型；certificates/与docs/不属于运行目录。只含本release，51资源加bundle.json和sw.js，已包含ui/SHORTCUTS.md及根手册；没有旧release或测试故障夹具。SHA256SUMS.json核对档内其余文件，build.json记录构建基线，根增量另以资源及源码指纹绑定。

两档仅本地保存，不上传GitHub；第三方二进制完整来源/许可映射仍待，G2/G3和正式profile未通过。打不开或证书警告请记录原文，不清网站数据、不关闭整个防火墙、不绕过证书验证。
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
assert len(all_release_files) == 53
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
          'sourceBaseRevisionScope': 'Merge base includes shortcuts309d29d. Root build-list/manual/metadata increments are additionally bound by resource hashes and source fingerprints.',
          'shortcutCommit': '309d29dd703b1bc5a5beff03a88f232764c95808',
          'archiveRevision': 'r3: integrated mixed floating operands, NaN truth and stale clipboard fixes; both prior candidates retained',
          'uiFixCommit': '66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9',
          'independentDesktopVerificationCommit': 'd12aad000b3474f9ce597d798ecc861b57b4ea4d',
          'debuggerFixCommit': '309cb45191a62fde2b13eeab9746a8d2502ef658',
          'clipboardFixCommit': '33c16398948c102edcac4f4c794a3e1de1cb9b19',
          'independentUIChecks': {'existing': 195, 'additionalControlledUI': 14, 'scope': '66db2bb tested desktop scope only; not this complete offline package or iPad'},
          'bundleId': BUNDLE_ID, 'entryURL': URL, 'resourceCount': 51, 'resourceBytes': 60874273,
          'workerSha256': BUILD['workerSha256'], 'descriptorSha256': BUILD['descriptorSha256'],
          'completePackage': full_report, 'firstSetupPackage': small_report,
          'knownOpenIssues': ['REV-006','REV-007','REV-008'],
          'knownIssueState': 'Fixes integrated, independent person05 closure pending; not claimed independently closed',
          'independentlyClosedInTestedDesktopScope': ['REV-004','REV-005'],
          'explicitWatchLimitations': ['pointer-pointer subtraction unsupported because common-array provenance cannot be established', 'integer literal suffixes, binary prefixes and digit separators not added', 'float unary fix is not complete floating-point semantics'],
          'integratedPendingIndependentVerification': ['REV-001','REV-002','REV-003','REV-006','REV-007','REV-008','keyboard-shortcuts','complete-v0.4.5-offline-package'],
          'verification': {'allRuntimeResourceHashes': 51, 'controlPlaneHashes': 2,
                           'publicRootDERMatchesProfile': True, 'profilePayloadCount': 1,
                           'rootSHA256': ROOT_FP, 'profileRemovable': True,
                           'privateKeysExcluded': True, 'onlyCurrentReleaseIncluded': True,
                           'testControlsExcluded': True, 'manualMatchesRuntimePayload': True},
          'declaration': 'Archive byte verification only, not a distribution license clearance. Current HTTPS connectivity and browser smoke are recorded separately. REV-004/005 and VAL-004 are independently closed only in their tested desktop scope; new debugger corrections, REV-001, this complete offline release, real iPad and G2/G3 remain independently unverified.'}
report_path = ROOT / 'app/offline/evidence/shortcuts-package-r3-2026-10-28/package.json'
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
