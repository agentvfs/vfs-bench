"""The ``mirage`` topology: an env's server on this machine, in no sandbox.

An env registered with ``env_provider_type = "mirage"`` deploys as a
process of ``vfsbench_agentenv.server`` here, which runs the task's
workspace on Mirage, in place of a container. Its image is not built or run.

``deploy_env``'s ``artifact_id`` names the task's environment artifact. A
server outside agent-env's sandboxes is loaded from signed URLs, which the
local object store cannot give, so this reads the artifact's files from the
store itself and hands them to the server's ``data/add`` as files here.
"""
import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

import httpx
from agent_env.artifact.artifact import Artifact
from agent_env.config import get_config
from agent_env.env.env import DeployedEnv
from agent_env.env.envs._deployment import file_parts
from agent_env.providers.env_providers import EnvironmentProvider
from agentenv_protocol import client as protocol
from vfsbench_agentenv.server import RUNS, _free_port

CARD = "/.well-known/agent-env.json"


class MirageTopology(EnvironmentProvider):
    """An env's server as a process on this machine."""

    type = "mirage"

    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.url = ""
        self.files: Path | None = None

    async def deploy(self, env, sandbox_provider, **options) -> DeployedEnv:
        port = _free_port()
        RUNS.mkdir(parents=True, exist_ok=True)
        log = (RUNS / f"server-{env.environment_name}-{port}.log").open("ab")
        self.process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "vfsbench_agentenv.server",
            env={
                **os.environ, "ENVIRONMENT_NAME": env.environment_name,
                "MCP_HOST": "127.0.0.1",
                "MCP_PORT": str(port)
            },
            stdin=asyncio.subprocess.PIPE,
            stdout=log,
            stderr=log)
        log.close()
        self.url = url = f"http://127.0.0.1:{port}"
        card = await self._card(url)
        if options.get("artifact_id"):
            await self._load(url, options["artifact_id"],
                             options.get("artifact_version"))
        return DeployedEnv(env_id=env.id,
                           env_version=env.version,
                           env_provider_type=self.type,
                           environment_card_url=f"{url}{CARD}",
                           environment_card=card)

    async def _card(self, url: str) -> dict:
        async with httpx.AsyncClient() as client:
            for _ in range(300):
                if self.process.returncode is not None:
                    raise RuntimeError(f"the env's server exited "
                                       f"({self.process.returncode})")
                try:
                    reply = await client.get(f"{url}{CARD}")
                    if reply.status_code == 200:
                        return reply.json()
                except httpx.TransportError:
                    pass
                await asyncio.sleep(0.1)
        raise RuntimeError(f"the env's server did not answer on {url}")

    async def _load(self, url: str, artifact_id: str,
                    version: int | None) -> None:
        artifact = Artifact.get(artifact_id, version=version)
        files = artifact.get_file_artifacts()
        self.files = Path(tempfile.mkdtemp(prefix="vfsbench-load-"))
        uris = {}
        for path, file in files.items():
            target = self.files / path
            target.parent.mkdir(parents=True, exist_ok=True)
            store = get_config().get_object_store_at(file.object_url)
            target.write_bytes(await asyncio.to_thread(store.get,
                                                       file.object_url))
            uris[path] = target.as_uri()
        await protocol.reset_data(url, timeout=600)
        await protocol.add_data(url,
                                file_parts(artifact, files, uris),
                                timeout=600)

    async def close(self) -> None:
        """``data/reset`` closes the task's workspace, saving its history,
        before the server goes."""
        if self.process is not None and self.process.returncode is None:
            try:
                await protocol.reset_data(self.url, timeout=60)
            except Exception:
                pass
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), 30)
            except TimeoutError:
                self.process.kill()
        self.process = None
        if self.files is not None:
            shutil.rmtree(self.files, ignore_errors=True)
            self.files = None
