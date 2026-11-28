import asyncio
import json
from contextlib import asynccontextmanager
from functools import partial
from uuid import uuid4

from ..cli.complexmcp import legacy_flag_cli, service_cli
from ..runtime import TrialEnvironment
from ..server import get_server
from ..snapshot import SNAPSHOT
from ..verifier import SuiteVerifier
from ._complexmcp_kit import tool_api
from .vendor.complexmcp.judge import judge_env


def _inputs(task, *, local_corpus):
    manifest = task.manifest
    corpus = {}
    if local_corpus:
        targets = [
            a["target"] for a in manifest["assets"] if a["role"] == "corpus"
        ]
        corpus = {
            name: source.read_text(encoding="utf-8")
            for name, source in task.files(targets).items()
        }
    public = task.files(["workspace/tools.json", "workspace/instructions.md"])
    tools = json.loads(public["workspace/tools.json"].read_bytes())
    guide = public["workspace/instructions.md"].read_text()
    return manifest, tools, guide, corpus


@asynccontextmanager
async def prepare(task, config, run_dir, *, run_id=None):
    use_kit = "complexmcp_kit_endpoints" in config.suite_options
    manifest, tools, guide, corpus = await asyncio.to_thread(
        _inputs, task, local_corpus=not use_kit)
    cli_format = manifest.get("cli_format", "flags")
    if cli_format not in {"mirage-mcp", "flags"}:
        raise ValueError(f"Unsupported ComplexMCP CLI format: {cli_format!r}")
    make_cli = service_cli if cli_format == "mirage-mcp" else legacy_flag_cli
    runtime = manifest.get("python_runtime", "cpython")
    if runtime not in {"monty", "cpython"}:
        raise ValueError(f"Unsupported ComplexMCP Python runtime: {runtime!r}")
    guest = (runtime == "cpython" or config.snapshot != SNAPSHOT
             or bool(config.python_packages))
    workspace = {"system_time": manifest["system_time"]}
    if not guest:
        workspace["machines"] = {
            "python": {
                "provider": "in_process",
                "runtime": "monty",
                "captures": ["@python"],
            }
        }
    server = await get_server(config.server_url)
    run_id = run_id or uuid4().hex
    settings = {key: manifest[key] for key in ("seed", "apps", "system_time")}
    settings.update(
        task=task.id,
        tools={s["name"]: [t["name"] for t in s["tools"]]
               for s in tools})
    if use_kit:
        settings["endpoints"] = config.suite_options[
            "complexmcp_kit_endpoints"]
        if settings["endpoints"] is None:
            raise ValueError(
                "Expected complexmcp_kit_endpoints to be a service mapping")
    api = tool_api(partial(server.call, run_id), tools)
    async with server._run(run_id, settings,
                           corpus), api as (call_tool, address):
        initial = await server.state(run_id)

        def score(final):
            with task.file("verifier/expected.json").open("rb") as stream:
                result = judge_env(initial, final, json.load(stream))
            return dict(reward=int(result["recall"] == result["total"]
                                   and result["misbehave"] == 0),
                        **result)

        async def evaluate(view):
            return await asyncio.to_thread(
                score, await view.service_state("complexmcp"))

        readers = {"complexmcp": partial(server.state, run_id)}
        if use_kit:
            readers["complexmcp_kit"] = partial(server.info, run_id)
        workspace["network"] = {"allowed_domains": [address]}
        yield TrialEnvironment(
            workspace=workspace,
            server=server,
            python=guest,
            instructions=guide,
            clis={s["name"]: make_cli(s, call_tool)
                  for s in tools},
            state_readers=readers,
            verifier=SuiteVerifier(evaluate))
