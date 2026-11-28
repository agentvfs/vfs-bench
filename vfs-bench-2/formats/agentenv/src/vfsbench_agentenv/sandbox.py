"""The ``mirage`` sandbox provider: a task's Mirage workspace as a sandbox.

An env's image is its folder's Dockerfile, whose ``LABEL workspace=`` names
the task's ``workspace/workspace.yaml`` under ``vfs-bench-2/``.
``prepare_image`` reads that from the image's build context in place of a
build, and ``create_sandbox(image_name, port, env)`` opens the workspace:
the task's runs on the fakes this process shares (``fakes.py``), and a
process of ``vfsbench_agentenv.server`` on this machine with that task
loaded over them, ``tunnel_urls[port]`` its URL. No image is built or run.
``exec`` runs on the workspace's shell, and ``terminate`` closes it
(``data/reset``, saving its history), stops the server and drops the
runs.
"""
import asyncio
import base64
import io
import os
import re
import shlex
import signal
import sys
import tarfile
from pathlib import Path

import httpx
from agent_env.config import get_config
from agent_env.providers.sandbox_providers.sandbox import Sandbox
from agent_env.providers.sandbox_providers.sandbox_provider import (
    SANDBOX_MODE_CONTAINER, Accepts, SandboxNotFoundError, SandboxProvider)
from agentenv_protocol import DataPart
from agentenv_protocol import client as protocol
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from vfsbench_agentenv import fakes
from vfsbench_agentenv.server import DATASETS, ROOT, RUNS, _free_port, run_id

CARD = "/.well-known/agent-env.json"
LOAD_TIMEOUT = 600

LABEL = re.compile(r"^LABEL\s+workspace=(\S+)\s*$", re.MULTILINE)

# The servers this process started and their tasks' runs, by sandbox id;
# the workspace.yaml each prepared image names, by image name.
_SERVERS: dict[str, asyncio.subprocess.Process] = {}
_RUNS: dict[str, list[fakes.Run]] = {}
_WORKSPACES: dict[str, str] = {}


def task_of(workspace: str) -> str:
    """``<dataset>/<task>`` of a task's ``workspace.yaml``, by its path under
    ``vfs-bench-2/``."""
    path = (ROOT / workspace).resolve()
    if path.name != "workspace.yaml" or not path.is_file():
        raise ValueError(f"not a task's workspace.yaml: {workspace}")
    return str(path.parent.parent.relative_to(DATASETS))


def workspace_of(image) -> str:
    """The workspace.yaml an image's Dockerfile names, from its build
    context."""
    url = image.build_context_object_url
    if not url:
        raise ValueError(f"{image.image_name} has no build context")
    data = get_config().get_object_store_at(url).get(url)
    name = image.dockerfile_path or "Dockerfile"
    with tarfile.open(fileobj=io.BytesIO(data)) as context:
        member = next((m for m in context.getmembers()
                       if m.isfile() and m.name.lstrip("./") == name), None)
        if member is None:
            raise ValueError(f"{image.image_name}'s context has no {name}")
        found = LABEL.search(context.extractfile(member).read().decode())
    if found is None:
        raise ValueError(f"{image.image_name}'s {name} names no workspace "
                         "(LABEL workspace=<its workspace.yaml>)")
    return found.group(1)


class _Done:
    """What ``exec`` returns: a finished process's output and status."""

    def __init__(self, code: int, stdout: str, stderr: str) -> None:
        self.returncode = code
        self.stdout = asyncio.StreamReader()
        self.stdout.feed_data(stdout.encode())
        self.stdout.feed_eof()
        self.stderr = asyncio.StreamReader()
        self.stderr.feed_data(stderr.encode())
        self.stderr.feed_eof()

    async def wait(self) -> int:
        return self.returncode


class MirageSandbox(Sandbox):
    """A task's workspace, served by its env server at ``url``."""

    type = "mirage"
    platform = None

    def __init__(self, sandbox_id: str, url: str, port: int) -> None:
        self.mode = SANDBOX_MODE_CONTAINER
        self.sandbox_id = sandbox_id
        self.url = url
        self.tunnel_urls = {port: url}
        self.vnc_url = None

    async def exec(self, *command: str) -> _Done:
        line = command[0] if len(command) == 1 else shlex.join(command)
        async with streamablehttp_client(f"{self.url}/mcp") as (read, write,
                                                                _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool("shell", {"command": line})
        text = "".join(getattr(part, "text", "") for part in result.content)
        return _Done(1 if result.isError else 0, text, "")

    async def write_file_from_text(self, content: str,
                                   destination_path: str) -> None:
        await self._write(content.encode(), destination_path)

    async def write_file_from_url(self, url: str,
                                  destination_path: str) -> None:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            reply = await client.get(url)
            reply.raise_for_status()
        await self._write(reply.content, destination_path)

    async def write_file_from_object(self, object_url: str,
                                     destination_path: str) -> None:
        store = get_config().get_object_store_at(object_url)
        await self._write(await asyncio.to_thread(store.get, object_url),
                          destination_path)

    async def _write(self, data: bytes, path: str) -> None:
        folder = shlex.quote(str(Path(path).parent))
        encoded = base64.b64encode(data).decode()
        process = await self.exec(
            f"mkdir -p {folder} && printf %s {encoded} | base64 -d"
            f" > {shlex.quote(path)}")
        if await process.wait():
            raise RuntimeError(f"writing {path} failed: "
                               f"{(await process.stdout.read()).decode()}")

    async def terminate(self) -> None:
        await _stop(self.sandbox_id)


class MirageSandboxProvider(SandboxProvider):
    """Each sandbox a task's workspace, by its ``workspace.yaml``."""

    CONTAINER_ACCEPTS = Accepts.NAME_OR_CONTEXT

    async def prepare_image(self, image, **_) -> None:
        _WORKSPACES[image.image_name] = await asyncio.to_thread(
            workspace_of, image)

    async def create_sandbox(self, *, image_name: str, port: int,
                             env: dict[str, str], **_) -> MirageSandbox:
        task = task_of(_WORKSPACES.get(image_name, image_name))
        own = _free_port()
        url = f"http://127.0.0.1:{own}"
        RUNS.mkdir(parents=True, exist_ok=True)
        run = run_id(task)
        runs = await fakes.open_task(task, run)
        try:
            with (RUNS / f"server-{task.replace('/', '-')}-{own}.log"
                  ).open("ab") as log:
                # Its stdin stays open: it exits when this process does.
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-m",
                    "vfsbench_agentenv.server",
                    env={
                        **os.environ,
                        **env, "MCP_HOST": "127.0.0.1",
                        "MCP_PORT": str(own)
                    },
                    stdin=asyncio.subprocess.PIPE,
                    stdout=log,
                    stderr=log)
        except BaseException:
            await fakes.close_task(runs)
            raise
        sandbox_id = f"mirage-{process.pid}-{own}"
        _SERVERS[sandbox_id] = process
        _RUNS[sandbox_id] = runs
        try:
            await _card(url, process)
            await protocol.add_data(url, [
                DataPart(data={
                    "task": task,
                    "run": run,
                    "fakes": fakes.views(task, runs)
                })
            ],
                                    timeout=LOAD_TIMEOUT)
        except BaseException:
            await _stop(sandbox_id)
            raise
        return MirageSandbox(sandbox_id, url, port)

    async def get_sandbox(self, sandbox_id: str) -> MirageSandbox:
        pid, own = _parse(sandbox_id)
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            raise SandboxNotFoundError(sandbox_id) from None
        return MirageSandbox(sandbox_id, f"http://127.0.0.1:{own}", own)

    async def terminate_sandbox(self, sandbox_id: str) -> None:
        await _stop(sandbox_id)


def _parse(sandbox_id: str) -> tuple[int, int]:
    try:
        _, pid, own = sandbox_id.split("-")
        return int(pid), int(own)
    except ValueError:
        raise SandboxNotFoundError(sandbox_id) from None


async def _card(url: str, process: asyncio.subprocess.Process) -> None:
    async with httpx.AsyncClient() as client:
        for _ in range(300):
            if process.returncode is not None:
                raise RuntimeError(
                    f"the env's server exited ({process.returncode})")
            try:
                if (await client.get(f"{url}{CARD}")).status_code == 200:
                    return
            except httpx.TransportError:
                pass
            await asyncio.sleep(0.1)
    raise RuntimeError(f"the env's server did not answer on {url}")


async def _stop(sandbox_id: str) -> None:
    """Close the workspace, saving its history, stop its server, then drop
    its runs."""
    pid, own = _parse(sandbox_id)
    process = _SERVERS.get(sandbox_id)
    if process is None or process.returncode is None:
        try:
            await protocol.reset_data(f"http://127.0.0.1:{own}", timeout=60)
        except Exception:
            pass
        if process is None:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        elif process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 30)
            except TimeoutError:
                process.kill()
                await process.wait()
    # A failed deletion leaves the runs and the exited process handle
    # available for retry. Repeating DELETE for an absent run succeeds.
    await fakes.close_task(_RUNS.get(sandbox_id, []))
    _RUNS.pop(sandbox_id, None)
    _SERVERS.pop(sandbox_id, None)
