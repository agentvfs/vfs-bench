"""Check each Gaia2 app's kit fake against upstream's gaia2-cli app.

    uv run --project gaia2 python -I harbor/gaia2_compare.py [app ...]
        [--scenario <split>/<id> ...] [-v]
    uv run --project gaia2 python -I harbor/gaia2_compare.py --oracles
        [app ...] [--scenario ...]

For each app (default: every one in ``gaia2.APPS`` with a fake under
``mocks/``) and each scenario (default: the first three of the search
split and one of the execution split), this lays the scenario out as
upstream does (``gaia2-init`` into a state directory) and seeds a run of the
app's fake from the fixture ``gaia2.py`` writes for it. It then makes the
same calls on both: upstream's click program run in this process, as its
CLI runs it, on the scenario's clock (``time.time()`` frozen at the
scenario's start, as libfaketime freezes upstream's container) and with
``uuid.uuid4()`` the fake's counter, so the ids agree; and the fake's route,
as the workspace's CLI sends it. The calls are each app's
(``gaia2_calls/<cli>.py``): every command, with values from the scenario's
state and the replies before, error cases, and writes, so later reads see
them.

With ``--oracles`` the calls are instead each scenario's oracle, as
``gaia2.py`` replays it into ``solve.sh`` (every app command of it, in
order, the app's own), and the scenarios default to every task's.

After each call it compares what each printed (stdout, or stderr on an
error, and which), the app's state, and the lines it logged (``events.jsonl``
upstream, the run's ``event`` rows here), and exits 1 on any difference but
``KNOWN`` ones, which it prints.
"""
import argparse
import contextlib
import functools
import hashlib
import io
import json
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
sys.path.insert(0, str(HARBOR))
import gaia2  # noqa: E402
from gaia2_cli.shared import normalize_app_name  # noqa: E402

# None: the first three search scenarios, and one execution one.
DEFAULT_SCENARIOS = None


def mint(service: str, n: int) -> str:
    """The fake's n-th id (mocks/gaia2/store.ts)."""
    digits = list(hashlib.sha256(f"{service}:{n}".encode()).hexdigest()[:32])
    digits[12] = "4"
    digits[16] = "89ab"[int(digits[16], 16) % 4]
    return "".join(digits)


class Upstream:
    """One scenario's state directory, and an app's click program run on it."""

    def __init__(self, scenario: Path, state_dir: Path):
        gaia2.init_state(scenario, state_dir)
        self.state_dir = state_dir
        self.start = float(
            json.loads(
                scenario.read_text())["metadata"]["definition"]["start_time"])
        self.ids: dict[str, int] = {}
        self.events_seen = 0

    def call(self, app: dict, command: str, options: dict) -> tuple[bool, str]:
        import importlib
        import os
        os.environ["GAIA2_STATE_DIR"] = str(self.state_dir)
        module = importlib.import_module(app["module"])
        argv = [command]
        params = {
            gaia2.option_name(p): p
            for p in module.cli.commands[command].params if hasattr(p, "opts")
        }
        for key, value in options.items():
            param = params.get(key)
            flag = param.opts[
                0] if param is not None else f"--{key.replace('_', '-')}"
            if value is True and param is not None and param.is_flag:
                argv.append(flag)
            elif isinstance(value, list):
                for item in value:
                    argv += [flag, str(item)]
            else:
                argv += [
                    flag,
                    value if isinstance(value, str) else json.dumps(value)
                ]
        service = app["service"]

        def uuid4():
            self.ids[service] = self.ids.get(service, 0) + 1
            return uuid.UUID(hex=mint(service, self.ids[service]))

        # A process per call upstream: the app's class map and log class anew.
        from gaia2_cli import shared
        shared._APP_CLASS_MAP = None
        shared.set_app(module.APP_NAME)
        out, err = io.StringIO(), io.StringIO()
        real_uuid4, real_time = uuid.uuid4, time.time
        uuid.uuid4, time.time = uuid4, (lambda: self.start)
        code = 0
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(
                    err):
                module.cli.main(args=argv,
                                prog_name=app["cli"],
                                standalone_mode=True)
        except SystemExit as exit_:
            code = exit_.code if isinstance(
                exit_.code, int) else (0 if exit_.code is None else 1)
        except Exception as error:
            # An uncaught exception: Python's last traceback line.
            code = 1
            kind = type(error)
            name = (kind.__qualname__ if kind.__module__ == "builtins" else
                    f"{kind.__module__}.{kind.__qualname__}")
            err.write(f"{name}: {error}\n")
        finally:
            uuid.uuid4, time.time = real_uuid4, real_time
            # Each CLI call is a process upstream: drop the module's cached
            # state.
            from gaia2_cli import shared
            for path in list(shared._active_locks):
                shared._release_lock(Path(path))
        return (code == 0, out.getvalue() if code == 0 else err.getvalue())

    def state(self, app: dict):
        path = self.state_dir / f"{normalize_app_name(app['state_name'])}.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def new_events(self) -> list[dict]:
        lines = (self.state_dir / "events.jsonl").read_text().splitlines()
        new = lines[self.events_seen:]
        self.events_seen = len(lines)
        return [json.loads(line) for line in new if line]


class Fake:
    """An app's kit fake, started as harbor/fakes.ts starts a job's."""

    def __init__(self, service: str, root: Path):
        self.service, self.root = service, root
        (root / "fixtures" / service).mkdir(parents=True, exist_ok=True)
        (root / "fixtures" / service /
         "default.json").write_text('{"doc": []}\n')
        self.proc = subprocess.Popen([
            "node",
            str(HARBOR / "fakes.ts"), "--service", service, "--root",
            str(root), "--fixture", "default", "--log",
            str(root / f"{service}.log")
        ],
                                     cwd=ROOT,
                                     stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE,
                                     text=True)
        for line in self.proc.stdout:
            if line.startswith("FAKE="):
                ready = json.loads(line[5:])
                self.url, self.state_root = ready["url"], Path(ready["state"])
                return
        raise RuntimeError(
            f"{service} did not start (see {root / f'{service}.launcher.log'})"
        )

    def open(self, run: str, fixture: bytes, epoch: str) -> None:
        name = f"f-{hashlib.sha256(fixture).hexdigest()[:12]}"
        (self.root / "fixtures" / self.service /
         f"{name}.json").write_bytes(fixture)
        body = json.dumps({
            "run": run,
            "fixture": name,
            "epoch": epoch
        }).encode()
        request = urllib.request.Request(
            f"{self.url}/reset",
            data=body,
            headers={"content-type": "application/json"})
        urllib.request.urlopen(request, timeout=120).read()
        self.run = run
        self.events_seen = 0

    def db(self) -> Path:
        files = list(
            self.state_root.glob(f"mirage-kit-{self.service}-*/{self.run}.db"))
        assert len(files) == 1, files
        return files[0]

    def call(self, app: dict, command: str, options: dict) -> tuple[bool, str]:
        request = urllib.request.Request(
            f"{self.url}/_run/{self.run}/{app['cli']}/{command}",
            data=json.dumps(options).encode(),
            headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as reply:
                return True, json.loads(reply.read())
        except urllib.error.HTTPError as error:
            body = error.read()
            if error.code != 400:
                raise RuntimeError(
                    f"{command}: {error.code} {body[:500]!r}") from None
            return False, json.loads(body)

    def state(self):
        with contextlib.closing(sqlite3.connect(self.db())) as conn:
            row = conn.execute(
                "select doc from doc where name = 'state'").fetchone()
        return json.loads(row[0]) if row else {}

    def new_events(self) -> list[dict]:
        with contextlib.closing(sqlite3.connect(self.db())) as conn:
            rows = conn.execute(
                "select entry from event order by seq").fetchall()
        new = rows[self.events_seen:]
        self.events_seen = len(rows)
        return [json.loads(r[0]) for r in new]

    def stop(self) -> None:
        self.proc.stdin.close()
        self.proc.wait()


def app_module(name: str):
    """An app's calls and known differences: ``gaia2_calls/<cli>.py``'s
    ``calls(state, last)``, which yields each (command, options) given the
    app's state as gaia2-init wrote it and ``last()``, the last reply's
    JSON, and ``KNOWN``, each difference accepted by command, with why."""
    import importlib
    cli = gaia2.APPS[name]["cli"].replace("-", "_")
    try:
        return importlib.import_module(f"gaia2_calls.{cli}")
    except ModuleNotFoundError:
        return None


@functools.cache
def replayed(split: str, scenario_id: str) -> list[list[str]]:
    return gaia2.replay(split, scenario_id)[0]


def oracle_calls(scenario: Path, name: str):
    """A scenario's oracle commands for one app, as ``solve.sh`` runs them
    (``gaia2.replay``), each as the options the workspace's CLI sends."""
    import importlib

    import click
    app = gaia2.APPS[name]
    group = importlib.import_module(app["module"]).cli
    commands = replayed(scenario.parent.name, scenario.stem)
    for argv in commands:
        if argv[0] != app["cli"]:
            continue
        command = group.commands[argv[1]]
        params = {
            opt: p
            for p in command.params if isinstance(p, click.Option)
            for opt in p.opts
        }
        options: dict = {}
        rest = argv[2:]
        while rest:
            param = params[rest.pop(0)]
            key = gaia2.option_name(param)
            if param.is_flag:
                options[key] = True
                continue
            raw = rest.pop(0)
            value = int(raw) if param.type is click.INT else float(
                raw) if param.type is click.FLOAT else raw
            if param.multiple:
                options.setdefault(key, []).append(value)
            else:
                options[key] = value
        yield argv[1], options


def with_drive(fixture: bytes, scenario: Path, where: Path) -> bytes:
    """The fixture with a drive of the fake's own (``meta``'s ``drive``): the
    Files app's tree as gaia2-init lays it out without its backing files,
    as upstream's state directory has it here."""
    gaia2.init_state(scenario, where)
    data = json.loads(fixture)
    for row in data["doc"]:
        if row["name"] == "meta":
            row["doc"] = json.dumps({
                **json.loads(row["doc"]), "drive":
                str(where / "filesystem")
            })
    return json.dumps(data).encode()


def normalize(value, app: str):
    """Upstream's values that its process does not fix: a Python ``set``'s
    order (a new conversation's participants, the calendar's tags), read as
    sorted."""
    if isinstance(value, dict):
        out = {k: normalize(v, app) for k, v in value.items()}
        if app in ("Messages", "Chats") and isinstance(
                out.get("participant_ids"), list):
            out["participant_ids"] = sorted(out["participant_ids"])
        if out.get("fn") == "get_all_tags" and isinstance(
                out.get("ret"), list):
            out["ret"] = sorted(out["ret"], key=str)
        return out
    if isinstance(value, list):
        return [normalize(v, app) for v in value]
    return value


def compare_app(name: str,
                scenarios: list[Path],
                tmp: Path,
                verbose: bool,
                oracles: bool = False) -> tuple[int, int]:
    app = gaia2.APPS[name]
    module = app_module(name)
    fake = Fake(app["service"], tmp / app["service"])
    sent = failed = 0
    try:
        for n, scenario in enumerate(scenarios):
            up = Upstream(scenario, tmp / f"state-{app['service']}-{n}")
            fixture = with_drive(
                gaia2.fixtures(scenario)[app["service"]], scenario,
                tmp / f"drive-{app['service']}-{n}")
            start = json.loads(
                scenario.read_text())["metadata"]["definition"]["start_time"]
            epoch = gaia2.iso(start)
            fake.open(f"cmp{n}", fixture, epoch)
            replies: list = []

            def last():
                return replies[-1]

            def same(label, a, b):
                nonlocal failed
                if a == b:
                    return True
                known = getattr(module, "KNOWN", {}).get(label.split()[0])
                tag = "known" if known else "DIFF"
                if not known:
                    failed += 1
                print(f"  {tag} {scenario.stem[:4]} {label}" +
                      (f" ({known})" if known else ""))
                print(
                    f"    upstream: {json.dumps(a, ensure_ascii=False)[:1200]}"
                )
                print(
                    f"    fake:     {json.dumps(b, ensure_ascii=False)[:1200]}"
                )
                return False

            if same("seed state", normalize(up.state(app), name),
                    normalize(fake.state(), name)) is False:
                pass
            roots = [
                str(up.state_dir / "filesystem"),
                str(tmp / f"drive-{app['service']}-{n}" / "filesystem")
            ]

            def printed(reply, command):
                """A reply with its JSON normalized, and each drive's host
                path (download's) as ``<FS>``."""
                ok, text = reply
                for root in roots:
                    text = text.replace(root, "<FS>")
                try:
                    data = normalize(json.loads(text), name)
                except ValueError:
                    return ok, text
                if command == "get-all-tags" and isinstance(data, list):
                    data = sorted(data, key=str)
                return ok, data

            def events(entries):
                text = json.dumps(entries)
                for root in roots:
                    text = text.replace(json.dumps(root)[1:-1], "<FS>")
                return normalize(json.loads(text), name)

            calls = (oracle_calls(scenario, name) if oracles else module.calls(
                up.state(app), last))
            for command, options in calls:
                label = (f"{command} "
                         f"{json.dumps(options, ensure_ascii=False)[:160]}")
                a = up.call(app, command, options)
                b = fake.call(app, command, options)
                sent += 1
                try:
                    replies.append(json.loads(a[1]) if a[0] else None)
                except ValueError:
                    replies.append(a[1])
                if same(label, printed(a, command), printed(
                        b, command)) and verbose:
                    print(f"  same {label}: {'ok' if a[0] else 'error'} "
                          f"{a[1][:100]!r}")
                same(f"{command} (state after)",
                     normalize(up.state(app), name),
                     normalize(fake.state(), name))
                same(f"{command} (events)", events(up.new_events()),
                     events(fake.new_events()))
            print(f"{name} {scenario.parent.name}/{scenario.stem}: "
                  f"{sent} calls so far")
    finally:
        fake.stop()
    return sent, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("apps", nargs="*")
    parser.add_argument("--scenario", action="append", default=[])
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--oracles",
                        action="store_true",
                        help="replay each scenario's oracle, not gaia2_calls/")
    args = parser.parse_args()
    have = [
        name for name, app in gaia2.APPS.items()
        if (ROOT / "mocks" / app["service"] /
            "main.ts").is_file() and app_module(name)
    ]
    names = args.apps or have
    if args.scenario:
        scenarios = [gaia2.SCENARIOS / f"{s}.json" for s in args.scenario]
    elif args.oracles:
        scenarios = [
            gaia2.scenario_path(*gaia2.TASKS[task])
            for task in sorted(gaia2.TASKS)
        ]
    else:
        scenarios = sorted((gaia2.SCENARIOS / "search").glob("*.json"))[:3]
        scenarios += sorted((gaia2.SCENARIOS / "execution").glob("*.json"))[:1]
    total = failed = 0
    with tempfile.TemporaryDirectory(prefix="gaia2-cmp-") as tmp:
        for name in names:
            s, f = compare_app(name, scenarios, Path(tmp), args.verbose,
                               args.oracles)
            total += s
            failed += f
    print(f"{total} calls, {failed} differences")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
