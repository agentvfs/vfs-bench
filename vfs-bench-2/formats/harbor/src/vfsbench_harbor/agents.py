"""Codex and Claude Code on the host, their tools in the trial's workspace.

    harbor run ... --env vfsbench_harbor:MirageEnvironment \\
      -a vfsbench_harbor:Codex -m openai/gpt-5.6-luna
    harbor run ... --env vfsbench_harbor:MirageEnvironment \\
      -a vfsbench_harbor:ClaudeCode -m anthropic/claude-sonnet-5-5

Harbor's own ``codex`` and ``claude-code`` agents install the CLI into the
container and run it there, which a Mirage workspace cannot do. These run
the CLI already on the host's ``PATH`` instead, one process per trial, and
put every tool call of the agent into the trial's workspace:

- Codex runs ``codex exec -C /`` with a Codex environment that is the
  trial's workspace (``$CODEX_HOME/environments.toml``, ``include_local =
  false``): its shell commands, file reads and patches go over SSH to the
  trial's daemon (``-s codex-exec``), the workspace as the user, the job's
  key as the login (environment.py). Its features that reach past the
  workspace (``CODEX_OFF``) and web search are off.
- Claude Code gets Mirage's tools alone: the workspace's MCP server on the
  trial's daemon (shell, read, write, edit, ls, grep, glob), with every
  built-in tool turned off (``--tools ""``), so nothing it does reaches the
  host.

Each CLI reaches its model through the trial's gateway (gateway.py), its
HTTPS proxy, which tells the model the run's date, as the workspace and
services have it, in place of the host's.

Neither CLI's tools go through ``MirageEnvironment.exec``, which brings
the workspace's copies of the services' state files up to date before
each command. So while a CLI runs, the copies are brought up to date
first and then every ``STATE_REFRESH`` seconds: a command sees the
services' state as it was at most that long before it ran.

Everything else is Harbor's: each agent's ``run()`` builds its config,
auth and command line as it does in a container, and its trajectory is
Harbor's ATIF from the CLI's own session logs. ``run()`` is handed a
stand-in environment (``_Host``) whose commands run on the host, with the
container paths the agent uses mapped to directories of the trial's and
``HOME`` a directory of its own, so the host user's ``~/.codex`` and
``~/.claude`` (config, skills, memory, MCP servers) never reach a trial.
"""
import asyncio
import contextlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from harbor.agents.installed.claude_code import ClaudeCode as HarborClaudeCode
from harbor.agents.installed.codex import Codex as HarborCodex
from harbor.environments.base import BaseEnvironment, ExecResult
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths
from vfsbench_harbor.environment import MirageEnvironment
from vfsbench_harbor.gateway import Gateway, authority

# Codex's features that reach past the workspace: they drive this machine
# (a browser, the screen) or run tools in OpenAI's cloud (the ChatGPT
# account's apps and plugins, image generation). A trial has none of them,
# nor web search, as a container offline would not.
CODEX_OFF = ("apps", "browser_use", "browser_use_external",
             "browser_use_full_cdp_access", "computer_use", "image_generation",
             "in_app_browser", "plugins", "remote_plugin")

# The endpoints each CLI reaches its model at, as (host, port, tls), whose
# requests the gateway gives the run's date; a base URL Harbor resolves
# adds its own.
CODEX_HOSTS = {("chatgpt.com", 443, True), ("api.openai.com", 443, True)}
CLAUDE_HOSTS = {("api.anthropic.com", 443, True)}

# Seconds between refreshes of the workspace's copies of the services'
# state files while a CLI runs.
STATE_REFRESH = 1.0

# The container paths Harbor's codex and claude-code agents write, each a
# directory of the trial's on the host.
MAPPED = ("/installed-agent", "/tmp/codex-secrets",
          "/tmp/claude-code-settings", EnvironmentPaths.agent_dir.as_posix())


class _Host:
    """The container a Harbor agent expects, as the host: ``exec`` runs a
    command in bash on the host, and ``upload_file`` copies a file, each
    with the container paths in ``MAPPED`` rewritten to directories of the
    agent's, in the command, its environment and its paths. ``HOME`` is
    the agent's own, ``env`` is added to every command's environment, and
    the agent runs from an empty directory of its own.

    Those directories are under a temporary one, not the trial's: a CLI
    tells its model where it runs (Claude Code its working directory and
    memory, Codex its skills), and the trial's path holds the job's date
    and name. ``finish()`` moves them into the trial's: the container's
    ``/logs/agent`` into ``agent_dir``, the rest into ``root``."""

    default_user = None

    def __init__(self,
                 root: Path,
                 agent_dir: Path,
                 env: dict[str, str] | None = None):
        self.trial, self.agent_dir = root.resolve(), agent_dir.resolve()
        # Absolute: the agent's commands run from a directory of their own.
        self.root = Path(tempfile.mkdtemp(prefix="vfsbench-agent-")).resolve()
        self.home = self.root / "home"
        self.env = env or {}
        self.cwd = self.root / "cwd"
        for directory in (self.home, self.cwd):
            directory.mkdir(parents=True, exist_ok=True)
        self.paths = {
            path: self.root / path.strip("/").replace("/", "-")
            for path in MAPPED
        }
        for host in self.paths.values():
            if re.search(r"[\s'\"\\$`]", str(host)):
                raise ValueError(f"{host}: a host path the agent's commands "
                                 "name cannot hold spaces, quotes or $")

    def host(self, path: str) -> str:
        """A path the agent names, on the host."""
        return re.sub("|".join(re.escape(p) + r"(?=/|\b|$)" for p in MAPPED),
                      lambda m: str(self.paths[m.group(0)]), path)

    async def exec(self,
                   command: str,
                   user: str | int | None = None,
                   env: dict[str, str] | None = None,
                   cwd: str | None = None,
                   timeout_sec: int | None = None) -> ExecResult:
        process = await asyncio.create_subprocess_exec(
            "bash",
            "-c",
            self.host(command),
            cwd=self.host(cwd) if cwd else self.cwd,
            env={
                **os.environ, "HOME": str(self.home),
                **self.env,
                **{
                    k: self.host(v)
                    for k, v in (env or {}).items()
                }
            },
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(process.communicate(),
                                              timeout_sec)
        except BaseException:
            if process.returncode is None:
                process.kill()
            await asyncio.shield(process.wait())
            raise
        return ExecResult(stdout=out.decode(errors="replace"),
                          stderr=err.decode(errors="replace"),
                          return_code=process.returncode or 0)

    async def upload_file(self, source_path: Path | str, target_path: str):
        target = Path(self.host(target_path))
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, target)

    async def upload_dir(self, source_dir: Path | str, target_dir: str):
        shutil.copytree(source_dir, self.host(target_dir), dirs_exist_ok=True)

    def finish(self) -> None:
        """The agent's directories moved into the trial's, where Harbor
        reads its logs once ``run()`` returns."""
        logs = self.paths[MAPPED[-1]]
        if logs.exists():
            shutil.copytree(logs,
                            self.agent_dir,
                            symlinks=True,
                            dirs_exist_ok=True)
            shutil.rmtree(logs)
        shutil.copytree(self.root,
                        self.trial,
                        symlinks=True,
                        dirs_exist_ok=True)
        shutil.rmtree(self.root, ignore_errors=True)


def _hosts(base_url: str | None) -> set[tuple[str, int, bool]]:
    """A base URL's endpoint, as ``(host, port, tls)``."""
    if not base_url:
        return set()
    url = urlsplit(base_url)
    if not url.hostname:
        return set()
    tls = url.scheme == "https"
    return {(url.hostname, url.port or (443 if tls else 80), tls)}


@contextlib.asynccontextmanager
async def _fresh_state(environment: MirageEnvironment):
    """The workspace's copies of the services' state files brought up to
    date now, and every ``STATE_REFRESH`` seconds until the block ends."""
    await environment.refresh_state()

    async def refresh() -> None:
        while True:
            await asyncio.sleep(STATE_REFRESH)
            await environment.refresh_state()

    task = asyncio.create_task(refresh())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def _gateway(hosts: set[tuple[str, int,
                                    bool]], environment: MirageEnvironment,
                   root: Path, trust: str) -> tuple[Gateway, dict[str, str]]:
    """The trial's gateway, started, and the environment that sends a
    CLI's requests through it: its proxy for every host but the loopback,
    where the workspace's own endpoints are, and its CA, trusted through
    the variable ``trust``."""
    gateway = Gateway(hosts, environment, root / "gateway.log")
    proxy = await gateway.start()
    proxies = ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy")
    return gateway, {
        **{
            name: proxy
            for name in proxies
        },
        "NO_PROXY": "127.0.0.1",
        "no_proxy": "127.0.0.1",
        trust: str(authority().bundle),
        # The trial's zone, as its workspace and services keep time.
        "TZ": "UTC",
    }


def _mirage(environment: BaseEnvironment) -> MirageEnvironment:
    if not isinstance(environment, MirageEnvironment):
        raise TypeError(
            "this agent runs on vfsbench_harbor:MirageEnvironment, "
            f"not {type(environment).__name__}")
    return environment


async def _host_version(program: str) -> str | None:
    """``<program> --version``, as the trial runs it: from the host's
    ``PATH``, where Harbor's own command would source ``~/.nvm`` first."""
    process = await asyncio.create_subprocess_exec(
        program,
        "--version",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL)
    out, _ = await process.communicate()
    return out.decode().strip() if process.returncode == 0 else None


class Codex(HarborCodex):
    """Harbor's codex agent, on the host, its tools in the workspace."""

    @staticmethod
    def name() -> str:
        return "codex-mirage"

    async def install(self, environment: BaseEnvironment) -> None:
        """Nothing: codex is the host's."""
        if shutil.which("codex") is None:
            raise RuntimeError("codex is not on the host's PATH")

    async def setup(self, environment: BaseEnvironment) -> None:
        _mirage(environment)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        await self.install(environment)
        if self._version is None:
            version = await _host_version("codex")
            if version:
                self._version = self.parse_version(version)

    def _build_effective_config(self,
                                openai_base_url: str | None = None
                                ) -> dict[str, Any]:
        config = super()._build_effective_config(openai_base_url)
        config["web_search"] = "disabled"
        # Plain bodies, so the gateway reads the date without decoding.
        config.setdefault("features",
                          {}).update({feature: False
                                      for feature in CODEX_OFF}
                                     | {"enable_request_compression": False})
        # No skills: Codex's bundled ones (image generation and the like)
        # run on the host, and their catalog names their directory under
        # the trial's, on the host, its date included.
        config.setdefault("skills", {}).update({
            "bundled": {
                "enabled": False
            },
            "include_instructions": False
        })
        return config

    def build_cli_flags(self) -> str:
        # Codex checks -C on the local disk; the workspace's commands run
        # where the trial's workdir is, as in the container.
        return " ".join(f for f in (super().build_cli_flags(), "--cd /") if f)

    async def run(self, instruction: str, environment: BaseEnvironment,
                  context: AgentContext) -> None:
        mirage = _mirage(environment)
        ssh = mirage.ssh
        if ssh is None:
            raise RuntimeError("the workspace has no SSH: codex needs the "
                               "trial's own daemon, not --ek daemon_url")
        root = self.logs_dir.parent / "agent-host"
        gateway, proxied = await _gateway(
            CODEX_HOSTS | _hosts(self._resolved_base_url()), mirage, root,
            "CODEX_CA_CERTIFICATE")
        host = _Host(root, self.logs_dir, proxied)
        codex_home = Path(host.host(self._REMOTE_CODEX_HOME.as_posix()))
        codex_home.mkdir(parents=True, exist_ok=True)
        args = [
            "-T", "-p",
            str(ssh["port"]), "-i", ssh["key"], "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=no", "-o",
            "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
            f"{ssh['user']}@{ssh['host']}", "-s", "codex-exec"
        ]
        (codex_home / "environments.toml").write_text(
            'default = "mirage"\ninclude_local = false\n\n'
            '[[environments]]\nid = "mirage"\nprogram = "ssh"\n'
            f"args = {json.dumps(args)}\n")
        try:
            async with _fresh_state(mirage):
                await super().run(instruction, host, context)
        finally:
            await gateway.close()
            host.finish()


class ClaudeCode(HarborClaudeCode):
    """Harbor's claude-code agent, on the host, with the workspace's MCP
    tools in place of its own."""

    @staticmethod
    def name() -> str:
        return "claude-code-mirage"

    async def install(self, environment: BaseEnvironment) -> None:
        """Nothing: claude is the host's."""
        if shutil.which("claude") is None:
            raise RuntimeError("claude is not on the host's PATH")

    async def setup(self, environment: BaseEnvironment) -> None:
        _mirage(environment)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        await self.install(environment)
        if self._version is None:
            version = await _host_version("claude")
            if version:
                self._version = self.parse_version(version)

    def build_cli_flags(self) -> str:
        # No built-in tool: Bash, Read, Edit and the rest would act on the
        # host. The workspace's MCP tools are the only ones; Harbor's
        # bypassPermissions lets them run unasked.
        return " ".join(f for f in (
            super().build_cli_flags(),
            "--tools ''",
            "--strict-mcp-config",
            f"--mcp-config {self._mcp_config}",
            "--allowedTools mcp__mirage",
        ) if f)

    async def run(self, instruction: str, environment: BaseEnvironment,
                  context: AgentContext) -> None:
        mirage = _mirage(environment)
        root = self.logs_dir.parent / "agent-host"
        base_url = super()._resolve_auth_env().get("ANTHROPIC_BASE_URL")
        gateway, proxied = await _gateway(CLAUDE_HOSTS | _hosts(base_url),
                                          mirage, root, "NODE_EXTRA_CA_CERTS")
        host = _Host(root, self.logs_dir, proxied)
        config = host.root / "mcp.json"
        config.write_text(
            json.dumps({
                "mcpServers": {
                    "mirage": {
                        "type": "http",
                        "url": mirage.mcp_url
                    }
                }
            }))
        self._mcp_config = str(config)
        try:
            async with _fresh_state(mirage):
                await super().run(instruction, host, context)
        finally:
            await gateway.close()
            host.finish()
