"""Check that trials run side by side cannot reach each other.

    uv run --project harbor python -I harbor/isolation.py [--out <dir>]

Starts nine trials at once from the committed tasks, each with its own
daemon, on kit fakes they share: chat-sticker-engagement twice (A and B,
both reaching the one chat fake at localhost:5003, each its own run),
weather-aqi-report (C), candidate-interview-slot-confirm twice (D and E,
both on the one gws fake through /gmail, /calendar and the gws CLI),
email-sending-verify twice (F and G, on that gws fake too, each with the
task's fault plan armed on its run), and finance-anomaly-detect twice (H
and I, both on the one finance fake at localhost:1235, each logged in with
a cookie of its own run's). Then checks, from inside the workspaces, that
each trial reaches only its own runs and files: not another's state, mail
or calendar events, not another's run by path through its own URL, not the
shared fakes' real ports, and not another run's session; and that each
run's fault fires once, for that run alone. A trial's own commands keep
apart too: several at once each see its state, and one canceled stops.

Exits 1 if any check fails.
"""
import argparse
import asyncio
import json
import shlex
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
FINANCE = "http://localhost:1235"
JAR = "/tmp/finance.jar"
LOGIN = (f"curl -s -c {JAR} -X POST {FINANCE}/api/auth/login "
         "-H 'Content-Type: application/json' "
         "-d '{\"username\":\"admin\",\"password\":\"admin123\"}'")
# Whether transaction 8 is flagged, from the finance's data mount.
FLAGGED = ("python3 -c \"import sqlite3; "
           "db = sqlite3.connect('/opt/mock/data/finance_app.sqlite'); "
           "print(db.execute(\\\"select count(*) from transaction_record "
           "where id = 8 and status = 'flagged'\\\").fetchone()[0])\"")
REFUSED_SESSION = '{"success":false,"message":"Invalid or expired token"}'
# F's and G's mail: email-sending-verify's fault answers a run's first send
# as sent and stores nothing.
FAULTED = "isolation-check-fault"
FAULTED_MAILS = MAILS.replace(SUBJECT, FAULTED)
FAULTED_SEND = (f"gws gmail send --to iso@example.com --subject {FAULTED} "
                "--body isolation")
# D's calendar event, on a day of its own.
EVENT_DAY = "2026-05-28"
EVENT = ("gws calendar events insert --params '{\"calendarId\": \"primary\"}' "
         f"--json '{{\"summary\": \"{SUBJECT}\", "
         f"\"start\": {{\"dateTime\": \"{EVENT_DAY}T10:00:00Z\"}}, "
         f"\"end\": {{\"dateTime\": \"{EVENT_DAY}T11:00:00Z\"}}}}'")
EVENTS = ("gws calendar events list --params "
          f"'{{\"calendarId\": \"primary\", \"q\": \"{SUBJECT}\"}}'")
# How many events in the trial's gws run are D's, from its data mount.
CALENDAR = ("python3 -c \"import sqlite3; "
            "db = sqlite3.connect('/var/lib/mock-data/gws/gws.db'); "
            "print(db.execute(\\\"select count(*) from Event where "
            f"summary = '{SUBJECT}'\\\").fetchone()[0])\"")
# A request from inside a verifier VM, its path sent as it is: the status
# and the body's start, or the error. A name resolves to IPv4, as the VM
# reaches the host's loopback there.
PROBE = """
import http.client, socket, sys
name, port, method, path = sys.argv[1:5]
try:
    host = socket.getaddrinfo(name, None, socket.AF_INET)[0][4][0]
    c = http.client.HTTPConnection(host, int(port), timeout=5)
    c.request(method, path)
    r = c.getresponse()
    print(r.status, r.read().decode(errors="replace"))
except OSError as e:
    print("error", type(e).__name__, e)
"""
HOST = "host.microsandbox.internal"


def probe(name: str,
          port: int | str,
          path: str = "/",
          method: str = "GET") -> str:
    args = " ".join(shlex.quote(str(a)) for a in (name, port, method, path))
    return f"python3 -c {shlex.quote(PROBE)} {args}"


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
    args = parser.parse_args()
    out = args.out.resolve()
    a, b = (trial(out, "chat-sticker-engagement", n) for n in ("a", "b"))
    c = trial(out, "weather-aqi-report", "c")
    d, e = (trial(out, "candidate-interview-slot-confirm", n)
            for n in ("d", "e"))
    f, g = (trial(out, "email-sending-verify", n) for n in ("f", "g"))
    h, i = (trial(out, "finance-anomaly-detect", n) for n in ("h", "i"))
    trials = (a, b, c, d, e, f, g, h, i)
    await asyncio.gather(*(t.start(force_build=False) for t in trials))
    failed = 0

    def report(passed: bool, who: str, what: str, detail: str) -> None:
        nonlocal failed
        failed += not passed
        print(f"{'PASS' if passed else 'FAIL'} [{who}] {what}\n    {detail}",
              flush=True)

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

        # Fault plans, armed on F's run and on G's: each run's first send
        # is answered by its own plan, once.
        sent = lambda n: lambda code, out: out == str(n)  # noqa: E731
        await check(f, "its first send is answered as sent", FAULTED_SEND,
                    lambda code, out: code == 0)
        await check(f, "its first send stored nothing", FAULTED_MAILS, sent(0))
        await check(
            g, "its own first send is answered as sent, though "
            "F's fault has fired", FAULTED_SEND, lambda code, out: code == 0)
        await check(g, "its first send stored nothing", FAULTED_MAILS, sent(0))
        await check(f, "its second send is stored", FAULTED_SEND,
                    lambda code, out: code == 0)
        await check(f, "has its one stored message", FAULTED_MAILS, sent(1))
        await check(g, "does not see F's stored message", FAULTED_MAILS,
                    sent(0))
        await check(g, "its second send is stored", FAULTED_SEND,
                    lambda code, out: code == 0)
        await check(g, "has its one stored message", FAULTED_MAILS, sent(1))
        await check(f, "still has only its own message", FAULTED_MAILS,
                    sent(1))

        # The shared gws fake's calendars, through the mount and the CLI.
        await check(d, "creates an event with the gws CLI", EVENT,
                    lambda code, out: code == 0 and SUBJECT in out)
        await check(d, "sees its event in its own data mount", CALENDAR,
                    lambda code, out: out == "1")
        await check(d, "sees its event on its /calendar mount",
                    f"ls /calendar/primary/{EVENT_DAY}",
                    lambda code, out: code == 0 and SUBJECT in out)
        await check(d, "sees its event through the gws CLI", EVENTS,
                    lambda code, out: code == 0 and SUBJECT in out)
        await check(e, "does not see D's event in its data mount", CALENDAR,
                    lambda code, out: out == "0")
        await check(e, "does not see D's event on its /calendar mount",
                    f"ls /calendar/primary/{EVENT_DAY}",
                    lambda code, out: code == 0 and SUBJECT not in out)
        await check(e, "does not see D's event through the gws CLI", EVENTS,
                    lambda code, out: code == 0 and SUBJECT not in out)
        await check(
            e, "cannot reach D's calendar on the shared fake's real port",
            f"curl -sS {TOKEN} "
            f"{gws}{d_run}/calendar/v3/calendars/primary/events", refused)

        # The shared finance fake, whose session is a cookie of the run's.
        finance = origin(real["h"]["1235"])
        report(
            origin(real["i"]["1235"]) == finance and real["h"] != real["i"],
            "h,i", "share one finance fake, each with a run of its own",
            f"{real['h']['1235']}  {real['i']['1235']}")
        sessions = {}
        for t in (h, i):
            await check(t, "logs in with a cookie jar", LOGIN,
                        lambda code, out: code == 0 and '"admin"' in out)
            jar = await t.exec(f"cat {JAR}", timeout_sec=120)
            line = next((ln for ln in (jar.stdout or "").splitlines()
                         if "\ttoken\t" in ln), "")
            sessions[t.session_id] = line.split("\t")[-1]
        await check(
            h, "flags a transaction on its own run",
            f"curl -sf -b {JAR} -X POST {FINANCE}/api/transactions/8/flag",
            lambda code, out: code == 0 and '"flagged"' in out)
        await check(h, "sees the flag in its own data mount", FLAGGED,
                    lambda code, out: out == "1")
        await check(i, "does not see H's flag in its data mount", FLAGGED,
                    lambda code, out: out == "0")
        await check(i, "does not see H's flag on its API",
                    f"curl -sf -b {JAR} {FINANCE}/api/transactions/8",
                    lambda code, out: code == 0 and '"pending"' in out)
        await check(
            i, "refuses H's session cookie",
            f"curl -s -H 'Cookie: token={sessions['h']}' "
            f"{FINANCE}/api/transactions",
            lambda code, out: out == REFUSED_SESSION and sessions["h"] != "")
        await check(
            h, "refuses I's session cookie",
            f"curl -s -H 'Cookie: token={sessions['i']}' "
            f"{FINANCE}/api/transactions",
            lambda code, out: out == REFUSED_SESSION and sessions["i"] != "")
        await check(
            h, "still takes its own session cookie",
            f"curl -s -H 'Cookie: token={sessions['h']}' "
            f"{FINANCE}/api/transactions/8",
            lambda code, out: '"flagged"' in out)
        h_run = urlsplit(real["h"]["1235"]).path
        await check(i, "cannot reach H's run by path through its own URL",
                    f"curl -s -b {JAR} {FINANCE}{h_run}/api/transactions",
                    not_found)
        await check(i, "cannot reach H's run on the shared fake's real port",
                    f"curl -sS -b {JAR} {finance}{h_run}/api/transactions",
                    refused)
        await check(i, "cannot reach the shared finance fake outside its run",
                    f"curl -sS {finance}/api/transactions", refused)
    finally:
        await asyncio.gather(*(t.stop(delete=True) for t in trials))
    print(
        f"{'all checks passed' if failed == 0 else f'{failed} checks failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
