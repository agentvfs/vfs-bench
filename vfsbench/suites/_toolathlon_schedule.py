"""Run the original student memory service and the private exam schedule
evaluator."""

import asyncio
import hashlib
import json
import os
import shutil
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from uuid import uuid4

from mcp import types

from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from ._mcpatlas_services import stdio_service, tool_cli
from ._npm import install_locked

VENDOR = Path(__file__).parent / "vendor/memory"
MANIFEST = "c98850e46adada130d55d6e557fead581d0d4c7fb8b7abc1e7b5405ca735c125"


class EmptyWebCapture:

    async def call_tool(self, name, arguments):
        target = arguments.get("url") or arguments.get("query")
        return types.CallToolResult(
            isError=True,
            content=[
                types.TextContent(
                    type="text",
                    text=f"No recorded response in the course-schedule web "
                    f"fixture for {target}")
            ])


def inputs(task, root, memory):
    if json.loads(task.file("shared/web_fixture.json").read_bytes()) != {}:
        raise ValueError("Unexpected Course Schedule web capture")
    for asset in task.manifest["source_assets"]:
        target = asset["target"]
        if not target.startswith("upstream/initial_workspace/"):
            continue
        name = target.removeprefix("upstream/initial_workspace/")
        dest = memory if name == "memory/memory.json" else root / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(task.file(target), dest)


@asynccontextmanager
async def memory_session(task, run_dir, memory, *, node_image=None):
    node, modules = await asyncio.to_thread(install_locked, task._dataset,
                                            VENDOR)
    declarations = json.loads((VENDOR / "course-tools.json").read_bytes())
    names = [s["command"].replace("-", "_") for s in declarations["memory"]]
    entry = "@modelcontextprotocol/server-memory/dist/index.js"
    async with AsyncExitStack() as stack:
        if node_image is None:
            argv = [str(node), str(modules / entry)]
            env = {"MEMORY_FILE_PATH": str(memory)}
        else:
            from ._woocommerce_store import docker
            root = run_dir / "workspace"
            path = "/workspace/" + memory.relative_to(root).as_posix()
            name = "vfsbench-memory-" + uuid4().hex
            stack.push_async_callback(docker,
                                      "rm",
                                      "--force",
                                      "--volumes",
                                      name,
                                      missing_ok=True)
            offline = task._dataset._local_files_only
            pull = "--pull=never" if offline else "--pull=missing"
            argv = [
                "docker", "run", "--rm", "-i", pull, "--name", name,
                "--network", "none", "--read-only", "--tmpfs", "/tmp",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--user", f"{os.getuid()}:{os.getgid()}", "--mount",
                f"type=bind,src={root},dst=/workspace", "--mount",
                f"type=bind,src={modules},dst=/opt/node_modules,readonly",
                "--env", "MEMORY_FILE_PATH=" + path, node_image, "node",
                "/opt/node_modules/" + entry
            ]
            env = {}
        session, tools = await stack.enter_async_context(
            stdio_service(argv, env, run_dir, names))

        async def graph():
            reply = await session.call_tool("read_graph", arguments={})
            if reply.is_error:
                raise RuntimeError(
                    "Could not read this trial's student memory")
            return json.loads(reply.content[0].text)

        yield tool_cli("memory", session, tools, names), graph


@asynccontextmanager
async def prepare(task, config, run_dir):
    manifest = await asyncio.to_thread(lambda: task.manifest)
    digest = hashlib.sha256(
        json.dumps(manifest, sort_keys=True,
                   separators=(",", ":")).encode()).hexdigest()
    if digest != MANIFEST:
        raise ValueError("Unexpected Course Schedule manifest")
    root = run_dir / "workspace"
    memory = run_dir / "student" / "memory.json"
    await asyncio.to_thread(inputs, task, root, memory)
    declarations = json.loads((VENDOR / "course-tools.json").read_bytes())
    async with memory_session(task, run_dir, memory) as (memory_cli, graph):

        async def install(workspace):
            workspace.register_cli("memory", memory_cli)
            for service in ("fetch", "web-search"):
                shapes = {s["command"]: s for s in declarations[service]}
                workspace.register_cli(
                    service,
                    tool_cli(service, EmptyWebCapture(), shapes, shapes))

        async def evaluate(view):

            def files():
                names = ["main.py", "check_local.py"]
                staged = {
                    "code/evaluation/" + n:
                    task.file("upstream/evaluation/" + n).read_bytes()
                    for n in names
                }
                staged.update({
                    "code/evaluation/__init__.py":
                    b"",
                    "requirements.json":
                    b"[]",
                    "trajectory.json":
                    b"{}",
                    "driver.py":
                    Path(__file__).with_name(
                        "_toolathlon_grader.py").read_bytes(),
                    "truth/exam_schedule.jsonl":
                    task.file(
                        "upstream/groundtruth_workspace/exam_schedule.jsonl").
                    read_bytes(),
                })
                return staged

            staged = await asyncio.to_thread(files)
            if await view.is_file("/workspace/exam_schedule.jsonl"):
                staged["agent/exam_schedule.jsonl"] = await view.read_file(
                    "/workspace/exam_schedule.jsonl")
            async with VerifierGuest(config) as guest:
                result = await guest.run(staged,
                                         ["python3", "-I", "driver.py"])
            if result.return_code not in (0, 10):
                raise RuntimeError(
                    f"Course Schedule grader failed: {result.stderr[-1000:]}")
            return {
                "reward": int(result.return_code == 0),
                "grader": "toolathlon/evaluation/main.py"
            }

        spec = {
            "mounts": {
                "/workspace/memory": {
                    "vfs": "disk",
                    "mode": "read",
                    "read": "fresh",
                    "config": {
                        "root": str(memory.parent)
                    }
                }
            },
            "clis": {
                n: {
                    "cli": n,
                    "machine": "in_process"
                }
                for n in ("office", "pdfinfo", "pdftotext")
            }
        }
        instructions = (
            "Read the student's knowledge graph with memory read-graph and "
            "the supplied course PDF "
            "and exam workbook under /workspace. Use office, pdftotext or "
            "Python. The supplied web "
            "capture contains no records. Write the completed "
            "exam_schedule.jsonl in /workspace.")
        yield TrialEnvironment(spec,
                               SuiteVerifier(evaluate),
                               instructions,
                               install=install,
                               state_readers={"memory": graph})
