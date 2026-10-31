"""Download hash-checked Pyodide wheels for offline Claw-Eval verification.

Requires the pinned Mirage npm dependencies. Does not install host Python
packages or a microVM image. Run from any working directory.
"""
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DIST = ROOT / "submodule/mirage/typescript/packages/core/node_modules/pyodide"
OUT = ROOT / "state/claweval/pyodide"
VERSION = "314.0.5"


def main():
    if json.loads((DIST / "package.json").read_text())["version"] != VERSION:
        raise ValueError("Review Claw-Eval parity before changing Pyodide")
    lock = json.loads((DIST / "pyodide-lock.json").read_text())
    pending, seen = ["pydantic", "pyyaml"], set()
    OUT.mkdir(parents=True, exist_ok=True)
    while pending:
        name = pending.pop().replace("_", "-")
        if name in seen:
            continue
        seen.add(name)
        package = lock["packages"][name]
        pending.extend(package["depends"])
        target = OUT / package["file_name"]
        if target.exists() and hashlib.sha256(
                target.read_bytes()).hexdigest() == package["sha256"]:
            continue
        url = f"https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/{target.name}"
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != package["sha256"]:
            raise ValueError(f"Pyodide wheel hash mismatch: {target.name}")
        temp = target.with_suffix(".tmp")
        temp.write_bytes(data)
        temp.replace(target)
        print(target.name)
    print(f"Claw-Eval Pyodide {VERSION}: {len(seen)} packages ready in {OUT}")


if __name__ == "__main__":
    main()
