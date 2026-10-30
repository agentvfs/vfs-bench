"""Write the committed EnterpriseOps-Gym tasks from upstream, or check them.

    uv run --project enterpriseops python -I enterpriseops/setup.py
    uv run --project enterpriseops python -I harbor/enterpriseops.py \
        [--check] [--domain <domain> ...] [task id ...]

Each task under ``harbor/tasks/enterpriseops/<task id>/`` is one row of the
Hugging Face dataset's ``oracle`` mode (ServiceNow-AI/EnterpriseOps-Gym,
pinned by ``enterpriseops/setup.py``, Apache-2.0): the task with exactly the
tools upstream selects for it (``selected_tools``). A domain is written once
each of its servers has a fake (``mocks/enterpriseops_<domain>/``):
``--domain`` names them, ``csm`` by default. Its files:

- ``instruction.md``: upstream's system prompt (the domain's policy) and
  user prompt, verbatim, as upstream's agent gets them, then the selected
  tools as the CLIs that carry them.
- ``task.toml``: the row.
- ``environment/mirage.yaml``: each of the task's servers as its kit fake,
  seeded from the row's seed (``gym_dbs.zip``), its tools a CLI
  (``harbor/tools.ts``) that calls as the row's user (``x-user-email``):
  the agent reaches the fake through that CLI alone, so neither another
  tool, another user nor the SQL runner. Upstream's port reaches the fake
  from the reference grader's VM only (``verifierPorts``). The trial's
  clock starts at the task's id's time.
- ``environment/kit/<service>.json``: each fake's fixture, the seed's path.
- ``environment/tools.json``: the tools, by CLI.
- ``tests/test.sh``, ``tests/grade.py`` (``enterpriseops_grade.py``),
  ``tests/verifiers.json`` (the row's verifiers, verbatim) and
  ``tests/ports.json``: upstream's SQL verifiers on each fake's SQL
  runner, the reference grader, for ``MicrosandboxVerifier``
  (``enterpriseops-msb.yaml``). ``enterpriseops.yaml`` grades natively
  instead (``MirageVerifier``, ``graders/enterpriseops.ts``), its
  definitions in ``graders/enterpriseops/manifest.json``, which this
  writes too, with each task's verifier queries and the hashes of the
  reference tests the native grader ports.
- ``solution/solve.sh``, where ``enterpriseops/solutions/<task id>.json``
  has one (upstream ships no reference solutions): its calls, each as the
  CLI line that makes it. ``harbor/enterpriseops_compare.py --task`` checks
  that one passes upstream's verifiers both on upstream's image and on the
  fake.

``--check`` writes nothing and exits 1 if a file differs from what upstream
gives, or if a file is unaccounted for.
"""
import argparse
import functools
import hashlib
import json
import re
import shlex
import sys
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
STATE = ROOT / "state" / "enterpriseops"
PORT = ROOT / "enterpriseops"
OUT = HARBOR / "tasks" / "enterpriseops"
GRADE = HARBOR / "enterpriseops_grade.py"
SOLUTIONS = PORT / "solutions"
MANIFEST = HARBOR / "graders" / "enterpriseops" / "manifest.json"
# The reference tests the native grader ports: MirageVerifier refuses a task
# whose files no longer hash as its definition says.
REFERENCE = ("test.sh", "grade.py", "verifiers.json", "ports.json")
DATASET = "ServiceNow-AI/EnterpriseOps-Gym@c8e538e"
MODE = "oracle"
DOMAINS = [
    "calendar", "csm", "drive", "email", "hr", "hybrid", "itsm", "teams"
]
DISPATCHES = "/var/lib/mock-data/enterpriseops/dispatches.jsonl"


@functools.cache
def servers() -> dict[str, dict]:
    """Each server's tool list and port, by upstream's name."""
    out = {}
    for path in sorted((PORT / "tools").glob("*.json")):
        spec = json.loads(path.read_text())
        out[spec["server"]] = spec
    return out


def service(server: str) -> str:
    """A server's kit fake: ``enterpriseops_csm``."""
    return f"enterpriseops_{servers()[server]['domain']}"


def faked(server: str) -> bool:
    return (ROOT / "mocks" / service(server) / "main.ts").is_file()


@functools.cache
def rows(domain: str) -> list[dict]:
    import pyarrow.parquet as pq
    out = []
    for row in pq.read_table(STATE / "hf" / MODE /
                             f"{domain}.parquet").to_pylist():
        for key in ("gym_servers_config", "verifiers"):
            if isinstance(row[key], str):
                row[key] = json.loads(row[key])
        out.append(row)
    return out


def tool_specs(row: dict) -> list[tuple[str, list[dict]]]:
    """The row's selected tools, by server, in each server's own order."""
    selected = set(row["selected_tools"])
    out = []
    for cfg in row["gym_servers_config"]:
        server = cfg["mcp_server_name"]
        tools = [
            t for t in servers()[server]["tools"] if t["name"] in selected
        ]
        out.append((server, tools))
    return out


def parameters(tool: dict) -> dict:
    """A tool's input schema as the CLI takes it: its properties and the
    required ones, less the database's id, which the server adds."""
    schema = tool.get("inputSchema") or {}
    props = {
        k: v
        for k, v in (schema.get("properties") or {}).items()
        if k != "database_id"
    }
    out = {"type": "object", "properties": props}
    required = [k for k in schema.get("required") or [] if k in props]
    if required:
        out["required"] = required
    return out


def tools_json(row: dict) -> list[dict]:
    return [{
        "name":
        server,
        "description":
        f"{server}'s tools.",
        "tools": [{
            "name": t["name"],
            "call": t["name"],
            "description": t.get("description") or "",
            "parameters": parameters(t),
            "endpoint": {
                "url":
                f"http://localhost:{servers()[server]['port']}/{t['name']}",
                "method": "POST"
            },
        } for t in tools],
    } for server, tools in tool_specs(row)]


def flag(param: str, schema: dict, required: bool) -> str:
    kind = schema.get("type")
    if kind is None and "anyOf" in schema:
        kinds = [
            s.get("type") for s in schema["anyOf"] if s.get("type") != "null"
        ]
        kind = kinds[0] if len(kinds) == 1 else "object"
    if kind == "array" and (schema.get("items")
                            or {}).get("type") not in ("string", "integer",
                                                       "number", None):
        kind = "object"
    value = {"array": "<value> ...", "object": "<JSON>"}.get(kind, f"<{kind}>")
    text = f"--{param.replace('_', '-')} {value}"
    return text if required else f"[{text}]"


def instruction(row: dict) -> str:
    lines = [
        row["system_prompt"].rstrip("\n"), "", "---", "",
        row["user_prompt"].rstrip("\n"), "", "## Tools", "",
        "Each tool is a shell command, `<server> <tool> [--flag value ...]`, "
        "whose output is the tool's reply; `<server> <tool> --help` says "
        "more.", ""
    ]
    for entry in tools_json(row):
        lines += [f"### {entry['name']}", ""]
        for t in entry["tools"]:
            params = t["parameters"].get("properties") or {}
            required = set(t["parameters"].get("required") or [])
            usage = " ".join(
                [entry["name"], t["name"].replace("_", "-")] +
                [flag(p, s, p in required) for p, s in params.items()])
            description = " ".join(t["description"].split())
            lines.append(f"- `{usage}`: {description}".rstrip(": "))
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def epoch(row: dict) -> str:
    """The trial's clock: the time in the task's id
    (``task_<date>_<time>``)."""
    m = re.match(r"task_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})",
                 row["task_id"])
    if not m:
        raise ValueError(f"no time in {row['task_id']}")
    y, mo, d, h, mi, s = m.groups()
    return f"{y}-{mo}-{d}T{h}:{mi}:{s}Z"


def task_toml(row: dict) -> str:
    servers_list = ", ".join(
        json.dumps(c["mcp_server_name"]) for c in row["gym_servers_config"])
    return f"""version = "1.0"

[metadata]
upstream = "{DATASET} {MODE}/{row['domain']} {row['task_id']}"
domain = "{row['domain']}"
servers = [{servers_list}]
category = "tool-use"

[verifier]
timeout_sec = 600.0

[agent]
timeout_sec = 1800.0

[environment]
build_timeout_sec = 300.0
cpus = 1
memory_mb = 2048
storage_mb = 4096
# The trial's services are its only network: without it, Harbor gives the
# verifier no routes to them either. The internet stays out.
allow_internet = true
"""


def fixture(cfg: dict) -> bytes:
    return (json.dumps({"seed": [{
        "id": 1,
        "db": cfg["seed_database_file"]
    }]},
                       indent=1) + "\n").encode()


def mirage_yaml(row: dict) -> str:
    lines = [
        f"# {row['task_id']}, EnterpriseOps-Gym's "
        f"{MODE}/{row['domain']} task, "
        "on vfsbench_harbor's",
        "# mirage environment (harbor/enterpriseops.py writes it).",
        "#",
        "# Each of the task's servers is its kit fake, seeded from the task's "
        "seed; its",
        "# selected tools are a CLI (harbor/tools.ts) that calls as the "
        "task's user, the",
        "# agent's only way to it. Upstream's port is the reference grader's "
        "alone, for",
        "# the SQL runner. The trial's clock starts at the task id's time.",
        "fakes:",
    ]
    for cfg in row["gym_servers_config"]:
        server = cfg["mcp_server_name"]
        lines += [
            f"  {service(server)}:",
            f"    fixture: kit/{service(server)}.json",
            f"    epoch: '{epoch(row)}'",
            f"    verifierPorts: [{servers()[server]['port']}]"
        ]
    lines += [
        "tools:", "  file: tools.json", f"  dispatches: {DISPATCHES}",
        "workspace:", "  clis:"
    ]
    for cfg in row["gym_servers_config"]:
        server = cfg["mcp_server_name"]
        url = "${" + service(server).upper() + "_URL}"
        headers = ", ".join(f"{k}: {json.dumps(str(v))}"
                            for k, v in context_headers(cfg).items())
        lines.append(f"    {server}: {{cli: {server}, config: {{url: '{url}', "
                     f"headers: {{{headers}}}}}}}")
    return "\n".join(lines) + "\n"


def context_headers(cfg: dict) -> dict[str, str]:
    """The row's context as upstream's client sends it, a header each: a key
    not starting ``x-`` becomes ``x-<key, dashed>``. Three rows' keys have a
    stray space (``' x-user-email'``), which no header name can carry: it
    is dropped here, so they call as the user they name."""
    out = {}
    for key, value in cfg.get("context", {}).items():
        key = key.strip()
        name = key if key.lower().startswith("x-") else (
            f"x-{key.lower().replace('_', '-')}")
        out[name.lower()] = str(value)
    return out


TEST_SH = """#!/usr/bin/env bash
# Upstream's SQL verifiers on each server's end state (grade.py), in
# MicrosandboxVerifier's VM; MirageVerifier runs its native port instead.
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py
"""


def expected(row: dict) -> dict[str, bytes]:
    """Every file this writes for a task, by path in its directory."""
    ports = {
        c["mcp_server_name"]: servers()[c["mcp_server_name"]]["port"]
        for c in row["gym_servers_config"]
    }
    out = {
        "instruction.md":
        instruction(row).encode(),
        "task.toml":
        task_toml(row).encode(),
        "environment/mirage.yaml":
        mirage_yaml(row).encode(),
        "environment/tools.json":
        (json.dumps(tools_json(row), ensure_ascii=False, indent=1) +
         "\n").encode(),
        "tests/test.sh":
        TEST_SH.encode(),
        "tests/grade.py":
        GRADE.read_bytes(),
        "tests/verifiers.json":
        (json.dumps(row["verifiers"], ensure_ascii=False, indent=1) +
         "\n").encode(),
        "tests/ports.json": (json.dumps(ports, indent=1) + "\n").encode(),
    }
    for cfg in row["gym_servers_config"]:
        kit = f"environment/kit/{service(cfg['mcp_server_name'])}.json"
        out[kit] = fixture(cfg)
    solve = SOLUTIONS / f"{row['task_id']}.json"
    if solve.is_file():
        out["solution/solve.sh"] = solution(row, json.loads(solve.read_text()))
    return out


def solution(row: dict, calls: list[dict]) -> bytes:
    """A solution's calls (``[{"tool": ..., "args": {...}}]``, ``server``
    where the task has two) as a script, one CLI line each."""
    default = row["gym_servers_config"][0]["mcp_server_name"]
    lines = [
        "#!/usr/bin/env bash",
        f"# A solution of {row['task_id']}, written for this port "
        "(enterpriseops/solutions/);",
        "# it passes upstream's verifiers on upstream's image and on the "
        "fake."
    ]
    for call in calls:
        lines.append(
            command(call.get("server", default), call["tool"],
                    call.get("args") or {}))
    return ("\n".join(lines) + "\n").encode()


def command(server: str, tool: str, args: dict) -> str:
    """One call as a CLI line: a list of scalars a flag per item, an object
    or a list of objects as JSON."""
    spec = next(t for t in servers()[server]["tools"] if t["name"] == tool)
    schema = parameters(spec)["properties"]
    parts = [server, tool.replace("_", "-")]
    for name, value in args.items():
        if value is None:
            continue
        kind = schema.get(name, {}).get("type")
        flag_name = f"--{name.replace('_', '-')}"
        if kind == "array" and isinstance(value, list) and all(
                isinstance(v, (str, int, float)) for v in value):
            for v in value:
                parts += [flag_name, shlex.quote(str(v))]
        elif isinstance(value, (dict, list)):
            parts += [
                flag_name,
                shlex.quote(json.dumps(value, ensure_ascii=False))
            ]
        else:
            text = json.dumps(value) if isinstance(value, bool) else str(value)
            parts += [flag_name, shlex.quote(text)]
    return " ".join(parts)


def definition(row: dict, files: dict[str, bytes]) -> dict:
    """A task's native grading definition (``MirageVerifier``,
    ``graders/enterpriseops.ts``): each server's verifier queries, in order,
    which its fake answers in its state view, and the reference tests'
    hashes."""
    state = {}
    for cfg in row["gym_servers_config"]:
        server = cfg["mcp_server_name"]
        state[server] = {
            "service":
            service(server),
            "queries": [
                v["validation_config"]["query"] for v in row["verifiers"]
                if v.get("verifier_type") == "database_state"
                and v.get("gym_name") == server
            ],
        }
    return {
        "native_state": state,
        "files": {
            name: hashlib.sha256(files[f"tests/{name}"]).hexdigest()
            for name in REFERENCE
        },
        "inputs": ["/tests/verifiers.json"],
        "trees": [],
    }


def manifest(chosen: list[dict]) -> bytes:
    tasks = {r["task_id"]: definition(r, expected(r)) for r in chosen}
    return (json.dumps(
        {"tasks": dict(sorted(tasks.items()))}, indent=1, ensure_ascii=False) +
            "\n").encode()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--domain", action="append", choices=DOMAINS)
    parser.add_argument("tasks", nargs="*")
    args = parser.parse_args()
    every = [
        r for d in (args.domain or ["csm"]) for r in rows(d) if all(
            faked(c["mcp_server_name"]) for c in r["gym_servers_config"])
    ]
    chosen = [r for r in every if not args.tasks or r["task_id"] in args.tasks]
    failed = 0
    for row in chosen:
        target = OUT / row["task_id"]
        files = expected(row)
        problems = []
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
                if rel.endswith(".sh"):
                    path.chmod(0o755)
        for path in sorted(target.rglob("*")):
            rel = path.relative_to(target).as_posix()
            if path.is_file() and rel not in files:
                problems.append(f"{rel} is not generated")
        failed += bool(problems)
        status = "FAIL" if problems else ("ok" if args.check else "written")
        print(f"{status} {row['task_id']}")
        for problem in problems:
            print(f"    {problem}")
    # The manifest is every task's, however many this writes or checks.
    data = manifest(every)
    if args.check:
        if not MANIFEST.is_file() or MANIFEST.read_bytes() != data:
            print(f"FAIL {MANIFEST.relative_to(ROOT)} differs from the tasks'")
            failed += 1
    else:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_bytes(data)
    print(f"{len(chosen)} tasks")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
