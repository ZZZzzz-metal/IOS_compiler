"""Archive/input integrity checks in disposable directories, not product acceptance."""

import importlib.util
import json
import plistlib
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("archive_release", Path(__file__).parents[1] / "archive-release.py")
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class ArchiveReleaseChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="archive-release-test-")
        self.root = Path(self.temp.name).resolve()
        # Verify the known temporary target before TemporaryDirectory's recursive cleanup.
        self.assertEqual(self.root.parent, Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith("archive-release-test-"))
        self.addCleanup(self.temp.cleanup)
        self.local = self.root / "app/offline/.local"
        self.local.mkdir(parents=True)
        self.template = b"// fixture only\nconst bundle=__BUNDLE_DESCRIPTOR__;\n"
        template = self.root / "app/offline/browser/worker-template.js"
        template.parent.mkdir(parents=True)
        template.write_bytes(self.template)
        self.contents = {"index.html": b"<main>fixture</main>\n",
                         "IPAD-USER-MANUAL.md": "# 临时手册\n不是产品验收。\n".encode("utf-8"),
                         "compiler/engine.wasm": b"synthetic-compiler-fixture"}
        self.build_path = self.local / "latest-build.json"
        self.write_release()

    def write_release(self, unsafe_path=None):
        rows = [{"path": name, "sha256": archive.sha(data), "byteLength": len(data), "mediaType": "application/octet-stream"}
                for name, data in sorted(self.contents.items())]
        if unsafe_path:
            rows[0]["path"] = unsafe_path
        template_hash = archive.sha(self.template)
        identity = archive.sha(archive.json_bytes({"resources": rows, "workerTemplateSha256": template_hash}))[7:31]
        bundle = "ipad-web-probe-" + identity
        self.release = self.local / "site/releases" / bundle
        self.release.mkdir(parents=True, exist_ok=True)
        for name, data in self.contents.items():
            path = self.release / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.descriptor = {"schemaVersion": 1, "kind": "offline-web-probe", "status": "device-unverified",
                           "bundleId": bundle, "workerTemplateSha256": template_hash,
                           "compatibilityId": "integration-prototype-" + "a" * 16,
                           "resourceManifestHash": "sha256:" + "b" * 64,
                           "resources": rows, "totalBytes": sum(len(data) for data in self.contents.values())}
        descriptor_raw = archive.json_bytes(self.descriptor)
        compact = json.dumps(self.descriptor, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        worker = self.template.replace(b"__BUNDLE_DESCRIPTOR__", compact)
        (self.release / "bundle.json").write_bytes(descriptor_raw)
        (self.release / "sw.js").write_bytes(worker)
        self.build = {"schemaVersion": 1, "sourceBaseRevision": "c" * 40, "bundleId": bundle,
                      "compatibilityId": self.descriptor["compatibilityId"],
                      "resourceManifestHash": self.descriptor["resourceManifestHash"],
                      "resourceCount": len(rows), "totalBytes": self.descriptor["totalBytes"],
                      "releaseDirectory": str(self.release), "entryPath": "/releases/" + bundle + "/index.html",
                      "workerSha256": archive.sha(worker), "descriptorSha256": archive.sha(descriptor_raw)}
        self.build_path.write_bytes(archive.json_bytes(self.build))

    def package(self, **kwargs):
        return archive.package_release(self.root, self.build_path, "0.4.6-fixture", **kwargs)

    def test_verified_archive_has_only_current_release_exact_manual_and_checksums(self):
        report_path = self.root / "app/offline/evidence/fixture/report.json"
        report = self.package(report_path=report_path)
        path = self.local / "packages" / report["completePackage"]["filename"]
        with zipfile.ZipFile(path) as zipped:
            prefix = "site/releases/" + self.build["bundleId"] + "/"
            self.assertEqual(zipped.read("docs/平板完整操作手册.md"), self.contents["IPAD-USER-MANUAL.md"])
            self.assertEqual(zipped.read(prefix + "IPAD-USER-MANUAL.md"), self.contents["IPAD-USER-MANUAL.md"])
            self.assertEqual(zipped.read("site/index.html").count(b"href="), 1)
            self.assertTrue(all(not name.startswith("site/releases/") or name.startswith(prefix) for name in zipped.namelist()))
            sums = json.loads(zipped.read("SHA256SUMS.json"))
            self.assertEqual(len(sums), len(zipped.namelist()) - 1)
        before = path.read_bytes()
        self.assertEqual(self.package(report_path=report_path, verify_existing=True), report)
        self.assertEqual(path.read_bytes(), before)

    def test_existing_archive_and_report_are_not_overwritten_and_corruption_is_rejected(self):
        report_path = self.root / "report.json"
        report = self.package(report_path=report_path)
        path = self.local / "packages" / report["completePackage"]["filename"]
        before, prior_report = path.read_bytes(), report_path.read_bytes()
        with self.assertRaisesRegex(archive.ArchiveError, "Refusing to overwrite"):
            self.package(report_path=report_path)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(report_path.read_bytes(), prior_report)
        # Corrupt only this test's disposable ZIP. Verification must never repair it.
        with zipfile.ZipFile(path, "a") as zipped:
            zipped.writestr("unexpected.txt", b"extra")
        corrupt = path.read_bytes()
        with self.assertRaisesRegex(archive.ArchiveError, "member set differs"):
            self.package(verify_existing=True)
        self.assertEqual(path.read_bytes(), corrupt)

    def test_changed_resource_or_extra_release_file_fails_before_any_archive(self):
        source = self.release / "compiler/engine.wasm"
        original = source.read_bytes()
        source.write_bytes(b"changed")
        with self.assertRaisesRegex(archive.ArchiveError, "Resource bytes differ"):
            self.package()
        source.write_bytes(original)
        (self.release / "unknown.txt").write_bytes(b"extra")
        with self.assertRaisesRegex(archive.ArchiveError, "unexpected files"):
            self.package()
        self.assertFalse((self.local / "packages").exists())

    def test_path_traversal_or_wrong_release_directory_is_rejected(self):
        self.write_release(unsafe_path="../outside.txt")
        with self.assertRaisesRegex(archive.ArchiveError, "Unsafe archive path"):
            self.package()
        self.write_release()
        other = self.root / "outside"
        other.mkdir()
        self.build["releaseDirectory"] = str(other)
        self.build_path.write_bytes(archive.json_bytes(self.build))
        with self.assertRaisesRegex(archive.ArchiveError, "release directory differs"):
            self.package()

    def test_control_plane_and_private_or_test_control_resources_are_rejected(self):
        (self.release / "sw.js").write_bytes(b"not the frozen worker")
        with self.assertRaisesRegex(archive.ArchiveError, "Worker hash differs"):
            self.package()
        self.contents["secret.pem"] = b"-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n"
        self.write_release()
        with self.assertRaisesRegex(archive.ArchiveError, "Private key content"):
            self.package()
        del self.contents["secret.pem"]
        self.contents["test-controls/entry.mjs"] = b"fixture"
        self.write_release()
        with self.assertRaisesRegex(archive.ArchiveError, "Test controls"):
            self.package()

    def test_setup_stays_in_archives_and_public_report_has_no_url_or_absolute_path(self):
        tls = self.local / "tls/fixture"
        tls.mkdir(parents=True)
        # Structurally a certificate container; no real trust is asserted in this fixture.
        cert = b"\x30\x07\x30\x00\x30\x00\x03\x01\x00"
        (tls / "root-ca.cer").write_bytes(cert)
        profile = {"PayloadType": "Configuration", "PayloadRemovalDisallowed": False,
                   "PayloadContent": [{"PayloadType": "com.apple.security.root", "PayloadContent": cert}]}
        (tls / "root-only.mobileconfig").write_bytes(plistlib.dumps(profile))
        url = "https://127.0.0.1:4187" + self.build["entryPath"]
        config = self.local / "setup.json"
        config.write_bytes(archive.json_bytes({"tlsDir": str(tls), "entryURL": url}))
        report_path = self.root / "report.json"
        report = self.package(setup_config=config, report_path=report_path)
        public = report_path.read_text(encoding="utf-8")
        self.assertNotIn(url, public)
        self.assertNotIn("127.0.0.1", public)
        self.assertNotIn(str(self.root), public)
        self.assertIn("firstSetupPackage", report)
        for key in ("completePackage", "firstSetupPackage"):
            with zipfile.ZipFile(self.local / "packages" / report[key]["filename"]) as zipped:
                self.assertEqual(zipped.read("certificates/root-ca.cer"), cert)
                self.assertIn(url.encode(), zipped.read("本次首次准备说明.md"))
                self.assertFalse(any(name.endswith(("key.pem", ".pfx", ".p12")) for name in zipped.namelist()))
        self.assertEqual(self.package(setup_config=config, report_path=report_path, verify_existing=True), report)

    def test_non_removable_or_multi_payload_certificate_profile_is_rejected(self):
        tls = self.local / "tls/fixture"
        tls.mkdir(parents=True)
        cert = b"\x30\x07\x30\x00\x30\x00\x03\x01\x00"
        (tls / "root-ca.cer").write_bytes(cert)
        payload = {"PayloadType": "com.apple.security.root", "PayloadContent": cert}
        profile = {"PayloadType": "Configuration", "PayloadRemovalDisallowed": True, "PayloadContent": [payload]}
        (tls / "root-only.mobileconfig").write_bytes(plistlib.dumps(profile))
        config = self.local / "setup.json"
        config.write_bytes(archive.json_bytes({"tlsDir": str(tls), "entryURL": "https://127.0.0.1" + self.build["entryPath"]}))
        with self.assertRaisesRegex(archive.ArchiveError, "must be removable"):
            self.package(setup_config=config)
        profile["PayloadRemovalDisallowed"] = False
        profile["PayloadContent"] = [payload, payload]
        (tls / "root-only.mobileconfig").write_bytes(plistlib.dumps(profile))
        with self.assertRaisesRegex(archive.ArchiveError, "one certificate"):
            self.package(setup_config=config)
        (tls / "root-ca.cer").write_bytes(b"\x30\x06\x02\x01\x00\x04\x01\x00")
        with self.assertRaisesRegex(archive.ArchiveError, "not a certificate container"):
            self.package(setup_config=config)
        self.assertFalse((self.local / "packages").exists())


if __name__ == "__main__":
    unittest.main()
