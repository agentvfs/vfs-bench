"""Build the reusable disk snapshot used by Mirage's Python machine and
offline graders."""

import argparse
import hashlib
import json
import subprocess
from uuid import uuid4

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
SNAPSHOT = "vfsbench:python-" + hashlib.sha256(
    json.dumps([IMAGE, APT, PACKAGES]).encode()).hexdigest()[:12]


def build() -> str:
    """Create the snapshot once. Only the temporary build guest downloads
    packages."""
    if subprocess.run(["msb", "snapshot", "inspect", SNAPSHOT],
                      capture_output=True).returncode == 0:
        return SNAPSHOT
    builder = "vfsbench-build-" + uuid4().hex

    def msb(*args):
        subprocess.run(["msb", *args], check=True)

    try:
        msb("create", IMAGE, "--name", builder, "--cpus", "2", "--memory",
            "3G")
        msb("exec", builder, "--", "apt-get", "update")
        msb("exec", builder, "--", "apt-get", "install", "-y",
            "--no-install-recommends", *APT)
        msb("exec", builder, "--", "python3", "-m", "pip", "install",
            "--only-binary=:all:", "--no-cache-dir",
            "--root-user-action=ignore", *PACKAGES)
        msb("exec", builder, "--", "python3", "-c",
            "import " + ", ".join(MODULES))
        msb("stop", builder)
        group, member = SNAPSHOT.split(":")
        try:
            msb("snapshot", "create", "--sandbox", builder, "--group", group,
                member)
        except subprocess.CalledProcessError:
            if subprocess.run(["msb", "snapshot", "inspect", SNAPSHOT],
                              capture_output=True).returncode:
                raise
    finally:
        removed = subprocess.run(["msb", "remove", "--force", builder],
                                 capture_output=True,
                                 text=True)
        if removed.returncode and "not found" not in removed.stderr.lower():
            raise RuntimeError(
                f"Failed to remove build guest {builder}: {removed.stderr}")
    return SNAPSHOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "name"])
    args = parser.parse_args()
    print(build() if args.command == "build" else SNAPSHOT)


if __name__ == "__main__":
    main()
