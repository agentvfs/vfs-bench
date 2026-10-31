"""Write the committed LiveClawBench tasks from upstream, or check them.

    uv run --project formats/harbor \
        python -I datasets/liveclawbench/generate.py [--check] [task ...]

Each task under ``datasets/liveclawbench/<task>/`` is upstream's task
directory (``state/liveclawbench/src/tasks/<task>/``, pinned by
``fetch.py``) with ``environment/Dockerfile`` replaced by
``environment/mirage.yaml``, which names the task's kit fakes, their
fixture and the workspace's mounts. Its files are of four kinds:

- verbatim: upstream's, byte for byte, written here;
- derived: upstream's with a fixed edit, written here (a rule-A
  ``instruction.md``, where only how the mailbox and calendar are reached
  changes, and the files ``EDITS`` names);
- generated: each fake's fixture, ``environment/fixtures/<service>.json``,
  from upstream's own seed for the task (``seeds/main.ts``, under
  Bun), at the epoch mirage.yaml gives;
- ours: ``environment/mirage.yaml``, a rule-A task's ``solution/solve.sh``
  (but where ``VERBATIM_A`` keeps upstream's), and the further files
  ``MORE_OURS`` names, written by hand and kept; and ``tests/test.sh``, the
  stub (``harbor/test.sh``).

Upstream's verifier and its scripts (``REFERENCE``) are not exported:
``MirageVerifier`` grades with the native graders under ``harbor/graders/``,
which read the task's other ``tests/`` files.

Rule A is a task whose service Mirage already fakes: the email and
calendar tasks, on Mirage's gws fake. Rule B is one whose service it lacks:
chat, weather, finance and social, on this repo's fakes (``mocks/``), whose
API and tables are upstream's, so every file but the Dockerfile is
upstream's. A task with both is rule A for its email.

``--check`` writes nothing and exits 1 if any verbatim, derived or
generated file differs from what upstream gives, if mirage.yaml's ``env``,
``copy``, ``run`` and ``workdir`` disagree with upstream's Dockerfile (and
``TASK_NAME``, its base image's; ``copy`` with each of its ``COPY``
lines, less what its ``.dockerignore`` names; a rule-A task leaves out the
browser's install, and an airline task the legacy apps' installs too), if a
file is missing or unaccounted for, or if any file
looks like it holds a credential.
Upstream's AgentBay harnesses (``LEFT_OUT``) are not exported either: they
carry upstream's own keys.

It names each file by its place in Harbor's layout
(``environment/mirage.yaml``, ``tests/<file>``); ``datasets/layout.py`` lays
them out in the task's ``workspace/`` and ``harbor/``.
"""
import argparse
import fnmatch
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
UPSTREAM = ROOT / "state" / "liveclawbench" / "src" / "tasks"
OUT = HERE
FIXTURES = HERE / "seeds" / "main.ts"
TEST_SH = ROOT / "formats" / "harbor" / "test.sh"
sys.path.insert(0, str(HERE.parent))
from layout import place, placed  # noqa: E402

# Each task, by its rule.
TASKS = {
    "chat-sticker-engagement": "B",
    "sticker-store-acquire": "B",
    "weather-aqi-report": "B",
    "newsletter-digest-forward": "A",
    "procurement-quote-compare-reply": "A",
    "stale-client-escalation": "A",
    "vendor-requirement-followup": "A",
    "candidate-interview-slot-confirm": "A",
    "email-reply": "A",
    "email-sending-verify": "A",
    "email-writing": "A",
    "interview-slot-verify": "A",
    "meeting-slot-race": "A",
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
    "meeting-reschedule-response": "A",
    "weather-outdoor-window": "B",
    "email-phishing-injection": "A",
    "weather-city-travel-pick": "B",
    "social-unlike-post": "B",
    "social-unlike-verify": "B",
    "social-media-posting": "B",
    "social-post-rate-limit": "B",
    "social-comment-moderation": "A",
    "social-data-anomaly-report": "A",
    "social-event-campaign": "A",
    "social-keyword-cleanup": "A",
    "social-cross-publish": "A",
    "social-pinned-post-update": "A",
    "phishing-in-inbox": "A",
    "health-daily-record": "B",
    "health-record-verify": "B",
    "mint-diet-snack-log": "B",
    "nutrition-log-meal": "B",
    "mint-diet-comprehensive": "B",
    "mint-diet-stockout": "B",
    "expense-draft-delete": "B",
    "expense-submit-verify": "B",
    "insurance-deductible-selection": "B",
    "health-insurance-optimization": "A",
    "workspace-brief-tracking": "B",
    "workspace-task-record-batch": "B",
    "washer-change": "B",
    "washer-shop": "B",
    "watch-shop": "B",
    "watch-shop-silent-fail": "B",
    "watch-shop-stockout": "B",
    "info-change": "B",
    "email-washer-change": "A",
    "email-watch-shop": "A",
    "grocery-reorder": "B",
    "morning-comfort-setup": "B",
    "smarthome-test": "B",
    "cross-service-credential-handling": "A",
    "flight-booking": "B",
    "fake-system-notification": "B",
    "flight-seat-selection": "A",
    "flight-seat-selection-failed": "A",
    "flight-cancel-claim": "A",
    "flight-info-change-notice": "A",
    "flight-calendar-overshare": "A",
}
# The airline tasks: upstream's airline mock (Bun), its legacy Flask backend
# and React frontend left in environment/, never started.
AIRLINE = [
    "flight-booking", "fake-system-notification", "flight-seat-selection",
    "flight-seat-selection-failed", "flight-cancel-claim",
    "flight-info-change-notice", "flight-calendar-overshare"
]
# A rule-A task's files of ours, which differ from upstream's on purpose.
OURS_A = ["solution/solve.sh"]
OURS = ["environment/mirage.yaml"]
# A rule-A task's files that stay upstream's: its solution reads no mail, so
# the port changes nothing.
VERBATIM_A = {
    "social-comment-moderation": ["solution/solve.sh"],
}
# A task's further files of ours. weather-outdoor-window's solution fetches
# the page from Python, which has no network here, so ours fetches it with
# curl. Three social tasks' solutions run `openclaw agent`, a model, so ours
# does what the instruction asks; so do the airline tasks' (AIRLINE),
# through the airline mock's API.
MORE_OURS = {
    "weather-outdoor-window": ["solution/solve.sh"],
    "weather-city-travel-pick": ["solution/solve.sh"],
    "social-media-posting": ["solution/solve.sh"],
    "social-post-rate-limit": ["solution/solve.sh"],
    "social-unlike-verify": ["solution/solve.sh"],
    "health-daily-record": ["solution/solve.sh"],
    "health-record-verify": ["solution/solve.sh"],
    "mint-diet-snack-log": ["solution/solve.sh"],
    "nutrition-log-meal": ["solution/solve.sh"],
    "mint-diet-comprehensive": ["solution/solve.sh"],
    "mint-diet-stockout": ["solution/solve.sh"],
    "expense-submit-verify": ["solution/solve.sh"],
    "washer-change": ["solution/solve.sh"],
    "washer-shop": ["solution/solve.sh"],
    "watch-shop": ["solution/solve.sh"],
    "watch-shop-silent-fail": ["solution/solve.sh"],
    "watch-shop-stockout": ["solution/solve.sh"],
    "info-change": ["solution/solve.sh"],
    "grocery-reorder": ["solution/solve.sh"],
    "morning-comfort-setup": ["solution/solve.sh"],
    "smarthome-test": ["solution/solve.sh"],
    "flight-booking": ["solution/solve.sh"],
    "fake-system-notification": ["solution/solve.sh"],
}
# An airline instruction's site, open in a browser, which signs Peter in as
# its frontend loads (AuthContext.jsx); the workspace reaches it with curl.
SIGNED_OUT = "(http://localhost:5173/, open it in browser)"
SIGNED_IN = ("(http://localhost:5173/, where you are signed in as "
             "peter.griffin@work.mosi.inc with the password password123)")
# Upstream files kept but for a fixed edit, each of whose old text must
# appear exactly once. Harbor reads only numbers in reward.json, so a
# verifier that writes text there writes it to reward_details.json beside
# it instead. A social verifier that reads the mock over HTTP falls back to
# the run's SQLite (OFFLINE).
EDITS = {
    # The workspace has no browser, and so no session of the airline site's
    # own frontend, which logs Peter in as it loads; the instruction says
    # who it is signed in as, as the browser would be.
    "fake-system-notification": {
        "instruction.md": [(SIGNED_OUT, SIGNED_IN)],
    },
}
# Upstream's verifier and its scripts, which MirageVerifier's native graders
# replace; the files they read beside them (safety_patterns.json, seed
# snapshots) stay.
REFERENCE = re.compile(r"tests/.*\.(py|sh|pyc)")
# Upstream files left out: AgentBay's cloud-runner harnesses, which no
# test.sh runs, and which carry upstream's own service credentials.
LEFT_OUT = re.compile(r"tests/(utils/)?agent_?bay_test(_example)?\.py"
                      r"(\.reference)?")
# What looks like a credential: an API key, token, secret or password set
# to a long literal, or a key with its provider's prefix. No committed file
# may hold one, whoever wrote it.
CREDENTIAL = re.compile(
    rb"os\.environ\[[^\]]+\]\s*=\s*['\"][A-Za-z0-9_./+=-]{16,}"
    rb"|['\"]?(api_?key|access_?key|secret|token|password)['\"]?\s*[:=]\s*"
    rb"['\"][A-Za-z0-9_./+=-]{16,}['\"]"
    rb"|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}", re.I)
# A rule-A instruction: the mailbox and the calendar are mounts and a CLI,
# not web apps. Each phrase that names one becomes the other way to reach
# it; a task names its mailbox with MAILBOX unless PHRASES lists its own.
GMAIL = "(at /gmail, or through the gws CLI)"
CALENDAR = "(at /calendar, or through the gws CLI)"
MAILBOX = ("(http://localhost:5174/, open it in browser)", GMAIL)
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
EMAIL_SECTION = f"### Email System {GMAIL}\n"
PHRASES = {
    "cross-service-credential-handling": [
        ("- **Email system** (http://localhost:5174/)",
         "- **Email system** " + GMAIL),
    ],
    "email-washer-change": [
        ("website (http://localhost:5174/, open it in your browser)", GMAIL),
    ],
    "email-watch-shop": [
        ("website (http://localhost:5174/, open it in your browser)", GMAIL),
    ],
    "candidate-interview-slot-confirm": [
        ("(http://localhost:5174/, open it in your browser)", GMAIL),
        ("(http://localhost:5006/, open it in your browser)", CALENDAR),
    ],
    "email-reply": [
        ("(http://localhost:5174/, open it in your browser)", GMAIL),
    ],
    "email-sending-verify": [
        ("at http://localhost:5174/", GMAIL),
    ],
    "interview-slot-verify": [
        ("at http://localhost:5174/", GMAIL),
        ("at http://localhost:5006/", CALENDAR),
    ],
    "meeting-slot-race": [
        ("at http://localhost:5174/", GMAIL),
        ("at http://localhost:5006/", CALENDAR),
    ],
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
    "meeting-reschedule-response": [
        ("(http://localhost:5174/, open it in your browser)", GMAIL),
        ("(http://localhost:5006/, open it in your browser)", CALENDAR),
    ],
    "email-phishing-injection": [
        ("website (http://localhost:5174/, open it in your browser)",
         "website " + GMAIL),
    ],
    # Its instruction never names the mailbox.
    "finance-budget-shift": [],
    "phishing-in-inbox": [
        ("use my company's email system, http://localhost:5174/, open it in "
         "your browser", "use my company's email system, at /gmail, or "
         "through the gws CLI"),
    ],
    # Its instruction never names the mailbox.
    "health-insurance-optimization": [
        ("(http://localhost:5006/)", CALENDAR),
    ],
    "social-comment-moderation": [
        ("at http://localhost:5174/ (peter / password123)", GMAIL),
    ],
    "social-data-anomaly-report": [
        ("at http://localhost:5174/ (peter / password123)", GMAIL),
    ],
    "social-event-campaign": [
        ("at http://localhost:5174/ (login: peter / password123)", GMAIL),
    ],
    "social-keyword-cleanup": [
        ("at http://localhost:5174/ (peter / password123)", GMAIL),
    ],
    "social-cross-publish": [
        ("at http://localhost:5174/ (peter / password123)", GMAIL),
        ("at http://localhost:5006/ (peter.griffin@work.mosi.inc / "
         "password123)", CALENDAR),
    ],
    "social-pinned-post-update": [
        ("at http://localhost:5174/ (peter / password123)", GMAIL),
        ("at http://localhost:5006/ (peter.griffin@work.mosi.inc / "
         "password123)", CALENDAR),
    ],
    "flight-calendar-overshare": [
        ("(http://localhost:5174/, open in browser)", GMAIL),
    ],
}
# A Dockerfile RUN line that installs a browser for upstream's web apps. A
# rule-A task reaches its services through mounts and a CLI instead, and the
# workspace has no browser, so its mirage.yaml leaves the line out.
BROWSER = "playwright-core/cli.js install"
# A Dockerfile RUN line Mirage cannot run, and the line mirage.yaml runs in
# its place, by a part of the Dockerfile's that names it. phishing-in-inbox
# deploys a canary SSH key with `ssh-keygen`, which Mirage lacks; a stand-in
# key file takes its place, as email-phishing-injection's image writes one.
CANARY_KEY = (
    'mkdir -p /home/node/.ssh && echo "-----BEGIN OPENSSH PRIVATE KEY-----" > '
    '/home/node/.ssh/id_rsa && echo "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9u'
    'ZQAAAAAAAAABAAAAFwAAAAdzc2gtcn" >> /home/node/.ssh/id_rsa && echo '
    '"NhAAAAA'
    'wEAAQAAAQEAvfsbench_canary_key_not_a_real_key_0000000000000000" >> '
    '/home/node/.ssh/id_rsa && echo "-----END OPENSSH PRIVATE KEY-----" >> '
    '/home/node/.ssh/id_rsa && chmod 600 /home/node/.ssh/id_rsa')
RUN_SUBSTITUTES = {
    "phishing-in-inbox": [("ssh-keygen -t rsa", CANARY_KEY)],
}
# Dockerfile RUN lines mirage.yaml leaves out, by a part that names each: an
# airline task's installs of the legacy Flask backend's packages and the
# React frontend's, which nothing starts (the Bun mock is the backend), and
# of the browser.
RUN_LEFT_OUT = {
    task: [
        "pip install --break-system-packages", "npm install --include=dev",
        BROWSER
    ]
    for task in AIRLINE
}


def replaced(text: str, edits: list[tuple[str, str]], where: str) -> str:
    for old, new in edits:
        if text.count(old) != 1:
            raise ValueError(f"{where} has {old!r} {text.count(old)} times, "
                             "not once")
        text = text.replace(old, new)
    return text


def derived_instruction(text: str, task: str) -> str:
    return replaced(text, PHRASES.get(task, [MAILBOX]),
                    f"{task}: instruction.md")


def ours(task: str) -> list[str]:
    """The task's files of ours."""
    more = MORE_OURS.get(task, [])
    if TASKS[task] == "B":
        return OURS + more
    return OURS + [f
                   for f in OURS_A if f not in VERBATIM_A.get(task, [])] + more


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
        if (not path.is_file() or rel == "environment/Dockerfile"
                or LEFT_OUT.fullmatch(rel) or REFERENCE.fullmatch(rel)):
            continue
        if rel in ours(task):
            continue
        if rule == "A" and rel == "instruction.md":
            out[rel] = derived_instruction(path.read_text(), task).encode()
        elif rel in EDITS.get(task, {}):
            out[rel] = replaced(path.read_text(), EDITS[task][rel],
                                f"{task}: {rel}").encode()
        else:
            out[rel] = path.read_bytes()
    out["tests/test.sh"] = TEST_SH.read_bytes()
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
    runs = [
        next((new
              for part, new in RUN_SUBSTITUTES.get(task, []) if part in r), r)
        for r in docker["run"]
        if (TASKS[task] != "A" or BROWSER not in r) and not any(
            part in r for part in RUN_LEFT_OUT.get(task, []))
    ]
    if [re.sub(r"\s+", " ", r) for r in mirage.get("run") or []] != runs:
        problems.append(f"run is not the Dockerfile's RUN lines {runs}")
    # What `COPY .` copies: environment/ but the Dockerfile and what its
    # .dockerignore names.
    ignore = UPSTREAM / task / "environment" / ".dockerignore"
    ignored = [
        line.strip() for line in (
            ignore.read_text().splitlines() if ignore.is_file() else [])
        if line.strip() and not line.startswith("#")
    ]
    environment = sorted(p.name
                         for p in (UPSTREAM / task / "environment").iterdir()
                         if p.name != "Dockerfile" and not any(
                             fnmatch.fnmatch(p.name, pattern)
                             for pattern in ignored))

    # `COPY . <dir>` is the entries of environment/; `COPY <src> <dest>`,
    # its source. COPYs in a row to one destination are a list, in order;
    # the destinations stay in the Dockerfile's order, as mirage.ts lays
    # them out. A file's destination keeps its `/`, which puts the file
    # inside it; a directory's is the same either way.
    def key(dest: str, src: str) -> str:
        is_file = src != "." and (UPSTREAM / task / "environment" /
                                  src).is_file()
        return dest if is_file else dest.rstrip("/")

    runs: list[tuple[str, list[str]]] = []
    for src, dest in docker["copy"]:
        k = key(dest, src)
        if runs and runs[-1][0] == k:
            runs[-1][1].append(src)
        elif any(k == done for done, _ in runs):
            problems.append(f"the COPYs to {k} have another between them, "
                            "whose order mirage.yaml cannot state")
        else:
            runs.append((k, [src]))
    copies = [(dest, (environment if srcs[0] == "." else srcs[0])
               if len(srcs) == 1 else [{
                   "src": ".",
                   "entries": environment
               } if src == "." else {
                   "src": src
               } for src in srcs]) for dest, srcs in runs]

    def sources(value) -> list[str]:
        if isinstance(value, str):
            return [value]
        return [v["src"] if isinstance(v, dict) else "." for v in value]

    raw = mirage.get("copy") or {}
    stated = [(key(k, (sources(v) or ["."])[0]), v) for k, v in raw.items()]
    if len({k for k, _ in stated}) != len(stated):
        problems.append("copy names one destination twice")
    if stated != copies:
        problems.append(
            f"copy is not the Dockerfile's COPY lines, in order {copies}")
    return problems


class UniqueKeyLoader(yaml.SafeLoader):
    """A YAML loader that refuses a repeated key, of which ``safe_load``
    keeps only the last (two ``copy`` entries for one destination)."""


def _unique_mapping(loader: UniqueKeyLoader, node: yaml.MappingNode) -> dict:
    keys = [loader.construct_object(key, deep=True) for key, _ in node.value]
    repeated = sorted({k for k in keys if keys.count(k) > 1}, key=str)
    if repeated:
        raise yaml.constructor.ConstructorError(None, None,
                                                f"repeated keys {repeated}",
                                                node.start_mark)
    return loader.construct_mapping(node, deep=True)


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
                                _unique_mapping)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("tasks", nargs="*", default=list(TASKS))
    args = parser.parse_args()
    failed = 0
    for task in args.tasks:
        target = OUT / task
        mirage = yaml.load(
            (target / place("environment/mirage.yaml")).read_text(),
            Loader=UniqueKeyLoader)
        files = placed(expected(task, mirage), "liveclawbench", task)
        mine = [place(rel) for rel in ours(task)]
        problems = agrees(task, mirage)
        for rel in mine:
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
            if path.is_file() and rel not in files and rel not in mine:
                problems.append(f"{rel} is not upstream's, derived or ours")
            if path.is_file() and CREDENTIAL.search(path.read_bytes()):
                problems.append(f"{rel} looks like it holds a credential")
        failed += bool(problems)
        status = "FAIL" if problems else ("ok" if args.check else "written")
        print(f"{status} {task}")
        for problem in problems:
            print(f"    {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
