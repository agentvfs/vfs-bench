"""Check that trials run side by side cannot reach each other.

    uv run --project harbor python -I harbor/isolation.py

Starts three trials at once, each with its own daemon: chat-sticker-engagement
twice (A and B, both reaching their chat mock at localhost:5003) and
weather-aqi-report (C). Then checks, from inside the workspaces, that each
trial reaches only its own mocks and files, and that a trial's own commands
keep apart too: several at once each see its state, and one canceled stops.
Exits 1 if any check fails.
"""
import asyncio
import json
import sys
from pathlib import Path

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import MirageEnvironment

ROOT = Path(__file__).resolve().parents[1]
TASKS = ROOT / "state/liveclawbench/src/tasks"
OUT = ROOT / "state/harbor/isolation"
# How many of the chat user's packs are pack 1, from the chat's data mount.
PACKS = ("python3 -c \"import sqlite3; "
         "db = sqlite3.connect('/opt/mock/data/chat/chat.sqlite'); "
         "print(db.execute('select count(*) from user_sticker_pack "
         "where sticker_pack_id = 1').fetchone()[0])\"")
URLOPEN = ("python3 -c \"import urllib.request; "
           "urllib.request.urlopen('http://localhost:5003/health')\"")


def trial(task: str, name: str) -> MirageEnvironment:
    t = Task(TASKS / task)
    paths = TrialPaths(OUT / name)
    paths.mkdir()
    return MirageEnvironment(
        environment_dir=t.paths.environment_dir,
        environment_name=t.name,
        session_id=name,
        trial_paths=paths,
        task_env_config=t.config.environment,
    )


async def main() -> int:
    a, b, c = trial("chat-sticker-engagement",
                    "a"), trial("chat-sticker-engagement",
                                "b"), trial("weather-aqi-report", "c")
    await asyncio.gather(*(e.start(force_build=False) for e in (a, b, c)))
    failed = 0

    async def check(e: MirageEnvironment, what: str, line: str, ok) -> None:
        nonlocal failed
        r = await e.exec(line, timeout_sec=120)
        out = (r.stdout or "") + (r.stderr or "")
        passed = ok(r.return_code, out.strip())
        failed += not passed
        print(f"{'PASS' if passed else 'FAIL'} [{e.session_id}] {what}\n"
              f"    $ {line}\n    {out.strip()[:200]}")

    try:
        real = {
            e.session_id:
            json.loads((e._run_dir / "plan.json").read_text())["routes"]
            for e in (a, b, c)
        }
        refused = lambda code, out: code == 7  # noqa: E731
        await check(
            a, "acquires a pack on its own mock",
            "curl -sf -X POST http://localhost:5003/api/store/packs/1/acquire",
            lambda code, out: code == 0)
        await check(a, "sees the pack in its own data mount", PACKS,
                    lambda code, out: out == "1")
        # Each exec first refreshes the workspace's copy of the mocks'
        # state, so commands at once refresh at once.
        results = await asyncio.gather(*(a.exec(PACKS, timeout_sec=120)
                                         for _ in range(6)))
        passed = all(r.return_code == 0 and (r.stdout or "").strip() == "1"
                     for r in results)
        failed += not passed
        outs = [(r.stdout or r.stderr or "").strip()[:60] for r in results]
        print(f"{'PASS' if passed else 'FAIL'} [a] six commands at once each "
              f"see the pack\n    {outs}")
        try:
            await asyncio.wait_for(
                a.exec("sleep 3; echo late > /workspace/late", timeout_sec=60),
                0.5)
        except TimeoutError:
            pass
        await asyncio.sleep(5)
        await check(a, "a canceled command stops before it writes",
                    "ls /workspace/late", lambda code, out: code != 0)
        await check(b, "does not see A's pack in its data mount", PACKS,
                    lambda code, out: out == "0")
        await check(b, "does not see A's pack on its mock",
                    "curl -sf http://localhost:5003/api/stickers",
                    lambda code, out: code == 0 and '"pack_id":1' not in out)
        await check(a, "cannot reach B's mock by its real port",
                    f"curl -sS {real['b']['5003']}/health", refused)
        await check(a, "cannot reach B's mock with -k",
                    f"curl -k -sS {real['b']['5003']}/health", refused)
        await check(b, "cannot reach A's mock by its real port",
                    f"curl -sS {real['a']['5003']}/health", refused)
        await check(c, "cannot reach a chat mock at localhost:5003",
                    "curl -sS http://localhost:5003/health", refused)
        await check(c, "cannot reach A's mock by its real port",
                    f"curl -sS {real['a']['5003']}/health", refused)
        await check(a, "cannot reach C's mock by its real port",
                    f"curl -sS {real['c']['3000']}/health", refused)
        await check(a, "cannot reach the internet",
                    "curl -sS http://example.com/", refused)
        await check(a, "has no network from python3", URLOPEN,
                    lambda code, out: code != 0 and "unreachable" in out)
        await check(a, "cannot read B's run directory", f"ls {b._run_dir}",
                    lambda code, out: code != 0)
        await check(c, "has no chat data mount", "ls /opt/mock/data/chat",
                    lambda code, out: code != 0)
    finally:
        await asyncio.gather(*(e.stop(delete=True) for e in (a, b, c)))
    print(
        f"{'all checks passed' if failed == 0 else f'{failed} checks failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
