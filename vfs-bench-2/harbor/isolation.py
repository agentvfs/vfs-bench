"""Check that trials run side by side cannot reach each other.

    uv run --project harbor python -I harbor/isolation.py [--out <dir>] [--msb]

Starts seven trials at once from the committed tasks, each with its own
daemon, on kit fakes they share: chat-sticker-engagement twice (A and B,
both reaching the one chat fake at localhost:5003, each its own run),
weather-aqi-report (C), candidate-interview-slot-confirm twice (D and E,
both on the one gws fake through /gmail, /calendar and the gws CLI), and
email-sending-verify twice (F and G, on that gws fake too, each with the
task's fault plan armed on its run). Then checks, from inside the
workspaces, that each trial reaches only its own runs and files: not
another's state, mail or calendar events, not another's run by path through
its own URL, and not the shared fakes' real ports; and that each run's
fault fires once, for that run alone. A trial's own commands keep apart
too: several at once each see its state, and one canceled stops.

With ``--msb``, it then boots the verifier microVMs of A to E at once, as
``MicrosandboxVerifier`` boots them, and checks from inside them that each
sees only its own trial's files and state, reaches its own runs through its
upstream ports, and reaches nothing else: not another trial's run or
proxy, not the shared fakes' real ports, no other host port and not the
internet. Exits 1 if any check fails.
"""
import argparse
import asyncio
import contextlib
import json
import shlex
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import MicrosandboxVerifier, MirageEnvironment
from vfsbench_harbor.microsandbox import ATTEMPTS, Hung, Sandbox

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
    parser.add_argument("--msb",
                        action="store_true",
                        help="also check the verifiers' microVMs")
    args = parser.parse_args()
    out = args.out.resolve()
    a, b = (trial(out, "chat-sticker-engagement", n) for n in ("a", "b"))
    c = trial(out, "weather-aqi-report", "c")
    d, e = (trial(out, "candidate-interview-slot-confirm", n)
            for n in ("d", "e"))
    f, g = (trial(out, "email-sending-verify", n) for n in ("f", "g"))
    trials = (a, b, c, d, e, f, g)
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
        if args.msb:
            await microvms(trials[:5], real, runs, report)
    finally:
        await asyncio.gather(*(t.stop(delete=True) for t in trials))
    print(
        f"{'all checks passed' if failed == 0 else f'{failed} checks failed'}")
    return 1 if failed else 0


async def microvms(trials, real, runs, report) -> None:
    """Boot every trial's verifier VM at once, as MicrosandboxVerifier
    boots it, and check from inside each what it reaches."""
    a, b, c, d, e = trials
    of = dict(zip("abcde", trials))
    logs: dict[str, list[str]] = {t.session_id: [] for t in trials}
    stacks: dict[str, contextlib.AsyncExitStack] = {}
    booted: list[str] = []

    async def boot(who: str) -> Sandbox:
        t = of[who]
        verifier = MicrosandboxVerifier(task=Task(t.environment_dir.parent),
                                        trial_paths=t.trial_paths,
                                        environment=t)
        for _ in range(ATTEMPTS):
            stack = contextlib.AsyncExitStack()
            try:
                vm = await stack.enter_async_context(
                    verifier.sandbox("true", logs[t.session_id], []))
            except Hung as e:
                print(f"note [{who} vm] {e}; booting another", flush=True)
                continue
            stacks[who] = stack
            booted.append(vm.name)
            return vm
        raise RuntimeError(f"msb hung on all {ATTEMPTS} boots of {who}")

    try:
        vms = dict(zip("abcde", await asyncio.gather(*map(boot, "abcde"))))
        names = [vm.name for vm in vms.values()]
        report(
            len(set(names)) == 5, "a-e", "boot five VMs at once, each its "
            "own", "  ".join(names))

        async def check(who: str, what: str, line: str, ok) -> str:
            # A VM msb leaves a command unrun in is booted again, as the
            # verifier does.
            for _ in range(ATTEMPTS):
                try:
                    code, answer, err = await vms[who].guest(line)
                    with answer:
                        out = answer.read()
                    break
                except Hung as e:
                    print(f"note [{who} vm] {e}; booting another", flush=True)
                    await stacks.pop(who).aclose()
                    vms[who] = await boot(who)
            else:
                raise RuntimeError(f"msb hung on all {ATTEMPTS} tries")
            text = (out + err).decode(errors='replace').strip()
            shown = line.replace(f"python3 -c {shlex.quote(PROBE)}", "probe")
            report(ok(code, text), f"{who} vm", what,
                   f"$ {shown[-120:]}\n    {text[:200]}")
            return text

        ok = lambda code, out: code == 0  # noqa: E731
        status = lambda n: lambda code, out: out.startswith(f"{n} ")  # noqa
        unreachable = lambda code, out: out.startswith("error ")  # noqa
        chat = urlsplit(real["a"]["5003"])
        gws = urlsplit(runs["d"][0])
        daemon = urlsplit(str(a._client.base_url))
        await check(
            "a", "runs real CPython, with time zones",
            "python3 -c \"import sys, zoneinfo; "
            "print(sys.implementation.name, "
            "zoneinfo.ZoneInfo('Asia/Shanghai'))\"",
            lambda code, out: out == "cpython Asia/Shanghai")
        await check("a", "sees its pack in its copy of the data mount", PACKS,
                    lambda code, out: out == "1")
        await check("b", "does not see A's pack in its copy", PACKS,
                    lambda code, out: out == "0")
        await check(
            "a", "reaches its own run at localhost:5003",
            probe("localhost", 5003, "/api/stickers"),
            lambda code, out: out.startswith("200 ") and '"pack_id":1' in out)
        await check(
            "b", "reaches its own run, without A's pack",
            probe("localhost", 5003, "/api/stickers"), lambda code, out: out.
            startswith("200 ") and '"pack_id":1' not in out)
        b_run = urlsplit(real["b"]["5003"]).path
        await check("a", "cannot reach B's run by path through its own URL",
                    probe("localhost", 5003, f"{b_run}/api/stickers"),
                    status(404))
        await check("a", "cannot climb out of its run with dot segments",
                    probe("localhost", 5003, "/../../_run/b/api/stickers"),
                    status(404))
        await check(
            "a", "cannot climb out with encoded dot segments",
            probe("localhost", 5003, "/%2e%2e/%2E%2E/_run/b/api"
                  "/stickers"), status(404))
        # A URL parser reads a backslash in an http path as a slash.
        await check("a", "cannot climb out with backslashes",
                    probe("localhost", 5003, "/..\\..\\_run/b/api/stickers"),
                    status(404))
        await check("a", "cannot reset its run",
                    probe("localhost", 5003, "/reset", "POST"), status(404))
        await check("a", "cannot reset it with an escaped path",
                    probe("localhost", 5003, "/%72eset", "POST"), status(404))
        await check("a", "cannot drop B's run with an escaped kit path",
                    probe("localhost", 5003, "/%5fkit/runs/b", "DELETE"),
                    status(404))
        await check("a", "cannot reset it with a doubled slash",
                    probe("localhost", 5003, "//reset", "POST"), status(404))
        await check("a", "cannot reach the kit's endpoints",
                    probe("localhost", 5003, "/_kit/health"), status(404))
        await check("a", "reaches its own proxy on the host directly",
                    probe(HOST, vms["a"].ports[5003], "/health"), status(200))
        await check("a", "cannot reach B's proxy on the host",
                    probe(HOST, vms["b"].ports[5003], "/api/stickers"),
                    unreachable)
        await check("a", "cannot reach C's proxy on the host",
                    probe(HOST, vms["c"].ports[3000], "/health"), unreachable)
        await check("a", "cannot reach the shared chat fake's real port",
                    probe(HOST, chat.port, f"{b_run}/api/stickers"),
                    unreachable)
        await check("a", "cannot reach the shared gws fake's real port",
                    probe(HOST, gws.port, "/health"), unreachable)
        await check("a", "cannot reach its Mirage daemon's port",
                    probe(HOST, daemon.port, "/v1/health"), unreachable)
        await check("a", "cannot reach the fake's port on its own loopback",
                    probe("localhost", chat.port, "/health"), unreachable)
        await check("a", "cannot reach the internet by name",
                    probe("example.com", 80), unreachable)
        await check("a", "cannot reach the internet by address",
                    probe("1.1.1.1", 80), unreachable)
        await check("c", "reaches its own weather run at localhost:3000",
                    probe("localhost", 3000, "/health"), status(200))
        await check("c", "has no chat port", probe("localhost", 5003),
                    unreachable)
        await check("d", "sees its mail in its copy of the gws data", MAILS,
                    lambda code, out: out == "1")
        await check("e", "does not see D's mail in its copy", MAILS,
                    lambda code, out: out == "0")
        await check("d", "with no routes, cannot reach the host",
                    probe(HOST, vms["a"].ports[5003], "/health"), unreachable)
        await check("d", "with no routes, cannot reach the internet",
                    probe("1.1.1.1", 80), unreachable)

        # Files: each VM has copies of its own trial's, and nothing else.
        written = ("/workspace/iso-vm", "/tmp/iso-vm", "/logs/verifier/iso-vm")
        await check(
            "a", "writes into its own copies, and reads them back",
            " && ".join(f"echo a > {f}" for f in written) +
            f" && cat {' '.join(written)} | tr -d '\\n'",
            lambda code, out: code == 0 and out == "aaa")
        await check("b", "does not see A's writes, at the same time",
                    " && ".join(f"test ! -e {f}" for f in written), ok)
        on_host = [
            a._run_dir / "workspace/iso-vm", a._run_dir / "tmp/iso-vm",
            a._run_dir / "logs/verifier/iso-vm"
        ]
        report(not any(f.exists() for f in on_host), "a vm",
               "its writes do not reach the trial's files on the host",
               str(on_host[0]))
        await check("a", "cannot see its trial's run directory",
                    f"ls {shlex.quote(str(a._run_dir))}",
                    lambda code, out: code != 0)
        await check("a", "cannot see B's run directory",
                    f"ls {shlex.quote(str(b._run_dir))}",
                    lambda code, out: code != 0)
        await check("a", "has its trial's /workspace and /logs",
                    "test -d /workspace/environment && test -d /logs/agent",
                    ok)
    finally:
        await asyncio.gather(*(s.aclose() for s in stacks.values()))
    # Every VM booted, a replacement for a hung one included.
    listed = subprocess.run([vms["a"].msb, "ls"],
                            capture_output=True,
                            text=True,
                            stdin=subprocess.DEVNULL)
    report(
        listed.returncode == 0 and not any(name in listed.stdout
                                           for name in booted), "a-e",
        "every VM is removed afterwards",
        (listed.stdout + listed.stderr).strip()[:200])


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
