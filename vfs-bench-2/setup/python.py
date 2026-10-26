"""Bundle the Python packages tasks import, so `python3` runs offline.

    python3 -I setup/python.py [--check]

The workspace runs `python3` in Pyodide. Its npm package ships the lock
file and almost no wheels, fetching the rest from a CDN on first import, so
this downloads every wheel the tasks need into ``state/python/`` and writes
a lock that also lists the pure-Python wheels Pyodide does not carry.
Workspaces point ``lockFileUrl`` and ``packageBaseUrl`` there, and an
import loads its package from disk.

Pyodide's own wheels come from its CDN at the installed version and are
checked against its lock's sha256; the pure-Python ones are pinned below
by version and sha256. A wheel built for another Pyodide ABI will not
import, which is why the version is read from the installed package and
never written down here.
"""
import argparse
import hashlib
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "state" / "python"
CDN = "https://cdn.jsdelivr.net/pyodide/v{version}/full/"
PYPI = "https://files.pythonhosted.org/packages/{path}/{filename}"

# What the datasets' tasks import that Pyodide carries but does not ship on
# disk: tables and SQLite-adjacent analysis (DataSpace), PDFs, images and
# documents (DataSpace, Gaia2).
PYODIDE = ("numpy", "pandas", "pyarrow", "pymupdf", "pillow", "opencv-python",
           "lxml", "tzdata")
# Pure-Python wheels Pyodide does not carry: name, version, filename,
# sha256, the file's path on PyPI, dependencies.
PURE = (
    ("pypdf", "6.21.2", "pypdf-6.21.2-py3-none-any.whl",
     "1d44d1a3a200f25062adff0085b02040e4646431ac2ccac22e42679e91466084",
     "1b/4d/c9d2d67f204eff463237a1a8f5e25a6923b7b1043982b91fcaf104c8ef60", ()),
    ("openpyxl", "3.1.5", "openpyxl-3.1.5-py2.py3-none-any.whl",
     "5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2",
     "c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506",
     ("et-xmlfile", )),
    ("et-xmlfile", "2.0.0", "et_xmlfile-2.0.0-py3-none-any.whl",
     "7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa",
     "c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a", ()),
    ("python-docx", "1.2.0", "python_docx-1.2.0-py3-none-any.whl",
     "3fd478f3250fbbbfd3b94fe1e985955737c145627498896a8a6bf81f4baf66c7",
     "d0/00/1e03a4989fa5795da308cd774f05b704ace555a70f9bf9d3be057b680bcf",
     ("lxml", "typing-extensions")),
    ("python-pptx", "1.0.2", "python_pptx-1.0.2-py3-none-any.whl",
     "160838e0b8565a8b1f67947675886e9fea18aa5e795db7ae531606d68e785cba",
     "d9/4f/00be2196329ebbff56ce564aa94efb0fbc828d00de250b1980de1a34ab49",
     ("pillow", "xlsxwriter", "lxml", "typing-extensions")),
    ("xlsxwriter", "3.3.0", "xlsxwriter-3.3.0-py3-none-any.whl",
     "5f04772d43281da5109af66f39b65153359a203e896847c416476e709b024469",
     "ce/9d/3d30eaaa7e06bdb6172f938b2661d64f8d899bdca54120384ecf3759488a", ()),
)


def pyodide_dir() -> Path:
    """The Pyodide that Mirage's TypeScript tree loads."""
    store = ROOT / "submodule" / "mirage" / "typescript" / "node_modules"
    found = sorted(store.glob(".pnpm/pyodide@*/node_modules/pyodide"))
    if not found:
        raise SystemExit("no pyodide under submodule/mirage/typescript: "
                         "run `pnpm install` there first")
    return found[-1]


def fetch(url: str, sha256: str) -> bytes:
    """Download ``url`` and check it against ``sha256``."""
    with urllib.request.urlopen(url) as response:
        body = response.read()
    if hashlib.sha256(body).hexdigest() != sha256:
        raise SystemExit(f"sha256 mismatch for {url}")
    return body


def imports_of(wheel: Path) -> list[str]:
    """The top-level import names a wheel ships."""
    with zipfile.ZipFile(wheel) as zf:
        names = zf.namelist()
    found = set()
    for name in names:
        head = name.split("/", 1)[0]
        if head.endswith((".dist-info", ".data")) or head.startswith("_"):
            continue
        if f"{head}/__init__.py" in names:
            found.add(head)
        elif "/" not in name and name.endswith(".py"):
            found.add(name[:-3])
    return sorted(n for n in found if n.isidentifier())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check",
                        action="store_true",
                        help="verify the bundle without downloading")
    args = parser.parse_args(argv)
    installed = pyodide_dir()
    stock = json.loads((installed / "pyodide-lock.json").read_text())
    version = json.loads((installed / "package.json").read_text())["version"]
    packages: dict[str, dict] = {}
    urls: dict[str, str] = {}

    def take(name: str) -> None:
        if name in packages:
            return
        entry = dict(stock["packages"][name])
        packages[name] = entry
        urls[name] = CDN.format(version=version) + entry["file_name"]
        for dependency in entry.get("depends", []):
            take(dependency)

    for name in PYODIDE:
        take(name)
    for name, ver, filename, sha256, path, depends in PURE:
        packages[name] = {
            "name": name,
            "version": ver,
            "file_name": filename,
            "sha256": sha256,
            "install_dir": "site",
            "package_type": "package",
            "imports": [],
            "depends": list(depends),
            "unvendored_tests": False,
        }
        urls[name] = PYPI.format(path=path, filename=filename)
        for dependency in depends:
            if dependency not in packages and dependency in stock["packages"]:
                take(dependency)

    DEST.mkdir(parents=True, exist_ok=True)
    bad = 0
    for name, entry in sorted(packages.items()):
        target = DEST / entry["file_name"]
        if target.is_file() and hashlib.sha256(
                target.read_bytes()).hexdigest() == entry["sha256"]:
            continue
        if args.check:
            print(f"MISSING or INVALID {target.name}")
            bad += 1
            continue
        print(f"fetch {target.name}")
        target.write_bytes(fetch(urls[name], entry["sha256"]))
    if bad:
        return 1
    pure = {name for name, *_ in PURE}
    for name in pure:
        packages[name]["imports"] = imports_of(DEST /
                                               packages[name]["file_name"])
    # Keep every stock entry, so a stdlib module Pyodide unvendors still
    # resolves; the ones not downloaded here fail loudly on import.
    lock = {
        "info": stock["info"],
        "packages": {
            **stock["packages"],
            **packages
        }
    }
    (DEST / "pyodide-lock.json").write_text(json.dumps(lock, indent=1) + "\n")
    print(f"{len(packages)} packages in {DEST} for pyodide {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
