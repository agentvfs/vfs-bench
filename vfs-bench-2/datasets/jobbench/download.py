"""Download the JobBench tasks this repo ports, then write them.

    uv run --project datasets/jobbench python -I datasets/jobbench/download.py

JobBench (JobBench/job-bench on Hugging Face, MIT data;
Job-Bench/job-bench-eval
on GitHub, Apache-2.0 code) ships each task as a folder: its RUBRICS.json, its
task_card.md and the task_folder/ the agent works in. This fetches the ported
tasks' folders at a pinned dataset revision, each file checked against the
Hub's own record of it (an LFS file's sha256, any other's git blob id), and
upstream's judge and Harbor verifier at a pinned commit, for the parity test.
Everything lands in ``state/jobbench/``:

    <split>/<occupation>/<task>/...    as the dataset lays it out
    upstream/eval/judge.py             and the files it imports
    upstream/harbor/runtime/verify.py
    upstream/harbor/jobbench_harbor/render.py   the agent's instruction
    upstream/harbor/templates/environment.Dockerfile   the agent's image

It builds that image as the microsandbox snapshot ``jobbench:<commit>``,
which each trial's sandbox is restored from: msb builds no Dockerfile, so
its steps run in a sandbox of the base image (``FROM``, ``ENV``, ``RUN``,
``COPY`` of the requirements; the task's own files are Mirage's to copy),
then ``sshfs``, which Mirage's ssh mount needs on the machine. Then
convert.py writes each task here.
"""
import hashlib
import json
import shlex
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
STATE = ROOT / "state" / "jobbench"
REVISION = "d43a66575635da0d3f6cb9a20976dc1a60f3ffc9"
DATASET = "https://huggingface.co/api/datasets/JobBench/job-bench"
FILES = ("https://huggingface.co/datasets/JobBench/job-bench/resolve/"
         f"{REVISION}")
COMMIT = "660b33a86e"
CODE = f"https://raw.githubusercontent.com/Job-Bench/job-bench-eval/{COMMIT}"
UPSTREAM = [
    "eval/judge.py",
    # Hashed into the judge's implementation id, never run here.
    "eval/calc-runtime/Dockerfile",
    "eval/jobbench_eval/__init__.py",
    "eval/jobbench_eval/calc.py",
    "eval/jobbench_eval/calc_worker.py",
    "eval/jobbench_eval/excel.py",
    "eval/jobbench_eval/excel_text.py",
    "eval/jobbench_eval/rich_text.py",
    "harbor/runtime/verify.py",
    "harbor/jobbench_harbor/render.py",
    "harbor/templates/environment.Dockerfile",
    "harbor/templates/environment-requirements.txt",
]
SNAPSHOT = f"jobbench:{COMMIT}"
BUILDER = "jobbench-build"
# What Mirage's ssh mount needs on the machine.
SSHFS = ("apt-get update && apt-get install -y --no-install-recommends sshfs"
         " && rm -rf /var/lib/apt/lists/*")
# The ported tasks, as (split folder, occupation, task): those whose
# deliverables are all text, which the judge reads as upstream's does.
TASKS = [
    ("dataset", "technical_writers", "task1"),
    ("dataset", "technical_writers", "task2"),
    ("dataset", "technical_writers", "task3"),
    ("dataset", "web_administrators", "task1"),
    ("dataset_easy", "bookkeeping_accounting_and_auditing_clerks", "task1"),
    ("dataset_easy", "computer_user_support_specialists", "task1"),
    ("dataset_easy", "customer_service_representatives", "task1"),
    ("dataset_easy", "data_entry_keyers", "task1"),
    ("dataset_easy", "data_entry_keyers", "task2"),
    ("dataset_easy", "personal_financial_advisors", "task1"),
    ("dataset_easy", "personal_financial_advisors", "task2"),
    ("dataset_easy", "police_fire_and_ambulance_dispatchers", "task3"),
    ("dataset_easy", "reporters_and_correspondents", "task3"),
    ("dataset_easy", "social_science_research_assistants", "task1"),
    ("dataset_easy", "sociology_teachers_postsecondary", "task1"),
    ("dataset_easy", "statisticians", "task2"),
]


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url) as reply:
        return reply.read()


def matches(data: bytes, entry: dict) -> bool:
    """Whether ``data`` is the file the Hub's tree lists as ``entry``."""
    if entry.get("lfs"):
        return hashlib.sha256(data).hexdigest() == entry["lfs"]["oid"]
    blob = b"blob %d\0" % len(data) + data
    return hashlib.sha1(blob).hexdigest() == entry["oid"]


def steps(dockerfile: Path) -> list[tuple[str, str]]:
    """The Dockerfile's instructions, each continued line joined."""
    out, line = [], ""
    for raw in dockerfile.read_text().splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        line += raw.rstrip()
        if line.endswith("\\"):
            line = line[:-1] + " "
            continue
        word, _, rest = line.strip().partition(" ")
        out.append((word.upper(), rest.strip()))
        line = ""
    return out


def msb(*argv: str) -> None:
    subprocess.run(["msb", *argv], check=True)


def build() -> None:
    """Upstream's agent image as the snapshot each trial restores."""
    if subprocess.run(["msb", "snapshot", "inspect", SNAPSHOT],
                      capture_output=True).returncode == 0:
        return
    templates = STATE / "upstream/harbor/templates"
    subprocess.run(["msb", "remove", "--force", BUILDER], capture_output=True)
    env: list[str] = []
    for word, rest in steps(templates / "environment.Dockerfile"):
        if word == "FROM":
            # LibreOffice and the requirements outgrow a 4 GiB root disk.
            msb("create", rest, "--name", BUILDER, "--cpus", "4", "--memory",
                "4G", "--root-disk", "10G")
        elif word == "ENV":
            env = [f"--env={pair}" for pair in shlex.split(rest)]
        elif word == "RUN":
            msb("exec", *env, BUILDER, "--", "sh", "-c", rest)
        elif word == "COPY" and rest.split()[0] == "requirements.txt":
            msb("copy", str(templates / "environment-requirements.txt"),
                f"{BUILDER}:{rest.split()[1]}")
    msb("exec", *env, BUILDER, "--", "sh", "-c", SSHFS)
    msb("stop", BUILDER)
    group, name = SNAPSHOT.split(":")
    msb("snapshot", "create", "--sandbox", BUILDER, "--group", group, name)
    msb("remove", "--force", BUILDER)


def main() -> int:
    count = 0
    for split, occupation, task in TASKS:
        folder = f"{split}/{occupation}/{task}"
        tree = json.loads(
            fetch(f"{DATASET}/tree/{REVISION}/{folder}?recursive=true"))
        for entry in tree:
            if entry["type"] != "file":
                continue
            target = STATE / entry["path"]
            if target.is_file() and matches(target.read_bytes(), entry):
                continue
            data = fetch(f"{FILES}/{entry['path']}")
            if not matches(data, entry):
                raise SystemExit(
                    f"{entry['path']} does not match the Hub's record of it")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            count += 1
            print(f"fetch {entry['path']}")
    for path in UPSTREAM:
        target = STATE / "upstream" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(fetch(f"{CODE}/{path}"))
    print(f"{len(TASKS)} tasks, {count} files fetched from {REVISION[:7]} "
          f"in {STATE}")
    build()
    return subprocess.run([
        "uv", "run", "--project",
        str(HERE), "python", "-I",
        str(HERE / "convert.py")
    ]).returncode


if __name__ == "__main__":
    sys.exit(main())
