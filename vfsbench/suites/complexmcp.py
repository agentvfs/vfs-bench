"""Seed one ComplexMCP world and bind its software tools to a Mirage trial."""

import asyncio
import json
import os
import re
import shutil
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

from mirage.commands.cli.types import CLI, CLIHandler
from mirage.commands.spec.flag_view import FlagView
from mirage.commands.spec.types import Argument, CommandSpec
from mirage.io.types import IOResult
from nodejs_wheel.executable import ROOT_DIR

from ..runtime import TrialEnvironment
from ..verifier import SuiteVerifier
from .vendor.complexmcp.judge import judge_env

BUNDLE = Path(__file__).parent / "vendor/complexmcp/mock.mjs"


class Mock:

    def __init__(self, process):
        self.process = process
        self.lock = asyncio.Lock()

    async def request(self, op, **kwargs):
        data = json.dumps({
            "op": op,
            **kwargs
        }, allow_nan=False).encode() + b"\n"
        async with self.lock:
            proc = self.process
            try:
                proc.stdin.write(data)
                await proc.stdin.drain()
                line = await proc.stdout.readline()
                if not line:
                    raise RuntimeError("ComplexMCP mock exited during request")
                reply = json.loads(line)
            except BaseException:
                # An interrupted request may leave a reply pending on stdout.
                if proc.returncode is None:
                    proc.kill()
                raise
            if "error" in reply:
                raise RuntimeError(f"ComplexMCP {op} failed: {reply['error']}")
            return reply["result"]


def _shape(schema):
    branches = [s for s in schema.get("anyOf", []) if s.get("type") != "null"]
    return branches[0] if len(branches) == 1 else schema


def _argument(name, schema, required):
    shape = _shape(schema)
    kind = shape.get("type")
    item = shape.get("items", {}).get("type")
    return Argument("--" + name.replace("_", "-"),
                    action="append" if kind == "array"
                    and item in ("number", "integer", "string") else "store",
                    type={
                        "integer": "int",
                        "number": "float"
                    }.get(kind, "str"),
                    choices=("true", "false") if kind == "boolean" else tuple(
                        shape.get("enum", [])),
                    required=required and "default" not in schema,
                    help=schema.get("description"))


def _value(flags, name, schema):
    kind = _shape(schema).get("type")
    if kind == "number":
        return flags.as_float(name)
    if kind == "integer":
        return flags.as_int(name)
    if kind == "array":
        item = schema.get("items", {}).get("type")
        if item in ("number", "integer", "string"):
            values = flags.as_list(name)
            if len(values) == 1 and values[0].lstrip().startswith("["):
                return json.loads(values[0])
            convert = {"number": float, "integer": int, "string": str}[item]
            return [convert(value) for value in values]
    raw = flags.as_str(name)
    if kind == "boolean":
        return raw == "true"
    return raw if kind == "string" else json.loads(raw)


async def _call(mock, service, name, properties, accessor, paths, texts, ctx):
    flags = FlagView(ctx.flags, ctx.spec)
    try:
        args = {
            key: _value(flags, key, schema)
            for key, schema in properties.items() if key in (ctx.flags or {})
        }
    except ValueError as exc:
        return None, IOResult(exit_code=2, stderr=f"{exc}\n".encode())
    output = await mock.request("call", service=service, tool=name, args=args)
    return (output if output.endswith("\n") else output +
            "\n").encode(), IOResult()


def _cli(service, mock):
    commands, handlers = [], {}
    for tool in service["tools"]:
        schema = tool["parameters"]
        properties = schema["properties"]
        verb = tool["name"].replace("_", "-")
        commands.append(
            CommandSpec(name=verb,
                        description=tool["description"],
                        arguments=tuple(
                            _argument(k, s, k in schema.get("required", ()))
                            for k, s in properties.items())))
        handlers[verb] = CLIHandler(fn=partial(_call, mock, service["name"],
                                               tool["name"], properties),
                                    write=True)
    return CLI(spec=CommandSpec(name=service["name"],
                                description=service["description"],
                                subcommands=tuple(commands)),
               handlers=handlers)


def _inputs(task, run_dir):
    manifest = task.manifest
    targets = [
        a["target"] for a in manifest["assets"] if a["role"] == "corpus"
    ]
    for target, source in task.files(targets).items():
        if not re.fullmatch(
                r"software/Light[A-Za-z]+/corpus/[A-Za-z0-9_-]+\.yaml",
                target):
            raise ValueError(f"Invalid ComplexMCP corpus path: {target!r}")
        dest = run_dir / target
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
    public = task.files(["workspace/tools.json", "workspace/instructions.md"])
    tools = json.loads(public["workspace/tools.json"].read_bytes())
    guide = public["workspace/instructions.md"].read_text()
    return manifest, tools, guide


@asynccontextmanager
async def prepare(task, config, run_dir):
    manifest, tools, guide = await asyncio.to_thread(_inputs, task, run_dir)
    node = Path(ROOT_DIR) / ("node.exe" if os.name == "nt" else "bin/node")
    proc = await asyncio.create_subprocess_exec(
        node,
        BUNDLE,
        cwd=run_dir,
        env={"COMPLEXMCP_SRC": str(run_dir)},
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        limit=16 << 20)
    try:
        mock = Mock(proc)
        initial = await mock.request("init",
                                     seed=manifest["seed"],
                                     apps=manifest["apps"])

        async def install(workspace):
            for service in tools:
                workspace.register_cli(service["name"], _cli(service, mock))

        def score(final):
            with task.file("verifier/expected.json").open("rb") as stream:
                result = judge_env(initial, final, json.load(stream))
            return dict(reward=int(result["recall"] == result["total"]
                                   and result["misbehave"] == 0),
                        **result)

        async def evaluate(view):
            return await asyncio.to_thread(
                score, await view.service_state("complexmcp"))

        yield TrialEnvironment(
            workspace={"system_time": manifest["system_time"]},
            instructions=guide,
            install=install,
            state_readers={"complexmcp": partial(mock.request, "state")},
            verifier=SuiteVerifier(evaluate))
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        await proc.communicate()
