"""Write the AutomationBench tasks for Harbor on Mirage, or check them.

    uv run --project datasets/automationbench python -I datasets/automationbench/generate.py \
        [--check] [task ...]

AutomationBench (zapier/AutomationBench v1.0.6, ``4a8e106``, MIT; the
package ``automationbench/pyproject.toml`` pins) is 600 public tasks over 47
simulated SaaS apps, one ``WorldState`` per task, reached through three
tools, ``api_search``, ``api_fetch`` and ``base64_encode``, and graded on
the world's end state. Here the world is one kit fake,
``mocks/automationbench/``, a TypeScript port of upstream's API routes and
handlers over the world's JSON; the tools are the ``api`` CLI
(``workspace/tools.ts``); the pinned rubric grades the world's JSON in a
separate Mirage VFS/Monty workspace.

Each task under ``datasets/automationbench/<task>/`` (the task's name,
``<domain>.<name>``, with ``.`` as ``-`` and ``_`` as ``-``) has:

- ``instruction.md``: upstream's system prompt, then the tools as the CLI
  carries them (upstream's tool descriptions), then upstream's user message,
  verbatim.
- ``task.toml``, ``environment/mirage.yaml``, ``environment/tools.json``,
  ``tests/test.sh`` (the stub, ``harbor/test.sh``).
- ``environment/kit/automationbench.json``: the fake's fixture, the world
  as upstream builds it from the task's ``initial_state`` (its services
  gated as ``setup_state`` gates them), on the task's clock and with ids
  from generators seeded with the task's name, whose states the fixture
  carries on (``Upstream``). Not committed (``.gitignore``): it is upstream's
  data, 32 MB for all 600, and this writes it again.
- ``tests/task.json``: what the rubric reads besides the world, the task's
  ``assertions`` and ``initial_state``. Not committed either.
- ``solution/solve.sh``, for the tasks of ``SOLVED``: ours, by hand, through
  the CLI (upstream ships no solutions).

It also writes what the fake reads (``mocks/automationbench/data/``):
``models.json``, every Pydantic model of the world, its fields' types,
defaults and default factories, which the fake's records are built and
validated by; and ``endpoints.json``, ``api_search``'s index and endpoints,
as upstream builds them from its schemas.

A task is written only if every service its world is subscribed to has a
port in the fake (``PORTED``), its nop scores below 1.0 (computed here, on
the world as built) and it is not ``SKIPPED``. ``--check`` writes nothing
and exits 1 if a file differs from what this would write, or a file is
unaccounted for.

It names each file by its place in Harbor's layout (``environment/mirage.yaml``,
``tests/<file>``); ``datasets/layout.py`` lays them out in the task's
``workspace/`` and ``harbor/``.
"""
import argparse
import datetime as _dt
import enum
import inspect
import json
import os
import random
import sys
import textwrap
import time
import types
import typing
import uuid
from pathlib import Path

# The imports below come after TZ is pinned to UTC, so upstream's modules
# load on the clock they run on (hence the E402 noqas).
os.environ["TZ"] = "UTC"
time.tzset()

from automationbench.domains import PUBLIC_DOMAINS  # noqa: E402
from automationbench.domains import get_domain_dataset  # noqa: E402
from automationbench.runner import compute_allowed_services  # noqa: E402
from automationbench.runner import strip_none_values  # noqa: E402
from automationbench.schema.world import WorldState  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from pydantic_core import to_jsonable_python  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE
MOCK = HERE / "mocks" / "automationbench"
DATA = MOCK / "data"
TEST_SH = ROOT / "formats" / "harbor" / "test.sh"
sys.path.insert(0, str(HERE.parent))
from layout import place, placed  # noqa: E402
COMMIT = "4a8e1061254004d9dac807054eed33fad7d1ff14"
PACKAGE = Path(sys.modules["automationbench"].__file__).resolve().parent

# The clock of a task whose world sets no ``meta.current_time``: upstream's
# is the wall clock; here it is fixed, after the bulk of those tasks' dates.
DEFAULT_EPOCH = "2026-04-01T09:00:00Z"

# The services the fake has a port of: mocks/automationbench/app_<service>.ts.
PORTED: set[str] = {p.stem.removeprefix("app_") for p in MOCK.glob("app_*.ts")}

# Tasks left out, with why.
SKIPPED: dict[str, str] = {}

# Tasks with a solution of ours,
# ``datasets/automationbench/<task>/harbor/solution/solve.sh``.
SOLVED: set[str] = {
    # The pre-Harbor port's eleven (automationbench/<task>/tests/oracle.sh).
    "finance-invoice-email-extract",
    "hr-intern-program-coordination",
    "marketing-event-registration-sync",
    "operations-docusign-annual-review",
    "operations-hubspot-ticket-escalation",
    "operations-safety-certification-gap-analysis",
    "operations-twilio-facilities-emergency",
    "sales-competitive-displacement-outreach",
    "support-gorgias-refund-processing",
    "support-helpcrunch-usage-alerts",
    "support-zoho-freshdesk-escalation",
}

# ---------------------------------------------------------------------------
# Upstream's world, on the task's clock and seeded ids
# ---------------------------------------------------------------------------


class Clock:
    """The world's ``now``: its epoch, one second on for each ``api_fetch``
    call."""
    epoch = _dt.datetime(2026, 4, 1, 9, tzinfo=_dt.timezone.utc)
    calls = 0

    @classmethod
    def now(cls) -> _dt.datetime:
        return cls.epoch + _dt.timedelta(seconds=cls.calls)


class FrozenDatetime(_dt.datetime):
    """``datetime`` whose ``now()`` is the clock's; a naive ``now()`` is
    UTC's wall time."""

    @classmethod
    def now(cls, tz=None):
        t = Clock.now()
        return t.astimezone(tz) if tz is not None else t.replace(tzinfo=None)

    @classmethod
    def utcnow(cls):
        return Clock.now().replace(tzinfo=None)

    @classmethod
    def today(cls):
        return cls.now()


IDS = random.Random()
_UUID4 = uuid.uuid4


def seeded_uuid4() -> uuid.UUID:
    """A version-4 UUID from ``IDS``, in place of ``os.urandom``."""
    return uuid.UUID(int=IDS.getrandbits(128), version=4)


def _models() -> list[type[BaseModel]]:
    out, todo = [], [BaseModel]
    while todo:
        for sub in todo.pop().__subclasses__():
            out.append(sub)
            todo.append(sub)
    return [m for m in out if m.__module__.startswith("automationbench.")]


def freeze() -> None:
    """Put upstream's clock and ids on ``Clock`` and ``IDS``, for good.

    A module's ``datetime`` is ``FrozenDatetime``, and a field whose default
    factory is ``datetime.now`` itself (bound when its class was made) gets
    the clock's; ``time.time`` is the clock's; ``uuid.uuid4`` draws from
    ``IDS``. The ``random`` module's own generator is upstream's, seeded per
    task.
    """
    if getattr(freeze, "done", False):
        return
    import automationbench.tools.api  # noqa: F401  (every handler module)
    import automationbench.tools.zapier  # noqa: F401
    uuid.uuid4 = seeded_uuid4
    time.time = lambda: Clock.now().timestamp()
    for name, module in list(sys.modules.items()):
        if not name.startswith("automationbench"):
            continue
        if getattr(module, "datetime", None) is _dt.datetime:
            module.datetime = FrozenDatetime
        if getattr(module, "uuid4", None) is _UUID4:
            module.uuid4 = seeded_uuid4
    models = _models()
    for model in models:
        for field in model.model_fields.values():
            if field.default_factory == _dt.datetime.now:
                field.default_factory = FrozenDatetime.now
    # A model's schema embeds those of the models it holds, as they were when
    # it was built: rebuild until every level has the new factories.
    for _ in range(4):
        for model in models:
            model.model_rebuild(force=True)
    freeze.done = True


def epoch_of(info: dict) -> str:
    """The task's clock: its world's ``meta.current_time``, in UTC, or
    ``DEFAULT_EPOCH``."""
    current = ((info.get("initial_state") or {}).get("meta")
               or {}).get("current_time")
    if not current:
        return DEFAULT_EPOCH
    t = _dt.datetime.fromisoformat(current.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=_dt.timezone.utc)
    return t.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Upstream:
    """One task's world, as upstream's ``AutomationBenchEnv`` sets it up,
    and its tools.

    The clock is the task's epoch, on by a second for each ``api_fetch``
    call; ``random`` and ``IDS`` are seeded with the task's name before the
    world is built, and each call runs on the states this world left them in.
    """

    def __init__(self, row: dict):
        freeze()
        from automationbench.tools.api import API_TOOLS
        self.functions = {tool.__name__: tool for tool in API_TOOLS}
        self.info = row["info"]
        self.name = self.info["task_name"]
        self.epoch = epoch_of(self.info)
        self.calls = 0
        self._tick()
        IDS.seed(self.name)
        random.seed(self.name)
        initial = strip_none_values(self.info.get("initial_state", {}))
        self.world = WorldState(**initial)
        self.world.meta.allowed_services = compute_allowed_services(
            initial, self.info.get("assertions", []),
            self.info.get("zapier_tools", []))
        self._save()

    def _tick(self) -> None:
        Clock.epoch = _dt.datetime.fromisoformat(
            self.epoch.replace("Z", "+00:00"))
        Clock.calls = self.calls

    def _save(self) -> None:
        self.random_state = random.getstate()
        self.ids_state = IDS.getstate()

    def services(self) -> list[str]:
        return list(self.world.meta.allowed_services or [])

    def dump(self) -> dict:
        """The world as the fake keeps it: ``meta`` and the services it is
        subscribed to."""
        whole = self.world.model_dump(mode="json")
        return {
            k: v
            for k, v in whole.items() if k == "meta" or k in self.services()
        }

    def fixture(self) -> dict:
        """The fake's fixture: the world, and the clock and generators it
        goes on with."""
        meta = {
            "task": self.name,
            "epoch": self.epoch,
            "calls": self.calls,
            "random": list(self.random_state[1]),
            "ids": list(self.ids_state[1]),
        }
        return {
            "doc": [{
                "name": "world",
                "doc": json.dumps(self.dump())
            }, {
                "name": "meta",
                "doc": json.dumps(meta)
            }]
        }

    def call(self, tool: str, arguments: dict) -> str:
        """A tool call as ``AutomationBenchEnv`` makes it; its text, or the
        exception's."""
        function = self.functions[tool]
        arguments = {
            k: v
            for k, v in arguments.items()
            if not (isinstance(v, dict) and not v)
        }
        if "world" in inspect.signature(function).parameters:
            arguments["world"] = self.world
        if tool == "api_fetch":
            self.calls += 1
        self._tick()
        random.setstate(self.random_state)
        IDS.setstate(self.ids_state)
        try:
            return str(function(**arguments))
        except Exception as error:  # verifiers' error_formatter: f"{e}"
            return f"{error}"
        finally:
            self._save()


def rows() -> dict[str, dict]:
    """Every public task's row, as its domain's loader returns it, by task
    name."""
    out = {}
    for domain in PUBLIC_DOMAINS:
        for row in get_domain_dataset(domain):
            info = row["info"]
            info = json.loads(info) if isinstance(info, str) else info
            out[info["task_name"]] = {**row, "info": info}
    return out


def slug(name: str) -> str:
    """A task name as its directory: ``sales.lead_router`` is
    ``sales-lead-router``."""
    return name.replace(".", "-").replace("_", "-")


# ---------------------------------------------------------------------------
# What the fake reads
# ---------------------------------------------------------------------------


def _type(annotation) -> dict:
    origin, args = typing.get_origin(annotation), typing.get_args(annotation)
    if annotation is type(None):
        return {"k": "none"}
    if origin in (typing.Union, types.UnionType):
        return {"k": "union", "of": [_type(a) for a in args]}
    if origin is typing.Annotated:
        return _type(args[0])
    if origin in (list, list):
        return {"k": "list", "item": _type(args[0]) if args else {"k": "any"}}
    if origin in (set, set, frozenset):
        return {"k": "set", "item": _type(args[0]) if args else {"k": "any"}}
    if origin in (dict, dict):
        return {
            "k": "dict",
            "key": _type(args[0]) if args else {
                "k": "any"
            },
            "value": _type(args[1]) if args else {
                "k": "any"
            }
        }
    if origin is typing.Literal:
        return {"k": "literal", "values": list(args)}
    if annotation is typing.Any or annotation is object:
        return {"k": "any"}
    if annotation in (dict, dict):
        return {"k": "dict", "key": {"k": "any"}, "value": {"k": "any"}}
    if annotation in (list, list):
        return {"k": "list", "item": {"k": "any"}}
    if annotation in (set, set):
        return {"k": "set", "item": {"k": "any"}}
    if inspect.isclass(annotation):
        if issubclass(annotation, BaseModel):
            return {"k": "model", "name": model_key(annotation)}
        if issubclass(annotation, enum.Enum):
            return {
                "k": "literal",
                "values": [m.value for m in annotation],
                "enum": annotation.__name__
            }
        if issubclass(annotation, bool):
            return {"k": "bool"}
        if issubclass(annotation, _dt.datetime):
            return {"k": "datetime"}
        if issubclass(annotation, _dt.date):
            return {"k": "date"}
        simple = {str: "str", int: "int", float: "float"}
        if annotation in simple:
            return {"k": simple[annotation]}
        if annotation.__name__ == "Decimal":
            return {"k": "decimal"}
    raise TypeError(f"no type descriptor for {annotation!r}")


def model_key(model: type[BaseModel]) -> str:
    """A model's name in models.json: its module under ``schema`` and its
    class."""
    module = model.__module__.removeprefix("automationbench.schema.")
    return f"{module}.{model.__name__}"


def _factory(model: type[BaseModel], name: str, factory) -> dict:
    if factory in (list, dict, set):
        return {"factory": factory.__name__}
    if factory == _dt.datetime.now or factory == FrozenDatetime.now:
        return {"factory": "datetime.now"}
    if inspect.isclass(factory) and issubclass(factory, BaseModel):
        return {"factory": f"model:{model_key(factory)}"}
    qual = getattr(factory, "__qualname__", "")
    if "<lambda>" in qual:
        source = textwrap.dedent(inspect.getsource(factory)).strip()
        return {
            "factory": f"lambda:{model_key(model)}.{name}",
            "source": source
        }
    return {
        "factory":
        f"{factory.__module__.removeprefix('automationbench.')}.{qual}"
    }


def models_json() -> dict:
    """Every model of the world, by ``model_key``: its fields in order, their
    types, defaults and default factories, and its validators."""
    out: dict[str, dict] = {}
    todo = [WorldState]
    while todo:
        model = todo.pop()
        if model_key(model) in out:
            continue
        fields = []
        for name, field in model.model_fields.items():
            entry: dict = {"name": name, "type": _type(field.annotation)}
            if field.alias:
                entry["alias"] = field.alias
            if field.default_factory is not None:
                entry.update(_factory(model, name, field.default_factory))
            elif field.is_required():
                entry["required"] = True
            else:
                entry["default"] = to_jsonable_python(field.default)
            fields.append(entry)
            stack = [entry["type"]]
            while stack:
                t = stack.pop()
                if t["k"] == "model":
                    todo.append(
                        _model_class(model, t["name"], field.annotation))
                stack += t.get("of", []) + [
                    t[k] for k in ("item", "key", "value") if k in t
                ]
        decorators = model.__pydantic_decorators__
        out[model_key(model)] = {
            "fields":
            fields,
            "extra":
            model.model_config.get("extra"),
            "validate_assignment":
            bool(model.model_config.get("validate_assignment")),
            "before": [
                k for k, v in decorators.model_validators.items()
                if v.info.mode == "before"
            ],
            "after": [
                k for k, v in decorators.model_validators.items()
                if v.info.mode != "before"
            ],
            "field_validators": {
                k: list(v.info.fields)
                for k, v in decorators.field_validators.items()
            },
        }
    return dict(sorted(out.items()))


def _model_class(owner: type[BaseModel], name: str,
                 annotation) -> type[BaseModel]:
    stack = [annotation]
    while stack:
        a = stack.pop()
        if inspect.isclass(a) and issubclass(
                a, BaseModel) and model_key(a) == name:
            return a
        stack += list(typing.get_args(a))
    raise LookupError(f"{owner.__name__}: no model {name}")


def endpoints_json() -> dict:
    """``api_search``'s corpus as upstream builds it: the index lines, and
    each endpoint as a result shows it (its ``url``, in place of ``path``)."""
    from automationbench.tools.api import search
    schemas = search._load_schemas()
    lines = []
    for api_name, schema in sorted(schemas.items()):
        for endpoint in schema.get("endpoints", []):
            lines.append(search._build_index_line(api_name, endpoint))
    endpoints = {}
    for api_name, schema in schemas.items():
        for endpoint in schema.get("endpoints", []):
            result = {k: v for k, v in endpoint.items() if k != "path"}
            result["url"] = search._compute_url(api_name,
                                                schema.get("baseUrl", ""),
                                                endpoint.get("path", ""))
            endpoints[endpoint["id"]] = result
    return {"lines": lines, "endpoints": endpoints}


def tool_schemas() -> list[dict]:
    """The three tools as upstream's environment hands them to a model."""
    from automationbench.rubric import create_rubric
    from automationbench.runner import AutomationBenchEnv
    from datasets import Dataset
    env = AutomationBenchEnv(dataset=Dataset.from_list([{
        "prompt": [],
        "answer": "",
        "info": "{}"
    }]),
                             rubric=create_rubric(),
                             toolset="api")
    return [t["function"] for t in env._all_oai_tools]


def data_files() -> dict[Path, bytes]:
    return {
        DATA / "models.json":
        (json.dumps(models_json(), indent=1) + "\n").encode(),
        DATA / "endpoints.json":
        (json.dumps(endpoints_json(), indent=1) + "\n").encode(),
    }


# ---------------------------------------------------------------------------
# A task's files
# ---------------------------------------------------------------------------

COMMANDS = {
    "api_search": "search",
    "api_fetch": "fetch",
    "base64_encode": "base64-encode"
}

TOOLS_INTRO = (
    "## Tools\n"
    "\n"
    "Your tools are upstream's API tools, as the `api` CLI: `api search`, "
    "`api fetch` and\n"
    "`api base64-encode` (`api <command> --help` lists each one's flags). "
    "Each flag is the\n"
    "tool's parameter of the same name: `--params` and `--body` take a JSON "
    "string, as\n"
    "`params` and `body` do.\n")


def tools_json(schemas: list[dict]) -> list[dict]:
    return [{
        "name":
        "api",
        "description":
        "AutomationBench's API tools: search the API endpoints, call one, "
        "encode text.",
        "tools": [{
            "name": COMMANDS[s["name"]],
            "call": s["name"],
            "description": s["description"],
            "parameters": s["parameters"],
            "endpoint": {
                "url": f"http://automationbench/{s['name']}",
                "method": "POST"
            },
        } for s in schemas],
    }]


def instruction(row: dict, schemas: list[dict]) -> str:
    """Upstream's system prompt, the tools as the CLI carries them, then its
    user message."""
    system = "\n\n".join(m["content"] for m in row["prompt"]
                         if m["role"] == "system")
    user = "\n\n".join(m["content"] for m in row["prompt"]
                       if m["role"] == "user")
    tools = "\n".join(f"- `api {COMMANDS[s['name']]}` ({s['name']}): "
                      f"{s['description'].splitlines()[0]}" for s in schemas)
    return f"{system}\n\n{TOOLS_INTRO}\n{tools}\n\n## Task\n\n{user}\n"


def task_toml(row: dict) -> str:
    info = row["info"]
    upstream = (f"zapier/AutomationBench@{COMMIT[:7]} {info['task_name']} "
                f"(example {row['example_id']})")
    return f"""version = "1.0"

[metadata]
category = "{info['task_name'].split('.')[0]}"
upstream = "{upstream}"

[verifier]
# The rubric takes seconds.
timeout_sec = 120.0

[agent]
timeout_sec = 1800.0

[environment]
build_timeout_sec = 300.0
cpus = 1
memory_mb = 2048
storage_mb = 4096
# The agent reaches the world through the api CLI alone; curl and wget are
# off (environment/mirage.yaml).
allow_internet = false
"""


def mirage_yaml(name: str, epoch: str) -> str:
    head = (f"# {name}, on vfsbench_harbor's mirage environment "
            "(datasets/automationbench/generate.py writes it).")
    return f"""{head}
#
# The task's world is the automationbench kit fake (mocks/automationbench),
# seeded with the world upstream builds for the task (kit/, written from
# upstream, not committed), its clock at the task's epoch. Its tools are the
# api CLI (tools.json, workspace/tools.ts).
fakes:
  automationbench:
    fixture: kit/automationbench.json
    epoch: '{epoch}'
    state: /var/lib/mock-data/automationbench/automationbench.db
tools:
  file: tools.json
  dispatches: /var/lib/mock-data/automationbench/dispatches.jsonl
workspace:
  profiles:
    default:
      commands:
        deny:
        - commands: [curl, wget]
          reason: the world is reached through the api CLI
  clis:
    api: {{cli: api, config: {{url: '${{AUTOMATIONBENCH_URL}}'}}}}
"""


def nop_score(row: dict) -> float:
    """``partial_credit`` on the world as built, which is a nop's end world."""
    from automationbench.rubric import partial_credit
    info = row["info"]
    up = Upstream(row)
    state = {
        "info": {
            **info, "assertions":
            [strip_none_values(a) for a in info["assertions"]]
        },
        "initial_state": strip_none_values(info.get("initial_state", {})),
        "world": up.world
    }
    return partial_credit(state)


def task_files(
        row: dict,
        schemas: list[dict]) -> tuple[dict[str, bytes], dict[str, bytes]]:
    """A task's files: those committed, and those git ignores."""
    info = row["info"]
    up = Upstream(row)
    committed = {
        "instruction.md":
        instruction(row, schemas).encode(),
        "task.toml":
        task_toml(row).encode(),
        "environment/mirage.yaml":
        mirage_yaml(info["task_name"], up.epoch).encode(),
        "environment/tools.json":
        (json.dumps(tools_json(schemas), indent=1) + "\n").encode(),
        "tests/test.sh":
        TEST_SH.read_bytes(),
    }
    task = {
        "task_name": info["task_name"],
        "assertions": info["assertions"],
        "initial_state": info.get("initial_state", {}),
        "zapier_tools": info.get("zapier_tools", [])
    }
    ignored = {
        "environment/kit/automationbench.json":
        (json.dumps(up.fixture()) + "\n").encode(),
        "tests/task.json":
        (json.dumps(task, ensure_ascii=False) + "\n").encode(),
    }
    return committed, ignored


GITIGNORE = """\
# Made from upstream's data, which fetch.py writes again from the pinned
# package: each world's fixture (32 MB for all 600 tasks) and what the
# rubric reads besides the world.
*/workspace/fixtures/
*/workspace/verifier/task.json
"""


def job_yaml(tasks: list[str]) -> str:
    lines = [
        "# All 600 AutomationBench tasks.",
        "# From vfs-bench-2/, after datasets/automationbench/fetch.py:",
        "#   uv run --project formats/harbor harbor run -c "
        "datasets/automationbench/jobs/harbor.yaml -a oracle -n 32",
        "environment:",
        "  import_path: vfsbench_harbor:MirageEnvironment",
        "verifier:",
        "  import_path: vfsbench_harbor:MirageVerifier",
        "tasks:",
    ]
    lines += [
        f"  - path: datasets/automationbench/{task}/harbor"
        for task in sorted(tasks)
    ]
    return "\n".join(lines) + "\n"


def selected(
        all_rows: dict[str, dict]) -> tuple[dict[str, str], dict[str, str]]:
    """The tasks written, by directory name, and those left out, with why."""
    chosen, left = {}, {}
    for name, row in sorted(all_rows.items()):
        info = row["info"]
        initial = strip_none_values(info.get("initial_state", {}))
        services = compute_allowed_services(initial,
                                            info.get("assertions", []),
                                            info.get("zapier_tools", []))
        missing = sorted(set(services) - PORTED)
        if name in SKIPPED:
            left[name] = SKIPPED[name]
        elif missing:
            left[name] = f"no port of {', '.join(missing)}"
        else:
            chosen[slug(name)] = name
    return chosen, left


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--data",
                        action="store_true",
                        help="write only the fake's data files")
    parser.add_argument("tasks", nargs="*")
    args = parser.parse_args()
    failed = 0

    def put(path: Path, data: bytes) -> None:
        nonlocal failed
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                print(f"FAIL {path.relative_to(ROOT)} differs from what "
                      "upstream gives")
                failed += 1
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    for path, data in data_files().items():
        put(path, data)
    if args.data:
        return 1 if failed else 0
    all_rows = rows()
    chosen, left = selected(all_rows)
    wanted = args.tasks or sorted(chosen)
    schemas = tool_schemas()
    for task in wanted:
        if task not in chosen:
            print(f"FAIL {task}: not a task written here "
                  f"({left.get(chosen.get(task, ''), 'unknown')})")
            failed += 1
            continue
        row = all_rows[chosen[task]]
        nop = nop_score(row)
        if nop >= 1.0:
            print(f"FAIL {task}: nop scores {nop}")
            failed += 1
            continue
        committed, ignored = task_files(row, schemas)
        committed = placed(committed, "automationbench", task)
        ignored = {place(rel): data for rel, data in ignored.items()}
        target = OUT / task
        for rel, data in {**committed, **ignored}.items():
            put(target / rel, data)
        ours = {place("solution/solve.sh")} if task in SOLVED else set()
        for rel in ours:
            if not (target / rel).is_file():
                print(f"FAIL {task}: {rel} (ours) is missing")
                failed += 1
        for path in sorted(target.rglob("*")):
            rel = path.relative_to(target).as_posix()
            if (path.is_file() and rel not in committed and rel not in ignored
                    and rel not in ours):
                print(f"FAIL {task}: {rel} is not generated or ours")
                failed += 1
        if not args.check:
            print(f"written {task}")
    if not args.tasks:
        put(OUT / ".gitignore", GITIGNORE.encode())
        put(HERE / "jobs" / "harbor.yaml", job_yaml(sorted(chosen)).encode())
        for path in sorted(OUT.iterdir()) if OUT.is_dir() else []:
            if (path / "harbor").is_dir() and path.name not in chosen:
                print(f"FAIL {path.name}: not a task written here")
                failed += 1
    print(f"{len(chosen)} tasks, {len(left)} left out" +
          (f", {failed} failures" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
