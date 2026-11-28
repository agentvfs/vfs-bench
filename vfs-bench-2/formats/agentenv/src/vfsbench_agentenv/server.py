"""A vfs-bench-2 task's Mirage workspace as an agent-env environment.

    ENVIRONMENT_NAME=mirage MCP_PORT=<port> python -m vfsbench_agentenv.server

``data/add`` takes the task and its runs on the shared fakes, which the
process that started this one opened (``fakes.py``): ``{"task":
"<dataset>/<task>", "run": <its id>, "fakes": {<service>: {"url": <the
run's port>, "db": <its SQLite file>}}}``. It opens the task's workspace
over them:

- the layout (``workspace/mirage.ts``);
- the task's Mirage workspace, in this process (Mirage's Python
  ``Workspace``): its network those runs alone, its clock the task's, its
  tools CLIs (``tools.py``), ``/VFS.md`` and ``/SKILL.md``, and
  ``workspace.yaml``'s ``run`` lines run.

The agent's one tool is ``shell``: a bash line in that workspace.
``computer-exec/v1`` ``run`` runs a line in the task's grade workspace,
opened at its first call over the frozen state: the request the grader
takes read-only at ``/``, ``logs/`` writable, which ``data/get`` reads back
by path, and the ``grade`` CLI. Without paths, ``data/get`` answers that
request; ``data/reset`` closes everything.

``urn:mirage:workspace/v1`` ``snapshot`` answers the task's environment as
one JSON document, and ``load`` makes the environment a snapshot's: its
Mirage workspace (Mirage's own snapshot), each of its runs on the fakes
(the kit's), the state files beside them (the tools' dispatch log) and its
clock. A clone is a new env of the task, deployed as any, then loaded with
another's snapshot.

It exits when its stdin closes (its parent is gone), and its processes
with it.
"""
import asyncio
import base64
import hashlib
import importlib.util
import io
import json
import os
import re
import shlex
import shutil
import signal
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from functools import cache, wraps
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote, urlparse

import httpx
import yaml
from agentenv_protocol import (DATA_OBJECTS_EXTENSION_URI, AgentEnvEnvironment,
                               DataPart, FilePart, add_data, environment_card,
                               extension, get_data, reset_data, tool)
from agentenv_protocol.computer.card import COMPUTER_EXEC, MAX_EXEC_TIMEOUT_S
from agentenv_protocol.types import FileWithBytes
from mcp.types import CallToolResult, TextContent
from mirage.commands.cli.specs import CLI_SPECS, register_cli_spec
from mirage.commands.cli.types import CLI, CLIHandler
from mirage.commands.config import Context
from mirage.commands.spec.types import CommandSpec
from mirage.config import WorkspaceConfig
from mirage.io.types import IOResult
from mirage.server.logs import completed_logs, log_lines
from mirage.types import PathSpec
from mirage.workspace.snapshot import apply_state_dict, read_tar
from mirage.workspace.workspace import Workspace as Mirage
from vfsbench_agentenv import tools

ROOT = Path(__file__).resolve().parents[4]
DATASETS = ROOT / "datasets"
WORKSPACE = ROOT / "workspace"
RUNS = ROOT / "state" / "agentenv"
# The workspace's python3: CPython's WASI build (python.py), as Pyodide,
# which the TypeScript Mirage runs, has no Python twin.
WASI = ROOT / "state" / "cpython-wasi"
RUNNER = WORKSPACE / "verify.ts"
NODE = os.environ.get("VFSBENCH_NODE", "node")
MODEL_ENV = re.compile(r".*_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE")
SQLITE = b"SQLite format 3\x00"
# The task's test, a line in its grade workspace (computer-exec/v1 run):
# grade writes the grade, and its score the reward file.
# The datasets whose graders this format freezes for: the ones it has
# run end to end. Others' graders take helpers it doesn't give yet.
GRADED = ("complexmcp", )
REWARD = "logs/verifier/reward.txt"
GRADE_JSON = "logs/verifier/grade.json"
GRADE = f"grade > {GRADE_JSON} && jq -r .score {GRADE_JSON} > {REWARD}"
# The env's snapshot and load, named as Mirage names a workspace's.
WORKSPACE_EXTENSION = "urn:mirage:workspace/v1"
WORKSPACE_DESCRIPTION = (
    "The task's environment: snapshot answers it as one JSON document (its "
    "Mirage workspace, its runs on the fakes, the state files beside them "
    "and its clock), and load makes it a snapshot's, of the same task. A "
    "clone is a new env of the task loaded with another's snapshot.")


def _host_env() -> dict[str, str]:
    """This process's environment less the model's credentials."""
    env = {k: v for k, v in os.environ.items() if not MODEL_ENV.fullmatch(k)}
    return {**env, "TZ": "UTC"}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _netloc(url: str) -> str:
    return httpx.URL(url).netloc.decode()


def _snapshot(view: Path, live: Path) -> None:
    """Copy a fake's state file to where the workspace reads it: a SQLite
    file whole, with ``VACUUM INTO``, in the rollback journal."""
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


@cache
def _dataset_module(dataset: str):
    """``datasets/<dataset>/graders/verifier.py``: the dataset's grader
    definitions and how it freezes their inputs."""
    path = DATASETS / dataset / "graders" / "verifier.py"
    name = f"vfsbench_datasets.{dataset}.verifier"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class _Budget:
    """The bounds a dataset's ``freeze`` reads and writes under."""

    def __init__(self, timeout: float):
        self.deadline = time.monotonic() + timeout

    def check(self):
        if time.monotonic() > self.deadline:
            raise TimeoutError("freezing the grader's inputs timed out")

    def charge(self, size: int):
        self.check()

    def chunks(self, path: Path):
        with Path(path).open("rb") as f:
            while chunk := f.read(1024 * 1024):
                self.check()
                yield chunk

    def write_json(self, target: Path, value):
        self.check()
        Path(target).write_text(json.dumps(value))


async def _grade(_accessor, _paths: list[PathSpec], _texts: list[str],
                 ctx: Context) -> tuple[bytes | None, IOResult]:
    """The task's grade, as ``workspace/grade.ts`` grades in the
    TypeScript daemon: ``/request.json`` the request a grader's runner
    takes on its stdin, but for its frozen states and files, which
    ``paths`` names by their files beside it (``states`` as JSON, ``files``
    as base64). The runner (``workspace/verify.ts``, or the dataset's
    ``graders/verify.ts`` for a ``<dataset>-monty`` runtime) runs in node as
    Harbor's verifier runs it, in a process group it stops with the grade.
    The grade prints as one JSON line; a failed grade exits 1 with its
    error on stderr, and prints the artifacts it had."""
    request = json.loads(await ctx.vfs.read("/request.json"))
    paths = request.pop("paths", None)
    if paths is not None:
        request["states"] = {
            alias: json.loads(await ctx.vfs.read(path))
            for alias, path in paths["states"].items()
        }
        request["files"] = {
            name: base64.b64encode(await ctx.vfs.read(path)).decode()
            for name, path in paths["files"].items()
        }
    dataset = request["dataset"]
    runtime = request.get("runtime", "typescript")
    own = DATASETS / dataset / "graders" / "verify.ts"
    if runtime == "typescript":
        runner = RUNNER
    elif (re.fullmatch(r"[a-z0-9]+", dataset) and runtime == f"{dataset}-monty"
          and own.is_file()):
        runner = own
    else:
        return None, IOResult(
            exit_code=1,
            stderr=f"Unknown verifier runtime: {runtime}\n".encode())
    process = await asyncio.create_subprocess_exec(
        NODE,
        "--no-warnings",
        str(runner),
        cwd=ROOT,
        env={
            "PATH": os.environ.get("PATH", ""),
            "TZ": "UTC"
        },
        start_new_session=True,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    try:
        stdout, stderr = await process.communicate(
            json.dumps(request).encode())
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
    return stdout, IOResult(exit_code=process.returncode, stderr=stderr)


GRADE_CLI = CLI(spec=CommandSpec(
    name="grade",
    description="Grade a trial's frozen inputs (/request.json)."),
                handlers={"": CLIHandler(fn=_grade)})


def _config(plan: dict) -> dict:
    """The plan's workspace config, for Mirage's Python ``Workspace``:
    ``python3`` on CPython's WASI build where the TypeScript daemon runs
    Pyodide, the network the task's runs alone, each at a port of its own,
    and each upstream port on localhost routed to its run's."""
    config = dict(plan["config"])
    machines = dict(config.get("machines") or {})
    if any("snapshot" in m for m in machines.values()):
        raise NotImplementedError("a task on a microsandbox snapshot "
                                  "(JobBench) is not supported here yet")
    for name, machine in machines.items():
        if machine.get("runtime") == "pyodide":
            if not (WASI / "python.wasm").is_file():
                raise RuntimeError(f"no CPython WASI build at {WASI}: run "
                                   "formats/agentenv/python.py")
            machines[name] = {
                "provider":
                "in_process",
                "runtime":
                "wasi",
                "home":
                str(WASI),
                **({
                    "max_memory": machine["max_memory"]
                } if "max_memory" in machine else {}),
            }
    if machines:
        config["machines"] = machines
    config["network"] = {
        "allowed_domains": sorted({_netloc(u)
                                   for u in plan.get("allow", [])}),
        "routes": {
            f"{host}:{port}": _netloc(url)
            for port, url in plan["routes"].items()
            for host in ("localhost", "127.0.0.1")
        },
    }
    return config


class Workspace:
    """One task's open Mirage workspace, over its runs of the shared
    fakes."""

    def __init__(self, task: str, run: str | None = None):
        self.dataset, self.name = task.split("/")
        if self.dataset not in GRADED:
            raise ValueError(f"{self.dataset} isn't graded here yet; "
                             f"this format grades {', '.join(GRADED)}")
        self.dir = DATASETS / self.dataset / self.name / "workspace"
        if not (self.dir / "workspace.yaml").is_file():
            raise ValueError(f"no task {task} under {DATASETS}")
        self.id = run or run_id(task)
        self.run = RUNS / self.id
        self.processes: list[asyncio.subprocess.Process] = []
        self.mirage: Mirage | None = None
        self.fakes: dict[str, dict] = {}
        self.config: dict = {}
        self.dispatches: str | None = None
        self.routes: dict[int, str] = {}
        self.state: list[tuple[Path, Path]] = []
        self.workdir = "/"
        self.epoch: int | None = None
        self.started = 0
        self.restore_failed = False
        self.grade: Mirage | None = None
        self.logs = self.run / "verifier" / "logs"

    async def _spawn(self,
                     name: str,
                     *argv: str,
                     env: dict,
                     ready: bool = False) -> asyncio.subprocess.Process:
        """A process of the workspace's, logging to ``<run>/<name>.log``.
        Its stdin stays open: it exits when this server does."""
        log = (self.run / f"{name}.log").open("ab")
        process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=ROOT,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE if ready else log,
            stderr=log)
        log.close()
        self.processes.append(process)
        return process

    async def _line(self, process, prefix: str, name: str) -> str:
        """The first line of a process's stdout that starts with
        ``prefix``, less it."""
        while True:
            raw = await process.stdout.readline()
            if not raw:
                log = (self.run / f"{name}.log").read_text()
                raise RuntimeError(f"{name} exited ({process.returncode}) "
                                   f"before it was ready:\n{log[-4000:]}")
            line = raw.decode().strip()
            if line.startswith(prefix):
                return line.removeprefix(prefix)

    async def _plan(self, fakes: dict) -> dict:
        process = await self._spawn("mirage",
                                    NODE,
                                    str(WORKSPACE / "mirage.ts"),
                                    "--workspace",
                                    str(self.dir),
                                    "--run",
                                    str(self.run),
                                    "--fakes",
                                    json.dumps(fakes),
                                    env=_host_env(),
                                    ready=True)
        plan = await self._line(process, "PLAN=", "mirage")
        await process.wait()
        return json.loads(Path(plan).read_text())

    def now(self, host: float | None = None) -> datetime:
        """The task's clock: its epoch, moving on in real time."""
        host = time.time() if host is None else host
        if self.epoch is None:
            return datetime.fromtimestamp(host, timezone.utc)
        ms = self.epoch + int(host * 1000) - self.started
        return datetime.fromtimestamp(ms / 1000, timezone.utc)

    async def open(self, fakes: dict) -> None:
        """The workspace over the task's runs (``data/add``'s ``fakes``)."""
        self.run.mkdir(parents=True, exist_ok=True)
        spec = yaml.safe_load((self.dir / "workspace.yaml").read_text()) or {}
        wanted = sorted(spec.get("fakes") or {})
        if sorted(fakes) != wanted:
            raise ValueError(f"{self.dataset}/{self.name} runs on the fakes "
                             f"{', '.join(wanted) or 'none'}, not "
                             f"{', '.join(sorted(fakes)) or 'none'}")
        # The layout takes each run's port and files; the fake's own URL
        # is this server's alone.
        plan = await self._plan({
            service: {
                k: v
                for k, v in fake.items() if k != "kit"
            }
            for service, fake in fakes.items()
        })
        self.fakes = fakes
        if plan.get("epoch"):
            self.epoch = _ms(plan["epoch"])
            self.started = int(time.time() * 1000)
        self.routes = {int(p): u for p, u in plan["routes"].items()}
        self.state = [(Path(v), Path(l)) for v, l in plan["state"]]
        self.workdir = plan["workdir"]
        if plan.get("tools") is not None:
            tools.register(Path(plan["tools"]["file"]))
            self.dispatches = plan["tools"]["dispatches"]
        self.config = _config(plan)
        self.mirage = self._mirage()
        await self._documents()
        for step in plan["run"]:
            done = await self.shell(step["line"], step["cwd"])
            if done["exit_code"] != 0:
                raise RuntimeError(f"workspace.yaml's run {step['line']!r} "
                                   f"exited {done['exit_code']}:\n"
                                   f"{done['stderr'] or done['stdout']}")
        # The agent's lines run in the workspace's session, from its
        # working directory: a cd or export holds for the next line.
        await self.shell(f"cd {shlex.quote(self.workdir)}")

    def _mirage(self) -> Mirage:
        """The task's Mirage workspace as its config makes it, its clock at
        the task's time."""
        config = dict(self.config)
        if self.epoch is not None:
            config["system_time"] = self.now().isoformat(
                timespec="milliseconds")
        return Mirage(
            **WorkspaceConfig.model_validate(config).to_workspace_kwargs())

    async def _documents(self) -> None:
        """Mirage's VFS.md (the mounts) and SKILL.md (the CLIs, each one's
        help) at the workspace's root, live and read-only."""
        await self.mirage.vfs_md("/VFS.md")
        await self.mirage.skill_md("/SKILL.md")

    def _files(self) -> dict[str, Path]:
        """The state files beside the fakes' runs (the tools' dispatch
        log), each by its view's path under the run, which a clone's run
        has too."""
        dbs = {Path(fake["db"]) for fake in self.fakes.values()}
        return {
            view.relative_to(self.run).as_posix(): live
            for view, live in self.state if live not in dbs
        }

    async def snapshot(self) -> dict:
        """The task's environment as one document, which ``load`` takes:
        its Mirage workspace (Mirage's snapshot, base64), each run on the
        fakes (the kit's ``GET /_kit/runs/<run>/snapshot``), the state
        files beside them and the task's time."""
        tar = io.BytesIO()
        await self.mirage.snapshot(tar)

        async def run(client: httpx.AsyncClient, service: str) -> dict:
            reply = await client.get(
                f"{self.fakes[service]['kit']}/_kit/runs/{self.id}/snapshot")
            if reply.status_code != 200:
                raise RuntimeError(f"snapshotting run {self.id} of the "
                                   f"{service} fake failed "
                                   f"({reply.status_code}): {reply.text}")
            return reply.json()

        services = sorted(self.fakes)
        async with httpx.AsyncClient(timeout=300) as client:
            runs = await asyncio.gather(*(run(client, s) for s in services))
        return {
            "task": f"{self.dataset}/{self.name}",
            "time": self.now().isoformat(timespec="milliseconds"),
            "mirage": base64.b64encode(tar.getvalue()).decode(),
            "fakes": dict(zip(services, runs)),
            "calls": tools.CALLS.get(self.dispatches, 0),
            "files": {
                view: base64.b64encode(live.read_bytes()).decode()
                for view, live in self._files().items() if live.exists()
            },
        }

    def _decode(self, snapshot: dict, staging: Path) -> tuple:
        """Decode local state before sending a load to any service."""
        task = f"{self.dataset}/{self.name}"
        if snapshot.get("task") != task:
            raise ValueError(f"a snapshot of {snapshot.get('task')}, "
                             f"not {task}")
        runs = snapshot["fakes"]
        if (not isinstance(runs, dict) or runs.keys() != self.fakes.keys()
                or any(not isinstance(run, dict) or run.get("service") != name
                       for name, run in runs.items())):
            raise ValueError(f"the snapshot's fakes are not {task}'s")
        ours = self._files()
        files = snapshot["files"]
        if not isinstance(files, dict) or not files.keys() <= ours.keys():
            raise ValueError(f"the snapshot's state files are not {task}'s")
        data = {
            ours[k]: base64.b64decode(v, validate=True)
            for k, v in files.items()
        }
        calls = snapshot.get("calls", 0)
        if type(calls) is not int or calls < 0:
            raise ValueError("invalid snapshot call counter")
        if self.dispatches:
            # Older snapshots have only the log. Calls finish out of order
            # and cancellation can leave gaps.
            for line in data.get(Path(self.dispatches), b"").splitlines():
                match = re.fullmatch(r"call_([0-9]+)",
                                     json.loads(line)["tool_use_id"])
                if not match:
                    raise ValueError("invalid dispatch call ID")
                calls = max(calls, int(match[1]))
        epoch = _ms(snapshot["time"])
        archive = base64.b64decode(snapshot["mirage"], validate=True)
        return read_tar(io.BytesIO(archive), staging), data, calls, epoch

    async def _load_fakes(self, runs: dict) -> None:
        async with httpx.AsyncClient(timeout=300) as client:

            async def one(service, run):
                reply = await client.post(
                    f"{self.fakes[service]['kit']}/_kit/runs/{self.id}/load",
                    json=run)
                reply.raise_for_status()

            results = await asyncio.gather(*(one(s, r)
                                             for s, r in runs.items()),
                                           return_exceptions=True)
            errors = [r for r in results if isinstance(r, BaseException)]
            if errors:
                raise BaseExceptionGroup("loading fake runs failed", errors)

    async def _load_local(self, state, data, calls, epoch) -> None:
        if self.mirage is not None:
            await self.mirage.close()
            self.mirage = None
        for root in self._roots():
            if root.exists():
                shutil.rmtree(root)
        for root in self._roots():
            root.mkdir(parents=True, exist_ok=True)
        for live in self._files().values():
            if live in data:
                live.write_bytes(data[live])
            else:
                live.unlink(missing_ok=True)
        if self.dispatches:
            tools.CALLS[self.dispatches] = calls
        if self.epoch is not None:
            self.epoch = epoch
            self.started = int(time.time() * 1000)
        self.mirage = self._mirage()
        await apply_state_dict(self.mirage, state, built_for_state=True)
        await self._documents()
        await asyncio.to_thread(self.refresh)

    async def load(self, snapshot: dict) -> None:
        """Restore the workspace and all its runs as one operation."""
        with tempfile.TemporaryDirectory(prefix="vfsbench-load-") as tmp:
            staging = Path(tmp)
            target = await asyncio.to_thread(self._decode, snapshot,
                                             staging / "target")
            previous = await self.snapshot()
            touched_local = False
            try:
                await self._load_fakes(snapshot["fakes"])
                touched_local = True
                await self._load_local(*target)
                if self.grade is not None:
                    grade, self.grade = self.grade, None
                    await grade.close()
            except BaseException:
                try:
                    # Even a service whose response timed out may have
                    # committed its load. Restore every service.
                    await self._load_fakes(previous["fakes"])
                    if touched_local:
                        local = await asyncio.to_thread(
                            self._decode, previous, staging / "previous")
                        await self._load_local(*local)
                except BaseException:
                    self.restore_failed = True
                    raise RuntimeError("snapshot rollback failed; "
                                       "reset the environment")
                raise
        shutil.rmtree(self.run / "verifier", ignore_errors=True)

    def _roots(self) -> list[Path]:
        """The host directories of the workspace's disk mounts, each under
        the run."""
        roots = []
        for mount in (self.config.get("mounts") or {}).values():
            if mount.get("vfs") != "disk":
                continue
            root = Path(mount["config"]["root"]).resolve()
            if not root.is_relative_to(self.run.resolve()):
                raise ValueError(f"a disk mount outside the run: {root}")
            roots.append(root)
        return roots

    async def shell(self, command: str, cwd: str | None = None) -> dict:
        """Run a line in the workspace's session, or from ``cwd`` in a
        session of its own; each fake's state file brought up to date
        first."""
        await asyncio.to_thread(self.refresh)
        return await _run(self.mirage, command, cwd)

    def refresh(self) -> None:
        for view, live in self.state:
            _snapshot(view, live)

    async def freeze(self) -> dict:
        """The grader's request: the task's frozen state, as the dataset
        freezes it, and its clock."""
        module = _dataset_module(self.dataset)
        definition = module.definitions().get(self.name)
        if definition is None:
            raise ValueError(f"no grader for {self.dataset}/{self.name}")
        inputs = self.dir / "verifier"
        for name, expected in definition.get("files", {}).items():
            digest = hashlib.sha256((inputs / name).read_bytes()).hexdigest()
            if digest != expected:
                raise ValueError(
                    f"verifier/{name} changed; regenerate the task")
        if not hasattr(module, "freeze"):
            raise NotImplementedError(f"{self.dataset} grades from state this "
                                      "format does not freeze yet")
        budget = _Budget(600)
        verifier_dir = self.run / "verifier"
        verifier_dir.mkdir(exist_ok=True)

        async def background(work, *args, budget=budget):
            return await asyncio.to_thread(work, *args, budget)

        def log(path: Path, text: str):
            Path(path).write_text(text)

        await asyncio.to_thread(self.refresh)
        freezer = SimpleNamespace(
            inputs_dir=inputs,
            environment=self,
            _background=background,
            _log=log,
            trial_paths=SimpleNamespace(verifier_dir=verifier_dir))
        with tempfile.TemporaryDirectory(prefix="vfsbench-freeze-") as stage:
            frozen = await module.freeze(freezer, definition, Path(stage),
                                         budget)
            host = time.time()
            return {
                "dataset":
                self.dataset,
                "task":
                self.name,
                "runtime":
                definition.get("runtime", "typescript"),
                "states": {
                    a: json.loads(Path(p).read_text())
                    for a, p in frozen["states"].items()
                },
                "files": {
                    v: base64.b64encode(Path(p).read_bytes()).decode()
                    for v, p in frozen["files"].items()
                },
                "epoch":
                self.now(host).isoformat(),
                "host":
                datetime.fromtimestamp(host, timezone.utc).isoformat(),
                "env":
                dict(
                    yaml.safe_load(
                        (self.dir / "workspace.yaml").read_text()).get("env")
                    or {}),
                "timeoutSeconds":
                600,
            }

    async def grade_shell(self, command: str, cwd: str | None,
                          timeout: float) -> dict:
        """``command`` in the task's grade workspace, from ``cwd`` (``/``)."""
        if self.grade is None:
            await self._open_grade()
        return await asyncio.wait_for(_run(self.grade, command, cwd or "/"),
                                      timeout)

    async def _open_grade(self) -> None:
        """The grade workspace, as Harbor's verifier opens one: the frozen
        request staged read-only at ``/``, each state and file by its path
        there, and ``/logs`` the run's ``verifier/logs``."""
        request = await self.freeze()
        stage = self.run / "verifier" / "inputs"
        shutil.rmtree(stage, ignore_errors=True)
        stage.mkdir(parents=True)
        (self.logs / "verifier").mkdir(parents=True, exist_ok=True)
        states, files = {}, {}
        for i, (alias, value) in enumerate(request.pop("states").items()):
            (stage / f"state-{i}.json").write_text(json.dumps(value))
            states[alias] = f"/state-{i}.json"
        for i, (path, data) in enumerate(request.pop("files").items()):
            (stage / f"file-{i}").write_bytes(base64.b64decode(data))
            files[path] = f"/file-{i}"
        request["paths"] = {"states": states, "files": files}
        (stage / "request.json").write_text(json.dumps(request))
        size = sum(p.stat().st_size for p in stage.iterdir())
        if "grade" not in CLI_SPECS:
            register_cli_spec(GRADE_CLI)
        config = {
            "mounts": {
                "/": {
                    "vfs": "disk",
                    "mode": "read",
                    "config": {
                        "root": str(stage)
                    }
                },
                "/logs": {
                    "vfs": "disk",
                    "mode": "write",
                    "config": {
                        "root": str(self.logs)
                    }
                },
            },
            "clis": {
                "grade": {
                    "cli": "grade",
                    "machine": "in_process"
                }
            },
            # Room for the inputs as grade reads them, past Mirage's
            # 32 MiB a workspace.
            "max_memory": 2 * size + 32 * 1024 * 1024,
        }
        self.grade = Mirage(
            **WorkspaceConfig.model_validate(config).to_workspace_kwargs())

    def read(self, path: str) -> bytes | None:
        """A file of the grade workspace by its path from ``/``: under
        ``logs/``, what its lines wrote; else its staged inputs."""
        parts = Path(path).parts
        if not parts or Path(path).is_absolute() or ".." in parts:
            return None
        root, rest = ((self.logs, parts[1:]) if parts[0] == "logs" else
                      (self.run / "verifier" / "inputs", parts))
        target = root.joinpath(*rest)
        return target.read_bytes() if target.is_file() else None

    async def close(self) -> None:
        if self.grade is not None:
            grade, self.grade = self.grade, None
            await grade.close()
        if self.mirage is not None:
            mirage, self.mirage = self.mirage, None
            try:
                # Its history, as the daemon exports it (logs?format=jsonl).
                records = await mirage.observer.events(None)
                (self.run / "history.jsonl").write_text("".join(
                    log_lines(completed_logs(records))))
            finally:
                await mirage.close()
        for process in reversed(self.processes):
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 15)
                except TimeoutError:
                    process.kill()
        self.processes = []


async def _run(mirage: Mirage, command: str, cwd: str | None) -> dict:
    """A line in ``mirage``'s session, or from ``cwd`` in a subshell of
    its own."""
    io = await mirage.shell(command, cwd=cwd)
    stdout, stderr = await io.stdout_str(), await io.stderr_str()
    return {"exit_code": io.exit_code, "stdout": stdout, "stderr": stderr}


def _ms(iso: str) -> int:
    """An ISO 8601 time as milliseconds since the epoch."""
    return int(
        datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def run_id(task: str) -> str:
    """A new id for a task's run: its directory under ``state/agentenv/``,
    and its runs' name on the shared fakes."""
    return f"{task.split('/')[1][:40]}-{uuid.uuid4().hex[:8]}"


def _request(parts: list) -> dict:
    """What a ``data/add`` names: ``{"task": ..., ...}`` inline, or in a
    file as bytes, a ``file://`` path or an ``https://`` URL."""
    for part in parts:
        if isinstance(part, DataPart):
            data = part.data
        elif isinstance(part, FilePart):
            f = part.file
            uri = urlparse(getattr(f, "uri", None) or "")
            if getattr(f, "bytes", None) is not None:
                data = json.loads(base64.b64decode(f.bytes))
            elif uri.scheme in ("http", "https"):
                data = json.loads(httpx.get(f.uri).content)
            else:
                data = json.loads(Path(unquote(uri.path)).read_text())
        else:
            continue
        if "task" in data:
            return data
    raise ValueError("data/add named no task")


def _serialized(method):
    """Keep requests from observing a partial restore or reset."""

    @wraps(method)
    async def wrapped(self, *args, **kwargs):
        async with self.lock:
            return await method(self, *args, **kwargs)

    return wrapped


@environment_card(name="mirage")
class VfsBench(AgentEnvEnvironment):
    """A vfs-bench-2 task's Mirage workspace; its one tool is ``shell``."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.workspace: Workspace | None = None
        self.runs: dict[str, dict] = {}

    def _active(self) -> Workspace:
        if self.workspace is None:
            raise RuntimeError("no task is loaded")
        if self.workspace.restore_failed:
            raise RuntimeError(
                "snapshot rollback failed; reset the environment")
        return self.workspace

    @reset_data
    @_serialized
    async def _reset(self) -> None:
        await self._close()

    async def _close(self) -> None:
        self.runs = {}
        if self.workspace is not None:
            workspace, self.workspace = self.workspace, None
            await workspace.close()

    @add_data
    @_serialized
    async def _add(self, parts: list) -> None:
        await self._close()
        request = _request(parts)
        if "fakes" not in request:
            raise ValueError("data/add named no runs (fakes): the process "
                             "that starts this server opens them "
                             "(vfsbench_agentenv.fakes)")
        workspace = Workspace(request["task"], request.get("run"))
        try:
            await workspace.open(request["fakes"])
        except BaseException:
            await workspace.close()
            raise
        self.workspace = workspace

    @get_data
    @_serialized
    async def _state(self, paths: list | None = None) -> list:
        workspace = self._active()
        if paths is None:
            return [
                DataPart(data={
                    "request": await workspace.freeze(),
                    "run": str(workspace.run)
                })
            ]
        parts = []
        for path in paths:
            data = workspace.read(path)
            if data is not None:
                parts.append(
                    FilePart(
                        file=FileWithBytes(
                            bytes=base64.b64encode(data).decode()),
                        metadata={DATA_OBJECTS_EXTENSION_URI: {
                            "path": path
                        }}))
        return parts

    @extension(COMPUTER_EXEC,
               op="run",
               description="Run a command line in the task's grade "
               "workspace: its frozen state read-only at /, logs/ writable.")
    @_serialized
    async def _run(self,
                   argv: list,
                   request_id: str,
                   cwd: str | None = None,
                   env: dict | None = None,
                   timeout_s: float | None = None) -> dict:
        workspace = self._active()
        if request_id in self.runs:
            return self.runs[request_id]
        line = (argv[2] if len(argv) == 3 and argv[:2] == ["bash", "-c"] else
                shlex.join(argv))
        exports = "".join(f"export {k}={shlex.quote(v)}; "
                          for k, v in (env or {}).items())
        try:
            done = await workspace.grade_shell(exports + line, cwd, timeout_s
                                               or 600)
            answer = {
                "exit_code": done["exit_code"],
                "stdout": done["stdout"],
                "stderr": done["stderr"],
                "truncated": False,
                "timed_out": False
            }
        except TimeoutError:
            answer = {
                "exit_code": 124,
                "stdout": "",
                "stderr": "timed out",
                "truncated": False,
                "timed_out": True
            }
        self.runs[request_id] = answer
        return answer

    @extension(WORKSPACE_EXTENSION,
               op="snapshot",
               method="GET",
               description=WORKSPACE_DESCRIPTION)
    @_serialized
    async def _snapshot_environment(self) -> dict:
        workspace = self._active()
        return await workspace.snapshot()

    @extension(WORKSPACE_EXTENSION,
               op="load",
               description=WORKSPACE_DESCRIPTION)
    @_serialized
    async def _load_environment(self, snapshot: dict) -> dict:
        workspace = self._active()

        async def restore():
            await workspace.load(snapshot)
            self.runs.clear()

        # A disconnected client must not interrupt the transaction or
        # release the request lock while HTTP loads are still in flight.
        pending = asyncio.create_task(restore())
        try:
            await asyncio.shield(pending)
        except asyncio.CancelledError:
            await pending
            raise
        return {"task": snapshot["task"], "run": workspace.id}

    def extension_params(self, uri: str) -> dict:
        return {
            "max_timeout_s": MAX_EXEC_TIMEOUT_S
        } if uri == COMPUTER_EXEC else {}

    @tool()
    @_serialized
    async def shell(self, command: str) -> CallToolResult:
        """Run a bash command line in the workspace, from its working
        directory. Pipes, redirects and Unix commands work on its mounts;
        /VFS.md lists the mounts and /SKILL.md the CLIs."""
        workspace = self._active()
        done = await workspace.shell(command)
        text = done["stdout"]
        if done["stderr"]:
            text = f"{text}\n{done['stderr']}" if text else done["stderr"]
        return CallToolResult(content=[TextContent(type="text", text=text)],
                              isError=done["exit_code"] != 0)


def _exit_with_parent() -> None:
    sys.stdin.buffer.read()
    os.kill(os.getpid(), signal.SIGTERM)


if __name__ == "__main__":
    # Every run is in UTC; the fakes inherit it.
    os.environ["TZ"] = "UTC"
    time.tzset()
    threading.Thread(target=_exit_with_parent, daemon=True).start()
    VfsBench().serve()
