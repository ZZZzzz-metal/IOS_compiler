from pathlib import Path
import hashlib
import json
import plistlib
import zipfile

ROOT = Path.cwd().resolve()
PACKAGES = ROOT / 'app/offline/.local/packages'
BUILD_BYTES = (ROOT / 'app/offline/.local/latest-build.json').read_bytes()
BUILD = json.loads(BUILD_BYTES)
BUNDLE_ID = 'ipad-web-probe-1934f34d48ba1a8c94eadd93'
VERSION = '0.4.3'
assert BUILD['bundleId'] == BUNDLE_ID
assert BUILD['resourceCount'] == 50 and BUILD['totalBytes'] == 60847962
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

instructions = f'''# 算法工作台 v{VERSION}：修复更新与首次准备

日期：2026-10-27（北京时间）。

本包合入4号66db2bb的REV-004/005修复与浅色工作台：资源校验期间同步锁定准备/运行/调试入口，失败后清除旧候选；较早文件读取的成功、失败和finally不能覆盖新选择，读取期间的后续编辑会保留并提示重选。两项修复已集成，仍待5号独立复验。

同时保留REV-001离线启动恢复修复：本版本入口会在启动清单或启动脚本缺失、损坏时显示自包含恢复页，联网后由你主动点击“联网重新准备资源”，重新下载并逐项校验完整资源。打开恢复页本身不下载资源；重新准备保留草稿和其他版本，不恢复已经终止的调试会话。

VAL-004旧快照断点显示修复仍包含在本包；5号独立复验23b8794已在87973fa的已测桌面范围确认修复。此结论不扩张为本次新离线包或iPad已验收。

这是完整Web静态包，不是IPA或原生App安装包。不能直接在iPad解压后用file://运行；应从受信任HTTPS入口准备资源，保存成功后再从主屏入口断网使用。部署时将压缩包的site/作为静态站点根目录，必须正确提供JavaScript MIME类型；certificates/和docs/不属于应用运行目录。

## 本次固定版本与操作

1. 首次准备时，iPad和电脑连接能互访的同一Wi-Fi，电脑保持开机。固定版本地址为：

   {URL}

   地址沿用本地测试服务；本归档只验证文件字节，当前电脑HTTPS可达性由1号另行记录，iPad互通仍需你实际打开确认。打不开时记录原文，不把包生成成功当作网络连通。

2. 若尚未导入证书，只通过已信任的文件传送渠道取得certificates/root-only.mobileconfig。证书名称应为 iPad Debugger Local Test Root a065aa18，根证书DER SHA-256为 {ROOT_FP}。配置只有一个可移除根证书载荷，无VPN、代理、MDM或账户设置；没有服务器私钥。
3. 安装描述文件后，在“设置 → 通用 → 关于本机 → 证书信任设置”手动决定是否为本次根证书开启完全信任。该信任影响设备TLS信任范围，不限工作台；不能跳过浏览器安全警告替代。证书于2026-11-02 09:29:59北京时间到期。已经安装并信任同名同指纹证书者无需重复安装。
4. 入口应显示 {BUNDLE_ID}，50项、60,847,962字节，约58.0 MiB。点“准备离线资源”，保持前台直至50项全量校验通过，再打开工作台并“校验本地资源”。校验期间等待结束再编译运行或调试。
5. 从固定版本准备页添加主屏图标，例如“算法工作台0.4.3”；联网从新图标重开并检查资源。更新前先导出重要完整草稿；同一HTTPS origin沿用草稿库，新版本入口及缓存独立。旧入口、旧包和旧证据保留，不自动清理。
6. 准备完成后按“平板完整操作手册.md”关闭全部网络与辅助电脑，关闭重开，再输入此前未编译的新源码验证编译、断点、三种单步、变量/栈、停止恢复及草稿备份。切换到后台会终止调试会话，返回后需重新编译调试。iPad、G2/G3、正式兼容路线和产品分发条件仍待验收。
7. 如出现“本版本离线入口需要恢复”，先记录断网失败证据，关闭本版本其他工作台窗口，恢复联网后点“联网重新准备资源”；等待完成再进入工作台。断网时出现恢复页不表示离线能力已恢复。

## 仍待修复的问题

- REV-002（3号）：监视表达式010/00010被错读为十进制10，08也被错误接受。暂用十进制常量；源码中实际八进制计算输出在本轮对照测试中正确。
- REV-003（3号）：监视两个指针相加可能返回错误指针，合法指针相减可能报错误。需要指针距离时，把计算写入源码并重新编译，读取局部变量或程序输出；不把当前监视值当作可靠结论。
REV-004/005已合入本版本，状态为已修复并集成、待5号独立复验。导入前仍请导出重要稿件；读取时若继续编辑，应保留当前稿并提示重新选文件。

上述规避方式不代表缺陷已修复。发现异常照实记录，不清除草稿。当前说明不是5号对本新包的完整独立签收。

## ZIP内容与核验

- site/index.html仅指向本次固定版本，外层选择页本身不用于离线冷启动。
- site/releases/{BUNDLE_ID}/包含50项运行资源、bundle.json和sw.js，保留界面、草稿实现、编译工具链、运行时、调试器、本地许可证与操作手册。没有旧release或测试故障夹具。
- docs/含完整平板手册及本次说明；certificates/只含公开测试根证书和可移除描述文件。
- build.json记来源基线和实际资源身份。构建基线提交不含本次全部未提交增量，实际包以资源逐项SHA-256和1号另存的源码指纹为准。
- SHA256SUMS.json记录ZIP内每个其他文件的长度和SHA-256，不对自身递归自哈希。

同Wi-Fi不保证设备互通；打不开或出现证书警告时回报原提示，不关闭整个防火墙、不绕过证书验证，不登记为离线通过。通用手册里“等待入口”的历史表述由本次固定版本地址补充，不因此声称iPad已连通。
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
          'sourceBaseRevisionScope': 'Merge base includes delivered UI fixes. Current manual/metadata changes are additionally bound by resource hashes and separately sealed source fingerprints.',
          'uiFixCommit': '66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9',
          'independentDesktopVerificationCommit': '23b8794993b0a7824d84f9222aee91468c46bcbb',
          'bundleId': BUNDLE_ID, 'entryURL': URL, 'resourceCount': 50, 'resourceBytes': 60847962,
          'workerSha256': BUILD['workerSha256'], 'descriptorSha256': BUILD['descriptorSha256'],
          'completePackage': full_report, 'firstSetupPackage': small_report,
          'knownOpenIssues': ['REV-002','REV-003'],
          'integratedPendingIndependentVerification': ['REV-004','REV-005'],
          'verification': {'allRuntimeResourceHashes': 50, 'controlPlaneHashes': 2,
                           'publicRootDERMatchesProfile': True, 'profilePayloadCount': 1,
                           'rootSHA256': ROOT_FP, 'profileRemovable': True,
                           'privateKeysExcluded': True, 'onlyCurrentReleaseIncluded': True,
                           'testControlsExcluded': True, 'manualMatchesRuntimePayload': True},
          'declaration': 'Archive byte verification only. Current HTTPS connectivity and browser smoke are recorded separately. VAL-004 independently closed only in tested desktop scope; this new offline release, real iPad and G2/G3 remain independently unverified.'}
report_path = ROOT / 'app/offline/evidence/ui-race-integration-2026-10-27/package.json'
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
