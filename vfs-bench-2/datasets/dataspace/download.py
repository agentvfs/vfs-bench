"""Fetch the DataSpace tasks this repo ports, without the whole archive.

    uv run --project datasets/dataspace \
        python -I datasets/dataspace/download.py [task_N ...]

DataSpace (HKUSTDial/DataSpace, MIT code and data) ships its 410 tasks as
one 2.9 GB zip on Hugging Face. This reads only the ported tasks' entries
out of it with HTTP range requests, at a pinned dataset revision, and
checks each file against the archive's own ``checksums.sha256``. It also
fetches upstream's evaluator, which uses only the standard library, at a
pinned commit. Everything lands in ``state/dataspace/``:

    benchmark/input/task_N/...        the task's question and context
    benchmark/output/task_N/gold.csv  its public reference answer
    benchmark/evaluation/configs/task_N.json
    evaluation/evaluate.py

The tasks are this directory's (``*/harbor/task.toml``), or the ones named
on the command line.
"""
import hashlib
import io
import re
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
STATE = ROOT / "state" / "dataspace"
REVISION = "96be19257d7aa251dbce4771d46a26fc36f6dc52"
ARCHIVE = ("https://huggingface.co/datasets/HKUSTDial/DataSpace/resolve/"
           f"{REVISION}/release/DataSpace-Benchmark.zip")
COMMIT = "6491caa4c70cc06cacb6103ba73cefb00746abfe"
EVALUATOR = ("https://raw.githubusercontent.com/HKUSTDial/DataSpace/"
             f"{COMMIT}/evaluation/evaluate.py")
PREFIX = "DataSpace-Benchmark/"


class Remote(io.RawIOBase):
    """A read-only, seekable file over HTTP range requests."""

    def __init__(self, url: str):
        with urllib.request.urlopen(urllib.request.Request(
                url, method="HEAD")) as reply:
            self.size = int(reply.headers["Content-Length"])
            self.url = reply.url
        self.pos = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = {
            0: offset,
            1: self.pos + offset,
            2: self.size + offset
        }[whence]
        return self.pos

    def readinto(self, buffer):
        if self.pos >= self.size:
            return 0
        end = min(self.pos + len(buffer), self.size) - 1
        request = urllib.request.Request(
            self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(request) as reply:
            data = reply.read()
        buffer[:len(data)] = data
        self.pos += len(data)
        return len(data)


def ported() -> list[str]:
    """The upstream task ids of this repo's DataSpace tasks (``task_id`` in
    each one's task.toml)."""
    ids = set()
    for path in HERE.glob("*/harbor/task.toml"):
        found = re.search(r'^task_id = "(task_\d+)"$', path.read_text(), re.M)
        if found is None:
            raise SystemExit(f"{path} names no task_id")
        ids.add(found[1])
    return sorted(ids)


def main() -> int:
    tasks = sys.argv[1:] or ported()
    archive = zipfile.ZipFile(
        io.BufferedReader(Remote(ARCHIVE), buffer_size=1 << 20))
    sums = {}
    for line in archive.read(PREFIX +
                             "checksums.sha256").decode().splitlines():
        digest, _, name = line.strip().partition("  ")
        sums[name.removeprefix("./")] = digest
    wanted = []
    for info in archive.infolist():
        name = info.filename.removeprefix(PREFIX)
        if info.is_dir():
            continue
        if any(
                name.startswith(f"input/{t}/") or name in (
                    f"output/{t}/gold.csv", f"evaluation/configs/{t}.json")
                for t in tasks):
            wanted.append((info, name))
    for info, name in wanted:
        target = STATE / "benchmark" / name
        expected = sums.get(name)
        if expected is None:
            raise SystemExit(f"{name} is not in checksums.sha256")
        if target.is_file() and hashlib.sha256(
                target.read_bytes()).hexdigest() == expected:
            continue
        data = archive.read(info)
        if hashlib.sha256(data).hexdigest() != expected:
            raise SystemExit(f"sha256 mismatch for {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        print(f"fetch {name}")
    with urllib.request.urlopen(EVALUATOR) as reply:
        # In a directory of its own, which Harbor's verifier VM gets alone.
        (STATE / "evaluation").mkdir(parents=True, exist_ok=True)
        (STATE / "evaluation" / "evaluate.py").write_bytes(reply.read())
    print(f"{len(tasks)} tasks, {len(wanted)} files from {REVISION[:7]} "
          f"in {STATE}")
    # Each task's context, gold answer and config, from what was fetched.
    return subprocess.run([
        "uv", "run", "--project",
        str(ROOT / "formats" / "harbor"), "python", "-I",
        str(HERE / "convert.py")
    ]).returncode


if __name__ == "__main__":
    sys.exit(main())
