import asyncio
import json
import os
import re
import shutil
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

from nodejs_wheel.executable import ROOT_DIR

from ..cli.complexmcp import service_cli
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
            clis={s["name"]: service_cli(s, mock)
                  for s in tools},
            state_readers={"complexmcp": partial(mock.request, "state")},
            verifier=SuiteVerifier(evaluate))
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        await proc.communicate()
