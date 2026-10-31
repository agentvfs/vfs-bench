"""Write the Gaia2 tasks from upstream, or check them.

    uv run --project datasets/gaia2 \
        python -I datasets/gaia2/generate.py [--check] [task ...]

(``--project formats/harbor`` works too: the script then runs itself in the
gaia2 project, which has gaia2-cli.)

Each task, ``datasets/gaia2/<split>-<NNNN>/`` (the search,
execution and ambiguity splits) is one Gaia2 scenario
(meta-agents-research-environments/gaia2 @ 78ea3bd, CC BY 4.0 with the
Llama terms; ``fetch.py`` fetches it into ``state/gaia2/``), on the
apps of gaia2-cli (meta-agents-research-environments @ a9fd2ed, MIT), each
a kit fake of its own (``mocks/gaia2_<app>/``). Gaia2's data is never
committed: the files made from it are written here and git ignores them
(``datasets/gaia2/.gitignore``). The rest are committed.

Made from the scenario (ignored by git):
- ``instruction.md``: gaia2-cli's agent prompt, ``AGENTS_TEMPLATE.md``
  rendered for the scenario as upstream renders it, with ``EDITS`` (the
  workspace's paths, the drive as a mount), then the scenario's message to
  the agent, verbatim.
- ``environment/kit/gaia2_<app>.json``: each fake's fixture, the app's
  state file as ``gaia2-init`` writes it from the scenario, and the class
  name its calls log under (``app_class_map.json``).
- ``solution/solve.sh`` but for ``SOLVED``: upstream's oracle, replayed as
  gaia2-replay replays it, through the workspace's CLIs, then its reply.
- ``environment/drive/``: the Files app's tree as ``gaia2-init`` lays it
  out, hard links to one copy of it in ``state/gaia2/drive/``; each trial
  gets a copy of its own at ``/cloud-drive``.
- ``tests/scenario.json``: the scenario, which only the grader reads;
  MirageVerifier freezes it into a read-only Monty VFS.

Committed:
- ``task.toml``, ``environment/mirage.yaml``, ``environment/tools.json``
  (each app's commands, from upstream's click programs), ``tests/test.sh``
  (the stub, ``harbor/test.sh``), ``solution/trajectory.py``
  (``gaia2_trajectory.py``), and ``datasets/gaia2/.gitignore``: written
  here.
- ``solution/solve.sh`` for the tasks of ``SOLVED``: ours, which find the
  answer through the apps.

``--check`` writes nothing and exits 1 if a file differs from what upstream
gives, if a solution of ``SOLVED`` is missing, or if a file is unaccounted
for.

It names each file by its place in Harbor's layout
(``environment/mirage.yaml``, ``tests/<file>``); ``datasets/layout.py`` lays
them out in the task's ``workspace/`` and ``harbor/``.
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import gaia2_cli  # noqa: F401
except ImportError:
    # gaia2-cli is the gaia2 project's (Python 3.12), not formats/harbor's:
    # run from another project, this runs itself there.
    script = Path(sys.argv[0]).resolve() if sys.argv and sys.argv[0] else None
    if (os.environ.get("GAIA2_PY_REEXEC") or script is None
            or script != Path(__file__).resolve()):
        raise
    os.environ["GAIA2_PY_REEXEC"] = "1"
    os.execvp("uv", [
        "uv", "run", "--project",
        str(Path(__file__).resolve().parent), "python", "-I",
        str(script), *sys.argv[1:]
    ])

import click
from gaia2_cli import init_cmd
from gaia2_cli.app_registry import APP_REGISTRY, resolve_scenario_tools
from gaia2_cli.shared import normalize_app_name

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
STATE = ROOT / "state" / "gaia2"
SCENARIOS = STATE / "scenarios"
OUT = HERE
TEST_SH = ROOT / "formats" / "harbor" / "test.sh"
sys.path.insert(0, str(HERE.parent))
from layout import place, placed  # noqa: E402

COMMIT = "a9fd2edccb4bc7e22fbf45c8482a5fef30a2a5a4"
DATASET = "78ea3bdbdeec2bdcd6afa5420915d8a22f23ed99"
SPLITS = ("search", "execution", "ambiguity")

# The Files app is a mount, not a fake (``/cloud-drive``).
FILES = "Files"
DRIVE = "/cloud-drive"
# The apps that read and write the drive (attachments), whose runs are
# given the trial's (``extras``).
DRIVE_APPS = {"gaia2_emails", "gaia2_messages", "gaia2_chats"}
# Where the verifier reads each fake's run (its SQLite).
STATE_DIR = "/var/lib/mock-data/gaia2"
DISPATCHES = f"{STATE_DIR}/dispatches.jsonl"
# The class each messaging app logs under where app_class_map.json names
# none (``set_log_class`` in apps/messages.py and apps/chats.py).
LOG_CLASS = {"Messages": "MessagingAppV2", "Chats": "MessagingAppV2"}


def apps() -> dict[str, dict]:
    """Each app with a CLI but the drive, by its state name (``APP_NAME``):
    its registry entry and its fake."""
    out = {}
    for entry in APP_REGISTRY:
        if entry["state_name"] == FILES:
            continue
        out[entry["state_name"]] = {
            **entry,
            "service": "gaia2_" + entry["cli"].replace("-", "_"),
        }
    return out


APPS = apps()


def iso(start: float) -> str:
    """A scenario's start, as the run's epoch."""
    return datetime.fromtimestamp(
        float(start), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def scenario_path(split: str, scenario_id: str) -> Path:
    return SCENARIOS / split / f"{scenario_id}.json"


def init_state(scenario: Path, state_dir: Path) -> None:
    """Upstream's ``gaia2-init`` on the scenario, with no drive backing
    (its files are laid out by ``drive()``)."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        init_cmd.main.main(
            args=["--scenario",
                  str(scenario), "--state-dir",
                  str(state_dir)],
            standalone_mode=False)


def fixtures(scenario: Path) -> dict[str, bytes]:
    """Each fake's fixture for a scenario: the app's state file as
    gaia2-init writes it, as the ``state`` doc, and the class its calls log
    under (``set_app``: ``app_class_map.json``'s, else the app's own), as
    the ``meta`` doc."""
    with tempfile.TemporaryDirectory(prefix="gaia2-init-") as tmp:
        state_dir = Path(tmp)
        init_state(scenario, state_dir)
        class_map_file = state_dir / "app_class_map.json"
        class_map = json.loads(
            class_map_file.read_text()) if class_map_file.exists() else {}
        out = {}
        for name, app in APPS.items():
            path = state_dir / f"{normalize_app_name(name)}.json"
            if not path.exists():
                continue
            state = json.loads(path.read_text())
            log_class = class_map.get(name, "") or LOG_CLASS.get(name, "")
            meta = {"app": log_class} if log_class else {}
            rows = [{
                "name": "state",
                "doc": json.dumps(state)
            }, {
                "name": "meta",
                "doc": json.dumps(meta)
            }]
            out[app["service"]] = (json.dumps({"doc": rows}, indent=1) +
                                   "\n").encode()
        return out


def option_schema(param: click.Option) -> dict:
    """A click option as a JSON schema property, as ``gaia2/world.py``
    reads them."""
    if param.is_flag:
        schema: dict = {"type": "boolean", "x-flag": True}
    elif isinstance(param.type, click.Choice):
        schema = {"type": "string", "enum": list(param.type.choices)}
    elif param.type is click.INT:
        schema = {"type": "integer"}
    elif param.type is click.FLOAT:
        schema = {"type": "number"}
    else:
        schema = {"type": "string"}
    if param.multiple:
        schema = {"type": "array", "items": schema}
    if param.help:
        schema["description"] = param.help
    if not param.is_flag and isinstance(param.default,
                                        (str, int, float, list, tuple)):
        schema["default"] = list(param.default) if isinstance(
            param.default, tuple) else param.default
    return schema


def option_name(param: click.Option) -> str:
    """The option's property, and so its flag: its first spelling
    (``--start-date``, ``--folder-name``), as the CLI documents it."""
    return param.opts[0].lstrip("-").replace("-", "_")


def tools() -> list[dict]:
    """Each app's commands as a CLI of ``workspace/tools.ts``: its visible
    commands, each with its options and the fake's route, as upstream's
    click program declares them."""
    import importlib
    out = []
    for name, app in APPS.items():
        group = getattr(importlib.import_module(app["module"]), "cli")
        listed = []
        for command_name, command in group.commands.items():
            if command_name == "schema" or command.hidden:
                continue
            properties, required = {}, []
            for param in command.params:
                if not isinstance(param, click.Option) or param.name == "help":
                    continue
                prop = option_name(param)
                properties[prop] = option_schema(param)
                if param.required:
                    required.append(prop)
            listed.append({
                "name": command_name,
                # Unique across the CLIs: workspace/tools.ts finds a tool's
                # endpoint by it, and messages and chats share their names.
                "call": f"{app['cli']}.{command_name}",
                "description": (command.help or "").strip(),
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                },
                "endpoint": {
                    "url":
                    f"http://{app['cli']}.gaia2/{app['cli']}/{command_name}",
                    "method": "POST"
                },
            })
        out.append({
            "name": app["cli"],
            "description": app["description"],
            "tools": listed
        })
    return out


# ---------------------------------------------------------------------------
# The agent's instruction
# ---------------------------------------------------------------------------

TEMPLATE = STATE / "AGENTS_TEMPLATE.md"
# The tool upstream's prompt names for running commands (``{{EXEC_TOOL}}``).
EXEC_TOOL = "shell"
MESSAGING = {"messages", "chats"}
DRIVE_ITEM = ("- `cloud-drive` — Cloud storage (like Google Drive), "
              "separate from the local filesystem")
# Where this workspace differs from upstream's container, each applied to
# exactly one place in the rendered prompt.
EDITS = [
    ("Your workspace is `/home/agent`. You may create and edit files here.",
     "Your workspace is `/workspace`. You may create and edit files here."),
    (DRIVE_ITEM + "\n", ""),
    ("These are NOT tool names — they are shell commands.",
     "The Cloud storage app (like Google Drive) is not a command: its files "
     f"are mounted at `{DRIVE}`, where you read, create, move and remove them "
     "with ordinary shell commands.\n\n"
     "These are NOT tool names — they are shell commands."),
    ("Work only within `/home/agent`.",
     f"Work only within `/workspace` and `{DRIVE}`."),
]


def render_prompt(scenario: Path) -> str:
    """gaia2-cli's ``render_agent_prompt.render`` (shared/, outside its
    package, so its few lines are repeated, as gaia2/prompt.py does), then
    ``EDITS``, and the notifications section cut: nothing delivers them
    here, and the search, execution and ambiguity scenarios have none."""
    tools = resolve_scenario_tools(str(scenario))["tools"]
    tool_list = "\n".join(f"- `{name}` — {about}"
                          for name, about in sorted(tools.items()))
    messaging = [k for k in sorted(tools) if k in MESSAGING]
    prompt = TEMPLATE.read_text()
    prompt = prompt.replace("{{TOOL_LIST}}", tool_list)
    prompt = prompt.replace("{{MESSAGING_TOOLS}}",
                            ", ".join(messaging or ["messages", "chats"]))
    prompt = prompt.replace("{{EXEC_TOOL}}", EXEC_TOOL)
    for old, new in EDITS:
        count = prompt.count(old)
        if count != 1:
            raise ValueError(
                f"{old!r} appears {count} times in the Gaia2 prompt")
        prompt = prompt.replace(old, new)
    cut = prompt.find("\n## Notifications")
    return (prompt if cut < 0 else prompt[:cut]).rstrip()


def task_message(data: dict) -> str:
    """The scenario's message to the agent: its one
    ``send_message_to_agent``."""
    sent = [
        e for e in data["events"]
        if (e.get("action") or {}).get("function") == "send_message_to_agent"
    ]
    if len(sent) != 1:
        raise ValueError(f"{data['metadata']['definition']['scenario_id']}: "
                         f"{len(sent)} messages to the agent")
    return next(a["value"] for a in sent[0]["action"]["args"]
                if a["name"] == "content")


def instruction(scenario: Path, data: dict) -> str:
    return (f"{render_prompt(scenario)}\n\n## Task\n\n"
            f"{task_message(data).rstrip()}\n")


# ---------------------------------------------------------------------------
# The drive
# ---------------------------------------------------------------------------

DRIVE_STATE = STATE / "drive"


def drive_tree(data: dict) -> dict:
    files = next(a for a in data["apps"] if a.get("name") == FILES
                 or a.get("class_name") == "SandboxLocalFileSystem")
    return files["app_state"]


def drive_root(data: dict) -> Path:
    """The Files app's tree as gaia2-init lays it out, its files copied from
    the ``gaia2_filesystem`` download, once per distinct tree (every
    scenario has the same one): ``state/gaia2/drive/<hash>/``."""
    tree = drive_tree(data)
    key = hashlib.sha256(json.dumps(tree,
                                    sort_keys=True).encode()).hexdigest()[:12]
    root = DRIVE_STATE / key
    if not root.is_dir():
        build = DRIVE_STATE / f"{key}.build"
        shutil.rmtree(build, ignore_errors=True)
        init_cmd._init_filesystem(tree, build, str(STATE / "filesystem"))
        (build / "filesystem").rename(root)
        shutil.rmtree(build)
    return root


def link_tree(source: Path, target: Path) -> None:
    """``target`` as hard links to ``source``'s files, so a task's copy costs
    no space; each trial copies it whole (``copy``)."""
    shutil.rmtree(target, ignore_errors=True)
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source)
        if path.is_dir():
            (target / rel).mkdir(parents=True, exist_ok=True)
        else:
            (target / rel).parent.mkdir(parents=True, exist_ok=True)
            os.link(path, target / rel)
    target.mkdir(parents=True, exist_ok=True)


def same_tree(a: Path, b: Path) -> bool:

    def listing(root: Path):
        return sorted((p.relative_to(root).as_posix(), p.is_dir(),
                       0 if p.is_dir() else p.stat().st_size)
                      for p in root.rglob("*"))

    return b.is_dir() and listing(a) == listing(b)


# ---------------------------------------------------------------------------
# Upstream's oracle, replayed
# ---------------------------------------------------------------------------


def mint(service: str, n: int) -> str:
    """A fake's n-th id (``uuid.uuid4()``, mocks/gaia2/store.ts)."""
    digits = list(hashlib.sha256(f"{service}:{n}".encode()).hexdigest()[:32])
    digits[12] = "4"
    digits[16] = "89ab"[int(digits[16], 16) % 4]
    return "".join(digits)


class Apps:
    """A scenario's apps as upstream runs them, in this process: its state
    directory as gaia2-init writes it, each command its click program run
    as the CLI runs it, with ``time.time()`` frozen at the scenario's start
    and ``uuid.uuid4()`` each fake's id counter, so ids agree with a run's."""

    def __init__(self, scenario: Path, state_dir: Path):
        init_state(scenario, state_dir)
        self.state_dir = state_dir
        self.start = float(
            json.loads(
                scenario.read_text())["metadata"]["definition"]["start_time"])
        self.ids: dict[str, int] = {}
        self.by_cli = {app["cli"]: app for app in APPS.values()}

    def run(self, argv: list[str]) -> tuple[int, str, str]:
        """``<cli> <command> [options]``: exit code, stdout, stderr."""
        import importlib
        import time
        import uuid

        from gaia2_cli import shared
        os.environ["GAIA2_STATE_DIR"] = str(self.state_dir)
        app = self.by_cli[argv[0]]
        module = importlib.import_module(app["module"])
        shared._APP_CLASS_MAP = None
        shared.set_app(module.APP_NAME)
        service = app["service"]

        def uuid4():
            self.ids[service] = self.ids.get(service, 0) + 1
            return uuid.UUID(hex=mint(service, self.ids[service]))

        out, err = io.StringIO(), io.StringIO()
        real = uuid.uuid4, time.time
        uuid.uuid4, time.time = uuid4, (lambda: self.start)
        code = 0
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(
                    err):
                module.cli.main(args=argv[1:],
                                prog_name=argv[0],
                                standalone_mode=True)
        except SystemExit as exit_:
            code = exit_.code if isinstance(
                exit_.code, int) else (0 if exit_.code is None else 1)
        except Exception as error:
            code = 1
            err.write(f"{type(error).__name__}: {error}\n")
        finally:
            uuid.uuid4, time.time = real
            for path in list(shared._active_locks):
                shared._release_lock(Path(path))
        return code, out.getvalue(), err.getvalue()


def fn_map() -> dict[str, dict[str, str]]:
    """gaia2-replay's map from an oracle's function to its command, from
    each CLI's ``schema`` (``build_schema``), in this process."""
    import importlib

    from gaia2_cli.shared import build_schema
    out = {}
    for app in APPS.values():
        mapping: dict[str, str] = {}
        for entry in build_schema(importlib.import_module(app["module"]).cli):
            if entry["oracle_function"]:
                mapping[entry["oracle_function"]] = entry["command"]
            mapping.setdefault(entry["function"], entry["command"])
        out[app["cli"]] = mapping
    return out


def ours(argv: list[str]) -> list[str]:
    """An upstream command line as the workspace's CLI takes it: each
    option by its first spelling, the one ``tools()`` names."""
    import importlib
    app = next(a for a in APPS.values() if a["cli"] == argv[0])
    command = importlib.import_module(app["module"]).cli.commands[argv[1]]
    names = {
        opt: param.opts[0]
        for param in command.params if isinstance(param, click.Option)
        for opt in param.opts
    }
    return [names.get(a, a) if a.startswith("--") else a for a in argv]


def replay(split: str,
           scenario_id: str) -> tuple[list[list[str]], str | None, list[str]]:
    """Upstream's oracle for a scenario as gaia2-replay replays it
    (daemon/replay.py: its turns, function map, placeholders and command
    lines), run on upstream's apps here so each placeholder is the id the
    fakes mint: the command lines, the reply that ends the turn (the
    oracle's ``send_message_to_user``), and the commands upstream refused."""
    from gaia2_cli.daemon import replay as upstream
    scenario = scenario_path(split, scenario_id)
    _task, turns, _env = upstream.load_scenario_events(str(scenario))
    # One message to the agent, so one turn, which the agent's reply ends:
    # an oracle reply topologically before other calls splits gaia2-replay's
    # list, and the calls after it are the same turn's.
    data = json.loads(scenario.read_text())
    if sum(e.get("event_type") == "USER" for e in data["events"]) != 1:
        raise ValueError(
            f"{split}/{scenario_id}: more than one message to the agent")
    mapping = fn_map()
    commands, reply, refused = [], None, []
    returns: dict = {}
    with tempfile.TemporaryDirectory(prefix="gaia2-replay-") as tmp:
        apps = Apps(scenario, Path(tmp))
        for entry in [e for turn in turns for e in turn]:
            if entry["app"] == "AgentUserInterface" and entry[
                    "fn"] == "send_message_to_user":
                reply = entry["args"].get("content")
                continue
            args, _ = upstream._resolve_placeholders(entry["args"], returns)
            argv = upstream._build_cli_cmd(entry["app"], entry["fn"], args,
                                           mapping)
            if argv is None or argv[0] not in apps.by_cli:
                raise ValueError(
                    f"{split}/{scenario_id}: no app of ours for {entry['app']}"
                )
            code, _out, err = apps.run(argv)
            if code != 0:
                refused.append(f"{' '.join(argv)[:120]}: {err.strip()[:200]}")
            events = (Path(tmp) / "events.jsonl").read_text().splitlines()
            returns[entry["event_id"]] = json.loads(
                events[-1]).get("ret") if events else None
            commands.append(ours(argv))
    return commands, reply, refused


SOLVE_SH = """#!/usr/bin/env bash
# Upstream's oracle for {split}/{scenario_id}, replayed as gaia2-replay replays
# it, through the workspace's CLIs, then its reply (harbor/gaia2.py writes
# this from the scenario; not committed).
{lines}python3 /solution/trajectory.py {reply}
"""


def solve_sh(split: str, scenario_id: str) -> tuple[bytes, list[str]]:
    import shlex
    commands, reply, refused = replay(split, scenario_id)
    lines = "".join(f"{shlex.join(c)}\n" for c in commands)
    text = SOLVE_SH.format(
        split=split,
        scenario_id=scenario_id,
        lines=lines,
        reply=shlex.quote(reply if reply is not None else "Done."))
    return text.encode(), refused


# ---------------------------------------------------------------------------
# A task's files
# ---------------------------------------------------------------------------


def slug(split: str, scenario_id: str) -> str:
    return f"{split}-{scenario_id[:4]}"


def task_ids(split: str) -> list[str]:
    return sorted(p.stem for p in (SCENARIOS / split).glob("*.json"))


def skipped(split: str, scenario_id: str) -> str | None:
    """Why a scenario is left out, if it is: its oracle works the Files app
    through its CLI, which is a mount here, so those calls log no event for
    the judge to match; or the user writes to the agent more than once,
    which needs a turn after the first."""
    data = json.loads(scenario_path(split, scenario_id).read_text())
    users = sum(e.get("event_type") == "USER" for e in data["events"])
    if users != 1:
        return (f"the user writes to the agent {users} times: a turn after "
                "the first, which nothing here delivers")
    for event in data["events"]:
        action = event.get("action") or {}
        if event.get("event_type") == "AGENT" and action.get("app") in (
                FILES, "SandboxLocalFileSystem"):
            return (f"its oracle calls the Files app "
                    f"({action.get('function')}), a mount here, which logs "
                    "no event")
    return None


ALL = {
    slug(split, sid): (split, sid)
    for split in SPLITS
    for sid in (task_ids(split) if (SCENARIOS / split).is_dir() else [])
}
SKIPPED = {
    task: why
    for task, (split, sid) in ALL.items() if (why := skipped(split, sid))
}
TASKS = {task: v for task, v in ALL.items() if task not in SKIPPED}

# The tasks with a solution of ours (``solution/solve.sh``): the pre-Harbor
# port's oracles (gaia2/<name>/tests/oracle.sh), ported.
SOLVED = [
    "search-0002", "search-0012", "search-0034", "search-0038", "search-0231",
    "search-0284", "search-0295", "search-0396", "search-0419", "search-0430",
    "search-0435"
]
OURS = ["solution/solve.sh"]
TRAJECTORY = HERE / "trajectory.py"


def task_toml(split: str, scenario_id: str, data: dict) -> str:
    upstream = (f"meta-agents-research-environments/gaia2@{DATASET[:7]} "
                f"{split}/{scenario_id}; gaia2-cli@{COMMIT[:7]}")
    judge_extra_body = ('${JUDGE_EXTRA_BODY:-'
                        '{\\"reasoning_effort\\": \\"low\\"}}')
    return f"""version = "1.0"

[metadata]
category = "{split}"
upstream = "{upstream}"

# A judge's checks take seconds each; msb now and then leaves a running VM's
# command unrun, which only this timeout ends.
[verifier]
timeout_sec = 300.0

# Upstream's judge (gaia2-core's), its LLM checks over the chat completions
# API. Without a key it calls no model: an answer the oracle's equals, as
# gaia2-core normalizes them, passes, and any other is inconclusive, a fail.
[verifier.env]
OPENAI_API_KEY = "${{OPENAI_API_KEY:-}}"
OPENAI_BASE_URL = "${{OPENAI_BASE_URL:-https://api.openai.com/v1}}"
JUDGE_MODEL = "${{JUDGE_MODEL:-gpt-oss-120b}}"
JUDGE_EXTRA_BODY = "{judge_extra_body}"

[agent]
timeout_sec = 900.0

[environment]
build_timeout_sec = 300.0
cpus = 1
memory_mb = 2048
storage_mb = 4096
allow_internet = false
"""


def yaml_scalar(value) -> str:
    return json.dumps(value) if isinstance(
        value, str) and (not re.fullmatch(r"[A-Za-z0-9_./-]+", value)
                         or value in ("true", "false", "null")) else str(value)


def mirage_yaml(task: str, data: dict, services: list[str]) -> str:
    epoch = iso(data["metadata"]["definition"]["start_time"])
    lines = [
        f"# {task}, on vfsbench_harbor's mirage environment "
        "(datasets/gaia2/generate.py writes it).",
        "#",
        "# Each Gaia2 app is its kit fake (mocks/gaia2_<app>), "
        "seeded from the",
        "# scenario's state for it "
        "(kit/, written from the scenario, not committed),",
        "# its clock frozen at the scenario's start; "
        "its commands are a CLI each",
        "# (tools.json, workspace/tools.ts). "
        "The Files app's drive is a mount, a copy",
        "# of its own each trial, "
        "which the apps with attachments reach too",
        "# (extras).",
        "fakes:",
    ]
    for service in services:
        lines += [
            f"  {service}:", f"    fixture: kit/{service}.json",
            f"    epoch: '{epoch}'", f"    state: {STATE_DIR}/{service}.db"
        ]
        if service in DRIVE_APPS:
            lines.append("    extras: {drive: '${RUN_DIR}/cloud-drive', "
                         f"view: {DRIVE}}}")
    lines += [
        "copy:", f"  {DRIVE}: drive/", "tools:", "  file: tools.json",
        f"  dispatches: {DISPATCHES}", "workspace:", "  mounts:",
        f"    {DRIVE}:", "      vfs: disk", "      mode: write",
        "      read: fresh", "      config: {root: '${RUN_DIR}/cloud-drive'}",
        "  clis:"
    ]
    by_service = {app["service"]: app for app in APPS.values()}
    for service in services:
        cli = by_service[service]["cli"]
        lines.append(f"    {cli}: {{cli: {cli}, "
                     f"config: {{url: '${{{service.upper()}_URL}}'}}}}")
    return "\n".join(lines) + "\n"


def expected(task: str) -> tuple[dict[str, bytes], dict[str, bytes]]:
    """A task's files, by path in its directory: those committed, and those
    made from Gaia2's data, which git ignores."""
    split, scenario_id = TASKS[task]
    scenario = scenario_path(split, scenario_id)
    data = json.loads(scenario.read_text())
    kit = fixtures(scenario)
    services = [
        app["service"] for app in APPS.values() if app["service"] in kit
    ]
    committed = {
        "task.toml":
        task_toml(split, scenario_id, data).encode(),
        "environment/mirage.yaml":
        mirage_yaml(task, data, services).encode(),
        "environment/tools.json":
        (json.dumps(tools(), ensure_ascii=False, indent=1) + "\n").encode(),
        "tests/test.sh":
        TEST_SH.read_bytes(),
    }
    committed["solution/trajectory.py"] = TRAJECTORY.read_bytes()
    ignored = {"instruction.md": instruction(scenario, data).encode()}
    if task not in SOLVED:
        ignored["solution/solve.sh"], _refused = solve_sh(split, scenario_id)
    for service, fixture in kit.items():
        ignored[f"environment/kit/{service}.json"] = fixture
    # The scenario, which only the grader reads (workspace/verifier/).
    ignored["tests/scenario.json"] = scenario_path(split,
                                                   scenario_id).read_bytes()
    return committed, ignored


def job_yaml() -> str:
    lines = [
        '# GAIA2 on Harbor/Mirage. Generated by datasets/gaia2/generate.py.',
        '# Pinned judge in a separate Mirage/Monty VFS.',
        '# LLM checks use OPENAI_BASE_URL, OPENAI_API_KEY and JUDGE_MODEL.',
        '# From vfs-bench-2/, after datasets/gaia2/fetch.py:',
        "#   OPENAI_API_KEY=... uv run --project formats/harbor harbor run -y "
        "-c datasets/gaia2/jobs/harbor.yaml -a oracle -n 4", "environment:",
        "  import_path: vfsbench_harbor:MirageEnvironment", "verifier:",
        "  import_path: vfsbench_harbor:MirageVerifier", "tasks:"
    ]
    lines += [
        f"  - path: datasets/gaia2/{task}/harbor" for task in sorted(TASKS)
    ]
    return "\n".join(lines) + "\n"


def gitignore() -> str:
    lines = [
        "# Made from Gaia2's data (CC BY 4.0, with the Llama terms), "
        "which is fetched", "# at setup and never committed: "
        "fetch.py writes these from it.", "*/harbor/instruction.md",
        "*/workspace/fixtures/", "*/workspace/files/drive/",
        "*/workspace/verifier/", "*/harbor/solution/solve.sh",
        "# Our own solutions, which find the answer through the apps."
    ]
    lines += [f"!{task}/harbor/solution/solve.sh" for task in SOLVED]
    return "\n".join(lines) + "\n"


def write_or_check(path: Path, data: bytes, check: bool, problems: list[str],
                   rel: str) -> None:
    if check:
        if not path.is_file():
            problems.append(f"{rel} is missing")
        elif path.read_bytes() != data:
            problems.append(f"{rel} differs from what upstream gives")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.is_file() or path.read_bytes() != data:
            path.write_bytes(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("tasks", nargs="*", default=sorted(TASKS))
    args = parser.parse_args()
    failed = 0
    problems: list[str] = []
    write_or_check(OUT / ".gitignore",
                   gitignore().encode(), args.check, problems, ".gitignore")
    if problems:
        print("FAIL .gitignore")
        failed += 1
    write_or_check(HERE / "jobs" / "harbor.yaml",
                   job_yaml().encode(), args.check, problems,
                   "jobs/harbor.yaml")
    for task in args.tasks:
        target = OUT / task
        problems: list[str] = []
        committed, ignored = expected(task)
        committed = placed(committed, "gaia2", task)
        ignored = {place(rel): data for rel, data in ignored.items()}
        ours = [place(rel) for rel in OURS] if task in SOLVED else []
        for rel in ours:
            if not (target / rel).is_file():
                problems.append(f"{rel} (ours) is missing")
        for rel, data in {**committed, **ignored}.items():
            write_or_check(target / rel, data, args.check, problems, rel)
        split, scenario_id = TASKS[task]
        source = drive_root(
            json.loads(scenario_path(split, scenario_id).read_text()))
        drive = target / place("environment/drive")
        if args.check:
            if not same_tree(source, drive):
                problems.append(
                    "workspace/files/drive/ differs from the scenario's drive")
        elif not same_tree(source, drive):
            link_tree(source, drive)
        known = set(committed) | set(ignored) | set(ours)
        for path in sorted(target.rglob("*")):
            rel = path.relative_to(target).as_posix()
            if path.is_file() and rel not in known and not rel.startswith(
                    "workspace/files/drive/"):
                problems.append(f"{rel} is not generated or ours")
        failed += bool(problems)
        status = "FAIL" if problems else ("ok" if args.check else "written")
        print(f"{status} {task}")
        for problem in problems:
            print(f"    {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
