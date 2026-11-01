"""Write the ERPBench-100 tasks from upstream, or check them.

    uv run --project datasets/erpbench python -I datasets/erpbench/fetch.py
    uv run --project datasets/erpbench \
        python -I datasets/erpbench/generate.py [--check] [task ...]

ERPBench-100 (blobfishai/erp-agent-simulation ``5bdf458``, code Apache-2.0,
data CC BY 4.0) is 100 tasks over one synthetic ERP world per task: six
systems (``erpbench``, ``oracle_fusion``, ``gmail``, ``google_drive``,
``google_sheets``, ``slack``), 52 tools over one SQLite file, graded on the
world's end state, the agent's answers and its call trace. Here the world
is one kit fake, ``mocks/erpbench/``, a TypeScript port of upstream's tools
over the same SQLite tables; each system is a CLI (``workspace/tools.ts``).
``graders/index.ts`` grades natively (``MirageVerifier``): a port of
upstream's grader.

Each task under ``datasets/erpbench/<task>/`` has:

- ``instruction.md``: upstream's instruction, verbatim, then the tools as
  the CLIs carry them.
- ``task.toml``, ``environment/mirage.yaml``, ``environment/tools.json``,
  ``environment/kit/erpbench.json`` (the fake's fixture, the task's id)
  and ``tests/test.sh``, the stub (``formats/harbor/test.sh``).
- ``tests/task.json``: upstream's task, which the native grader reads (its
  expected answers and rubric). Not committed (``.gitignore``).
- ``solution/solve.sh``: upstream's oracle steps as CLI calls. Not committed.

It also writes ``jobs/harbor.yaml`` and the native grader's manifest,
``graders/manifest.json``: upstream's scoring constants, and per task the
hash of its input (``tests/task.json``) and the fake's state-view queries.

And what the fake reads outside the workspace,
``state/erpbench/kit/<task>.json``: the world upstream seeds for the task
(its SQLite as SQL), the task fields and world model upstream's tools read,
and the tools. The run's database never reaches the workspace; the grader
reads the world through the fake's private state view.

``--check`` writes nothing and exits 1 if a file differs from what upstream
gives, or if a file is unaccounted for. It names each file by its place in
Harbor's layout (``environment/mirage.yaml``, ``tests/<file>``);
``datasets/layout.py`` lays them out in the task's ``workspace/`` and
``harbor/``.
"""
import argparse
import hashlib
import json
import shlex
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE
STATE = ROOT / "state" / "erpbench"
UPSTREAM = (STATE / "src" / "benchmark" / "erpbench100" / "release" /
            "harbor" / "tasks")
KIT = STATE / "kit"
TEST_SH = ROOT / "formats" / "harbor" / "test.sh"
MANIFEST = HERE / "graders" / "manifest.json"
COMMIT = "5bdf458165fee71f6a7965ea30ca33dfbbce1332"
SERVERS = ("erpbench", "oracle_fusion", "gmail", "google_drive",
           "google_sheets", "slack")
# The task fields upstream's tools read (ErpWorld._dispatch); the rest
# (expected answers, rubric, required investigations) is the grader's.
RUNTIME_TASK = ("task_id", "prompt", "tenant_code", "company", "answer_schema",
                "decision_options", "status_options", "register_contract",
                "allowed_write_tools")

sys.path.insert(0, str(HERE.parent))
from layout import placed  # noqa: E402

sys.path.insert(0, str(UPSTREAM / "erpbench-001" / "tests"))
from erpbench100.evaluation import COMMON_WRITE_TABLES  # noqa: E402
from erpbench100.evaluation import FAMILY_WRITE_TABLES  # noqa: E402
from erpbench100.spec import AS_OF  # noqa: E402
from erpbench100.spec import METRIC  # noqa: E402
from erpbench100.spec import NUMERIC_FIELDS  # noqa: E402
from erpbench100.spec import SCORING_CATEGORIES  # noqa: E402
from erpbench100.spec import world_model  # noqa: E402
from erpbench100.world import IMMUTABLE_TABLES  # noqa: E402
from erpbench100.world import WRITE_TOOLS  # noqa: E402
from erpbench100.world import ErpWorld  # noqa: E402
from erpbench100.world import tool_definitions  # noqa: E402

# Mirage registers a `slack` CLI of its own, and a name is registered once.
CLI_NAMES = {"slack": "slack-tools"}


def cli(server: str) -> str:
    return CLI_NAMES.get(server, server.replace("_", "-"))


def flag(param: str) -> str:
    return "--" + param.replace("_", "-")


def command(tool: str) -> str:
    """``oracle_fusion.sales_orders.create`` as
    ``oracle-fusion sales-orders create``."""
    server, *rest = tool.split(".")
    return " ".join([cli(server)] + [part.replace("_", "-") for part in rest])


def tools_json(tools: list[dict]) -> list[dict]:
    return [{
        "name":
        cli(server),
        "description":
        f"ERPBench's {server} tools.",
        "tools": [{
            "name": t["name"].split(".", 1)[1],
            "call": t["name"],
            "description": t["description"],
            "parameters": t["inputSchema"],
            "endpoint": {
                "url": f"http://erpbench/{t['name']}",
                "method": "POST"
            },
        } for t in tools if t["name"].split(".", 1)[0] == server],
    } for server in SERVERS]


TOOLS_INTRO = (
    "## Tools\n"
    "\n"
    "The connected systems are CLIs, one per system: `erpbench`,\n"
    "`oracle-fusion`, `gmail`, `google-drive`, `google-sheets` and\n"
    "`slack-tools` (`<cli> <command> --help` lists a command's\n"
    "flags). Each command is one of the system's tools, and each\n"
    "flag the tool's parameter of the same name; an object, or a\n"
    "list of objects, takes a JSON string.\n")


def instruction(upstream: str, tools: list[dict]) -> str:
    listed = "\n".join(f"- `{command(t['name'])}`: "
                       f"{t['description'].splitlines()[0]}" for t in tools)
    return f"{upstream.rstrip()}\n\n{TOOLS_INTRO}\n{listed}\n"


def task_toml(task: dict) -> str:
    meta = task["metadata"]
    return f"""version = "1.0"

[metadata]
category = "{meta['category']}"
upstream = "blobfishai/erp-agent-simulation@{COMMIT[:7]} {task['task_id']}"

[verifier]
timeout_sec = 120.0

[agent]
timeout_sec = 1200.0

[environment]
build_timeout_sec = 300.0
cpus = 1
memory_mb = 2048
storage_mb = 2048
# The agent reaches the world through the systems' CLIs alone; curl and
# wget are off (environment/mirage.yaml).
allow_internet = false
"""


def mirage_yaml(task_id: str) -> str:
    clis = "\n".join(f"    {cli(s)}: {{cli: {cli(s)}, config: "
                     "{url: '${ERPBENCH_URL}'}}" for s in SERVERS)
    head = (f"# {task_id}, on vfsbench_harbor's mirage environment "
            "(datasets/erpbench/generate.py writes it).")
    return f"""{head}
#
# The task's world is the erpbench kit fake (mocks/erpbench), seeded with
# the world upstream builds for the task (state/erpbench/kit/, outside the
# workspace), its clock at upstream's as-of time. Its tools are one CLI per
# system (tools.json, workspace/tools.ts). MirageVerifier grades it
# natively, from the fake's private state view.
fakes:
  erpbench:
    fixture: kit/erpbench.json
    epoch: '{AS_OF}'
tools:
  file: tools.json
  dispatches: /var/lib/mock-data/erpbench/dispatches.jsonl
workspace:
  profiles:
    default:
      commands:
        deny:
        - commands: [curl, wget]
          reason: the systems are reached through their CLIs
  clis:
{clis}
"""


def argument(name: str, value, schema: dict) -> list[str]:
    """One argument as the CLI's flags (workspace/cli.ts ``argumentFor``)."""
    kind = schema.get("type")
    if value is None:
        return []
    if kind == "boolean":
        return [flag(name), "true" if value else "false"]
    if kind == "array" and schema.get(
            "items", {}).get("type") in ("string", "integer", "number"):
        return [part for v in value for part in (flag(name), str(v))]
    if kind in ("object", "array") or isinstance(value, (dict, list)):
        return [flag(name), json.dumps(value, ensure_ascii=False)]
    return [flag(name), str(value)]


def solve_sh(task: dict, tools: list[dict]) -> str:
    schemas = {t["name"]: t["inputSchema"]["properties"] for t in tools}
    lines = [
        "#!/usr/bin/env bash", "# Upstream's oracle steps (tests/task.json "
        "oracle_steps) as CLI calls.", "set -euo pipefail"
    ]
    for step in task["oracle_steps"]:
        props = schemas[step["tool"]]
        args = [
            part for name, value in step.get("arguments", {}).items()
            for part in argument(name, value, props.get(name, {}))
        ]
        lines.append(" ".join([command(step["tool"])] +
                              [shlex.quote(a) for a in args]))
    return "\n".join(lines) + "\n"


def kit(task: dict, tools: list[dict]) -> dict:
    """What the fake reads for the task, outside the workspace."""
    with tempfile.TemporaryDirectory() as tmp:
        world = ErpWorld.create(task, Path(tmp) / "world.sqlite")
        sql = "\n".join(world.connection.iterdump())
        world.close()
    return {
        "task": {
            k: task[k]
            for k in RUNTIME_TASK
        },
        "model": world_model(task["tenant_code"]),
        "tools": tools,
        "sql": sql,
    }


def task_files(src: Path) -> tuple[dict[str, bytes], dict[str, bytes]]:
    """A task's files by their place in Harbor's layout: those committed,
    and those git ignores (upstream's data)."""
    task = json.loads((src / "tests" / "task.json").read_text())
    tools = tool_definitions(task["answer_schema"])
    committed = {
        "instruction.md":
        instruction((src / "instruction.md").read_text(), tools).encode(),
        "task.toml":
        task_toml(task).encode(),
        "environment/mirage.yaml":
        mirage_yaml(task["task_id"]).encode(),
        "environment/tools.json":
        (json.dumps(tools_json(tools), indent=1, ensure_ascii=False) +
         "\n").encode(),
        "environment/kit/erpbench.json":
        (json.dumps({"seed": [{
            "id": 1,
            "task": task["task_id"]
        }]}) + "\n").encode(),
        "tests/test.sh":
        TEST_SH.read_bytes(),
    }
    ignored = {
        "solution/solve.sh": solve_sh(task, tools).encode(),
        "tests/task.json": (src / "tests" / "task.json").read_bytes(),
    }
    return committed, ignored


def job_yaml(tasks: list[str]) -> str:
    lines = [
        "# All ERPBench-100 tasks: Mirage agents and native Mirage grading.",
        "# From vfs-bench-2/, after datasets/erpbench/fetch.py:",
        "#   uv run --project formats/harbor harbor run -c "
        "datasets/erpbench/jobs/harbor.yaml -a oracle -n 8",
        "environment:",
        "  import_path: vfsbench_harbor:MirageEnvironment",
        "verifier:",
        "  import_path: vfsbench_harbor:MirageVerifier",
        "tasks:",
    ]
    lines += [f"  - path: datasets/erpbench/{task}/harbor" for task in tasks]
    return "\n".join(lines) + "\n"


def manifest(tasks: dict[str, bytes]) -> dict:
    """The native grader's manifest: upstream's scoring constants, and per
    task the hash of its input and the fake's state-view queries."""
    return {
        "constants": {
            "metric": METRIC,
            "write_tools": sorted(WRITE_TOOLS),
            "immutable_tables": list(IMMUTABLE_TABLES),
            "common_write_tables": sorted(COMMON_WRITE_TABLES),
            "family_write_tables": {
                k: sorted(v)
                for k, v in FAMILY_WRITE_TABLES.items()
            },
            "numeric_fields": {
                k: list(v)
                for k, v in NUMERIC_FIELDS.items()
            },
            "scoring_categories": [row["key"] for row in SCORING_CATEGORIES],
        },
        "tasks": {
            name: {
                "native_state": {
                    "erpbench": {
                        "service": "erpbench",
                        "queries": ["baseline", "snapshot", "trace", "model"],
                    }
                },
                "files": {
                    "task.json": hashlib.sha256(task_json).hexdigest()
                },
                "inputs": ["/tests/task.json"],
                "trees": [],
            }
            for name, task_json in sorted(tasks.items())
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("tasks", nargs="*")
    args = parser.parse_args()
    failed = 0

    def put(path: Path, data: bytes) -> list[str]:
        if args.check:
            if not path.is_file():
                return [f"{path.relative_to(ROOT)} is missing"]
            if path.read_bytes() != data:
                return [f"{path.relative_to(ROOT)} differs from upstream's"]
            return []
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        if path.suffix == ".sh":
            path.chmod(0o755)
        return []

    every = sorted(p.name for p in UPSTREAM.glob("erpbench-*") if p.is_dir())
    for name in args.tasks or every:
        src = UPSTREAM / name
        if not src.is_dir():
            print(f"FAIL {name}: not an upstream task")
            failed += 1
            continue
        committed, ignored = task_files(src)
        files = placed(committed | ignored, "erpbench", name)
        target = OUT / name
        problems = [
            p for rel, data in files.items() for p in put(target / rel, data)
        ]
        task = json.loads((src / "tests" / "task.json").read_text())
        problems += put(
            KIT / f"{name}.json",
            (json.dumps(kit(task, tool_definitions(task["answer_schema"])),
                        ensure_ascii=False) + "\n").encode())
        for path in sorted(target.rglob("*")):
            rel = path.relative_to(target).as_posix()
            if path.is_file() and rel not in files:
                problems.append(f"{rel} is not generated")
        failed += bool(problems)
        print(f"{'FAIL' if problems else 'ok' if args.check else 'written'} "
              f"{name}")
        for problem in problems:
            print(f"    {problem}")
    # The job and the manifest are every task's, however many this writes.
    tasks = {
        name: (UPSTREAM / name / "tests" / "task.json").read_bytes()
        for name in every
    }
    for path, data in ((HERE / "jobs" / "harbor.yaml", job_yaml(every)),
                       (MANIFEST,
                        json.dumps(manifest(tasks), indent=1) + "\n")):
        for problem in put(path, data.encode()):
            print(f"FAIL {problem}")
            failed += 1
    print(f"{len(args.tasks or every)} tasks" +
          (f", {failed} failures" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
