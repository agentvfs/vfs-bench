"""Run each task's solution through the mirage env, and grade it.

    uv run --project formats/agentenv \
      python -I formats/agentenv/oracle.py <dataset> [-n 4] [--nop | --clone] [task ...]

For each task: its runs on the fakes this process shares (``fakes.py``),
as the mirage sandbox provider opens them, the env's server, ``data/add``
naming the task and its runs, its
``harbor/solution/solve.sh`` as one ``shell`` call over MCP (none with
``--nop``), then the task's test as its verifier runs it: ``GRADE`` through
``computer-exec/v1`` ``run``, and the reward file read with ``data/get``.
agent-env has no oracle agent, so this drives the env as an agent would.

``--clone`` also snapshots the env (``urn:mirage:workspace/v1``) at its
start and once solved, loads it back to its start and tests it again, and
loads the solved snapshot into a new env of the task, tested before and
after: the clone must score as the solved env, and the env loaded back as
a new one.
"""
import argparse
import asyncio
import base64
import contextlib
import os
import sys
import time
import uuid
from collections.abc import AsyncIterator

import httpx
from agentenv_protocol import DataPart
from agentenv_protocol import client as protocol
from agentenv_protocol.computer.card import COMPUTER_EXEC
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from vfsbench_agentenv import fakes
from vfsbench_agentenv.server import (DATASETS, GRADE, REWARD, RUNS,
                                      WORKSPACE_EXTENSION, _free_port, run_id)

CARD = "/.well-known/agent-env.json"


def method(card: dict, uri: str, op: str) -> dict:
    """An extension method the env's card advertises: its endpoint and
    verb."""
    extension = next(e for e in card["capabilities"]["extensions"]
                     if e["uri"] == uri)
    return extension["params"]["methods"][op]


async def test(url: str, card: dict) -> float:
    """The reward of the task's test, as run_container_unit_tests_verifier
    runs it in the env."""
    run = method(card, COMPUTER_EXEC, "run")
    async with httpx.AsyncClient(timeout=660) as client:
        reply = await client.post(f"{url}{run['endpoint']}",
                                  json={
                                      "argv": ["bash", "-c", GRADE],
                                      "request_id": uuid.uuid4().hex,
                                      "timeout_s": 600
                                  })
    reply.raise_for_status()
    done = reply.json()
    if done.get("exit_code"):
        raise RuntimeError(f"the test exited {done['exit_code']}: "
                           f"{done.get('stderr', '')[-2000:]}")
    answer = await protocol.get_data(url, timeout=60, paths=[REWARD])
    return float(base64.b64decode(answer.parts[0].file.bytes))


async def snapshot(url: str, card: dict) -> dict:
    """The env's snapshot."""
    op = method(card, WORKSPACE_EXTENSION, "snapshot")
    async with httpx.AsyncClient(timeout=600) as client:
        reply = await client.request(op["method"], f"{url}{op['endpoint']}")
    reply.raise_for_status()
    return reply.json()


async def load(url: str, card: dict, taken: dict) -> None:
    """Make the env ``taken``'s."""
    op = method(card, WORKSPACE_EXTENSION, "load")
    async with httpx.AsyncClient(timeout=600) as client:
        reply = await client.request(op["method"],
                                     f"{url}{op['endpoint']}",
                                     json={"snapshot": taken})
    reply.raise_for_status()


async def solve(url: str, dataset: str, task: str) -> None:
    """The task's solution, as one ``shell`` call."""
    script = (DATASETS / dataset / task /
              "harbor/solution/solve.sh").read_text()
    async with streamablehttp_client(f"{url}/mcp") as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            await session.call_tool("shell", {"command": script})


@contextlib.asynccontextmanager
async def environment(name: str) -> AsyncIterator[tuple[str, dict]]:
    """A new env of the task, as the mirage sandbox provider deploys one:
    its runs on the shared fakes, its server, and ``data/add`` naming
    them; its URL and card."""
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    RUNS.mkdir(parents=True, exist_ok=True)
    own = run_id(name)
    runs = await fakes.open_task(name, own)
    try:
        task = name.split("/")[1]
        with (RUNS / f"oracle-{task}-{port}.log").open("ab") as log:
            server = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "vfsbench_agentenv.server",
                env={
                    **os.environ, "ENVIRONMENT_NAME": "mirage",
                    "MCP_HOST": "127.0.0.1",
                    "MCP_PORT": str(port)
                },
                stdin=asyncio.subprocess.PIPE,
                stdout=log,
                stderr=log)
        try:
            async with httpx.AsyncClient() as client:
                for _ in range(300):
                    try:
                        reply = await client.get(f"{url}{CARD}")
                        if reply.status_code == 200:
                            card = reply.json()
                            break
                    except httpx.TransportError:
                        await asyncio.sleep(0.1)
            await protocol.add_data(url, [
                DataPart(data={
                    "task": name,
                    "run": own,
                    "fakes": fakes.views(name, runs)
                })
            ],
                                    timeout=600)
            yield url, card
        finally:
            try:
                await protocol.reset_data(url, timeout=60)
            except Exception:
                pass
            server.terminate()
            await server.wait()
    finally:
        await fakes.close_task(runs)


async def run(dataset: str, task: str, nop: bool) -> float:
    async with environment(f"{dataset}/{task}") as (url, card):
        if not nop:
            await solve(url, dataset, task)
        return await test(url, card)


async def clone(dataset: str, task: str) -> float:
    """The solved env's score, once its clone scores the same and the env
    loaded back to its start scores as a new one."""
    name = f"{dataset}/{task}"
    async with environment(name) as (url, card):
        start = await snapshot(url, card)
        await solve(url, dataset, task)
        solved = await snapshot(url, card)
        score = await test(url, card)
        await load(url, card, start)
        back = await test(url, card)
    async with environment(name) as (url, card):
        new = await test(url, card)
        await load(url, card, solved)
        cloned = await test(url, card)
    if (cloned, back) != (score, new):
        raise RuntimeError(f"solved, {score} and its clone {cloned}; new, "
                           f"{new} and loaded back to its start {back}")
    return score


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dataset")
    parser.add_argument("tasks", nargs="*")
    parser.add_argument("-n", type=int, default=4)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--nop", action="store_true")
    mode.add_argument("--clone", action="store_true")
    args = parser.parse_args()
    tasks = args.tasks or sorted(
        p.parent.parent.parent.name
        for p in (DATASETS / args.dataset).glob("*/harbor/solution/solve.sh"))
    slots = asyncio.Semaphore(args.n)
    started = time.monotonic()

    async def one(task: str) -> tuple[str, float | str]:
        async with slots:
            try:
                score = await (clone(args.dataset, task) if args.clone else
                               run(args.dataset, task, args.nop))
            except Exception as error:
                score = f"error: {error}"
            print(f"{task}: {score}", flush=True)
            return task, score

    scores = dict(await asyncio.gather(*(one(t) for t in tasks)))
    passed = sum(1 for s in scores.values() if s == 1)
    failed = sum(1 for s in scores.values() if isinstance(s, str))
    print(f"{passed}/{len(scores)} scored 1 in "
          f"{time.monotonic() - started:.0f}s" +
          (f"; {failed} raised" if failed else ""))
    # A score of 0 is a grade; a task that raised is a broken run.
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
