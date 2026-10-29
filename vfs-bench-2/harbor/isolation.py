"""Check that trials run side by side cannot reach each other.

    uv run --project harbor python -I harbor/isolation.py [--out <dir>]

Starts five trials at once from the committed tasks, each with its own
daemon, on kit fakes they share: chat-sticker-engagement twice (A and B,
both reaching the one chat fake at localhost:5003, each its own run),
weather-aqi-report (C), and stale-client-escalation twice (D and E, both on
the one gws fake through /gmail and the gws CLI). Then checks, from inside
the workspaces, that each trial reaches only its own runs and files: not
another's state, not another's run by path through its own URL, and not the
shared fakes' real ports. A trial's own commands keep apart too: several at
once each see its state, and one canceled stops. Exits 1 if any check fails.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import MirageEnvironment

ROOT = Path(__file__).resolve().parents[1]
TASKS = ROOT / "harbor/tasks/liveclawbench"
OUT = ROOT / "state/harbor/isolation"
# How many of the chat user's packs are pack 1, from the chat's data mount.
PACKS = ("python3 -c \"import sqlite3; "
         "db = sqlite3.connect('/opt/mock/data/chat/chat.sqlite'); "
         "print(db.execute('select count(*) from user_sticker_pack "
         "where sticker_pack_id = 1').fetchone()[0])\"")
URLOPEN = ("python3 -c \"import urllib.request; "
           "urllib.request.urlopen('http://localhost:5003/health')\"")
SUBJECT = "isolation-check-d"
# How many messages in the trial's gws run are D's, from its data mount.
MAILS = ("python3 -c \"import sqlite3; "
         "db = sqlite3.connect('/var/lib/mock-data/gws/gws.db'); "
         "print(db.execute(\\\"select count(*) from MessageHeader where "
         f"name = 'Subject' and value = '{SUBJECT}'\\\").fetchone()[0])\"")
TOKEN = "-H 'Authorization: Bearer gws-integ-token'"


def trial(out: Path, task: str, name: str) -> MirageEnvironment:
    t = Task(TASKS / task)
    paths = TrialPaths(out / name)
    paths.mkdir()
    return MirageEnvironment(
        environment_dir=t.paths.environment_dir,
        environment_name=t.name,
        session_id=name,
        trial_paths=paths,
        task_env_config=t.config.environment,
    )


def origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT)
    out = parser.parse_args().out.resolve()
    a, b = (trial(out, "chat-sticker-engagement", n) for n in ("a", "b"))
    c = trial(out, "weather-aqi-report", "c")
    d, e = (trial(out, "stale-client-escalation", n) for n in ("d", "e"))
    trials = (a, b, c, d, e)
    await asyncio.gather(*(t.start(force_build=False) for t in trials))
    failed = 0

    def report(passed: bool, who: str, what: str, detail: str) -> None:
        nonlocal failed
        failed += not passed
        print(f"{'PASS' if passed else 'FAIL'} [{who}] {what}\n    {detail}")

    async def check(e: MirageEnvironment, what: str, line: str, ok) -> None:
        r = await e.exec(line, timeout_sec=120)
        out = (r.stdout or "") + (r.stderr or "")
        report(ok(r.return_code, out.strip()), e.session_id, what,
               f"$ {line}\n    {out.strip()[:200]}")

    try:
        plans = {
            t.session_id: json.loads((t._run_dir / "plan.json").read_text())
            for t in trials
        }
        # Each trial's run of a shared fake, and that fake's real origin.
        real = {n: p["routes"] for n, p in plans.items()}
        runs = {n: p["allow"] for n, p in plans.items()}
        chat = origin(real["a"]["5003"])
        gws = origin(runs["d"][0])
        refused = lambda code, out: code == 7  # noqa: E731
        not_found = lambda code, out: out == "404 Not Found"  # noqa: E731

        report(
            origin(real["b"]["5003"]) == chat and real["a"] != real["b"],
            "a,b", "share one chat fake, each with a run of its own",
            f"{real['a']['5003']}  {real['b']['5003']}")
        report(
            origin(runs["e"][0]) == gws and runs["d"] != runs["e"], "d,e",
            "share one gws fake, each with a run of its own",
            f"{runs['d'][0]}  {runs['e'][0]}")

        # The chat pair, as before the fakes were shared.
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
        outs = [(r.stdout or r.stderr or "").strip()[:60] for r in results]
        report(
            all(r.return_code == 0 and (r.stdout or "").strip() == "1"
                for r in results), "a", "six commands at once each see the "
            "pack", str(outs))
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

        # The shared chat fake: one run cannot reach another's.
        b_run = urlsplit(real["b"]["5003"]).path
        await check(a, "cannot reach B's run by path through its own URL",
                    f"curl -s http://localhost:5003{b_run}/api/stickers",
                    not_found)
        await check(a, "cannot reach B's run on the shared fake's real port",
                    f"curl -sS {chat}{b_run}/api/stickers", refused)
        await check(a, "cannot reach the shared fake outside its run",
                    f"curl -sS {chat}/api/stickers", refused)
        await check(a, "cannot reset its run through its own URL",
                    "curl -s -X POST http://localhost:5003/reset -d '{}'",
                    not_found)
        await check(a, "cannot reach the kit's endpoints",
                    "curl -s http://localhost:5003/_kit/health", not_found)
        await check(a, "still has its pack", PACKS,
                    lambda code, out: out == "1")

        # The shared gws fake, through the mount and the CLI.
        await check(
            d, "sends mail with the gws CLI",
            f"gws gmail send --to iso@example.com --subject {SUBJECT} "
            "--body isolation", lambda code, out: code == 0)
        await check(d, "sees its mail in its own data mount", MAILS,
                    lambda code, out: out == "1")
        await check(d, "sees its mail on its /gmail mount",
                    f"grep -rl {SUBJECT} /gmail/SENT",
                    lambda code, out: code == 0 and SUBJECT in out)
        await check(e, "does not see D's mail in its data mount", MAILS,
                    lambda code, out: out == "0")
        await check(e, "does not see D's mail on its /gmail mount",
                    f"grep -rl {SUBJECT} /gmail/SENT",
                    lambda code, out: code != 0 and SUBJECT not in out)
        await check(e, "does not see D's mail through the gws CLI",
                    f"gws gmail triage --query 'subject:{SUBJECT} in:sent'",
                    lambda code, out: code == 0 and SUBJECT not in out)
        d_run = urlsplit(runs["d"][0]).path
        await check(
            e, "cannot reach D's run on the shared fake's real port",
            f"curl -sS {TOKEN} {gws}{d_run}/gmail/v1/users/me/messages",
            refused)
        await check(e, "cannot reach the shared gws fake outside its run",
                    f"curl -sS {TOKEN} {gws}/gmail/v1/users/me/messages",
                    refused)
    finally:
        await asyncio.gather(*(t.stop(delete=True) for t in trials))
    print(
        f"{'all checks passed' if failed == 0 else f'{failed} checks failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
