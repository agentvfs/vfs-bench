"""A vfs-bench-2 task's Mirage workspace as an agent-env environment.

    ENVIRONMENT_NAME=mirage MCP_PORT=<port> python -m vfsbench_agentenv.server

``data/add`` takes the task (the ``task.json`` a bundle's environment
artifact holds, ``{"task": "<dataset>/<task>"}``) and opens its workspace:

- each fake its ``workspace.yaml`` names, a run of the task's own seeded
  from its fixture at its epoch (``workspace/fakes.ts``);
- the layout (``workspace/mirage.ts``);
- a Mirage daemon routed to those runs alone (``workspace/preload.ts``);
- the workspace on it, at the task's clock, with ``/VFS.md`` and
  ``/SKILL.md``, and ``workspace.yaml``'s ``run`` lines run.

The agent's one tool is ``shell``: a bash line in that workspace.
``computer-exec/v1`` ``run`` runs a line in the task's grade workspace on
the same daemon, opened at its first call over the frozen state
(``workspace/grade.ts``): the request the grader takes read-only at ``/``,
and ``logs/`` writable, which ``data/get`` reads back by path. Without
paths, ``data/get`` answers that request; ``data/reset`` closes
everything.

It exits when its stdin closes (its parent is gone), and its processes
with it.
"""
import asyncio
import base64
import hashlib
import importlib.util
import json
import os
import re
import secrets
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
from functools import cache
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote, unquote, urlparse

import httpx
import yaml
from agentenv_protocol import (DATA_OBJECTS_EXTENSION_URI, AgentEnvEnvironment,
                               DataPart, FilePart, add_data, environment_card,
                               extension, get_data, reset_data, tool)
from agentenv_protocol.computer.card import COMPUTER_EXEC, MAX_EXEC_TIMEOUT_S
from agentenv_protocol.types import FileWithBytes
from mcp.types import CallToolResult, TextContent

ROOT = Path(__file__).resolve().parents[4]
DATASETS = ROOT / "datasets"
WORKSPACE = ROOT / "workspace"
RUNS = ROOT / "state" / "agentenv"
DAEMON = ROOT / "submodule/mirage/typescript/packages/server/src/bin/daemon.ts"
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
URI_SAFE = "/:@!$&'()*+,;=-._~"


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


class Workspace:
    """One task's open workspace: its fakes, daemon and Mirage workspace."""

    def __init__(self, task: str):
        self.dataset, self.name = task.split("/")
        if self.dataset not in GRADED:
            raise ValueError(f"{self.dataset} isn't graded here yet; "
                             f"this format grades {', '.join(GRADED)}")
        self.dir = DATASETS / self.dataset / self.name / "workspace"
        if not (self.dir / "workspace.yaml").is_file():
            raise ValueError(f"no task {task} under {DATASETS}")
        self.id = f"{self.name}-{uuid.uuid4().hex[:8]}"
        self.run = RUNS / self.id
        self.processes: list[asyncio.subprocess.Process] = []
        self.client: httpx.AsyncClient | None = None
        self.routes: dict[int, str] = {}
        self.state: list[tuple[Path, Path]] = []
        self.workdir = "/"
        self.epoch: int | None = None
        self.started = 0
        self.grade: str | None = None
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

    async def _open_fake(self, service: str, block: dict) -> dict:
        """The task's run on a fake of its own, seeded from its fixture at
        its epoch, its faults armed; the run's own port and state file."""
        source = self.dir / block["fixture"]
        root = self.run / "fakes"
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        fixture = f"{self.name[:40]}-{digest[:12]}"
        target = root / "fixtures" / service / f"{fixture}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        process = await self._spawn(f"fake-{service}",
                                    NODE,
                                    str(WORKSPACE / "fakes.ts"),
                                    "--service",
                                    service,
                                    "--root",
                                    str(root),
                                    "--fixture",
                                    fixture,
                                    "--log",
                                    str(self.run / f"fake-{service}.out.log"),
                                    env={
                                        **_host_env(), "VFSBENCH_STATE_TOKEN":
                                        secrets.token_urlsafe(32)
                                    },
                                    ready=True)
        fake = json.loads(await self._line(process, "FAKE=",
                                           f"fake-{service}"))
        run = "task"
        body = {"run": run, "fixture": fixture}
        if block.get("epoch") is not None:
            body["epoch"] = block["epoch"]
        if block.get("extras"):
            body["extras"] = json.loads(
                json.dumps(block["extras"]).replace("${RUN_DIR}",
                                                    str(self.run)))
        async with httpx.AsyncClient(timeout=120) as client:
            reply = await client.post(f"{fake['url']}/reset", json=body)
            reply.raise_for_status()
            if block.get("faults"):
                reply = await client.post(
                    f"{fake['url']}/_run/{run}/_kit/faults",
                    json={"plans": block["faults"]})
                reply.raise_for_status()
        db = next(Path(fake["state"]).glob(f"mirage-kit-{service}-*/{run}.db"))
        process.stdin.write(json.dumps({"open": run}).encode() + b"\n")
        await process.stdin.drain()
        address = json.loads(await self._line(process, "RUN=",
                                              f"fake-{service}"))["url"]
        opened = {"url": address, "db": str(db)}
        if block.get("files"):
            opened["files"] = {
                view: f"{db}.files/{quote(path, safe=URI_SAFE)}"
                for view, path in block["files"].items()
            }
        return opened

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

    async def _daemon(self, plan: dict) -> str:
        port = _free_port()
        tools = plan.get("tools")
        await self._spawn(
            "daemon",
            NODE,
            "--experimental-transform-types",
            "--no-warnings",
            "--import",
            str(WORKSPACE / "preload.ts"),
            str(DAEMON),
            env={
                **_host_env(),
                "MIRAGE_HOME":
                str(self.run / "mirage-home"),
                "MIRAGE_DAEMON_PORT":
                str(port),
                "VFSBENCH_ROUTES":
                json.dumps(plan["routes"]),
                "VFSBENCH_ALLOW":
                json.dumps(plan.get("allow", [])),
                "VFSBENCH_GRADE":
                "1",
                **({} if tools is None else {
                       "VFSBENCH_TOOLS": tools["file"],
                       "VFSBENCH_DISPATCHES": tools["dispatches"],
                   }),
                **({} if self.epoch is None else {
                       "VFSBENCH_EPOCH": str(self.epoch),
                       "VFSBENCH_STARTED": str(self.started),
                   }),
            })
        url = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient() as client:
            for _ in range(600):
                if self.processes[-1].returncode is not None:
                    log = (self.run / "daemon.log").read_text()
                    raise RuntimeError(
                        f"the Mirage daemon exited:\n{log[-4000:]}")
                try:
                    reply = await client.get(f"{url}/v1/daemon/ready")
                    if reply.status_code == 200:
                        return url
                except httpx.TransportError:
                    pass
                await asyncio.sleep(0.1)
        raise RuntimeError(f"the Mirage daemon did not answer on {url}")

    def now(self, host: float | None = None) -> datetime:
        """The task's clock: its epoch, moving on in real time."""
        host = time.time() if host is None else host
        if self.epoch is None:
            return datetime.fromtimestamp(host, timezone.utc)
        ms = self.epoch + int(host * 1000) - self.started
        return datetime.fromtimestamp(ms / 1000, timezone.utc)

    async def open(self) -> None:
        self.run.mkdir(parents=True)
        spec = yaml.safe_load((self.dir / "workspace.yaml").read_text()) or {}
        blocks = spec.get("fakes") or {}
        starts = [
            asyncio.ensure_future(self._open_fake(s, b))
            for s, b in blocks.items()
        ]
        try:
            opened = await asyncio.gather(*starts)
        except BaseException:
            # The other starts end before close(), so none escapes it.
            for start in starts:
                start.cancel()
            await asyncio.gather(*starts, return_exceptions=True)
            raise
        plan = await self._plan(dict(zip(blocks, opened)))
        if plan.get("epoch"):
            self.epoch = int(
                datetime.fromisoformat(plan["epoch"].replace(
                    "Z", "+00:00")).timestamp() * 1000)
            self.started = int(time.time() * 1000)
        self.routes = {int(p): u for p, u in plan["routes"].items()}
        self.state = [(Path(v), Path(l)) for v, l in plan["state"]]
        self.workdir = plan["workdir"]
        url = await self._daemon(plan)
        self.client = httpx.AsyncClient(
            base_url=url,
            timeout=httpx.Timeout(60, read=None),
            limits=httpx.Limits(keepalive_expiry=2))
        config = dict(plan["config"])
        if any("snapshot" in m
               for m in (config.get("machines") or {}).values()):
            raise NotImplementedError("a task on a microsandbox snapshot "
                                      "(JobBench) is not supported here yet")
        if self.epoch is not None:
            config["system_time"] = self.now().isoformat(
                timespec="milliseconds")
        reply = await self.client.post("/v1/workspaces",
                                       json={
                                           "id": self.id,
                                           "config": config
                                       })
        if reply.status_code >= 300:
            raise RuntimeError(f"creating the workspace failed "
                               f"({reply.status_code}): {reply.text}")
        for kind in ("vfs", "skill"):
            reply = await self.client.put(
                f"/v1/workspaces/{self.id}/{kind}-md",
                json={"path": f"/{kind.upper()}.md"})
            reply.raise_for_status()
        for step in plan["run"]:
            done = await self.shell(step["line"], step["cwd"])
            if done["exit_code"] != 0:
                raise RuntimeError(f"workspace.yaml's run {step['line']!r} "
                                   f"exited {done['exit_code']}:\n"
                                   f"{done['stderr'] or done['stdout']}")
        # The agent's lines run in the workspace's session, from its
        # working directory: a cd or export holds for the next line.
        await self.shell(f"cd {shlex.quote(self.workdir)}")

    async def shell(self, command: str, cwd: str | None = None) -> dict:
        """Run a line in the workspace's session, or from ``cwd`` in a
        session of its own; each fake's state file brought up to date
        first."""
        await asyncio.to_thread(self.refresh)
        body = {"command": command, **({} if cwd is None else {"cwd": cwd})}
        reply = await self.client.post(f"/v1/workspaces/{self.id}/shell",
                                       json=body)
        if reply.status_code >= 300:
            raise RuntimeError(f"the workspace's shell failed "
                               f"({reply.status_code}): {reply.text}")
        return reply.json()

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
        reply = await asyncio.wait_for(
            self.client.post(f"/v1/workspaces/{self.grade}/shell",
                             json={
                                 "command": command,
                                 "cwd": cwd or "/"
                             }), timeout)
        if reply.status_code >= 300:
            raise RuntimeError(f"the grade workspace's shell failed "
                               f"({reply.status_code}): {reply.text}")
        return reply.json()

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
        grade = f"{self.id}-grade"
        reply = await self.client.post(
            "/v1/workspaces",
            json={
                "id": grade,
                "config": {
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
                    # Room for the inputs as grade reads them, past
                    # Mirage's 32 MiB a workspace.
                    "max_memory": 2 * size + 32 * 1024 * 1024,
                }
            })
        if reply.status_code >= 300:
            raise RuntimeError("creating the grade workspace failed "
                               f"({reply.status_code}): {reply.text}")
        self.grade = grade

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
        if self.client is not None and self.grade is not None:
            try:
                await self.client.delete(f"/v1/workspaces/{self.grade}")
            except httpx.TransportError:
                pass
            self.grade = None
        if self.client is not None:
            try:
                history = await self.client.get(
                    f"/v1/workspaces/{self.id}/logs",
                    params={"format": "jsonl"})
                if history.status_code == 200:
                    (self.run / "history.jsonl").write_text(history.text)
                await self.client.delete(f"/v1/workspaces/{self.id}")
            except httpx.TransportError:
                pass
            await self.client.aclose()
            self.client = None
        for process in reversed(self.processes):
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 15)
                except TimeoutError:
                    process.kill()
        self.processes = []


def _task(parts: list) -> str:
    """The task a ``data/add`` names: ``{"task": ...}`` inline, or in a
    file as bytes, a ``file://`` path or an ``https://`` URL."""
    for part in parts:
        if isinstance(part, DataPart):
            return part.data["task"]
        if isinstance(part, FilePart):
            f = part.file
            if getattr(f, "bytes", None) is not None:
                return json.loads(base64.b64decode(f.bytes))["task"]
            uri = urlparse(f.uri)
            if uri.scheme in ("http", "https"):
                return json.loads(httpx.get(f.uri).content)["task"]
            return json.loads(Path(unquote(uri.path)).read_text())["task"]
    raise ValueError("data/add named no task")


@environment_card(name="mirage")
class VfsBench(AgentEnvEnvironment):
    """A vfs-bench-2 task's Mirage workspace; its one tool is ``shell``."""

    def __init__(self) -> None:
        self.workspace: Workspace | None = None
        self.runs: dict[str, dict] = {}

    @reset_data
    async def _reset(self) -> None:
        self.runs = {}
        if self.workspace is not None:
            workspace, self.workspace = self.workspace, None
            await workspace.close()

    @add_data
    async def _add(self, parts: list) -> None:
        await self._reset()
        workspace = Workspace(_task(parts))
        try:
            await workspace.open()
        except BaseException:
            await workspace.close()
            raise
        self.workspace = workspace

    @get_data
    async def _state(self, paths: list | None = None) -> list:
        if self.workspace is None:
            raise RuntimeError("no task is loaded")
        if paths is None:
            return [
                DataPart(
                    data={
                        "request": await self.workspace.freeze(),
                        "run": str(self.workspace.run)
                    })
            ]
        parts = []
        for path in paths:
            data = self.workspace.read(path)
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
    async def _run(self,
                   argv: list,
                   request_id: str,
                   cwd: str | None = None,
                   env: dict | None = None,
                   timeout_s: float | None = None) -> dict:
        if self.workspace is None:
            raise RuntimeError("no task is loaded")
        if request_id in self.runs:
            return self.runs[request_id]
        line = (argv[2] if len(argv) == 3 and argv[:2] == ["bash", "-c"] else
                shlex.join(argv))
        exports = "".join(f"export {k}={shlex.quote(v)}; "
                          for k, v in (env or {}).items())
        try:
            done = await self.workspace.grade_shell(exports + line, cwd,
                                                    timeout_s or 600)
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

    def extension_params(self, uri: str) -> dict:
        return {
            "max_timeout_s": MAX_EXEC_TIMEOUT_S
        } if uri == COMPUTER_EXEC else {}

    @tool()
    async def shell(self, command: str) -> CallToolResult:
        """Run a bash command line in the workspace, from its working
        directory. Pipes, redirects and Unix commands work on its mounts;
        /VFS.md lists the mounts and /SKILL.md the CLIs."""
        if self.workspace is None:
            raise RuntimeError("no task is loaded")
        done = await self.workspace.shell(command)
        text = done["stdout"]
        if done["stderr"]:
            text = f"{text}\n{done['stderr']}" if text else done["stderr"]
        return CallToolResult(content=[TextContent(type="text", text=text)],
                              isError=done["exit_code"] != 0)


def _exit_with_parent() -> None:
    sys.stdin.buffer.read()
    os.kill(os.getpid(), signal.SIGTERM)


if __name__ == "__main__":
    threading.Thread(target=_exit_with_parent, daemon=True).start()
    VfsBench().serve()
