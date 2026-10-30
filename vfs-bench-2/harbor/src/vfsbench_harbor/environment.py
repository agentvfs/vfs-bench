"""A Harbor environment served from a Mirage workspace instead of a container.

``harbor run --env vfsbench_harbor:MirageEnvironment`` builds nothing. A
task states its environment in one of two ways:

- ``environment/mirage.yaml`` (the tasks under ``harbor/tasks/``): its
  services are kit fakes the whole job shares (``fakes.py``). For each
  trial, ``start()`` seeds a run of its own on each fake, from the task's
  fixture, then runs ``harbor/mocks.ts`` to lay out its workspace.
- ``environment/Dockerfile`` (an upstream LiveClawBench task): ``mocks.ts``
  starts the trial's own copy of upstream's mocks.

Either way the trial then gets a Mirage daemon of its own, and its
workspace is created through the daemon's HTTP API. ``exec`` is the
daemon's ``/shell``. Every path Harbor uses is a disk mount, so uploads and
downloads are copies into and out of the mounts' host directories.

One daemon per trial keeps trials apart: each has its own network (its
``localhost:<port>`` reaches only its own mocks, or its own runs of the
shared fakes), event loop and crashes. Each daemon also listens for SSH on
the loopback, for the job's key alone, which is how a coding agent on the
host runs its tools in the workspace (agents.py).
``--ek daemon_url=<url>`` points the environment at a shared daemon
instead, which cannot route each trial to its own mocks until Mirage has a
per-workspace network map (see the README).
"""
import asyncio
import atexit
import functools
import json
import os
import re
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import httpx
import yaml
from harbor.environments.base import BaseEnvironment, ExecResult
from harbor.environments.capabilities import (EnvironmentCapabilities,
                                              EnvironmentResourceCapabilities)
from harbor.models.task.config import NetworkMode
from harbor.models.trial.paths import EnvironmentPaths
from harbor.utils.path_filter import filter_paths_by_patterns
from vfsbench_harbor import fakes

HARBOR = Path(__file__).resolve().parents[2]
ROOT = HARBOR.parent
MOCKS = HARBOR / "mocks.ts"
PRELOAD = HARBOR / "preload.ts"
DAEMON = ROOT / "submodule/mirage/typescript/packages/server/src/bin/daemon.ts"

# The task image's base, which runs LiveClawBench's mocks.
BASE = re.compile(r"FROM\s+liveclawbench-[a-z0-9-]+-base(:\S+)?",
                  re.IGNORECASE)
# The model's credentials stay with Harbor; neither the mocks nor the
# workspace gets them.
MODEL_ENV = re.compile(r".*_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
SQLITE = b"SQLite format 3\x00"
DONE = {"done", "failed", "canceled"}

# The characters JavaScript's encodeURIComponent leaves as they are, as the
# fake escapes a file's path (mocks/upstream/fake.ts).
URI_SAFE = "-_.!~*'()"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _snapshot(view: Path, live: Path) -> None:
    """Copy a mock's state file to where the workspace reads it.

    A SQLite file is copied whole with ``VACUUM INTO`` and set to the
    rollback journal: the mocks keep theirs in WAL mode, open, and
    Pyodide's SQLite cannot share a WAL with another process.
    """
    if not live.exists():
        view.unlink(missing_ok=True)
        return
    temp = view.with_name(f"{view.name}.tmp")
    temp.unlink(missing_ok=True)
    with live.open("rb") as f:
        sqlite = f.read(len(SQLITE)) == SQLITE
    if sqlite:
        source = sqlite3.connect(f"file:{live}?mode=ro", uri=True)
        try:
            source.execute("VACUUM INTO ?", (str(temp), ))
        finally:
            source.close()
        copy = sqlite3.connect(temp)
        try:
            copy.execute("PRAGMA journal_mode = DELETE")
        finally:
            copy.close()
    else:
        shutil.copyfile(live, temp)
    os.replace(temp, view)


@functools.cache
def ssh_key() -> tuple[Path, Path]:
    """The job's SSH key and the authorized_keys file holding it: one
    for the Harbor process, removed when it exits. Every trial's daemon
    admits it, and nothing else, on its own loopback port."""
    directory = Path(tempfile.mkdtemp(prefix="vfsbench-ssh-"))
    atexit.register(shutil.rmtree, directory, ignore_errors=True)
    key = directory / "id_ed25519"
    subprocess.run([
        "ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "vfsbench-harbor",
        "-f",
        str(key)
    ],
                   check=True)
    authorized = directory / "authorized_keys"
    shutil.copyfile(key.with_suffix(".pub"), authorized)
    return key, authorized


class MirageEnvironment(BaseEnvironment):
    """A trial's environment as a workspace on a Mirage daemon.

    Args:
        node: the Node binary (24.15 or later) that runs the mocks and the
            daemon.
        daemon_url: a running daemon to create the workspace on, in place of
            starting one for the trial.
    """

    # State files only the verifier reads (mirage.yaml's ``verifier_state``),
    # copied once ``reveal_verifier_state`` is called.
    _verifier_state: list[tuple[Path, Path]] = []
    _revealed = False

    def __init__(self,
                 *args,
                 node: str = "node",
                 daemon_url: str | None = None,
                 **kwargs):
        self._node = node
        self._daemon_url = daemon_url
        self._processes: list[asyncio.subprocess.Process] = []
        self._client: httpx.AsyncClient | None = None
        self._workspace_id = ""
        self._mounts: dict[str, dict[str, str]] = {}
        self._verifier: dict = {}
        self._state: list[tuple[Path, Path]] = []
        self._routes: dict[str, str] = {}
        self._env: dict[str, str] = {}
        self._runs: list[fakes.Run] = []
        self._url = ""
        self._ssh_port: int | None = None
        # The run's epoch and when the trial started, in ms, which together
        # are its clock: None where the task has no fakes, and the host's.
        self._epoch: int | None = None
        self._started = 0
        # One refresh at a time: overlapping ones would share each state
        # file's temporary copy. The thread that copies holds it, so a
        # caller canceled mid-copy (an exec's timeout, an agent's end)
        # leaves it held until the copy is done.
        self._refreshing = threading.Lock()
        self._workdir = "/"
        super().__init__(*args, **kwargs)
        self._run_dir = (self.trial_paths.trial_dir / "mirage").resolve()
        # The shared fakes' logs go in the job's directory, as files: Harbor
        # takes every directory there for a trial (and removes one with no
        # result when it resumes the job).
        self._fake_logs = self.trial_paths.trial_dir.parent.resolve()

    @staticmethod
    def type() -> str:
        return "mirage"

    @property
    def capabilities(self) -> EnvironmentCapabilities:
        # Always offline: a task asking for the internet gets only its mocks.
        return EnvironmentCapabilities(disable_internet=True)

    @classmethod
    def resource_capabilities(cls) -> EnvironmentResourceCapabilities:
        # No CPU or memory is reserved or capped for the task.
        return EnvironmentResourceCapabilities()

    @property
    def _mirage_yaml(self) -> Path:
        return self.environment_dir / "mirage.yaml"

    def _validate_definition(self):
        if self._mirage_yaml.is_file():
            if self.task_env_config.docker_image:
                raise ValueError("a mirage.yaml task names no image")
            return
        dockerfile = self.environment_dir / "Dockerfile"
        if not dockerfile.is_file():
            raise FileNotFoundError(
                f"{dockerfile} not found: the mirage environment runs a task "
                "with an environment/mirage.yaml, or a LiveClawBench task, "
                "whose environment/Dockerfile is FROM "
                "liveclawbench-<task>-base")
        lines = [
            line.strip() for line in dockerfile.read_text().splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        if not lines or BASE.fullmatch(lines[0]) is None:
            first = lines[0] if lines else "(empty)"
            raise ValueError(
                f"{dockerfile} is not FROM liveclawbench-<task>-base, so the "
                f"mirage environment cannot run it (first line: {first!r})")
        if self.task_env_config.docker_image or (
                self.environment_dir / "docker-compose.yaml").exists():
            raise ValueError("the mirage environment runs a Dockerfile only, "
                             "not an image or Compose")

    def _host_env(self) -> dict[str, str]:
        env = {
            k: v
            for k, v in os.environ.items() if not MODEL_ENV.fullmatch(k)
        }
        return {**env, "TZ": "UTC"}

    async def _spawn(self,
                     name: str,
                     *argv: str,
                     env: dict[str, str],
                     ready_line: bool = False) -> asyncio.subprocess.Process:
        """Start a process of the trial's, logging to ``<run>/<name>.log``.

        Its stdin stays open: each exits when it closes, so none outlives
        Harbor. ``ready_line`` keeps stdout for its ready line.
        """
        log = (self._run_dir / f"{name}.log").open("ab")
        process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=ROOT,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE if ready_line else log,
            stderr=log,
        )
        log.close()
        self._processes.append(process)
        return process

    async def _open_runs(self) -> dict[str, dict]:
        """Seed this trial's run on each shared fake its mirage.yaml names.

        Each fake starts on the first trial that needs it, seeded from that
        trial's fixture; every trial then resets a run of its own from its
        task's fixture, at the task's epoch, with the task's faults armed.
        """
        spec = yaml.safe_load(self._mirage_yaml.read_text()) or {}
        shared = fakes.pool()
        name = fakes.run_name(self.session_id)
        task = self.environment_dir.parent.name
        runs: dict[str, dict] = {}
        for service, block in (spec.get("fakes") or {}).items():
            fixture = shared.register(service, task,
                                      self.environment_dir / block["fixture"])
            fake = await asyncio.to_thread(shared.fake,
                                           service, fixture, self._node,
                                           self._host_env(), self._fake_logs)
            # A fake's `extras` may name the trial's run dir, `${RUN_DIR}`.
            extras = json.loads(
                json.dumps(block.get("extras")
                           or {}).replace("${RUN_DIR}", str(self._run_dir)))
            run = await shared.open(fake, name, fixture, block.get("epoch"),
                                    block.get("faults"), extras)
            self._runs.append(run)
            runs[service] = {"url": run.url, "db": str(run.db)}
            # Files a fake keeps beside the run's SQLite as upstream's mock
            # keeps them on disk (mocks/upstream), by the workspace path
            # the task reads each at: `<run>.db.files/<path, escaped>`.
            if block.get("files"):
                runs[service]["files"] = {
                    view: f"{run.db}.files/{quote(path, safe=URI_SAFE)}"
                    for view, path in block["files"].items()
                }
        return runs

    async def _plan(self, runs: dict[str, dict]) -> dict:
        """Start the mocks and read the plan ``mocks.ts`` writes."""
        mocks = await self._spawn(
            "mocks",
            self._node,
            str(MOCKS),
            "--task",
            str(self.environment_dir.parent.resolve()),
            "--run",
            str(self._run_dir),
            *(["--fakes", json.dumps(runs)] if runs else []),
            env=self._host_env(),
            ready_line=True,
        )
        assert mocks.stdout is not None
        while True:
            line = (await mocks.stdout.readline()).decode()
            if line == "":
                await mocks.wait()
                log = (self._run_dir / "mocks.log").read_text()
                raise RuntimeError(f"mocks.ts exited ({mocks.returncode}) "
                                   f"before it was ready:\n{log[-4000:]}")
            if line.startswith("PLAN="):
                return json.loads(
                    Path(line.removeprefix("PLAN=").strip()).read_text())

    async def _start_daemon(self, routes: dict[str, str], allow: list[str],
                            tools: dict | None) -> str:
        """Start the trial's own daemon, routing its network and with the
        task's tools as CLIs, if it has some; wait for it."""
        port = _free_port()
        self._ssh_port = _free_port()
        _, authorized = ssh_key()
        daemon = await self._spawn(
            "daemon",
            self._node,
            "--experimental-transform-types",
            "--no-warnings",
            "--import",
            str(PRELOAD),
            str(DAEMON),
            env={
                **self._host_env(),
                "MIRAGE_HOME":
                str(self._run_dir / "mirage-home"),
                "MIRAGE_DAEMON_PORT":
                str(port),
                "MIRAGE_SSH_HOST":
                "127.0.0.1",
                "MIRAGE_SSH_PORT":
                str(self._ssh_port),
                "MIRAGE_SSH_AUTHORIZED_KEYS":
                str(authorized),
                "VFSBENCH_ROUTES":
                json.dumps(routes),
                "VFSBENCH_ALLOW":
                json.dumps(allow),
                **({} if tools is None else {
                       "VFSBENCH_TOOLS": tools["file"],
                       "VFSBENCH_DISPATCHES": tools["dispatches"],
                   }),
                **({} if self._epoch is None else {
                       "VFSBENCH_EPOCH": str(self._epoch),
                       "VFSBENCH_STARTED": str(self._started),
                   }),
            },
        )
        url = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient() as client:
            for _ in range(600):
                if daemon.returncode is not None:
                    log = (self._run_dir / "daemon.log").read_text()
                    raise RuntimeError(
                        f"the Mirage daemon exited ({daemon.returncode}):\n"
                        f"{log[-4000:]}")
                try:
                    if (await
                            client.get(f"{url}/v1/health")).status_code == 200:
                        return url
                except httpx.TransportError:
                    pass
                await asyncio.sleep(0.1)
        raise RuntimeError(f"the Mirage daemon did not answer on {url}")

    async def start(self, force_build: bool) -> None:
        if self._run_dir.exists():
            shutil.rmtree(self._run_dir)
        self._run_dir.mkdir(parents=True)
        if self.network_policy.network_mode == NetworkMode.PUBLIC:
            self.logger.warning(
                "%s asks for the internet; the mirage workspace is offline "
                "and reaches only its mocks",
                self.environment_name,
            )
        runs = await self._open_runs() if self._mirage_yaml.is_file() else {}
        plan = await self._plan(runs)
        self._mounts = plan["mounts"]
        self._verifier = plan.get("verifier") or {}
        if plan.get("epoch"):
            self._epoch = int(
                datetime.fromisoformat(plan["epoch"].replace(
                    "Z", "+00:00")).timestamp() * 1000)
            self._started = int(time.time() * 1000)
        # Where Harbor's agents and verifier write, which Docker mounts.
        paths = EnvironmentPaths.for_os(self.os)
        for path in (paths.agent_dir, paths.verifier_dir, paths.artifacts_dir):
            self._host(str(path), write=True).mkdir(parents=True,
                                                    exist_ok=True)
        self._state = [(Path(view), Path(live))
                       for view, live in plan["state"]]
        self._verifier_state = [(Path(view), Path(live))
                                for view, live in plan.get("verifier_state", [])]
        self._workdir = self.task_env_config.workdir or plan["workdir"]
        self._env = dict(plan["config"].get("env") or {})
        routes = {} if self._network_disabled else plan["routes"]
        self._routes = dict(routes)
        # A mount or CLI reaches its service at the trial's run directly,
        # so these stay reachable with the network off.
        allow = plan.get("allow", [])
        url = self._daemon_url or await self._start_daemon(
            routes, allow, plan.get("tools"))
        self._url = url
        self._client = httpx.AsyncClient(base_url=url,
                                         timeout=httpx.Timeout(60, read=None))
        self._workspace_id = re.sub(r"[^A-Za-z0-9_-]", "-", self.session_id)
        reply = await self._client.post("/v1/workspaces",
                                        json={
                                            "id": self._workspace_id,
                                            "config": plan["config"]
                                        })
        if reply.status_code >= 300:
            raise RuntimeError("creating the workspace failed "
                               f"({reply.status_code}): {reply.text}")
        # The Dockerfile's RUN lines, as its build would run them.
        for step in plan["run"]:
            done = await self.exec(step["line"], cwd=step["cwd"])
            if done.return_code != 0:
                raise RuntimeError(
                    f"the Dockerfile's RUN {step['line']!r} exited "
                    f"{done.return_code} in the workspace:\n"
                    f"{done.stderr or done.stdout}")

    async def stop(self, delete: bool):
        try:
            if self._client is not None:
                try:
                    await self._client.post(
                        f"/v1/workspaces/{self._workspace_id}/close")
                    if self._daemon_url is None:
                        await self._client.post("/v1/shutdown")
                except httpx.TransportError:
                    pass
                await self._client.aclose()
                self._client = None
        finally:
            # The daemon, then the mocks: each stops on SIGTERM.
            for process in reversed(self._processes):
                if process.returncode is None:
                    process.send_signal(signal.SIGTERM)
                    try:
                        await asyncio.wait_for(process.wait(), 15)
                    except TimeoutError:
                        process.kill()
            self._processes = []
            # The trial's runs of the shared fakes, which stay up.
            for run in self._runs:
                try:
                    await fakes.pool().drop(run)
                except httpx.HTTPError:
                    pass
            self._runs = []
        if delete:
            # The logs and the plan stay; the workspace's files go.
            for child in self._run_dir.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)

    def _host(self, path: str, *, write: bool = False) -> Path:
        """The host file behind a workspace path, through its mount."""
        target = PurePosixPath(os.path.normpath(PurePosixPath("/", path)))
        prefixes = [p for p in self._mounts if target.is_relative_to(p)]
        if not prefixes:
            mounts = ", ".join(self._mounts)
            raise FileNotFoundError(
                f"{path} is outside the workspace's mounts ({mounts})")
        prefix = max(prefixes, key=len)
        if write and self._mounts[prefix]["mode"] == "read":
            raise PermissionError(f"{path} is on a read-only mount ({prefix})")
        return Path(self._mounts[prefix]["root"], target.relative_to(prefix))

    async def exec(
        self,
        command: str,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int | None = None,
        user: str | int | None = None,
    ) -> ExecResult:
        # The workspace has no users, so `user` changes nothing. The shell
        # API takes no environment, so it is exported ahead of the line; a
        # line with a working directory runs in a session of its own, so
        # neither outlives it, as in `docker exec`.
        assert self._client is not None, "the environment is not started"
        exports = "".join(
            f"export {name}={shlex.quote(value)}\n"
            for name, value in (self._merge_env(env) or {}).items()
            if NAME.fullmatch(name))
        await self.refresh_state()
        reply = await self._client.post(
            f"/v1/workspaces/{self._workspace_id}/shell",
            params={"background": "true"},
            json={
                "command": exports + command,
                "cwd": cwd or self._workdir
            },
        )
        reply.raise_for_status()
        job = reply.json()["job_id"]
        try:
            detail = await self._wait(job, timeout_sec)
        except asyncio.CancelledError:
            # A canceled exec (asyncio.wait_for, a trial's timeout) leaves
            # nothing running behind it to overlap what comes next.
            await asyncio.shield(self._client.delete(f"/v1/jobs/{job}"))
            raise
        if detail["status"] != "done":
            raise RuntimeError(f"the workspace's shell {detail['status']}: "
                               f"{detail.get('error')}")
        result = detail["result"]
        return ExecResult(stdout=result["stdout"],
                          stderr=result["stderr"],
                          return_code=result["exit_code"])

    async def _wait(self, job: str, timeout_sec: int | None) -> dict:
        """The shell job's detail once it ends; past ``timeout_sec`` the job
        is canceled and this raises."""
        assert self._client is not None
        started = time.monotonic()
        while True:
            left = None if timeout_sec is None else timeout_sec - (
                time.monotonic() - started)
            waited = await self._client.post(
                f"/v1/jobs/{job}/wait",
                json={} if left is None else {"timeout_s": max(left, 0)},
            )
            waited.raise_for_status()
            detail = waited.json()
            if detail["status"] in DONE:
                return detail
            if left is not None and time.monotonic() - started >= timeout_sec:
                await self._client.delete(f"/v1/jobs/{job}")
                raise RuntimeError(
                    f"Command timed out after {timeout_sec} seconds")

    def _refresh_state(self) -> None:
        """Bring each mock's state file in the workspace up to date; one
        refresh at a time."""
        with self._refreshing:
            for view, live in self._state:
                _snapshot(view, live)
            if self._revealed:
                for view, live in self._verifier_state:
                    _snapshot(view, live)

    def reveal_verifier_state(self) -> None:
        """From now on, refresh the state files only the verifier reads
        too: the agent's turn is over (``WorkspaceVerifier``)."""
        self._revealed = True

    async def refresh_state(self) -> None:
        """Bring each mock's state file in the workspace up to date, as
        every ``exec`` does first; one refresh at a time."""
        await asyncio.to_thread(self._refresh_state)

    # What a verifier run outside the workspace reads (microsandbox.py):
    # the trial's files, its routes and the container's environment.

    @property
    def disk_mounts(self) -> dict[str, Path]:
        """Each disk mount's workspace path, and its host directory."""
        return {path: Path(m["root"]) for path, m in self._mounts.items()}

    @property
    def routes(self) -> dict[int, str]:
        """Each upstream port the trial reaches on localhost, and the URL
        behind it: its own mock, or its run of a shared fake. Empty when the
        task turns the network off."""
        return {int(port): url for port, url in self._routes.items()}

    @property
    def container_env(self) -> dict[str, str]:
        """The environment every command sees, as the container's ``ENV``."""
        return dict(self._env)

    @property
    def ssh(self) -> dict | None:
        """How an agent on the host reaches the workspace over SSH: the
        trial's daemon's loopback port, the workspace as the user, and the
        job's key. None on a daemon the environment did not start."""
        if self._ssh_port is None:
            return None
        return {
            "host": "127.0.0.1",
            "port": self._ssh_port,
            "user": self._workspace_id,
            "key": str(ssh_key()[0]),
        }

    def now(self) -> datetime:
        """The trial's time, as its workspace and services read it: the
        run's epoch when the trial started, moving on since; the host's
        where the task has no epoch."""
        now = time.time() * 1000
        if self._epoch is not None:
            now += self._epoch - self._started
        return datetime.fromtimestamp(now / 1000, timezone.utc)

    @property
    def mcp_url(self) -> str:
        """The workspace's MCP endpoint on its daemon (streamable HTTP)."""
        return f"{self._url}/v1/workspaces/{self._workspace_id}/mcp"

    @property
    def verifier(self) -> dict:
        """What the task gives a verifier outside the workspace besides its
        files (mirage.ts's ``Verifier``): host directories to copy in, by VM
        path, and the variables whose URLs' hosts it reaches."""
        return self._verifier

    @property
    def workdir(self) -> str:
        """Where a command runs when Harbor names no directory."""
        return self._workdir

    def host_path(self, path: str, *, write: bool = False) -> Path:
        """The host file behind a workspace path."""
        return self._host(path, write=write)

    async def upload_file(self, source_path: Path | str, target_path: str):
        target = self._host(target_path, write=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target)

    async def upload_dir(self, source_dir: Path | str, target_dir: str):
        shutil.copytree(source_dir,
                        self._host(target_dir, write=True),
                        dirs_exist_ok=True)

    async def download_file(self, source_path: str, target_path: Path | str):
        Path(target_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(self._host(source_path), target_path)

    async def download_dir(self, source_dir: str, target_dir: Path | str):
        shutil.copytree(self._host(source_dir), target_dir, dirs_exist_ok=True)

    async def download_dir_with_exclusions(self, *, source_dir: str,
                                           target_dir: Path | str,
                                           exclude: list[str]) -> None:
        # Harbor's own packs a tar in the environment; the files are on the
        # host.
        shutil.copytree(self._host(source_dir),
                        target_dir,
                        dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns(*exclude))

    async def download_dir_filtered(
        self,
        *,
        source_dir: str,
        target_dir: Path | str,
        include=None,
        exclude=None,
        protect=None,
    ) -> None:
        source = self._host(source_dir)
        paths = [
            p.relative_to(source).as_posix() for p in source.rglob("*")
            if p.is_file()
        ]
        selected = filter_paths_by_patterns(paths,
                                            include=include,
                                            exclude=exclude)
        selected += [
            p for p in paths if p in (protect or ()) and p not in selected
        ]
        for name in selected:
            destination = Path(target_dir, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / name, destination)
