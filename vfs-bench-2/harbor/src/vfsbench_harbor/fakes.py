"""The kit fakes a Harbor job's trials share: one process per service.

Harbor runs every trial of a job in one Python process, so a pool kept by
that process is the job's. The first trial that needs a service starts its
fake (``harbor/fakes.ts``); later trials reuse it, and each trial is a run
of its own on it: ``POST /reset {"run": <trial>, "fixture": ..., "epoch":
...}`` seeds a SQLite file of the run's, ``POST /_run/<run>/_kit/faults``
arms the task's fault plans on it, and ``DELETE /_kit/runs/<run>`` drops it
when the trial stops. The fakes stay up until the process exits: their
stdin closes then, and each stops.

A pool the environment starts lazily, rather than a Harbor job plugin, works
with every ``harbor run`` as it is: Harbor 0.25 takes plugins only as
``--plugin`` on the command line (a job config's ``plugins`` key is
ignored), and ``harbor/isolation.py`` drives environments with no job at
all.

Each fixture is registered under the pool's own root, named by its task and
content, so one fake seeds every task's runs from its own task directory.
"""
import asyncio
import atexit
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
from dataclasses import dataclass
from pathlib import Path

import httpx

HARBOR = Path(__file__).resolve().parents[2]
ROOT = HARBOR.parent
LAUNCHER = HARBOR / "fakes.ts"
# The kit's run and fixture names.
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


@dataclass
class Fake:
    """A running shared fake: its URL and the directory of its runs' files."""
    service: str
    url: str
    state: Path
    process: subprocess.Popen
    state_token: str


@dataclass
class Run:
    """One trial's run of a shared fake."""
    service: str
    name: str
    url: str
    db: Path


def run_name(session_id: str) -> str:
    """A kit run name for a trial: its session id, made legal and short."""
    name = re.sub(r"[^A-Za-z0-9._-]", "-", session_id).lstrip("._-") or "t"
    if len(name) > 64:
        digest = hashlib.sha256(session_id.encode()).hexdigest()[:12]
        name = f"{name[:51]}-{digest}"
    assert NAME.fullmatch(name), name
    return name


class SharedFakes:
    """The process's kit fakes, one per service, started on first use."""

    def __init__(self) -> None:
        self._fakes: dict[str, Fake] = {}
        self._lock = threading.Lock()
        self.root = Path(tempfile.mkdtemp(prefix="vfsbench-fakes-"))
        atexit.register(self.close)

    def register(self, service: str, task: str, source: Path) -> str:
        """Put a task's fixture where its service's fake seeds from.

        Returns its name, which is the task's and its content's.
        """
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

    def fake(self, service: str, fixture: str, node: str, env: dict[str, str],
             logs: Path) -> Fake:
        """The service's fake, started if it is not yet.

        Its logs go to ``logs`` (the job's directory), not the pool's root,
        so they outlive the pool: ``fake-<service>.launcher.log`` as it runs,
        and ``fake-<service>.log``, the fake's own output, once it stops.
        Blocks while it starts, so the environment calls it in a thread.
        """
        with self._lock:
            live = self._fakes.get(service)
            if live is not None and live.process.poll() is None:
                return live
            logs.mkdir(parents=True, exist_ok=True)
            launcher = logs / f"fake-{service}.launcher.log"
            log = launcher.open("ab")
            state_token = secrets.token_urlsafe(32)
            process = subprocess.Popen(
                [
                    node,
                    str(LAUNCHER), "--service", service, "--root",
                    str(self.root), "--fixture", fixture, "--log",
                    str(logs / f"fake-{service}.log")
                ],
                cwd=ROOT,
                env={
                    **env, "VFSBENCH_STATE_TOKEN": state_token
                },
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=log,
            )
            log.close()
            assert process.stdout is not None
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
            fake = Fake(service, ready["url"], Path(ready["state"]), process,
                        state_token)
            self._fakes[service] = fake
            return fake

    async def open(self,
                   fake: Fake,
                   run: str,
                   fixture: str,
                   epoch: str | None,
                   faults: list[dict] | None = None,
                   extras: dict | None = None) -> Run:
        """Seed a trial's run from its fixture; the run's URL and file.

        ``faults`` are kit fault plans (``POST /_kit/faults``), armed on the
        run once it is seeded, since a reset disarms them: each answers the
        next requests to its route in place of the fake. ``extras`` go with
        the reset, to the fake's ``afterSeed``.
        """
        body = {"run": run, "fixture": fixture}
        if epoch is not None:
            body["epoch"] = epoch
        # What the fake's seed takes besides the fixture (the kit's
        # `afterSeed`): a Gaia2 app's run its trial's drive.
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
        except BaseException:
            # No trial holds the run yet, so its stop() would never drop it:
            # a run seeded, or half seeded, goes before the error does, a
            # canceled start included.
            with contextlib.suppress(httpx.HTTPError):
                await asyncio.shield(
                    self.drop(Run(fake.service, run, "", Path())))
            raise
        return Run(fake.service, run, f"{fake.url}/_run/{run}", files[0])

    async def snapshot(self,
                       run: Run,
                       tables: list[str],
                       queries: list[str] = ()) -> dict:
        """Read the fake's private JSON view through its async client: each
        table's rows, and each query's as ``query-<i>`` where the fake
        answers its verifier's SQL itself (EnterpriseOps-Gym)."""
        fake = self._fakes[run.service]
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.get(
                f"{run.url}/_verifier/state",
                params=[("table", table)
                        for table in tables] + [("query", query)
                                                for query in queries],
                headers={"x-vfsbench-state-token": fake.state_token})
            response.raise_for_status()
            return response.json()

    async def drop(self, run: Run) -> None:
        """Delete a trial's run, its file with it."""
        fake = self._fakes.get(run.service)
        if fake is None or fake.process.poll() is not None:
            return
        async with httpx.AsyncClient(timeout=60) as client:
            await client.delete(f"{fake.url}/_kit/runs/{run.name}")

    def close(self) -> None:
        """Stop every fake and remove the pool's root."""
        with self._lock:
            for fake in self._fakes.values():
                if fake.process.poll() is None:
                    fake.process.terminate()
                    try:
                        fake.process.wait(15)
                    except subprocess.TimeoutExpired:
                        fake.process.kill()
                if fake.process.stdin is not None:
                    fake.process.stdin.close()
                if fake.process.stdout is not None:
                    fake.process.stdout.close()
            self._fakes = {}
        shutil.rmtree(self.root, ignore_errors=True)


_pool: SharedFakes | None = None
_pool_lock = threading.Lock()


def pool() -> SharedFakes:
    """The process's shared fakes."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = SharedFakes()
        return _pool
