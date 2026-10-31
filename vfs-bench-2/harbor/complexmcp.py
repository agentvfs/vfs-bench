"""Write the committed ComplexMCP tasks from upstream, or check them.

    # upstream, into state/:
    uv run --project complexmcp python -I complexmcp/setup.py
    uv run --project complexmcp python -I harbor/complexmcp.py \
        [--check] [task ...]

Each task under ``harbor/tasks/complexmcp/<slug>/`` is one row of
upstream's ``benchmark/data/data.parquet`` (ATH-MaaS/complex-mcp, pinned by
``complexmcp/setup.py``, MIT). Its files are generated from upstream:

- ``instruction.md``: upstream's query, verbatim, then the tools upstream's
  client lists for the model, as the CLIs that carry them.
- ``task.toml``: the row, its level and apps.
- ``environment/mirage.yaml``: each of upstream's 15 servers as its kit fake
  (``mocks/complexmcp_<server>``) at upstream's port, its tools as a CLI
  (``harbor/tools.ts``).
- ``environment/kit/login.json``: the task's login, the seed and the apps
  in order, which each Light app's fake makes its session from;
  ``environment/kit/none.json``, the plain servers', which keep nothing.
- ``environment/tools.json``: the tools, by CLI.
- ``tests/test.sh``: the stub (``harbor/test.sh``). ``MirageVerifier`` runs
  upstream's judge, over what each app's login and logout answer and the
  row's expected environment, on Monty in a separate Mirage workspace.
- ``solution/solve.sh``: the reference trajectory, each tool call as the
  CLI that makes it (``ORACLES``), or ours, by hand, where its second line
  says so (``OURS``).

``--check`` writes nothing and exits 1 if a file differs from what upstream
gives, or if a file is unaccounted for.
"""
import argparse
import functools
import importlib.util
import json
import shlex
import subprocess
import sys
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
STATE = ROOT / "state" / "complexmcp"
UPSTREAM = STATE / "src"
OURS = b"\n# Ours, written by hand through the CLIs.\n"
OUT = HARBOR / "tasks" / "complexmcp"
TEST_SH = HARBOR / "test.sh"
COMMIT = "7c01f92"

# Each task, by slug: the row of data.parquet. The pre-Harbor port's
# eleven keep their slugs (complexmcp/<slug>/task.json).
TASKS = {
    "mark-sean-baker-read": 0,
    "good-morning-paisley": 1,
    "family-group-airpods": 2,
    "mila-garza-unread": 3,
    "like-jeremy-latest-moment": 4,
    "neighbors-group-silas-owner": 5,
    "share-dennis-contact-jonah": 6,
    "delete-deborah-chat": 7,
    "remove-silent-classmates": 8,
    "unblock-relatives": 9,
    "new-york-ip-hello-moment": 10,
    "like-dennis-singapore-posts": 11,
    "family-and-classmate-groups": 12,
    "gcd-to-hayden-parker": 13,
    "inches-to-cm-to-self": 14,
    "ten-kg-seedless-grapes": 15,
    "max-seedless-grapes-star": 16,
    "max-grapes-star-seedless-shop": 17,
    "apple-watch-delete-history": 18,
    "hello-contacts-with-x": 19,
    "sha256-uid-moment": 20,
    "business-flight-sf-ny": 21,
    "banana-peppers-per-neighbor": 22,
    "larsson-book-per-teammate": 23,
    "cheapest-black-apples": 24,
    "sony-headphones-star": 25,
    "date-depot-dates": 26,
    "cheapest-90kg-limes": 27,
    "cheapest-mini-steamer": 28,
    "mint-100g": 29,
    "gala-apples-per-relative": 30,
    "priciest-pineapple-per-classmate": 31,
    "fashion-brand-days-chickpeas": 32,
    "replace-broken-mouse": 33,
    "cheapest-4-person-tent": 34,
    "mangosteen-and-mango": 35,
    "ipad-m-series": 36,
    "homecoming-play-endive": 37,
    "macbook-air-if-affordable": 38,
    "nikon-camera": 39,
    "cheapest-arugula": 40,
    "new-york-sun-rate": 41,
    "singapore-flight-by-weather": 42,
    "nike-to-20-shares": 43,
    "tech-stocks-flight-bitter-gourd": 44,
    "liquidate-short-news-flight": 45,
    "butternut-new-year-messages": 46,
}

# Upstream's servers, in its configuration's order (config/general.yaml),
# which is also the order its client lists their tools in: each its port,
# its source and, for a Light app, its tool descriptions.
SERVERS = {
    "MathServer": (8000, "servers/math/app.py", None),
    "UnitServer": (8001, "servers/unit/app.py", None),
    "OSINTServer": (8002, "servers/osint/app.py", None),
    "TimeServer": (8003, "servers/time/app.py", None),
    "LangServer": (8004, "servers/lang/app.py", None),
    "CryptoServer": (8005, "servers/crypto/app.py", None),
    "GraphServer": (8006, "servers/graphs/app.py", None),
    "ChemServer": (8007, "servers/chem/app.py", None),
    "LightSystem":
    (9000, "software/LightSystem/app.py", "software/LightSystem/desc.json"),
    "LightTalk":
    (9001, "software/LightTalk/app.py", "software/LightTalk/desc.json"),
    "LightShop":
    (9002, "software/LightShop/app.py", "software/LightShop/desc.json"),
    "LightWeather":
    (9003, "software/LightWeather/app.py", "software/LightWeather/desc.json"),
    "LightFlight": (9004, "software/LightFlight/app.py",
                    "software/LightFlight/desc.json"),
    "LightStock": (9005, "software/LightStock/app.py",
                   "software/LightStock/desc.json"),
    "LightNews": (9006, "software/LightNews/app.py",
                  "software/LightNews/desc.json"),
}
LIGHT = [s for s, (_, _, desc) in SERVERS.items() if desc]
# Tools upstream's client never lists for the model: its own login and
# logout, and the clock's internals, which only the apps call.
HIDDEN = {"login", "logout", "_step", "_gen_past"}
# Where each tool CLI's calls are logged (harbor/tools.ts), which no
# verifier reads: the judge reads the apps' environments.
DISPATCHES = "/var/lib/mock-data/complexmcp/dispatches.jsonl"
EMPTY_FIXTURE = b"{}\n"


def service(server: str) -> str:
    """A server's kit fake: `complexmcp_talk`, `complexmcp_math`. Short, as
    the fake's socket paths under the temporary directory must be."""
    return "complexmcp_" + server.lower().removeprefix("light").removesuffix(
        "server")


def cli(server: str) -> str:
    """A server's CLI, as the pre-Harbor port named it: `light-talk`,
    `math-server`."""
    out = ""
    for i, ch in enumerate(server):
        if ch.isupper() and i > 0 and (server[i - 1].islower() or
                                       (i + 1 < len(server)
                                        and server[i + 1].islower())):
            out += "-"
        out += ch.lower()
    return out


def rows() -> list[dict]:
    import pyarrow.parquet as pq
    return pq.read_table(UPSTREAM / "benchmark" / "data" /
                         "data.parquet").to_pylist()


DUMP = """
import asyncio, importlib, importlib.util, json, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
if sys.argv[3].startswith("servers/unit/"):
    mcp = importlib.import_module("servers.unit.app").app
else:
    spec = importlib.util.spec_from_file_location("app", sys.argv[3])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    mcp = module.mcp
tools = asyncio.run(mcp.get_tools())
print(json.dumps([{"name": t.name, "description": t.description,
                   "parameters": t.parameters} for t in tools.values()]))
"""


@functools.cache
def mcp_tools(server: str) -> list[dict]:
    """A server's tools as its MCP server lists them, in order."""
    path = SERVERS[server][1]
    out = subprocess.run([
        sys.executable, "-I", "-c", DUMP,
        str(UPSTREAM),
        str(UPSTREAM / Path(path).parent), path
    ],
                         cwd=UPSTREAM,
                         capture_output=True,
                         text=True,
                         check=True)
    return json.loads(out.stdout)


@functools.cache
def light_tools(app: str) -> list[dict]:
    """A Light app's tools as its ``desc.json`` describes them."""
    return json.loads((UPSTREAM / SERVERS[app][2]).read_text())


def listed(server: str) -> list[dict]:
    """The tools upstream's client lists for a server, in order: a Light
    app's from its desc.json, a plain server's from its MCP server."""
    if SERVERS[server][2]:
        return [{
            "name": t["tool_name"],
            "description": t["description"]
        } for t in light_tools(server) if t["tool_name"] not in HIDDEN]
    return [{
        "name": t["name"],
        "description": t["description"]
    } for t in mcp_tools(server)]


@functools.cache
def registry() -> dict[str, tuple[str, str]]:
    """Upstream's Toolbox's names: a tool's own, or, where a server before
    it has one, prefixed with its server's (``LightFlight_check_balance``)."""
    out: dict[str, tuple[str, str]] = {}
    for server in SERVERS:
        tools = ([t["tool_name"]
                  for t in light_tools(server)] if SERVERS[server][2] else
                 [t["name"] for t in mcp_tools(server)])
        for tool in tools:
            key = tool
            while key in out:
                key = f"{server}_{key}"
            out[key] = (server, tool)
    return out


def parameters(server: str, tool: str) -> dict:
    """A tool's parameters as its MCP server types them, less the session,
    with a Light app's descriptions from its desc.json. A list of scalars
    the CLI is given no value for is an empty one, since a repeatable flag
    cannot say []: it is not required, and the fakes take it as []."""
    schema = next(t for t in mcp_tools(server)
                  if t["name"] == tool)["parameters"]
    props = {
        k: dict(v)
        for k, v in (schema.get("properties") or {}).items()
        if k != "session_id"
    }
    required = [k for k in schema.get("required") or [] if k in props]
    if SERVERS[server][2]:
        desc = next(t for t in light_tools(server) if t["tool_name"] == tool)
        for name, spec in desc.get("arguments", {}).items():
            if name in props and spec.get("description"):
                props[name]["description"] = spec["description"]
    for name, spec in props.items():
        scalar = (spec.get("items")
                  or {}).get("type") in ("string", "number", "integer")
        if spec.get("type") == "array" and scalar and name in required:
            required.remove(name)
            spec["default"] = []
    out = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


def tools_json() -> list[dict]:
    """Every server's tools, by CLI, as harbor/tools.ts reads them."""
    out = []
    for server, (port, _, _) in SERVERS.items():
        out.append({
            "name":
            cli(server),
            "description":
            f"{server}'s tools.",
            "tools": [{
                "name": t["name"],
                "call": t["name"],
                "description": t["description"],
                "parameters": parameters(server, t["name"]),
                "endpoint": {
                    "url": f"http://localhost:{port}/{t['name']}",
                    "method": "POST"
                },
            } for t in listed(server)],
        })
    return out


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
    """Upstream's query, then each tool upstream's client lists, as the CLI
    that carries it."""
    lines = [
        row["query"].rstrip("\n"), "", "## Tools", "",
        "Each tool is a shell command, `<server> <tool> [--flag value ...]`, "
        "whose output is the tool's reply; `<server> <tool> --help` says "
        "more.", ""
    ]
    for entry in tools_json():
        lines += [f"### {entry['name']}", ""]
        for t in entry["tools"]:
            params = t["parameters"].get("properties") or {}
            required = set(t["parameters"].get("required") or [])
            usage = " ".join(
                [entry["name"], t["name"].replace("_", "-")] +
                [flag(p, s, p in required) for p, s in params.items()])
            description = " ".join((t["description"] or "").split())
            lines.append(f"- `{usage}`: {description}".rstrip(": "))
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def task_toml(slug: str, index: int, row: dict) -> str:
    apps = ", ".join(toml_string(a) for a in json.loads(row["apps"]))
    upstream = (f"ATH-MaaS/complex-mcp@{COMMIT} "
                f"benchmark/data/data.parquet row {index}")
    return f"""version = "1.0"

[metadata]
upstream = "{upstream}"
level = {int(row["level"])}
seed = {int(row["seed"])}
apps = [{apps}]
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


def login_fixture(seed: int, apps: list[str]) -> bytes:
    """Each Light app's fixture: the task's login, which its fake makes its
    session from (mocks/complexmcp/fake.ts)."""
    return (json.dumps({"login": [{
        "seed": seed,
        "apps": json.dumps(apps)
    }]},
                       indent=1) + "\n").encode()


@functools.cache
def clock_start(seed: int) -> str:
    """LightSystem's time at login, upstream's ``ClockSession(seed)``: the
    trial's clock starts there too, in UTC."""
    spec = importlib.util.spec_from_file_location(
        "clock", UPSTREAM / "software" / "LightSystem" / "clock.py")
    clock = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(clock)
    return clock.ClockSession(seed)._now.strftime("%Y-%m-%dT%H:%M:%SZ")


def mirage_yaml(slug: str, index: int, row: dict) -> str:
    seed = int(row["seed"])
    apps = json.loads(row["apps"])
    epoch = clock_start(seed)
    lines = [
        f"# {slug}, ComplexMCP's row {index}, on vfsbench_harbor's mirage "
        "environment",
        "# (harbor/complexmcp.py writes it).",
        "#",
        "# Each of upstream's servers is its kit fake at upstream's port, its "
        "tools a",
        "# CLI (harbor/tools.ts) whose calls reach this trial's run of it. A "
        "Light app",
        f"# logs in as upstream's client logs in: seed {seed}, then "
        f"{', '.join(apps)},",
        "# each fake making its session from kit/login.json; the others "
        "answer that",
        "# they were not logged into. A Light app's CLI names the trial's run "
        "of",
        "# LightSystem, whose clock every app steps, as upstream's connector "
        "does.",
        "# The trial's clock starts at LightSystem's time at login.",
        "fakes:",
    ]
    for server, (port, _, desc) in SERVERS.items():
        fixture = "kit/login.json" if desc else "kit/none.json"
        lines += [
            f"  {service(server)}:", f"    fixture: {fixture}",
            f"    epoch: '{epoch}'", f"    ports: [{port}]"
        ]
    lines += [
        "tools:", "  file: tools.json", f"  dispatches: {DISPATCHES}",
        "workspace:", "  clis:"
    ]
    system = "${" + service("LightSystem").upper() + "_URL}"
    for server, (_, _, desc) in SERVERS.items():
        url = "${" + service(server).upper() + "_URL}"
        config = f"{{url: '{url}'"
        if desc:
            config += f", headers: {{x-light-system: '{system}'}}"
        config += "}"
        lines.append(
            f"    {cli(server)}: {{cli: {cli(server)}, config: {config}}}")
    return "\n".join(lines) + "\n"


def oracle(slug: str, index: int, row: dict) -> bytes | None:
    """The task's solution: ours where we wrote one, or the reference
    trajectory's calls as CLI lines."""
    ours = OUT / slug / "solution" / "solve.sh"
    if ours.is_file() and OURS in ours.read_bytes():
        return ours.read_bytes()
    if index not in ORACLES:
        return None
    lines = [
        "#!/usr/bin/env bash",
        f"# Upstream's reference trajectory (data.parquet row {index}), each",
        "# call as the CLI that makes it. Its ids are the session's own, "
        "which",
        "# the seed makes the same each time; calls the client never sent to "
        "a", "# server (an unknown tool, a malformed call) are left out."
    ]
    for server, tool, args in calls(row):
        lines.append(command(server, tool, args))
    return ("\n".join(lines) + "\n").encode()


def calls(row: dict) -> list[tuple[str, str, dict]]:
    """The reference trajectory's tool calls that reached a server."""
    import re
    output = json.loads(row["output"])
    out = []
    for call, _ in re.findall(
            r"<tool>(.*?)</tool>\s*<response>\n(.*?)\n</response>", output,
            re.S):
        try:
            parsed = json.loads(call.strip())
        except ValueError:
            continue
        key = parsed.get("name")
        if key in registry():
            server, tool = registry()[key]
            out.append((server, tool, parsed.get("arguments") or {}))
    return out


def command(server: str, tool: str, args: dict) -> str:
    """One call as a CLI line: each list item a flag of its own, an object
    or a union as JSON."""
    schema = parameters(server, tool)["properties"]
    parts = [cli(server), tool.replace("_", "-")]
    for name, value in args.items():
        spec = schema.get(name, {})
        f = f"--{name.replace('_', '-')}"
        if spec.get("type") == "array" and isinstance(value, list) and all(
                isinstance(v, (str, int, float)) for v in value):
            for v in value:
                parts += [f, shlex.quote(str(v))]
        elif spec.get("type") in ("string", "integer", "number",
                                  "boolean") or ("anyOf" in spec
                                                 and value is None):
            if value is None:
                continue
            text = json.dumps(value) if isinstance(value, bool) else str(value)
            parts += [f, shlex.quote(text)]
        else:
            parts += [f, shlex.quote(json.dumps(value, ensure_ascii=False))]
    return " ".join(parts)


# The rows whose reference trajectory is the oracle: those that replay to
# the expected environment (complexmcp_compare.py checks each reply).
ORACLES: set[int] = set(range(47))


def expected(slug: str) -> dict[str, bytes]:
    """Every file this writes for a task, by path in its directory."""
    index = TASKS[slug]
    row = rows()[index]
    out = {
        "instruction.md":
        instruction(row).encode(),
        "task.toml":
        task_toml(slug, index, row).encode(),
        "environment/mirage.yaml":
        mirage_yaml(slug, index, row).encode(),
        "environment/kit/login.json":
        login_fixture(int(row["seed"]), json.loads(row["apps"])),
        "environment/kit/none.json":
        EMPTY_FIXTURE,
        "environment/tools.json":
        (json.dumps(tools_json(), ensure_ascii=False, indent=1) +
         "\n").encode(),
        "tests/test.sh":
        TEST_SH.read_bytes(),
    }
    solve = oracle(slug, index, row)
    if solve is not None:
        out["solution/solve.sh"] = solve
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("tasks", nargs="*", default=list(TASKS))
    args = parser.parse_args()
    failed = 0
    for slug in args.tasks:
        target = OUT / slug
        files = expected(slug)
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
        print(f"{status} {slug}")
        for problem in problems:
            print(f"    {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
