"""Download the workspace's python3, CPython's WASI build, into
``state/cpython-wasi/``.

    python3 -I formats/agentenv/python.py

Mirage's Python ``Workspace`` runs ``python3`` on it (its ``wasi``
runtime), where the TypeScript Mirage runs Pyodide, which has no Python
twin. The build is the one Mirage's CI runs, checked against its sha256.
"""
import hashlib
import io
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "state" / "cpython-wasi"
URL = ("https://github.com/brettcannon/cpython-wasi-build/releases/download/"
       "v3.14.7/python-3.14.7-wasi_sdk-24.zip")
SHA256 = "2e064d3fb8172471d39d741348efa722349c40b96301f69968dff714999c584b"


def main() -> None:
    if (DEST / "python.wasm").is_file():
        print(f"{DEST} is there")
        return
    with urllib.request.urlopen(URL) as reply:
        data = reply.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"{URL}: sha256 {digest}, not {SHA256}")
    staging = DEST.with_name(f"{DEST.name}.tmp")
    shutil.rmtree(staging, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        archive.extractall(staging)
    staging.replace(DEST)
    print(f"{DEST}")


if __name__ == "__main__":
    main()
