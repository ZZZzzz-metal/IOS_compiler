"""Optional independent Python reference for the fixed UTF-8 snapshot vectors."""
import hashlib
import json
from pathlib import Path


def digest(text):
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


vectors_path = Path(__file__).resolve().parents[1] / "contracts" / "source-hash-vectors.json"
vectors = json.loads(vectors_path.read_text(encoding="utf-8"))["vectors"]
for vector in vectors:
    files = [
        {
            "path": file["path"],
            "role": file["role"],
            "text": file["text"].removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n"),
        }
        for file in vector["inputFiles"]
    ]
    files.sort(key=lambda file: file["path"].encode("utf-16-be"))
    canonical = json.dumps(
        {"version": 1, "translationUnit": vector["translationUnit"], "files": files},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    assert canonical == vector["canonicalJSON"], vector["name"]
    assert digest(canonical) == vector["sourceHash"], vector["name"]
    for file in files:
        assert digest(file["text"]) == vector["contentHashes"][file["path"]]
    print(f"PASS {vector['name']}: {vector['sourceHash']}")
