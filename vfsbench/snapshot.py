import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import Version

# The official python:3.14-slim multi-platform index. msb selects this host's
# platform.
IMAGE = ('python@sha256:'
         '22eafb370920ad8b429e0aec3fff433e0669968519f5d60469d83729c138b28b')
APT = ("sshfs", "libfaketime")
# Native CPython wheels for the scientific and document packages used by the
# two suites.
PACKAGES = (
    "numpy==2.4.6",
    "pandas==3.0.2",
    "pyarrow==22.0.0",
    "PyMuPDF==1.27.2.2",
    "pillow==12.2.0",
    "lxml==6.0.2",
    "tzdata==2025.3",
    "pypdf==6.21.2",
    "openpyxl==3.1.5",
    "python-docx==1.2.0",
    "python-pptx==1.0.2",
    "XlsxWriter==3.3.0",
    "PyPDF2==3.0.1",
    "pytesseract==0.3.13",
    "olefile==0.47",
    "scipy==1.18.0",
)
MODULES = ("numpy", "pandas", "pyarrow", "pymupdf", "PIL", "lxml", "tzdata",
           "pypdf", "openpyxl", "docx", "pptx", "xlsxwriter", "PyPDF2",
           "pytesseract", "olefile", "scipy")


def _packages(pins):
    """Keep base disk order and normalize any additional package pins."""
    if isinstance(pins, str):
        raise ValueError(
            "Pass python_packages as a sequence of exact package pins")
    packages = {canonicalize_name(p.split("==")[0]): p for p in PACKAGES}
    requested = {}
    for pin in pins:
        req = Requirement(pin)
        specs = tuple(req.specifier)
        if (req.url or req.marker or req.extras or len(specs) != 1
                or specs[0].operator != "=="):
            raise ValueError(f"Expected a package==version pin: {pin!r}")
        name = canonicalize_name(req.name)
        version = str(Version(specs[0].version))
        if name in requested and requested[name] != version:
            raise ValueError(f"Conflicting versions for {name}")
        requested[name] = version
    for name, version in sorted(requested.items()):
        original = packages.get(name, "").partition("==")
        packages[name] = f"{original[0] or name}=={version}"
    return tuple(packages.values())


def snapshot_name(python_packages=()) -> str:
    return _name(_packages(python_packages))


def _name(packages):
    digest = hashlib.sha256(json.dumps([IMAGE, APT, packages]).encode())
    return "vfsbench:python-" + digest.hexdigest()[:12]


SNAPSHOT = snapshot_name()


def _installed(snapshot) -> bool:
    result = subprocess.run(["msb", "snapshot", "inspect", snapshot],
                            capture_output=True,
                            text=True)
    if not result.returncode:
        return True
    if "snapshot not found:" in result.stderr.lower():
        return False
    raise RuntimeError(
        f"Cannot inspect microsandbox snapshot: {result.stderr}")


def build(python_packages=()) -> str:
    """Build a reusable guest disk with the selected Python package pins."""
    packages = _packages(python_packages)
    snapshot = _name(packages)
    if _installed(snapshot):
        return snapshot
    import fcntl

    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    lock = cache / "vfsbench" / f"{snapshot}.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        if not _installed(snapshot):
            _build_guest(snapshot, packages)
    return snapshot


def _build_guest(snapshot, packages) -> None:
    builder = "vfsbench-build-" + uuid4().hex

    def msb(*args):
        subprocess.run(["msb", *args], check=True, stdout=sys.stderr)

    try:
        msb("create", IMAGE, "--name", builder, "--cpus", "2", "--memory",
            "3G")
        msb("exec", builder, "--", "apt-get", "update")
        msb("exec", builder, "--", "apt-get", "install", "-y",
            "--no-install-recommends", *APT)
        msb("exec", builder, "--", "python3", "-m", "pip", "install",
            "--only-binary=:all:", "--no-cache-dir",
            "--root-user-action=ignore", *packages)
        msb("exec", builder, "--", "python3", "-c",
            "import " + ", ".join(MODULES))
        msb("stop", builder)
        group, member = snapshot.split(":")
        try:
            msb("snapshot", "create", "--sandbox", builder, "--group", group,
                member)
        except subprocess.CalledProcessError:
            if subprocess.run(["msb", "snapshot", "inspect", snapshot],
                              capture_output=True).returncode:
                raise
    finally:
        removed = subprocess.run(["msb", "remove", "--force", builder],
                                 capture_output=True,
                                 text=True)
        if removed.returncode and "not found" not in removed.stderr.lower():
            raise RuntimeError(
                f"Failed to remove build guest {builder}: {removed.stderr}")


def main():
    description = ("Build the reusable disk snapshot used by Mirage's Python "
                   'machine and offline graders.')
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("command", choices=["build", "name"])
    parser.add_argument("--package",
                        dest="python_packages",
                        action="append",
                        default=[])
    args = parser.parse_args()
    print((build if args.command == "build" else snapshot_name)(
        args.python_packages))


if __name__ == "__main__":
    main()
