"""Grade a mirage env's task, for a bundle's ``env_outcome_verifier``.

The env's ``data/get`` freezes what the task's grader reads, as the request
its runner takes; this runs the dataset's grader on it, in Node, and answers
the grade as one criterion row, its score the grader's reward.
"""
import asyncio
import json
import os
import signal
from pathlib import Path

from agentenv_protocol import client as protocol
from vfsbench_agentenv.server import DATASETS, NODE, ROOT, WORKSPACE

TIMEOUT = 600


def _runner(request: dict) -> Path:
    runtime = request.get("runtime", "typescript")
    own = DATASETS / request["dataset"] / "graders" / "verify.ts"
    if runtime == "typescript":
        return WORKSPACE / "verify.ts"
    if runtime.endswith("-monty") and own.is_file():
        return own
    raise ValueError(f"unknown grader runtime: {runtime}")


async def grade(request: dict) -> dict:
    """The dataset's grade of a frozen request."""
    process = await asyncio.create_subprocess_exec(
        NODE,
        "--no-warnings",
        str(_runner(request)),
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
        async with asyncio.timeout(TIMEOUT):
            stdout, stderr = await process.communicate(
                json.dumps(request).encode())
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
    if process.returncode:
        raise RuntimeError(f"the grader exited {process.returncode}: "
                           f"{stderr.decode(errors='replace')[-4000:]}")
    return json.loads(stdout)


async def verify(mcp_url: str, env_url: str) -> list[dict]:
    """The task's grade, as a row an ``env_outcome_verifier`` scores."""
    reply = await protocol.get_data(env_url, timeout=TIMEOUT)
    data = next(p.data for p in reply.parts if hasattr(p, "data"))
    result = await grade(data["request"])
    verifier = Path(data["run"]) / "verifier"
    verifier.mkdir(exist_ok=True)
    (verifier / "grade.json").write_text(json.dumps(result, indent=2))
    score = float(result["score"])
    return [{
        "id":
        "reward",
        "score":
        score,
        "result":
        score >= 1,
        "description":
        json.dumps(result.get("rewards", {"reward": score})),
    }]
