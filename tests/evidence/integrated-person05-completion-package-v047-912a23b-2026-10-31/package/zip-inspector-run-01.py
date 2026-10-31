"""Independent archive inventory and fresh safe extraction; no package rebuild."""
import hashlib
import json
import pathlib
import stat
import sys
import zipfile

archive = pathlib.Path(sys.argv[1]).resolve(strict=True)
destination = None if len(sys.argv) == 2 else pathlib.Path(sys.argv[2]).resolve()
blob = archive.read_bytes()
members = []
seen = set()
with zipfile.ZipFile(archive) as package:
    infos = package.infolist()
    assert sum(item.file_size for item in infos) < 80 * 1024 * 1024
    for item in infos:
        name = item.filename
        path = pathlib.PurePosixPath(name)
        assert name and not path.is_absolute() and "\\" not in name
        assert not any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
        assert not any(character in name for character in (":", "\x00"))
        assert name.casefold() not in seen
        seen.add(name.casefold())
        assert not stat.S_ISLNK(item.external_attr >> 16)
        if item.is_dir():
            continue
        data = package.read(item)
        assert len(data) == item.file_size
        members.append({"name": name, "byteLength": len(data), "sha256": hashlib.sha256(data).hexdigest(), "crc32": item.CRC})
    if destination is not None:
        destination.mkdir(parents=True, exist_ok=False)
        for item in infos:
            target = destination.joinpath(*pathlib.PurePosixPath(item.filename).parts).resolve()
            assert target.is_relative_to(destination)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=False)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as output:
                    output.write(package.read(item))
print(json.dumps({"sourceArchive": str(archive), "zipBytes": len(blob), "zipSHA256": hashlib.sha256(blob).hexdigest(),
    "fileCount": len(members), "members": members, "allPathsContained": True, "duplicateOrLinkedEntries": False,
    "extractedRoot": None if destination is None else str(destination),
    "staticSiteRoot": None if destination is None else str(destination / "site")}, ensure_ascii=False))
