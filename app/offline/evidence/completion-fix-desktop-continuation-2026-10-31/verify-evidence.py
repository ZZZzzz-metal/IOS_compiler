"""Read-only verification of this fixed evidence directory; never produces a seal."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8-sig"))


def observation(number):
    matches = list((ROOT / "browser").glob(f"{number:03}-*.json"))
    assert len(matches) == 1
    return json.loads(matches[0].read_text(encoding="utf-8"))


def source(number):
    return next(x["value"] for x in observation(number)["dom"]["fields"] if x["id"] == "source")


def scheme(number):
    return next(x["value"] for x in observation(number)["dom"]["selects"] if x["id"] == "shortcut-scheme")


def verify():
    rows = read("SHA256SUMS.json")
    actual = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*") if p.is_file() and p.name != "SHA256SUMS.json")
    assert sorted(x["file"] for x in rows) == actual
    repository = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=ROOT, text=True).strip())
    for row in rows:
        data = (ROOT / row["file"]).read_bytes()
        assert len(data) == row["byteLength"]
        assert hashlib.sha256(data).hexdigest() == row["sha256"]
        if "--git" in sys.argv:
            rel = (ROOT / row["file"]).relative_to(repository).as_posix()
            assert subprocess.check_output(["git", "show", f"HEAD:{rel}"], cwd=repository) == data
    if "--git" in sys.argv:
        rel = (ROOT / "SHA256SUMS.json").relative_to(repository).as_posix()
        assert subprocess.check_output(["git", "show", f"HEAD:{rel}"], cwd=repository) == (ROOT / "SHA256SUMS.json").read_bytes()
    assert len(list((ROOT / "browser").glob("*.json"))) == 22
    assert read("server-after-stop-confirmed.json")["listenerCount"] == 0
    assert read("server-after-stop-confirmed.json")["originalPidExists"] is False
    assert source(7).endswith("box.va")
    assert source(8) == source(10) == source(7) + "lue"
    assert source(9) == source(7)
    for number in (12, 16, 22):
        record = observation(number)
        assert "root-v047=42" in record["dom"]["text"]
        assert "exit" in record["dom"]["text"]
    pause = observation(15)["snapshot"]
    assert "main.cpp:10:1" in pause
    for name, value in (("value", 23), ("picked", 23), ("total", 42), ("box.value", 23)):
        assert f'- code: {name}\n      - emphasis: int\n      - generic: "{value}"' in pause
    restored = read("restoration-comparison.json")
    assert restored["exactSourceRestored"] is True
    assert restored["sourceCharacterLength"] == 279
    assert restored["expectedSource"] == restored["actualSource"] == source(18) == source(20) == source(22)
    assert scheme(18) == scheme(20) == "standard"
    assert scheme(21) == scheme(22) == "control-number"
    assert read("browser-console.json") == []
    assert read("browser-cleanup.json")["ownedTestTabClosed"] is True
    print(json.dumps({"passed": True, "sealedFiles": len(rows), "gitVerified": "--git" in sys.argv, "browserObservations": 22, "iPadValidated": False}))


if __name__ == "__main__":
    verify()
