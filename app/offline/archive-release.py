#!/usr/bin/env python3
"""Archive one verified offline release without overwriting previous packages.

Maintenance utility; Python standard library only. This does not verify browser,
iPad, compiler semantics, or redistribution rights. Relative arguments resolve
against the repository root. Optional setup JSON contains only tlsDir/entryURL;
the URL is written inside the ignored ZIPs, never the public report/stdout.
"""

import argparse
import hashlib
import json
import plistlib
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
HASH = re.compile(r"sha256:[0-9a-f]{64}\Z")
BUNDLE = re.compile(r"ipad-web-probe-[0-9a-f]{24}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?\Z")
PRIVATE_PEM = re.compile(br"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")


class ArchiveError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ArchiveError(message)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def read_json(data):
    def invalid_constant(_value):
        raise ArchiveError("Non-finite JSON number")
    return json.loads(data.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=invalid_constant)


def integer(value):
    return type(value) is int and value >= 0


def safe_path(name):
    require(isinstance(name, str) and bool(name), "Invalid archive path")
    require(not re.search(r"[\\%:?#\x00-\x1f\x7f]", name), "Unsafe archive path")
    require(all(part not in ("", ".", "..") for part in name.split("/")), "Unsafe archive path")
    try:
        name.encode("utf-8")
    except UnicodeError as error:
        raise ArchiveError("Malformed Unicode archive path") from error
    parts = name.lower().split("/")
    require("test-controls" not in parts and "tls" not in parts, "Test controls or TLS directory cannot be archived")
    leaf = parts[-1]
    require(not leaf.endswith((".pfx", ".p12", ".key", "key.pem")), "Private key filename cannot be archived")
    return name


def public_bytes(name, data):
    safe_path(name)
    require(not PRIVATE_PEM.search(data), "Private key content cannot be archived")
    return data


def require_certificate_der(data):
    """Reject common private-key containers; this is not certificate trust validation."""
    require(0 < len(data) <= 1024 * 1024, "Invalid public certificate size")
    def element(offset):
        require(offset + 2 <= len(data), "Invalid certificate DER")
        tag, length = data[offset], data[offset + 1]
        cursor = offset + 2
        if length & 0x80:
            count = length & 0x7f
            require(0 < count <= 4 and cursor + count <= len(data), "Invalid certificate DER length")
            require(data[cursor] != 0, "Noncanonical certificate DER length")
            length = int.from_bytes(data[cursor:cursor + count], "big")
            require(length >= 128, "Noncanonical certificate DER length")
            cursor += count
        require(cursor + length <= len(data), "Invalid certificate DER boundary")
        return tag, cursor, cursor + length
    tag, start, end = element(0)
    require(tag == 0x30 and end == len(data), "Public certificate is not a DER certificate")
    tags, cursor, fields = [], start, []
    while cursor < end:
        tag, begin, finish = element(cursor)
        require(finish <= end, "Invalid certificate DER field")
        tags.append(tag); fields.append((begin, finish)); cursor = finish
    require(tags == [0x30, 0x30, 0x03], "Public certificate is not a certificate container")
    begin, finish = fields[-1]
    require(begin < finish and data[begin] <= 7, "Invalid certificate signature bit string")


def linked(path):
    return path.is_symlink() or bool(getattr(path, "is_junction", lambda: False)())


def resolve_argument(root, path):
    value = Path(path)
    return (value if value.is_absolute() else root / value).resolve()


def contained(path, parent):
    return path == parent or parent in path.parents


def checked_local(root):
    root = root.resolve(strict=True)
    local = (root / "app/offline/.local").resolve(strict=True)
    require(contained(local, root), "Local package directory escapes repository")
    return root, local


def validate_release(root, build_path):
    root, local = checked_local(root)
    build_path = resolve_argument(root, build_path)
    require(contained(build_path, local), "Build report must be inside local package directory")
    build_raw = build_path.read_bytes()
    build = read_json(build_raw)
    require(isinstance(build, dict), "Invalid build report")
    bundle_id = build.get("bundleId")
    require(isinstance(bundle_id, str) and BUNDLE.fullmatch(bundle_id), "Invalid bundle identity")
    require(isinstance(build.get("releaseDirectory"), str), "Invalid release directory")
    require(isinstance(build.get("sourceBaseRevision"), str) and
            re.fullmatch(r"(?:[0-9a-f]{40}|unknown)", build["sourceBaseRevision"]), "Invalid source revision")
    literal_release = root / "app/offline/.local/site/releases" / bundle_id
    release = literal_release.resolve(strict=True)
    require(contained(release, local) and not linked(literal_release), "Release directory escapes local package directory")
    require(resolve_argument(root, build.get("releaseDirectory", "")) == release, "Build release directory differs")
    for ancestor in literal_release.parents:
        if ancestor == root:
            break
        require(not linked(ancestor), "Linked release ancestor is not allowed")
    descriptor_raw = (release / "bundle.json").read_bytes()
    worker_raw = (release / "sw.js").read_bytes()
    require(sha(descriptor_raw) == build.get("descriptorSha256"), "Descriptor hash differs")
    require(sha(worker_raw) == build.get("workerSha256"), "Worker hash differs")
    descriptor = read_json(descriptor_raw)
    require(isinstance(descriptor, dict) and descriptor.get("schemaVersion") == 1 and
            descriptor.get("kind") == "offline-web-probe", "Invalid release descriptor")
    require(descriptor.get("bundleId") == bundle_id, "Descriptor identity differs")
    for key in ("compatibilityId", "resourceManifestHash"):
        require(isinstance(build.get(key), str) and build[key] == descriptor.get(key), "Component identity differs")
    require(re.fullmatch(r"integration-prototype-[0-9a-f]{16}", build["compatibilityId"]), "Invalid component identity")
    require(HASH.fullmatch(descriptor["resourceManifestHash"]), "Invalid resource manifest hash")
    resources = descriptor.get("resources")
    require(isinstance(resources, list) and bool(resources), "Release has no resources")
    entries, folded = {}, set()
    for row in resources:
        require(isinstance(row, dict) and set(row) == {"path", "sha256", "byteLength", "mediaType"}, "Invalid resource record")
        name = safe_path(row["path"])
        require(name not in ("bundle.json", "sw.js", "SHA256SUMS.json") and name.casefold() not in folded, "Duplicate or reserved resource")
        folded.add(name.casefold())
        require(integer(row["byteLength"]) and isinstance(row["sha256"], str) and HASH.fullmatch(row["sha256"]), "Invalid resource length/hash")
        require(isinstance(row["mediaType"], str), "Invalid resource media type")
        source = release.joinpath(*name.split("/"))
        require(contained(source.resolve(strict=True), release) and not linked(source), "Resource escapes release")
        data = public_bytes(name, source.read_bytes())
        require(len(data) == row["byteLength"] and sha(data) == row["sha256"], "Resource bytes differ")
        entries[name] = data
    expected = set(entries) | {"bundle.json", "sw.js"}
    found = set()
    for path in release.rglob("*"):
        require(not linked(path), "Linked release member is not allowed")
        require(contained(path.resolve(strict=True), release), "Release member escapes release")
        if path.is_file():
            found.add(path.relative_to(release).as_posix())
    require(found == expected, "Release contains missing or unexpected files")
    total = sum(len(value) for value in entries.values())
    require(integer(build.get("resourceCount")) and build["resourceCount"] == len(resources), "Resource count differs")
    require(integer(build.get("totalBytes")) and integer(descriptor.get("totalBytes")) and
            build["totalBytes"] == total == descriptor["totalBytes"], "Resource total differs")
    template_path = root / "app/offline/browser/worker-template.js"
    template = template_path.read_bytes()
    require(sha(template) == descriptor.get("workerTemplateSha256"), "Worker template hash differs")
    require(template.count(b"__BUNDLE_DESCRIPTOR__") == 1, "Worker template placeholder differs")
    compact = json.dumps(descriptor, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    require(template.replace(b"__BUNDLE_DESCRIPTOR__", compact) == worker_raw, "Worker does not embed exact descriptor")
    identity = sha(json_bytes({"resources": resources, "workerTemplateSha256": descriptor["workerTemplateSha256"]}))[7:31]
    require(bundle_id == "ipad-web-probe-" + identity, "Content-derived bundle identity differs")
    require(build.get("entryPath") == "/releases/" + bundle_id + "/index.html", "Entry path differs")
    require("IPAD-USER-MANUAL.md" in entries and "index.html" in entries, "Required entry/manual is missing")
    entries["bundle.json"] = public_bytes("bundle.json", descriptor_raw)
    entries["sw.js"] = public_bytes("sw.js", worker_raw)
    return root, local, build, build_raw, entries


def setup_entries(root, local, config_path, build, version):
    config_path = resolve_argument(root, config_path)
    require(contained(config_path, local), "Setup config must stay in ignored local directory")
    config = read_json(config_path.read_bytes())
    require(isinstance(config, dict) and set(config) == {"tlsDir", "entryURL"}, "Setup config requires only tlsDir and entryURL")
    require(isinstance(config["tlsDir"], str) and isinstance(config["entryURL"], str), "Invalid setup config values")
    tls = resolve_argument(root, config["tlsDir"])
    require(contained(tls, local / "tls"), "Setup certificates must stay in local TLS directory")
    url = urlsplit(config["entryURL"])
    require(not re.search(r"[\x00-\x20\x7f]", config["entryURL"]) and
            url.scheme == "https" and bool(url.hostname) and not url.username and not url.password and
            not url.query and not url.fragment and url.path == build["entryPath"], "Invalid setup entry URL")
    cert = (tls / "root-ca.cer").read_bytes()
    public_bytes("certificates/root-ca.cer", cert)
    require_certificate_der(cert)
    profile_raw = (tls / "root-only.mobileconfig").read_bytes()
    profile = plistlib.loads(profile_raw)
    require(isinstance(profile, dict), "Invalid setup profile")
    payloads = profile.get("PayloadContent")
    require(isinstance(payloads, list) and len(payloads) == 1, "Setup profile must contain one certificate")
    payload = payloads[0]
    require(isinstance(payload, dict) and payload.get("PayloadType") == "com.apple.security.root" and
            payload.get("PayloadContent") == cert, "Setup certificate does not match profile")
    require(profile.get("PayloadRemovalDisallowed") is False, "Setup profile must be removable")
    require(profile.get("PayloadType") == "Configuration", "Invalid certificate configuration profile")
    instructions = ("# 算法工作台 v" + version + "：首次准备\n\n"
        "这是离线 Web 实验包，真实 iPad 和完整语言服务仍需验证。先阅读平板完整操作手册。\n"
        "本次固定入口：" + config["entryURL"] + "\n\n"
        "只在首次传送时让电脑与 iPad 接入同一 Wi-Fi；电脑提供静态资源，源码在设备内处理。\n"
        "测试根证书 SHA-256：" + sha(cert)[7:] + "\n"
        "若使用此测试根证书，先核对来源和指纹，再由用户自行决定安装并开启完整信任；不要绕过浏览器证书警告。"
        "测试后可移除本次证书。ZIP不包含私钥，公开证书不表示本包已通过iPad验收。\n"
        "完成整包缓存检查后再按手册断网测试，保留旧入口和重要草稿备份。\n").encode("utf-8")
    return {"certificates/root-ca.cer": public_bytes("certificates/root-ca.cer", cert),
            "certificates/root-only.mobileconfig": public_bytes("certificates/root-only.mobileconfig", profile_raw),
            "本次首次准备说明.md": instructions}


def add_manifest(entries):
    require("SHA256SUMS.json" not in entries, "Reserved checksum member")
    result = dict(entries)
    for name, data in result.items():
        public_bytes(name, data)
    result["SHA256SUMS.json"] = json_bytes([
        {"path": name, "byteLength": len(data), "sha256": sha(data)[7:]}
        for name, data in sorted(result.items())])
    return result


def verify_zip(path, entries):
    with zipfile.ZipFile(path, "r") as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        require(len(names) == len(set(names)) == len(entries) and set(names) == set(entries), "Archive member set differs")
        for info in infos:
            safe_path(info.filename)
            require(not info.is_dir() and not (info.flag_bits & 1), "Invalid/encrypted archive member")
            expected = entries[info.filename]
            require(info.file_size == len(expected), "Archive member length differs")
            require(archive.read(info) == expected, "Archive member bytes differ")
        manifest = read_json(archive.read("SHA256SUMS.json"))
        require(len(manifest) == len(entries) - 1, "Archive checksum manifest differs")
        for row in manifest:
            data = entries.get(row["path"])
            require(data is not None and len(data) == row["byteLength"] and sha(data)[7:] == row["sha256"], "Archive checksum differs")
    return {"filename": path.name, "byteLength": path.stat().st_size,
            "sha256": sha(path.read_bytes())[7:], "fileCount": len(entries), "allArchivedFilesVerified": True}


def create_zip(path, entries):
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return verify_zip(path, entries)


def package_release(root, build_path, version, setup_config=None, report_path=None, verify_existing=False):
    require(isinstance(version, str) and VERSION.fullmatch(version), "Invalid archive version")
    root, local, build, build_raw, resources = validate_release(root, build_path)
    bundle_id = build["bundleId"]
    chooser = ("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>算法工作台离线入口</title>"
               "<h1>算法工作台离线实验</h1><p><a href=\"./releases/" + bundle_id + "/index.html\">打开固定版本 " + bundle_id +
               "</a></p><p>首次准备需要联网；iPad 真机验收仍待完成。</p></html>\n").encode("utf-8")
    full = {"site/index.html": chooser, "docs/平板完整操作手册.md": resources["IPAD-USER-MANUAL.md"], "build.json": build_raw}
    full.update({"site/releases/" + bundle_id + "/" + name: data for name, data in resources.items()})
    archives = [("completePackage", "ipad-offline-debugger-v" + version + ".zip", full)]
    if setup_config:
        setup = setup_entries(root, local, setup_config, build, version)
        full.update(setup)
        small = dict(setup)
        small.update({"平板完整操作手册.md": resources["IPAD-USER-MANUAL.md"], "build.json": build_raw})
        archives.append(("firstSetupPackage", "ipad-first-setup-v" + version + ".zip", small))
    packages = local / "packages"
    require(not linked(packages) and contained(packages.resolve(), local), "Package output directory escapes local")
    targets = [(key, packages / name, add_manifest(entries)) for key, name, entries in archives]
    if report_path:
        report_path = resolve_argument(root, report_path)
        require(contained(report_path, root) and not contained(report_path, local), "Public report must stay in repository outside ignored local data")
    if verify_existing:
        require(all(path.is_file() and not linked(path) for _, path, _ in targets), "Expected immutable archive is missing")
    else:
        require(all(not path.exists() for _, path, _ in targets), "Refusing to overwrite an existing archive; use --verify-existing")
        require(not report_path or not report_path.exists(), "Refusing to overwrite existing report")
        packages.mkdir(parents=True, exist_ok=True)
    report = {"schemaVersion": 1, "kind": "verified-static-web-archives", "version": version,
              "bundleId": bundle_id, "compatibilityId": build["compatibilityId"],
              "resourceManifestHash": build["resourceManifestHash"], "resourceCount": build["resourceCount"],
              "resourceBytes": build["totalBytes"], "sourceBaseRevision": build.get("sourceBaseRevision"),
              "workerSha256": build["workerSha256"], "descriptorSha256": build["descriptorSha256"],
              "verification": {"allRuntimeResourceHashes": build["resourceCount"], "controlPlaneHashes": 2,
                               "onlyCurrentReleaseIncluded": True, "privateKeysExcluded": True,
                               "manualMatchesRuntimePayload": True, "testControlsExcluded": True},
              "declaration": "Archive byte verification only; not browser, independent feature, iPad or distribution-license acceptance."}
    for key, path, entries in targets:
        report[key] = verify_zip(path, entries) if verify_existing else create_zip(path, entries)
    if report_path:
        encoded = json_bytes(report)
        if verify_existing:
            require(report_path.is_file() and report_path.read_bytes() == encoded, "Public report differs from verified archives")
        else:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            with report_path.open("xb") as output:
                output.write(encoded)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", default="app/offline/.local/latest-build.json")
    parser.add_argument("--version", required=True)
    parser.add_argument("--setup-config")
    parser.add_argument("--report")
    parser.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    try:
        report = package_release(ROOT, args.build, args.version, args.setup_config, args.report, args.verify_existing)
    except (ArchiveError, OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        # Never echo config/URLs/key content; our validation messages contain no input values.
        detail = str(error) if isinstance(error, ArchiveError) else "Input or filesystem operation failed; sensitive input is not displayed."
        print("Offline archive failed: " + type(error).__name__ + ": " + detail, file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
