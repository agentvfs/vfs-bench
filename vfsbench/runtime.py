"""Run one benchmark attempt in a Mirage workspace with its own offline
Python guest."""

from __future__ import annotations

import asyncio
import re
import tempfile
import tomllib
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager, AsyncExitStack
from copy import deepcopy
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Self
from uuid import uuid4

from .dataset import Task
from .snapshot import SNAPSHOT, build
from .verifier import (AgentResult, CommandEvent, TrialReport, TrialTrace,
                       TrialView, VerificationResult, Verifier, VerifierConfig)

if TYPE_CHECKING:
    from mirage.workspace.workspace import Workspace


@dataclass(frozen=True, kw_only=True)
class TrialConfig:
    """Operator configuration. A fresh VM is restored from the supplied msb
    snapshot."""

    snapshot: str = SNAPSHOT
    auto_build_snapshot: bool = True
    cpus: int = 1
    memory: str = "2G"
    timeout_sec: int = 120
    work_dir: Path | None = None
    workspace_yaml: Path | None = None
    environment: str = "suite"
    suite_options: dict = field(default_factory=dict)
    verifier: VerifierConfig = field(default_factory=VerifierConfig)

    def __post_init__(self):
        if not isinstance(self.snapshot, str) or not self.snapshot.strip(
        ) or self.snapshot.startswith("-"):
            raise ValueError("snapshot must name a microsandbox snapshot")
        if type(self.auto_build_snapshot) is not bool:
            raise ValueError("auto_build_snapshot must be a boolean")
        for name in ("cpus", "timeout_sec"):
            value = getattr(self, name)
            if type(value) is not int or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if not re.fullmatch(r"[1-9][0-9]*[KMG]?", self.memory):
            raise ValueError("memory must be an msb size, for example '2G'")
        if not isinstance(self.suite_options, dict):
            raise ValueError("suite_options must be a table")
        if not isinstance(self.environment,
                          str) or not self.environment.strip():
            raise ValueError(
                "environment must name a suite or installed environment "
                "factory")

    @classmethod
    def from_toml(cls, path: str | Path) -> Self:
        """Read trial, suite_options and verifier settings. Resolve work_dir
        and workspace_yaml relative to this file."""
        path = Path(path).expanduser().resolve()
        with path.open("rb") as source:
            values = tomllib.load(source)
        if extra := values.keys() - {"trial", "suite_options", "verifier"}:
            raise ValueError(
                f"Unknown trial configuration sections: {sorted(extra)}")
        trial = dict(values.get("trial", {}))
        for key in ("work_dir", "workspace_yaml"):
            if key in trial:
                trial[key] = (path.parent /
                              Path(trial[key]).expanduser()).resolve()
        return cls(**trial,
                   suite_options=values.get("suite_options", {}),
                   verifier=VerifierConfig(**values.get("verifier", {})))


@dataclass
class TrialEnvironment:
    """Mirage settings, private state readers and the default verifier for
    one attempt."""

    workspace: dict
    verifier: Verifier | None = None
    instructions: str = ""
    python: bool = True
    install: Callable[[Workspace], Awaitable[None]] | None = None
    state_readers: dict[str, Callable[[],
                                      Awaitable]] = field(default_factory=dict)


EnvironmentFactory = Callable[[Task, TrialConfig, Path],
                              AbstractAsyncContextManager[TrialEnvironment]]


def _installed_environment(name: str) -> EnvironmentFactory:
    from importlib.metadata import entry_points

    found = tuple(entry_points(group="vfsbench.environments", name=name))
    if len(found) != 1:
        raise ValueError(
            f"Expected one installed vfsbench.environments entry point named "
            f"{name!r}")
    return found[0].load()


@dataclass(frozen=True)
class CommandResult:
    stdout: str
    stderr: str
    return_code: int


async def _msb_result(*args: str) -> CommandResult:
    proc = await asyncio.create_subprocess_exec(
        "msb",
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        output, error = await proc.communicate()
    except BaseException:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise
    return CommandResult(output.decode(errors="replace"),
                         error.decode(errors="replace"), proc.returncode)


async def _msb(*args: str) -> None:
    result = await _msb_result(*args)
    if result.return_code:
        raise RuntimeError(f"msb {args[0]} failed ({result.return_code}): "
                           f"{result.stderr or result.stdout}")


async def _restore_guest(config: TrialConfig, name: str) -> None:
    if config.snapshot == SNAPSHOT and config.auto_build_snapshot:
        await asyncio.to_thread(build)
    await _msb("restore", "--no-net", "--name", name, "--cpus",
               str(config.cpus), "--memory", config.memory, config.snapshot)


async def _remove_guest(name: str) -> None:
    try:
        await _msb("remove", "--force", name)
    except RuntimeError as exc:
        if "not found" not in str(exc).lower():
            raise


class VerifierGuest:
    """An offline VM with verifier inputs and a fresh disk from the
    operator's snapshot."""

    def __init__(self, config: TrialConfig):
        self.config = config
        self.name = f"vfsbench-grade-{uuid4().hex}"

    async def __aenter__(self) -> Self:
        try:
            await _restore_guest(self.config, self.name)
        except BaseException:
            await _remove_guest(self.name)
            raise
        return self

    async def __aexit__(self, *exc) -> None:
        await _remove_guest(self.name)

    async def run(self, files: dict[str, bytes],
                  argv: list[str]) -> CommandResult:
        with tempfile.TemporaryDirectory() as directory:
            for name, contents in files.items():
                relative = PurePosixPath(name)
                if not relative.parts or relative.is_absolute(
                ) or ".." in relative.parts or "\\" in name:
                    raise ValueError(f"Invalid verifier input name: {name!r}")
                dest = Path(directory, *relative.parts)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(contents)
            async with asyncio.timeout(self.config.timeout_sec):
                await _msb("copy", "--quiet", directory,
                           f"{self.name}:/grading")
                return await _msb_result("exec", "--workdir", "/grading",
                                         "--no-stdin", self.name, "--", *argv)


def _prepare(suite: str):
    if suite == "mcpatlas":
        from .suites.mcpatlas import prepare
    elif suite == "complexmcp":
        from .suites.complexmcp import prepare
    elif suite == "toolathlon":
        from .suites.toolathlon import prepare
    else:
        raise ValueError(f"No VFS-Bench trial adapter for dataset {suite!r}")
    return prepare


def _workspace_config(prepared: TrialEnvironment,
                      run_dir: Path,
                      name: str,
                      workspace_yaml: Path | None = None) -> dict:
    values = dict(prepared.workspace)
    mounts = dict(values.get("mounts", {}))
    if prepared.instructions:
        root = run_dir / "instructions"
        root.mkdir()
        (root / "INSTRUCTIONS.md").write_text(prepared.instructions,
                                              encoding="utf-8")
        mounts["/vfsbench"] = {
            "vfs": "disk",
            "mode": "read",
            "config": {
                "root": str(root)
            }
        }
    for directory in ("workspace", "tmp", "logs"):
        if f"/{directory}" not in mounts:
            root = run_dir / directory
            root.mkdir(exist_ok=True)
            mounts[f"/{directory}"] = {
                "vfs": "disk",
                "mode": "exec",
                "read": "fresh",
                "config": {
                    "root": str(root)
                },
            }
    values.setdefault("mode", "exec")
    values.setdefault("profiles", {"default": {"cwd": "/workspace"}})
    machines = {
        "python": {
            "provider": "microsandbox",
            "sandbox": name,
            "mount_type": "ssh",
            "captures": ["@python"],
            "env": {
                "PYTHONDONTWRITEBYTECODE": "1"
            }
        },
    } if prepared.python else {}
    values.update(mounts=mounts,
                  machines={
                      **(values.get("machines") or {}),
                      **machines
                  })
    if workspace_yaml is not None:
        from mirage.config import load_config

        overlay = load_config(Path(workspace_yaml).expanduser()).model_dump(
            exclude_unset=True, by_alias=True)
        reserved = {
            "mounts": set(prepared.workspace.get("mounts") or {}),
            "machines": set(values["machines"]),
            "clis": set(prepared.workspace.get("clis") or {}),
        }
        if prepared.instructions:
            reserved["mounts"].add("/vfsbench")
        for key, names in reserved.items():
            if conflicts := names.intersection(overlay.get(key) or {}):
                raise ValueError(
                    f"Workspace YAML replaces trial {key}: {sorted(conflicts)}"
                )
        for key in (*reserved, "profiles", "env", "secrets", "command_limits"):
            if additions := overlay.pop(key, None):
                values[key] = {**(values.get(key) or {}), **additions}
        values.update(overlay)
    network = values.get("network", False)
    if network is not False:
        if not isinstance(network, dict) or "allowed_domains" not in network:
            raise ValueError(
                "Trial networking requires an allowed_domains list")
        endpoints = [
            *network["allowed_domains"], *network.get("routes", {}).values()
        ]
        if any(not re.fullmatch(r"(127\.0\.0\.1|localhost|\[::1\]):[0-9]+",
                                endpoint) for endpoint in endpoints):
            raise ValueError(
                "Trial networking must name individual local mock server ports"
            )
    values["network"] = network
    return values


class Trial:
    """One isolated attempt. Use start/close explicitly or use an async
    context manager."""

    def __init__(self,
                 task: Task,
                 *,
                 config: TrialConfig | None = None,
                 verifier: Verifier | None = None,
                 environment: EnvironmentFactory | None = None):
        self.task = task
        self.config = config if config is not None else TrialConfig()
        if task._dataset.local_files_only:
            self.config = replace(self.config, auto_build_snapshot=False)
        if verifier is not None and self.config.verifier.name != "suite":
            raise ValueError("Select the verifier in Python or TOML")
        self._verifier = verifier
        if environment is not None and self.config.environment != "suite":
            raise ValueError("Select the environment in Python or TOML")
        self._environment = environment
        self.id = uuid4().hex
        self._stack: AsyncExitStack | None = None
        self._workspace: Workspace | None = None
        self._prepared: TrialEnvironment | None = None
        self._closed = False
        self._lock = asyncio.Lock()
        self.run_dir: Path | None = None
        self._suite: str | None = None
        self._started_at: str | None = None
        self._closed_at: str | None = None
        self._commands: list[CommandEvent] = []
        self._agent_trace: dict | None = None
        self._events: tuple[dict, ...] = ()
        self._result: AgentResult | None = None
        self._verification: VerificationResult | None = None
        self._verification_error: str | None = None
        self._sealed = False

    @property
    def workspace(self) -> Workspace:
        if self._workspace is None:
            raise RuntimeError("The trial is not running")
        return self._workspace

    @property
    def instructions(self) -> str:
        if self._prepared is None:
            raise RuntimeError("The trial is not running")
        return self._prepared.instructions

    @property
    def result(self) -> AgentResult | None:
        return deepcopy(self._result)

    @property
    def trace(self) -> TrialTrace:
        return TrialTrace(tuple(self._commands), deepcopy(self._agent_trace),
                          deepcopy(self._events))

    @property
    def report(self) -> TrialReport:
        ds = self.task._dataset
        return TrialReport(self.id, self.task.id, self._suite, ds.repo_id,
                           ds.revision, self.config.snapshot, self._started_at,
                           self._closed_at, self.trace, self.result,
                           deepcopy(self._verification),
                           self._verification_error)

    def _require_recording(self):
        if self._closed or self._workspace is None or self._sealed:
            raise RuntimeError(
                "Recording requires a running trial that has not entered "
                "verification")

    def record_result(self, result: AgentResult) -> None:
        self._require_recording()
        if not isinstance(result, AgentResult):
            raise TypeError("record_result expects an AgentResult")
        self._result = deepcopy(result)

    def record_agent_trace(self, trajectory: dict) -> None:
        self._require_recording()
        if not isinstance(trajectory, dict):
            raise TypeError(
                "record_agent_trace expects a trajectory dictionary")
        self._agent_trace = deepcopy(trajectory)

    async def service_state(self, name: str):
        """Read the current run's controller-side state while the trial is
        open."""
        async with self._lock:
            if self._prepared is None:
                raise RuntimeError("The trial is not running")
            if name not in self._prepared.state_readers:
                raise KeyError(
                    f"This trial has no service state named {name!r}")
            return deepcopy(await self._prepared.state_readers[name]())

    async def start(self) -> Self:
        from mirage.concurrency.limiter import run_blocking
        from mirage.config import (WorkspaceConfig, build_mcp_clis,
                                   resolve_secrets)
        from mirage.workspace.workspace import Workspace

        async with self._lock:
            if self._closed:
                raise RuntimeError(
                    "This trial is closed. Create a new trial for another "
                    "attempt.")
            if self._stack is not None:
                return self
            async with AsyncExitStack() as stack:
                parent = self.config.work_dir
                if parent is not None:
                    Path(parent).mkdir(parents=True, exist_ok=True)
                run = Path(
                    stack.enter_context(
                        tempfile.TemporaryDirectory(
                            prefix=f"vfsbench-{self.id}-",
                            dir=parent))).resolve()
                manifest = await asyncio.to_thread(lambda: self.task.manifest)
                self._suite = manifest["dataset"]
                prepare = self._environment
                if prepare is None:
                    name = self.config.environment
                    prepare = _prepare(
                        self._suite
                    ) if name == "suite" else _installed_environment(name)
                verifier = self._verifier
                if verifier is None:
                    verifier = self.config.verifier.load()
                prepared = await stack.enter_async_context(
                    prepare(self.task, self.config, run))
                if verifier is None:
                    verifier = prepared.verifier
                if not callable(getattr(verifier, "verify", None)):
                    raise TypeError(
                        "The trial needs a verifier, supplied by its "
                        "environment or operator")
                name = f"vfsbench-{self.id}"
                spec = WorkspaceConfig.model_validate(
                    _workspace_config(prepared, run, name,
                                      self.config.workspace_yaml))
                # Register cleanup before restore, which can allocate the VM
                # and then fail.
                if prepared.python:
                    stack.push_async_callback(_remove_guest, name)
                    await _restore_guest(self.config, name)
                spec = await resolve_secrets(spec)
                workspace = Workspace(**spec.to_workspace_kwargs(
                    mcp_clis=await build_mcp_clis(spec)))
                stack.push_async_callback(workspace.close)
                for prefix, (backend,
                             mountpoint) in spec.kernel_mounts().items():
                    await run_blocking(workspace.add_fuse_mount,
                                       prefix,
                                       mountpoint,
                                       backend=backend)
                if prepared.install is not None:
                    await prepared.install(workspace)
                await workspace.vfs_md("/VFS.md")
                await workspace.skill_md("/SKILL.md")
                self._stack = stack.pop_all()
                self._workspace = workspace
                self._prepared = prepared
                self.run_dir = run
                self._verifier = verifier
                self._started_at = datetime.now(UTC).isoformat()
        return self

    async def close(self) -> None:
        async with self._lock:
            self._closed = True
            if self._stack is None:
                return
            try:
                try:
                    if not self._sealed:
                        self._events = tuple(await
                                             self.workspace.observer.events())
                finally:
                    await self._stack.aclose()
            finally:
                self._stack = self._workspace = None
                self._prepared = self.run_dir = None
                self._environment = None
                self._verifier = None
                self._closed_at = datetime.now(UTC).isoformat()

    async def __aenter__(self) -> Self:
        return await self.start()

    async def __aexit__(self, *exc) -> None:
        await self.close()

    async def exec(self,
                   command: str,
                   *,
                   cwd: str | None = None,
                   timeout_sec: float | None = None,
                   env: dict[str, str] | None = None) -> CommandResult:
        async with self._lock:
            self._require_recording()
            started = datetime.now(UTC).isoformat()
            try:
                async with asyncio.timeout(
                        self.config.timeout_sec if timeout_sec is
                        None else timeout_sec):
                    result = await self.workspace.shell(command,
                                                        cwd=cwd,
                                                        env=env)
                    output = CommandResult(await result.stdout_str(), await
                                           result.stderr_str(),
                                           result.exit_code)
            except BaseException as exc:
                self._commands.append(
                    CommandEvent(command, cwd, started,
                                 datetime.now(UTC).isoformat(), None, "",
                                 type(exc).__name__))
                raise
            self._commands.append(
                CommandEvent(command, cwd, started,
                             datetime.now(UTC).isoformat(), output.return_code,
                             output.stdout, output.stderr))
            return output

    async def verify(self) -> VerificationResult:
        """Seal the agent trace and run the selected verifier while its
        services remain live."""
        async with self._lock:
            workspace = self.workspace
            if not self._sealed:
                self._sealed = True
                try:
                    self._events = tuple(await workspace.observer.events())
                except BaseException:
                    self._sealed = False
                    raise
            active = True
            view = TrialView(self.task, self.id, self.trace, self.result,
                             workspace.vfs, self._prepared.state_readers,
                             lambda: active)
            try:
                verdict = await self._verifier.verify(view)
                if not isinstance(verdict, VerificationResult):
                    raise TypeError(
                        "verify(trial) must return a VerificationResult")
                self._verification = deepcopy(verdict)
                self._verification_error = None
                return verdict
            except Exception as exc:
                self._verification = None
                self._verification_error = f"{type(exc).__name__}: {exc}"
                raise
            finally:
                active = False
