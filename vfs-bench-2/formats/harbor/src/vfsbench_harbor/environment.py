"""A Harbor environment served from a Mirage workspace instead of a container.

``harbor run --env vfsbench_harbor:MirageEnvironment`` builds nothing. A
task states its environment in ``environment/mirage.yaml``: its services
are kit fakes the whole job shares (``fakes.py``). For each trial,
``start()`` seeds a run of its own on each fake, from the task's fixture,
then has ``workspace/mirage.ts`` lay out its workspace, in one of a few
processes for the job.

The trial then gets a Mirage daemon of its own, and its
workspace is created through the daemon's HTTP API. ``exec`` is the
daemon's ``/shell``. Every path Harbor uses is a disk mount, so uploads and
downloads are copies into and out of the mounts' host directories.

One daemon per trial keeps trials apart: each has its own network (its
``localhost:<port>`` reaches only its own mocks, or its own runs of the
shared fakes), event loop and crashes. ``--ek workers=<n>`` runs every
trial's workspace on one daemon of the job's instead, with that many
worker processes, and ``--ek daemon_url=<url>`` on a daemon already
running. A coding agent on the host runs its tools in the workspace
through the daemon's codex-exec or MCP endpoint (agents.py).
"""
import asyncio
import atexit
import contextlib
import json
import os
import re
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
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

ROOT = Path(__file__).resolve().parents[4]
WORKSPACE = ROOT / "workspace"
PLAN = WORKSPACE / "mirage.ts"
PRELOAD = WORKSPACE / "preload.ts"
DAEMON = ROOT / "submodule/mirage/typescript/packages/server/src/bin/daemon.ts"

# The model's credentials stay with Harbor; neither the mocks nor the
# workspace gets them.
MODEL_ENV = re.compile(r".*_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
SQLITE = b"SQLite format 3\x00"
# How long the client keeps an idle connection to a daemon: under Node's
# 5 s keepAliveTimeout, after which the daemon closes it.
KEEPALIVE_SECONDS = 2

# The characters JavaScript's encodeURIComponent leaves as they are, as the
# fake escapes a file's path (mocks/upstream/fake.ts).
URI_SAFE = "-_.!~*'()"

# How many trials' daemons boot at once, however many trials run: a daemon
# that cannot get the CPU to boot in time fails its Fastify ready hook (10 s),
# as 103 booting together on 14 cores did. Each waits here only to start.
BOOTS = int(os.environ.get("VFSBENCH_DAEMON_BOOTS") or os.cpu_count() or 4)
_boots: asyncio.Semaphore | None = None


def _boot_slot() -> asyncio.Semaphore:
    global _boots
    if _boots is None:
        _boots = asyncio.Semaphore(BOOTS)
    return _boots


def agent_commands(events: list[dict], spans: list) -> list[dict]:
    """The ``command`` entries of a workspace's history whose time is in
    one of ``spans`` (each a start and an end in milliseconds, the end
    None while the block runs), and the ``result`` entries that answer
    them, in the history's order."""
    now = time.time() * 1000

    def within(at: float) -> bool:
        return any(start <= at <= (now if end is None else end)
                   for start, end in spans)

    kept = {
        e.get("id")
        for e in events
        if e.get("type") == "command" and within(e.get("timestamp", 0))
    }
    return [
        e for e in events
        if (e.get("type") == "command" and e.get("id") in kept) or (
            e.get("type") == "result" and e.get("parent") in kept)
    ]


# Harbor's oracle runs a task's solution file as one line; the workspace's
# shell runs the file's code instead, as typed (exec), so its history shows
# the code itself and what it wrote.
ORACLE = re.compile(r"\((/solution/[^\s()]+)\) > (/logs/agent/[\w.-]+) 2>&1")

# The job's daemons (--ek workers=N), each started on the first trial that
# needs it and serving every later one: a key is its Node, its workers and
# the dataset whose tools it registers.
_job_daemons: dict[tuple, asyncio.Task] = {}
_job_processes: list[subprocess.Popen] = []


def _stop_job_daemons() -> None:
    for process in _job_processes:
        if process.poll() is None:
            process.terminate()
    for process in _job_processes:
        try:
            process.wait(15)
        except subprocess.TimeoutExpired:
            process.kill()


atexit.register(_stop_job_daemons)


async def _job_daemon(node: str, workers: int, dataset: Path,
                      job_dir: Path) -> str:
    """The URL of the job's daemon with ``workers`` worker processes,
    started if it is not yet, with every task's tools of ``dataset`` as
    CLIs, each under its spec name (tools.ts). Its workspaces each hold to
    their own runs (``network``), so its process routes nothing
    (preload.ts)."""
    key = (node, workers, dataset)
    task = _job_daemons.get(key)
    # A daemon that failed to boot, or exited since, starts again.
    if task is None or (task.done() and
                        (task.cancelled() or task.exception() is not None
                         or task.result()[1].poll() is not None)):
        task = asyncio.ensure_future(
            _boot_job_daemon(node, workers, dataset, job_dir))
        _job_daemons[key] = task
    url, _ = await asyncio.shield(task)
    return url


def _tools_files(dataset: Path) -> list[str]:
    """Each task's tools file, as its workspace.yaml names it."""
    files = []
    for spec in sorted(dataset.glob("*/workspace/workspace.yaml")):
        tools = (yaml.safe_load(spec.read_text()) or {}).get("tools")
        if tools:
            files.append(str(spec.parent / tools["file"]))
    return files


async def _boot_job_daemon(node: str, workers: int, dataset: Path,
                           job_dir: Path) -> tuple[str, subprocess.Popen]:
    tools = os.pathsep.join(await asyncio.to_thread(_tools_files,
                                                    dataset)) or None
    port = _free_port()
    home = job_dir / f"mirage-daemon-{port}"
    home.mkdir(parents=True, exist_ok=True)
    # Every trial of the job, its grade and the console reading its history
    # call from this host, one caller to the daemon's per-address limit, so
    # its config raises it from the default 1000/minute.
    (home /
     "config.toml").write_text('[daemon]\nrate_limits = "ip=1000/second"\n')
    env = {
        **{
            k: v
            for k, v in os.environ.items() if not MODEL_ENV.fullmatch(k)
        },
        "MIRAGE_HOME": str(home),
        "MIRAGE_DAEMON_PORT": str(port),
        "MIRAGE_WORKERS": str(workers),
        "MIRAGE_WORKER_TYPE": "process",
        "TZ": "UTC",
        # Each trial's grade is a workspace here too (grade.ts).
        "VFSBENCH_GRADE": "1",
        **({} if tools is None else {
               "VFSBENCH_TOOLS": tools
           }),
    }
    with (home / "daemon.log").open("ab") as log:
        # Its stdin stays open: it exits when Harbor does (preload.ts).
        process = subprocess.Popen([
            node, "--experimental-transform-types", "--no-warnings",
            "--import",
            str(PRELOAD),
            str(DAEMON)
        ],
                                   cwd=ROOT,
                                   env=env,
                                   stdin=subprocess.PIPE,
                                   stdout=log,
                                   stderr=log)
    _job_processes.append(process)
    url = f"http://127.0.0.1:{port}"
    async with httpx.AsyncClient() as client:
        for _ in range(1200):
            if process.poll() is not None:
                raise RuntimeError(
                    f"the job's Mirage daemon exited ({process.returncode}):"
                    f"\n{(home / 'daemon.log').read_text()[-4000:]}")
            try:
                if (await client.get(f"{url}/v1/ready")).status_code == 200:
                    return url, process
            except httpx.TransportError:
                pass
            await asyncio.sleep(0.1)
    raise RuntimeError(f"the job's Mirage daemon did not answer on {url}")


class _Planner:
    """One of the job's ``mirage.ts --serve`` processes: it lays out one
    trial's run at a time, so no trial starts a Node process of its own to
    plan."""

    def __init__(self, node: str, log: Path):
        self._node = node
        self._log = log
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    async def plan(self, workspace: Path, run: Path, fakes: dict) -> dict:
        line, process = await self._ask(workspace, run, fakes)
        if line.startswith("PLAN="):
            return json.loads(
                Path(line.removeprefix("PLAN=").strip()).read_text())
        if line.startswith("ERROR="):
            raise RuntimeError("mirage.ts could not lay out the run:\n" +
                               json.loads(line.removeprefix("ERROR=")))
        raise RuntimeError(f"mirage.ts exited ({process.returncode}):\n"
                           f"{self._log.read_text()[-4000:]}")

    async def _ask(self, workspace: Path, run: Path,
                   fakes: dict) -> tuple[str, asyncio.subprocess.Process]:
        async with self._lock:
            if self._process is None or self._process.returncode is not None:
                with self._log.open("ab") as log:
                    self._process = await asyncio.create_subprocess_exec(
                        self._node,
                        str(PLAN),
                        "--serve",
                        cwd=ROOT,
                        env={
                            k: v
                            for k, v in os.environ.items()
                            if not MODEL_ENV.fullmatch(k)
                        },
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=log)
            process = self._process
            assert process.stdin is not None and process.stdout is not None
            process.stdin.write(
                json.dumps({
                    "workspace": str(workspace),
                    "run": str(run),
                    "fakes": fakes
                }).encode() + b"\n")
            await process.stdin.drain()
            return (await process.stdout.readline()).decode(), process


# How many of the job's trials are laid out at once, each by a planner of
# its own: one queues 256 trials' layouts behind each other.
PLANNERS = int(os.environ.get("VFSBENCH_PLANNERS") or 4)
_planners: dict[str, asyncio.Queue[_Planner]] = {}


def _netloc(url: str) -> str:
    """A URL's ``host:port``."""
    return httpx.URL(url).netloc.decode()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _stamp(live: Path) -> tuple | None:
    """A state file's size and time, and its WAL's, where a mock writes
    first: the same stamp, the same contents. None for no file."""
    live = Path(live)
    stamps = []
    for path in (live, live.with_name(f"{live.name}-wal")):
        try:
            stat = path.stat()
        except FileNotFoundError:
            stamps.append(None)
            continue
        stamps.append((stat.st_size, stat.st_mtime_ns))
    return None if stamps[0] is None else tuple(stamps)


def _copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


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


class MirageEnvironment(BaseEnvironment):
    """A trial's environment as a workspace on a Mirage daemon.

    Args:
        node: the Node binary (24.15 or later) that runs the mocks and the
            daemon.
        daemon_url: a running daemon to create the workspace on, in place of
            starting one for the trial.
        workers: run every trial's workspace on one daemon of the job's,
            with this many worker processes, in place of a daemon each.
    """

    def __init__(self,
                 *args,
                 node: str = "node",
                 daemon_url: str | None = None,
                 workers: int | None = None,
                 **kwargs):
        self._node = node
        self._daemon_url = daemon_url
        self._workers = None if workers is None else int(workers)
        self._processes: list[asyncio.subprocess.Process] = []
        self._client: httpx.AsyncClient | None = None
        self._workspace_id = ""
        self._mounts: dict[str, dict[str, str]] = {}
        self._state: list[tuple[Path, Path]] = []
        self._routes: dict[str, str] = {}
        self._env: dict[str, str] = {}
        self._runs: list[fakes.Run] = []
        # When an agent ran (`agent_run`), in the daemon's milliseconds.
        self._agent_spans: list[list[float | None]] = []
        self._url = ""
        # The run's epoch and when the trial started, in ms, which together
        # are its clock: None where the task has no fakes, and the host's.
        self._epoch: int | None = None
        self._started = 0
        # One refresh at a time: overlapping ones would share each state
        # file's temporary copy. The thread that copies holds it, so a
        # caller canceled mid-copy (an exec's timeout, an agent's end)
        # leaves it held until the copy is done.
        self._refreshing = threading.Lock()
        # Each state file's stamp and its copy's when it was last copied
        # (_stamp).
        self._stamps: dict[Path, tuple] = {}
        self._layout: asyncio.Future | None = None
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
    def workspace_dir(self) -> Path:
        """The task's ``workspace/``, which ``environment/mirage.yaml``
        names."""
        pointer = yaml.safe_load(
            (self.environment_dir / "mirage.yaml").read_text())
        return (self.environment_dir / pointer["workspace"]).resolve()

    @property
    def dataset(self) -> str:
        return self.workspace_dir.parent.parent.name

    @property
    def task_id(self) -> str:
        """The task's directory name, as its dataset names it."""
        return self.workspace_dir.parent.name

    @property
    def _mirage_yaml(self) -> Path:
        return self.workspace_dir / "workspace.yaml"

    def _validate_definition(self):
        if not (self.environment_dir / "mirage.yaml").is_file():
            raise FileNotFoundError(
                f"{self.environment_dir / 'mirage.yaml'} not found")
        if not self._mirage_yaml.is_file():
            raise FileNotFoundError(f"{self._mirage_yaml} not found")
        if self.task_env_config.docker_image:
            raise ValueError("a mirage task names no image")

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
        task = f"{self.dataset}.{self.task_id}"

        async def open_run(service: str, block: dict) -> dict:
            fixture = shared.register(service, task,
                                      self.workspace_dir / block["fixture"])
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
            # The workspace reaches the run at its own port.
            opened = {"url": run.address, "db": str(run.db)}
            # Files a fake keeps beside the run's SQLite as upstream's mock
            # keeps them on disk (mocks/upstream), by the workspace path
            # the task reads each at: `<run>.db.files/<path, escaped>`.
            if block.get("files"):
                opened["files"] = {
                    view: f"{run.db}.files/{quote(path, safe=URI_SAFE)}"
                    for view, path in block["files"].items()
                }
            return opened

        # Each fake its own process, so the trial's runs open side by side.
        blocks = spec.get("fakes") or {}
        opens = [
            asyncio.ensure_future(open_run(service, block))
            for service, block in blocks.items()
        ]
        try:
            opened = await asyncio.gather(*opens)
        except BaseException:
            # The others stop before the error goes on, each dropping its
            # run as it does, so none is added after stop() drops the rest.
            for open_ in opens:
                open_.cancel()
            if opens:
                await asyncio.wait(opens)
            raise
        return dict(zip(blocks, opened))

    async def _plan(self, runs: dict[str, dict]) -> dict:
        """Lay out the workspace and read the plan ``mirage.ts`` writes."""
        planners = _planners.get(self._node)
        if planners is None:
            planners = _planners[self._node] = asyncio.Queue()
            for i in range(PLANNERS):
                planners.put_nowait(
                    _Planner(
                        self._node,
                        self.trial_paths.trial_dir.parent / f"mirage-{i}.log"))
        planner = await planners.get()
        # A trial canceled while its run is laid out still reads its reply,
        # so the next trial's is its own, and its stop() waits for the
        # layout before it deletes the files.
        self._layout = asyncio.ensure_future(
            planner.plan(self.workspace_dir, self._run_dir, runs))
        self._layout.add_done_callback(lambda _: planners.put_nowait(planner))
        return await asyncio.shield(self._layout)

    async def _start_daemon(self, routes: dict[str, str], allow: list[str],
                            tools: dict | None) -> str:
        """Start the trial's own daemon, routing its network and with the
        task's tools as CLIs, if it has some; wait for it. At most
        ``BOOTS`` daemons boot at once."""
        async with _boot_slot():
            return await self._boot_daemon(routes, allow, tools)

    async def _boot_daemon(self, routes: dict[str, str], allow: list[str],
                           tools: dict | None) -> str:
        port = _free_port()
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
        await asyncio.to_thread(self._fresh_run_dir)
        if self.network_policy.network_mode == NetworkMode.PUBLIC:
            self.logger.warning(
                "%s asks for the internet; the mirage workspace is offline "
                "and reaches only its mocks",
                self.environment_name,
            )
        runs = await self._open_runs()
        plan = await self._plan(runs)
        self._mounts = plan["mounts"]
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
        self._workdir = self.task_env_config.workdir or plan["workdir"]
        self._env = dict(plan["config"].get("env") or {})
        routes = {} if self._network_disabled else plan["routes"]
        self._routes = dict(routes)
        # A mount or CLI reaches its service at the trial's run directly,
        # so these stay reachable with the network off.
        allow = plan.get("allow", [])
        if self._daemon_url is not None:
            url = self._daemon_url
        elif self._workers is not None:
            url = await _job_daemon(self._node, self._workers,
                                    self.workspace_dir.parent.parent,
                                    self.trial_paths.trial_dir.parent)
        else:
            url = await self._start_daemon(routes, allow, plan.get("tools"))
        self._url = url
        # An idle connection is dropped well before the daemon's own 5 s
        # (Node's keepAliveTimeout): at httpx's default, also 5 s, a request
        # can go out on a connection the daemon is closing (EPIPE).
        self._client = httpx.AsyncClient(
            base_url=url,
            timeout=httpx.Timeout(60, read=None),
            limits=httpx.Limits(keepalive_expiry=KEEPALIVE_SECONDS))
        self._workspace_id = re.sub(r"[^A-Za-z0-9_-]", "-", self.session_id)
        # The workspace's clock starts at the trial's time (Mirage's
        # system_time): `date`, file times and the runtimes read it.
        config = dict(plan["config"])
        if self._workers is not None:
            # The trial's runs alone, each at a port of its own, and each
            # upstream port on localhost routed to its run's.
            config["network"] = {
                "allowed_domains": sorted({_netloc(u)
                                           for u in allow}),
                "routes": {
                    f"{host}:{port}": _netloc(url)
                    for port, url in routes.items()
                    for host in ("localhost", "127.0.0.1")
                },
            }
        if self._epoch is not None:
            config["system_time"] = self.now().isoformat(
                timespec="milliseconds")
        reply = await self._client.post("/v1/workspaces",
                                        json={
                                            "id": self._workspace_id,
                                            "config": config
                                        })
        if reply.status_code >= 300:
            raise RuntimeError("creating the workspace failed "
                               f"({reply.status_code}): {reply.text}")
        # Mirage's VFS.md (the mounts) and SKILL.md (the CLIs, each one's
        # help) at the workspace's root, live and read-only.
        for kind in ("vfs", "skill"):
            reply = await self._client.put(
                f"/v1/workspaces/{self._workspace_id}/{kind}-md",
                json={"path": f"/{kind.upper()}.md"})
            if reply.status_code >= 300:
                raise RuntimeError(f"placing {kind.upper()}.md failed "
                                   f"({reply.status_code}): {reply.text}")
        # mirage.yaml's `run` lines, as a build would run them.
        for step in plan["run"]:
            done = await self.exec(step["line"], cwd=step["cwd"])
            if done.return_code != 0:
                raise RuntimeError(
                    f"mirage.yaml's run {step['line']!r} exited "
                    f"{done.return_code} in the workspace:\n"
                    f"{done.stderr or done.stdout}")

    async def stop(self, delete: bool):
        try:
            if self._client is not None:
                try:
                    try:
                        # The workspace's history (each line, its output and
                        # when it ran) outlives it, in the trial's mirage/.
                        history = await self._client.get(
                            f"/v1/workspaces/{self._workspace_id}/history")
                        if history.status_code == 200:
                            (self._run_dir / "history.json").write_text(
                                history.text)
                    finally:
                        # Closed whether or not its history was saved: a
                        # shared daemon outlives the trial.
                        await self._client.post(
                            f"/v1/workspaces/{self._workspace_id}/close")
                        if self._daemon_url is None and self._workers is None:
                            await self._client.post("/v1/shutdown")
                except httpx.TransportError:
                    pass
                finally:
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
            if self._layout is not None:
                await asyncio.wait([self._layout])
            await asyncio.to_thread(self._delete_files)

    def _fresh_run_dir(self) -> None:
        if self._run_dir.exists():
            shutil.rmtree(self._run_dir)
        self._run_dir.mkdir(parents=True)

    def _delete_files(self) -> None:
        """The logs and the plan stay; the workspace's files go."""
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
        oracle = ORACLE.fullmatch(command)
        if oracle:
            async with self.agent_run():
                done = await self.exec(
                    self._host(oracle[1]).read_text(), cwd, env, timeout_sec)
            log = self._host(oracle[2], write=True)
            log.parent.mkdir(parents=True, exist_ok=True)
            log.write_text(done.stdout + done.stderr)
            return done
        exports = "".join(
            f"export {name}={shlex.quote(value)}\n"
            for name, value in (self._merge_env(env) or {}).items()
            if NAME.fullmatch(name))
        await self.refresh_state()
        # The daemon cancels a line whose caller drops it, so a timeout or a
        # canceled exec (asyncio.wait_for, a trial's timeout) leaves nothing
        # running behind it to overlap what comes next.
        try:
            reply = await asyncio.wait_for(
                self._client.post(
                    f"/v1/workspaces/{self._workspace_id}/shell",
                    json={
                        "command": exports + command,
                        "cwd": cwd or self._workdir
                    },
                ), timeout_sec)
        except TimeoutError:
            raise RuntimeError(
                f"Command timed out after {timeout_sec} seconds") from None
        if reply.status_code >= 300:
            raise RuntimeError(f"the workspace's shell failed "
                               f"({reply.status_code}): {reply.text}")
        result = reply.json()
        return ExecResult(stdout=result["stdout"],
                          stderr=result["stderr"],
                          return_code=result["exit_code"])

    @contextlib.asynccontextmanager
    async def agent_run(self):
        """The block an agent runs in. The workspace's history records
        every command run in it, whoever ran it: the agent's (a host
        agent's shell tool, an oracle's solution) and the commands Harbor
        runs around the agent (``chmod`` of the solution, ``test -d`` of
        the artifacts) and the workspace's own ``run`` lines. The commands
        run in such a block are the agent's (``agent_history``): a host
        agent's run (agents.py) and an oracle's solution (``exec``) are
        blocks. A solution runs as typed, each of its lines a command,
        after the exports ``exec`` puts ahead of it, which are the block's
        first command."""
        span: list[float | None] = [time.time() * 1000, None]
        self._agent_spans.append(span)
        try:
            yield
        finally:
            span[1] = time.time() * 1000

    async def agent_history(self) -> list[dict]:
        """The commands an agent ran, from the workspace's history
        (``GET /history``: every session's, each line a ``command`` entry
        with its ``id`` and a ``result`` entry naming it as ``parent``,
        with its exit code, stdout and stderr): those run in an
        ``agent_run`` block, with their results, in the history's order."""
        assert self._client is not None, "the environment is not started"
        reply = await self._client.get(
            f"/v1/workspaces/{self._workspace_id}/history")
        reply.raise_for_status()
        return agent_commands(reply.json(), self._agent_spans)

    def _refresh_state(self,
                       *,
                       files_only: bool = False,
                       fresh: bool = False) -> None:
        """Bring each mock's state file in the workspace up to date, where
        it changed since its last copy, or every one (``fresh``); one
        refresh at a time."""
        with self._refreshing:
            for view, live in self._state:
                if files_only and live.is_file():
                    with live.open("rb") as source:
                        if source.read(len(SQLITE)) == SQLITE:
                            continue
                # The copy's stamp too: an agent can write the copy (one
                # under /tmp), which the next refresh copies again.
                stamp = _stamp(live)
                if not fresh and stamp is not None and self._stamps.get(
                        view) == (stamp, _stamp(view)):
                    continue
                _snapshot(view, live)
                self._stamps[view] = (stamp, _stamp(view))
            # Host agents write ATIF outside Mirage's /logs mount. Both
            # verifiers refresh before reading it; keep an oracle's own
            # in-workspace trajectory when there is no host trajectory.
            trajectory = self.trial_paths.agent_dir / "trajectory.json"
            if trajectory.is_file():
                target = self._host("/logs/agent/trajectory.json", write=True)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(trajectory, target)

    async def refresh_state(self) -> None:
        """Refresh the mocks' state and the host agent's trajectory, as
        every ``exec`` does first and a microVM verifier does before copying
        the mounts; one refresh at a time."""
        await asyncio.to_thread(self._refresh_state)

    async def refresh_verifier_files(self) -> None:
        """Refresh files/trajectory; native grading never copies a database.
        Each file is copied again: the agent may have written its copy since
        the last one, a stamp read from that copy included."""
        await asyncio.to_thread(self._refresh_state,
                                files_only=True,
                                fresh=True)

    # What a verifier run outside the workspace reads (microsandbox.py):
    # the trial's files, its routes and the container's environment.

    @property
    def grades(self) -> bool:
        """Whether its daemon grades the trial: the job's does (``grade``)."""
        return self._workers is not None

    async def grade(self, inputs: Path, timeout_sec: float) -> ExecResult:
        """Run ``grade`` in a workspace of its own on the job's daemon, over
        ``inputs`` (``request.json`` and what it names) as its read-only
        ``/``."""
        assert self._client is not None and self.grades
        workspace = f"{self._workspace_id}-grade"
        # Room for the inputs as ``grade`` reads them, past Mirage's 32 MiB
        # a workspace (a GAIA2 run's state is 24 MB, more in base64).
        size = sum(p.stat().st_size for p in inputs.iterdir() if p.is_file())
        config = {
            "mounts": {
                "/": {
                    "vfs": "disk",
                    "mode": "read",
                    "config": {
                        "root": str(inputs)
                    }
                }
            },
            "clis": {
                "grade": {
                    "cli": "grade"
                }
            },
            "max_memory": 2 * size + 32 * 1024 * 1024,
        }
        reply = await self._client.post("/v1/workspaces",
                                        json={
                                            "id": workspace,
                                            "config": config
                                        })
        if reply.status_code >= 300:
            raise RuntimeError("creating the grade workspace failed "
                               f"({reply.status_code}): {reply.text}")
        try:
            # As exec: a timeout drops the request, which cancels the line.
            reply = await asyncio.wait_for(
                self._client.post(f"/v1/workspaces/{workspace}/shell",
                                  json={
                                      "command": "grade",
                                      "cwd": "/"
                                  }), timeout_sec)
        finally:
            await self._client.post(f"/v1/workspaces/{workspace}/close")
        if reply.status_code >= 300:
            raise RuntimeError(f"the grade workspace's shell failed "
                               f"({reply.status_code}): {reply.text}")
        result = reply.json()
        return ExecResult(stdout=result["stdout"],
                          stderr=result["stderr"],
                          return_code=result["exit_code"])

    @property
    def node_binary(self) -> str:
        """The Node binary used by this trial and its trusted verifier."""
        return self._node

    async def snapshot_verifier_states(self, definitions: dict) -> dict:
        """Read native JSON views from this trial's existing fake services."""
        runs = {run.service: run for run in self._runs}

        async def read(alias, definition):
            run = runs.get(definition["service"])
            if run is None:
                raise ValueError(f"No live state source for {alias}")
            value = await fakes.pool().snapshot(run,
                                                definition.get("tables", []),
                                                definition.get("queries", []))
            return alias, value

        return dict(
            await
            asyncio.gather(*(read(alias, definition)
                             for alias, definition in definitions.items())))

    async def read_virtual_file(self, path: str) -> bytes | None:
        """Read RAM inputs without a shell command or state refresh."""
        if self._client is None:
            return None
        reply = await self._client.post(
            f"/v1/workspaces/{self._workspace_id}/vfs/read",
            json={
                "path": path,
                "stream": True
            },
        )
        if reply.status_code == 404:
            return None
        reply.raise_for_status()
        return reply.content

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

    def now(self, host: float | None = None) -> datetime:
        """The trial's time, as its workspace and services read it: the
        run's epoch when the trial started, moving on since; the host's
        where the task has no epoch. ``host`` is the host's ``time.time()``
        to read it at, so a caller can pair the two."""
        now = (time.time() if host is None else host) * 1000
        if self._epoch is not None:
            now += self._epoch - self._started
        return datetime.fromtimestamp(now / 1000, timezone.utc)

    @property
    def codex_exec_url(self) -> str:
        """The workspace's codex-exec endpoint on its daemon (WebSocket),
        which ``codex`` reaches as a remote environment."""
        url = f"ws{self._url[len('http'):]}"
        return f"{url}/v1/workspaces/{self._workspace_id}/codex-exec"

    @property
    def mcp_url(self) -> str:
        """The workspace's MCP endpoint on its daemon (streamable HTTP)."""
        return f"{self._url}/v1/workspaces/{self._workspace_id}/mcp"

    @property
    def workdir(self) -> str:
        """Where a command runs when Harbor names no directory."""
        return self._workdir

    def host_path(self, path: str, *, write: bool = False) -> Path:
        """The host file behind a workspace path."""
        return self._host(path, write=write)

    # Copies run in a thread, so no trial's holds up the others'.

    async def upload_file(self, source_path: Path | str, target_path: str):
        target = self._host(target_path, write=True)
        await asyncio.to_thread(_copy_file, Path(source_path), target)

    async def upload_dir(self, source_dir: Path | str, target_dir: str):
        await asyncio.to_thread(shutil.copytree,
                                source_dir,
                                self._host(target_dir, write=True),
                                dirs_exist_ok=True)

    async def download_file(self, source_path: str, target_path: Path | str):
        await asyncio.to_thread(_copy_file, self._host(source_path),
                                Path(target_path))

    async def download_dir(self, source_dir: str, target_dir: Path | str):
        await asyncio.to_thread(shutil.copytree,
                                self._host(source_dir),
                                target_dir,
                                dirs_exist_ok=True)

    async def download_dir_with_exclusions(self, *, source_dir: str,
                                           target_dir: Path | str,
                                           exclude: list[str]) -> None:
        # Harbor's own packs a tar in the environment; the files are on the
        # host.
        await asyncio.to_thread(shutil.copytree,
                                self._host(source_dir),
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

        def copy() -> None:
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
                _copy_file(source / name, Path(target_dir, name))

        await asyncio.to_thread(copy)
