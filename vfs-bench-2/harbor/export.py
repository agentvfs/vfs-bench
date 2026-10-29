"""Write the committed LiveClawBench tasks from upstream, or check them.

    uv run --project harbor python -I harbor/export.py [--check] [task ...]

Each task under ``harbor/tasks/liveclawbench/<task>/`` is upstream's task
directory (``state/liveclawbench/src/tasks/<task>/``, pinned by
``liveclawbench/setup.py``) with ``environment/Dockerfile`` replaced by
``environment/mirage.yaml``, which names the task's kit fakes, their
fixture and the workspace's mounts. Its files are of four kinds:

- verbatim: upstream's, byte for byte, written here;
- derived: upstream's with a fixed edit, written here (a rule-A
  ``instruction.md``, where only how the mailbox is reached changes);
- generated: each fake's fixture, ``environment/fixtures/<service>.json``,
  from upstream's own seed for the task (``harbor/fixtures/main.ts``, under
  Bun), at the epoch mirage.yaml gives;
- ours: ``environment/mirage.yaml``, and a rule-A task's
  ``solution/solve.sh`` and ``tests/verify.py``, written by hand and kept.

Rule A is a task whose service Mirage already fakes: the email tasks, on
Mirage's gws fake. Rule B is one whose service it lacks: chat and weather,
on this repo's fakes (``mocks/``), whose API and tables are upstream's, so
every file but the Dockerfile is upstream's.

``--check`` writes nothing and exits 1 if any verbatim, derived or
generated file differs from what upstream gives, if mirage.yaml's ``env``,
``copy``, ``run`` and ``workdir`` disagree with upstream's Dockerfile (and
``TASK_NAME``, its base image's; ``copy`` with each of its ``COPY``
lines), or if a file is missing or unaccounted for.
"""
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
UPSTREAM = ROOT / "state" / "liveclawbench" / "src" / "tasks"
OUT = HARBOR / "tasks" / "liveclawbench"
FIXTURES = HARBOR / "fixtures" / "main.ts"

# Each task, by its rule.
TASKS = {
    "chat-sticker-engagement": "B",
    "sticker-store-acquire": "B",
    "weather-aqi-report": "B",
    "newsletter-digest-forward": "A",
    "procurement-quote-compare-reply": "A",
    "stale-client-escalation": "A",
    "vendor-requirement-followup": "A",
}
# A rule-A task's files of ours, which differ from upstream's on purpose.
OURS_A = ["solution/solve.sh", "tests/verify.py"]
OURS = ["environment/mirage.yaml"]
# A rule-A instruction: the mailbox is a mount and a CLI, not a web app.
MAILBOX = ("(http://localhost:5174/, open it in browser)",
           "(at /gmail, or through the gws CLI)")


def derived_instruction(text: str, task: str) -> str:
    old, new = MAILBOX
    if text.count(old) != 1:
        raise ValueError(f"{task}: instruction.md names the mailbox "
                         f"{text.count(old)} times, not once")
    return text.replace(old, new)


def env_pairs(args: str) -> list[tuple[str, str]]:
    """``ENV A=1 B=2`` or ``ENV A 1``, unquoted, as liveclawbench.ts does."""

    def unquote(value: str) -> str:
        return re.sub(r"^'(.*)'$", r"\1", re.sub(r'^"(.*)"$', r"\1", value))

    if not re.match(r"\S+=", args):
        name, _, value = args.partition(" ")
        return [(name, unquote(value.strip()))]
    return [(m[1], unquote(m[2]))
            for m in re.finditer(r"(\S+?)=(\"[^\"]*\"|'[^']*'|\S*)", args)]


def dockerfile(task: str) -> dict:
    """What upstream's Dockerfile sets: RUN, COPY (each source and target),
    ENV and WORKDIR."""
    text = (UPSTREAM / task / "environment" / "Dockerfile").read_text()
    joined = re.sub(r"\\\n\s*", " ", text)
    runs, copies, env, workdir = [], [], {}, None
    for line in joined.splitlines():
        line = line.strip()
        if line.startswith("RUN ") and not line[4:].lstrip().startswith("["):
            runs.append(re.sub(r"\s+", " ", line[4:].strip()))
        elif re.fullmatch(r"COPY [^-\s]\S* \S+", line):
            copies.append(tuple(line.split()[1:]))
        elif line.startswith("ENV "):
            env.update(env_pairs(line[4:].strip()))
        elif line.startswith("WORKDIR "):
            workdir = line[8:].strip()
    return {"run": runs, "copy": copies, "env": env, "workdir": workdir}


def expected(task: str, mirage: dict) -> dict[str, bytes]:
    """Every file export writes for a task, by path in its directory."""
    source = UPSTREAM / task
    rule = TASKS[task]
    out: dict[str, bytes] = {}
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source).as_posix()
        if not path.is_file() or rel == "environment/Dockerfile":
            continue
        if rule == "A" and rel in OURS_A:
            continue
        if rule == "A" and rel == "instruction.md":
            out[rel] = derived_instruction(path.read_text(), task).encode()
        else:
            out[rel] = path.read_bytes()
    for service, block in mirage["fakes"].items():
        out[f"environment/{block['fixture']}"] = fixture(
            task, service, block["epoch"])
    return out


def fixture(task: str, service: str, epoch: str) -> bytes:
    """A fake's fixture for the task, from upstream's seed."""
    done = subprocess.run(
        ["bun", str(FIXTURES), task, service, epoch],
        cwd=ROOT,
        env={
            **os.environ, "TZ": "UTC"
        },
        capture_output=True,
        check=False,
    )
    if done.returncode != 0:
        raise RuntimeError(f"{task}: the {service} fixture failed:\n"
                           f"{done.stderr.decode()[-4000:]}")
    return done.stdout


def agrees(task: str, mirage: dict) -> list[str]:
    """Where mirage.yaml disagrees with what upstream's Dockerfile sets."""
    docker = dockerfile(task)
    problems = []
    # TASK_NAME is the base image's, as liveclawbench.ts sets it.
    env = {"TASK_NAME": task, **docker["env"]}
    if (mirage.get("env") or {}) != env:
        problems.append(f"env is not the base image's and Dockerfile's {env}")
    if mirage.get("workdir") != docker["workdir"]:
        problems.append(
            f"workdir is not the Dockerfile's WORKDIR {docker['workdir']}")
    if [re.sub(r"\s+", " ", r)
            for r in mirage.get("run") or []] != docker["run"]:
        problems.append(
            f"run is not the Dockerfile's RUN lines {docker['run']}")
    environment = sorted(p.name
                         for p in (UPSTREAM / task / "environment").iterdir()
                         if p.name != "Dockerfile")
    # `COPY . <dir>` is the entries of environment/; `COPY <src> <dest>`,
    # its source.
    copies = {
        dest.rstrip("/"): environment if src == "." else src
        for src, dest in docker["copy"]
    }
    stated = {k.rstrip("/"): v for k, v in (mirage.get("copy") or {}).items()}
    if stated != copies:
        problems.append(f"copy is not the Dockerfile's COPY lines {copies}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("tasks", nargs="*", default=list(TASKS))
    args = parser.parse_args()
    failed = 0
    for task in args.tasks:
        target = OUT / task
        mirage = yaml.safe_load(
            (target / "environment" / "mirage.yaml").read_text())
        files = expected(task, mirage)
        ours = OURS + (OURS_A if TASKS[task] == "A" else [])
        problems = agrees(task, mirage)
        for rel in ours:
            if not (target / rel).is_file():
                problems.append(f"{rel} (ours) is missing")
        for rel, data in files.items():
            path = target / rel
            if args.check:
                if not path.is_file():
                    problems.append(f"{rel} is missing")
                elif path.read_bytes() != data:
                    problems.append(f"{rel} differs from upstream's")
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        for path in sorted(target.rglob("*")):
            rel = path.relative_to(target).as_posix()
            if path.is_file() and rel not in files and rel not in ours:
                problems.append(f"{rel} is not upstream's, derived or ours")
        failed += bool(problems)
        status = "FAIL" if problems else ("ok" if args.check else "written")
        print(f"{status} {task}")
        for problem in problems:
            print(f"    {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
