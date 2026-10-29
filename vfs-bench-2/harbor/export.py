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
  ``solution/solve.sh`` and ``tests/verify.py`` (but where ``VERBATIM_A``
  keeps upstream's), written by hand and kept.

Rule A is a task whose service Mirage already fakes: the email tasks, on
Mirage's gws fake. Rule B is one whose service it lacks: chat, weather and
finance, on this repo's fakes (``mocks/``), whose API and tables are
upstream's, so every file but the Dockerfile is upstream's. A task with
both is rule A for its email.

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
    "finance-anomaly-detect": "B",
    "finance-dashboard-repair": "B",
    "finance-depreciation-audit": "B",
    "finance-expense-log": "B",
    "finance-monthly-close": "B",
    "finance-portfolio-rebalancing": "B",
    "finance-analysis-generate": "A",
    "finance-budget-alert": "A",
    "finance-invoice-process": "A",
    "finance-tax-prepare": "A",
    "finance-budget-shift": "A",
}
# A rule-A task's files of ours, which differ from upstream's on purpose.
OURS_A = ["solution/solve.sh", "tests/verify.py"]
OURS = ["environment/mirage.yaml"]
# A rule-A task's files that stay upstream's: its verifier reads no mail,
# so the port changes nothing.
VERBATIM_A = {
    "finance-invoice-process": ["tests/verify.py"],
    "finance-budget-shift": ["tests/verify.py"],
}
# A rule-A instruction: the mailbox is a mount and a CLI, not a web app.
MAILBOX = ("(http://localhost:5174/, open it in browser)",
           "(at /gmail, or through the gws CLI)")
# How the email mock's own API is described, where an instruction does.
EMAIL_API = ("### Email System (http://localhost:5174)\n"
             "- `POST /api/auth/login` - authenticate with `{\"username\": "
             "\"peter\", \"password\": \"password123\"}` (%s)\n"
             "%s- `POST /api/emails` - send email with Bearer token "
             "authorization. Body format:\n"
             "  ```json\n"
             "  {\n"
             "    \"recipient\": \"email@example.com\",\n"
             "    \"subject\": \"Subject line\",\n"
             "    \"body\": \"Email content\",\n"
             "    \"send_now\": true\n"
             "  }\n"
             "  ```\n"
             "  Use the `Authorization: Bearer <access_token>` header for "
             "authentication.\n")
EMAIL_SECTION = "### Email System (at /gmail, or through the gws CLI)\n"
# The phrases a rule-A instruction reaches the mailbox by, where they are
# not MAILBOX alone; each is replaced, and must occur once.
MAILBOXES = {
    "finance-analysis-generate": [
        ("   - Email system URL: http://localhost:5174/\n"
         "   - Login credentials: username `peter`, password `password123`\n",
         "   - Email system: at /gmail, or through the gws CLI\n"),
        (EMAIL_API % ("returns Bearer token", ""), EMAIL_SECTION),
    ],
    "finance-budget-alert": [
        ("**Login to the email system** at http://localhost:5174/ using "
         "credentials: username `peter`, password `password123`.",
         "**Open the email system** (at /gmail, or through the gws CLI)."),
        (EMAIL_API % ("returns `access_token`", ""), EMAIL_SECTION),
    ],
    "finance-invoice-process": [
        ("at http://localhost:5174/ (username: `peter`, password: "
         "`password123`)", "(at /gmail, or through the gws CLI)"),
    ],
    "finance-tax-prepare": [
        ("Log in to the email system at **http://localhost:5174/** with "
         "credentials:\n- Username: `peter`\n- Password: `password123`\n",
         "Open the email system (at /gmail, or through the gws CLI).\n"),
        (EMAIL_API.replace(" - ", " — ") %
         ("returns `access_token`",
          "- `GET /api/emails?folder=inbox` — list inbox emails\n"),
         EMAIL_SECTION),
    ],
    # Its instruction never names the mailbox.
    "finance-budget-shift": [],
}


def derived_instruction(text: str, task: str) -> str:
    for old, new in MAILBOXES.get(task, [MAILBOX]):
        if text.count(old) != 1:
            raise ValueError(f"{task}: instruction.md names the mailbox "
                             f"{text.count(old)} times, not once: {old!r}")
        text = text.replace(old, new)
    return text


def ours(task: str) -> list[str]:
    """The task's files of ours."""
    if TASKS[task] == "B":
        return OURS
    return OURS + [f for f in OURS_A if f not in VERBATIM_A.get(task, [])]


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
        if rel in ours(task):
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
        problems = agrees(task, mirage)
        for rel in ours(task):
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
            if path.is_file() and rel not in files and rel not in ours(task):
                problems.append(f"{rel} is not upstream's, derived or ours")
        failed += bool(problems)
        status = "FAIL" if problems else ("ok" if args.check else "written")
        print(f"{status} {task}")
        for problem in problems:
            print(f"    {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
