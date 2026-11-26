"""The kit fakes this process's tasks share: one process per service.

The mirage sandbox provider runs in ``agent-env run``'s process, and
``oracle.py`` runs its tasks in its own, so a pool that process keeps is
the run's, as Harbor's environment keeps one for a job. The first task
that needs a service starts its fake (``workspace/fakes.ts``); later tasks
reuse it, and each task is a run of its own on it: ``POST /reset {"run":
<task's id>, "fixture": ..., "epoch": ...}`` seeds a SQLite file of the
run's, ``POST /_run/<run>/_kit/faults`` arms the task's fault plans on it,
and ``DELETE /_kit/runs/<run>`` drops it when the task closes. Each run
also gets a port of its own on the fake's launcher, which forwards to that
run alone: the task's workspace reaches its run there, and is allowed
nothing else. The fakes stay up until the process exits: their stdin
closes then, and each stops.

Each fixture is registered under the pool's own root, named by its task and
content, so one fake seeds every task's runs from its own task directory.
"""
import asyncio
import atexit
import concurrent.futures
import contextlib
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

import httpx
import yaml

from vfsbench_agentenv.server import DATASETS, NODE, ROOT, RUNS, _host_env

LAUNCHER = ROOT / "workspace" / "fakes.ts"
URI_SAFE = "/:@!$&'()*+,;=-._~"


@dataclass
class Fake:
    """A running shared fake: its URL and the directory of its runs'
    files."""
    service: str
    url: str
    state: Path
    process: subprocess.Popen
    # Each run's port as its launcher opens it, by run (``_ports``).
    ports: dict[str, concurrent.futures.Future] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass
class Run:
    """One task's run of a shared fake: ``address``, the run's own port,
    which the task's workspace reaches it at; ``db``, its SQLite file;
    ``kit``, the fake's own URL, where the kit's endpoints for the run are
    (``/_kit/runs/<run>/snapshot`` and ``load``), which the run's port
    refuses."""
    service: str
    name: str
    db: Path
    address: str
    kit: str = ""


class SharedFakes:
    """The process's kit fakes, one per service, started on first use."""

    def __init__(self) -> None:
        self._fakes: dict[str, Fake] = {}
        self._starting: dict[str, threading.Lock] = {}
        self._lock = threading.Lock()
        self.root = Path(tempfile.mkdtemp(prefix="vfsbench-fakes-"))
        # The fakes' logs, which outlive the pool.
        self.logs = RUNS / f"fakes-{os.getpid()}"
        atexit.register(self.close)

    def register(self, service: str, task: str, source: Path) -> str:
        """Put a task's fixture where its service's fake seeds from; its
        name, which is the task's and its content's."""
        data = source.read_bytes()
        stem = re.sub(r"[^A-Za-z0-9-]", "-", task)[:40].strip("-") or "task"
        name = f"{stem}-{hashlib.sha256(data).hexdigest()[:12]}"
        target = self.root / "fixtures" / service / f"{name}.json"
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            temp = target.with_name(f"{target.name}.{os.getpid()}.tmp")
            temp.write_bytes(data)
            os.replace(temp, target)
        return name

    def fake(self, service: str, fixture: str) -> Fake:
        """The service's fake, started if it is not yet. Blocks while it
        starts, so a task calls it in a thread; services start in
        parallel.

        Its logs go to ``fake-<service>.launcher.log`` as it runs, and
        ``fake-<service>.log``, the fake's own output, once it stops.
        """
        with self._lock:
            starting = self._starting.setdefault(service, threading.Lock())
        with starting:
            live = self._fakes.get(service)
            if live is not None and live.process.poll() is None:
                return live
            self.logs.mkdir(parents=True, exist_ok=True)
            launcher = self.logs / f"fake-{service}.launcher.log"
            log = launcher.open("ab")
            process = subprocess.Popen(
                [
                    NODE,
                    str(LAUNCHER), "--service", service, "--root",
                    str(self.root), "--fixture", fixture, "--log",
                    str(self.logs / f"fake-{service}.log")
                ],
                cwd=ROOT,
                env={
                    **_host_env(), "VFSBENCH_STATE_TOKEN":
                    secrets.token_urlsafe(32)
                },
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=log,
            )
            log.close()
            for raw in process.stdout:
                line = raw.decode().strip()
                if line.startswith("FAKE="):
                    ready = json.loads(line.removeprefix("FAKE="))
                    break
            else:
                process.wait()
                text = launcher.read_text()
                raise RuntimeError(
                    f"the shared {service} fake exited ({process.returncode}) "
                    f"before it was ready:\n{text[-4000:]}")
            fake = Fake(service, ready["url"], Path(ready["state"]), process)
            threading.Thread(target=_ports,
                             args=(fake, ),
                             name=f"fake-{service}-ports",
                             daemon=True).start()
            with self._lock:
                self._fakes[service] = fake
            return fake

    async def open(self,
                   fake: Fake,
                   run: str,
                   fixture: str,
                   epoch: str | None,
                   faults: list[dict] | None = None,
                   extras: dict | None = None) -> Run:
        """Seed a task's run from its fixture, arm its fault plans and
        open its port.

        ``faults`` are kit fault plans, armed once the run is seeded, since
        a reset disarms them. ``extras`` go with the reset, to the fake's
        ``afterSeed``.
        """
        body = {"run": run, "fixture": fixture}
        if epoch is not None:
            body["epoch"] = epoch
        if extras:
            body["extras"] = extras
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                reply = await client.post(f"{fake.url}/reset", json=body)
                if reply.status_code != 200:
                    raise RuntimeError(f"resetting run {run} of the "
                                       f"{fake.service} fake failed "
                                       f"({reply.status_code}): {reply.text}")
                if faults:
                    reply = await client.post(
                        f"{fake.url}/_run/{run}/_kit/faults",
                        json={"plans": faults})
                    if reply.status_code != 200:
                        raise RuntimeError(
                            f"arming run {run}'s faults on the "
                            f"{fake.service} fake failed "
                            f"({reply.status_code}): {reply.text}")
            files = list(
                fake.state.glob(f"mirage-kit-{fake.service}-*/{run}.db"))
            if len(files) != 1:
                raise RuntimeError(f"run {run} of the {fake.service} fake has "
                                   f"{len(files)} files under {fake.state}")
            address = await asyncio.wait_for(
                asyncio.wrap_future(_send(fake, {"open": run}, run)), 30)
        except BaseException:
            # No task holds the run yet, so its close would never drop it:
            # a run seeded, or half seeded, goes before the error does.
            with contextlib.suppress(httpx.HTTPError):
                await asyncio.shield(self.drop(Run(fake.service, run, Path(),
                                                   "")))
            raise
        return Run(fake.service, run, files[0], address, fake.url)

    async def drop(self, run: Run) -> None:
        """Delete a task's run, its port and file with it."""
        fake = self._fakes.get(run.service)
        if fake is None or fake.process.poll() is not None:
            return
        _send(fake, {"close": run.name})
        async with httpx.AsyncClient(timeout=60) as client:
            await client.delete(f"{fake.url}/_kit/runs/{run.name}")

    def close(self) -> None:
        """Stop every fake and remove the pool's root."""
        with self._lock:
            fakes, self._fakes = self._fakes, {}
        for fake in fakes.values():
            if fake.process.poll() is None:
                fake.process.terminate()
                try:
                    fake.process.wait(15)
                except subprocess.TimeoutExpired:
                    fake.process.kill()
            fake.process.stdin.close()
            fake.process.stdout.close()
        shutil.rmtree(self.root, ignore_errors=True)


def _send(fake: Fake,
          line: dict,
          run: str | None = None) -> concurrent.futures.Future:
    """Write a line to a fake's launcher; the future of ``run``'s port,
    when the line opens one."""
    future: concurrent.futures.Future = concurrent.futures.Future()
    with fake.lock:
        if run is not None:
            fake.ports[run] = future
        try:
            fake.process.stdin.write(json.dumps(line).encode() + b"\n")
            fake.process.stdin.flush()
        except (BrokenPipeError, ValueError) as error:
            fake.ports.pop(run, None)
            future.set_exception(
                RuntimeError(f"the {fake.service} fake's launcher is gone: "
                             f"{error}"))
    return future


def _ports(fake: Fake) -> None:
    """Hand each port the fake's launcher opens to the run that asked for
    it, until the launcher exits."""
    for raw in fake.process.stdout:
        line = raw.decode().strip()
        if not line.startswith("RUN="):
            continue
        opened = json.loads(line.removeprefix("RUN="))
        with fake.lock:
            future = fake.ports.pop(opened["run"], None)
        # An open that was canceled has no one to take the port, so it is
        # closed.
        if future is not None and future.set_running_or_notify_cancel():
            future.set_result(opened["url"])
        else:
            _send(fake, {"close": opened["run"]})
    with fake.lock:
        pending, fake.ports = fake.ports, {}
    for future in pending.values():
        if future.set_running_or_notify_cancel():
            future.set_exception(
                RuntimeError(f"the {fake.service} fake's launcher exited"))


_pool: SharedFakes | None = None
_pool_lock = threading.Lock()


def pool() -> SharedFakes:
    """The process's shared fakes."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = SharedFakes()
        return _pool


async def open_task(task: str, run: str) -> list[Run]:
    """The task's runs, one on each fake its ``workspace.yaml`` names,
    seeded from its fixtures at its epoch, its faults armed; ``run`` names
    each, and is the task's id (its directory under ``state/agentenv/``).
    None is left open when one fails."""
    dataset, name = task.split("/")
    folder = DATASETS / dataset / name / "workspace"
    spec = yaml.safe_load((folder / "workspace.yaml").read_text()) or {}
    shared = pool()

    async def one(service: str, block: dict) -> Run:
        fixture = shared.register(service, name, folder / block["fixture"])
        fake = await asyncio.to_thread(shared.fake, service, fixture)
        extras = block.get("extras")
        if extras:
            extras = json.loads(
                json.dumps(extras).replace("${RUN_DIR}", str(RUNS / run)))
        return await shared.open(fake, run, fixture, block.get("epoch"),
                                 block.get("faults"), extras)

    starts = [
        asyncio.ensure_future(one(s, b))
        for s, b in (spec.get("fakes") or {}).items()
    ]
    try:
        return list(await asyncio.gather(*starts))
    except BaseException:
        for start in starts:
            start.cancel()
        done = await asyncio.gather(*starts, return_exceptions=True)
        await close_task([r for r in done if isinstance(r, Run)])
        raise


async def close_task(runs: list[Run]) -> None:
    """Drop a task's runs."""
    for run in runs:
        with contextlib.suppress(httpx.HTTPError):
            await pool().drop(run)


def views(task: str, runs: list[Run]) -> dict:
    """What the task's server opens its workspace over (``data/add``'s
    ``fakes``): each run's port, its SQLite file, the files beside it that
    ``workspace.yaml``'s ``files`` names, and the fake's own URL, which
    the server snapshots and loads the run at and its workspace is never
    allowed."""
    dataset, name = task.split("/")
    spec = yaml.safe_load(
        (DATASETS / dataset / name / "workspace" /
         "workspace.yaml").read_text()) or {}
    out = {}
    for run in runs:
        opened = {"url": run.address, "db": str(run.db), "kit": run.kit}
        files = (spec["fakes"][run.service] or {}).get("files")
        if files:
            opened["files"] = {
                view: f"{run.db}.files/{quote(path, safe=URI_SAFE)}"
                for view, path in files.items()
            }
        out[run.service] = opened
    return out
