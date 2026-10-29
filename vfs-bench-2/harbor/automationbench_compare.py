"""Check the AutomationBench fake against upstream's Python world.

    uv run --project automationbench python -I \
        harbor/automationbench_compare.py [service ...] [--task <task> ...] \
        [--per N] [-v]

For each service (default: every one ``automationbench.PORTED`` names with a
calls module) and each task subscribed to it (``--per`` of them, default
3, spread over the domains; or ``--task``), this builds the task's world as
upstream does (``automationbench.Upstream``: the task's clock, ids seeded
with its name) and seeds a run of the fake (``mocks/automationbench``) with
the fixture the exporter writes from it. Then it makes the same tool calls
on both: upstream's ``api_search``, ``api_fetch`` and ``base64_encode`` in
this process, and the fake's routes as the workspace's CLI sends them. The
calls are each service's (``automationbench_calls/<service>.py``'s
``calls(world, last)``): every route, with values from the task's world and
the replies before, error cases, and writes, so later reads see them; and
``automationbench_calls/common.py``'s, for the tools and ``api_fetch``'s
routing.

After each call it compares the text each returned, byte for byte, and the
world after it (as JSON with sorted keys, so ``1`` and ``1.0`` differ) and the
rows Sheets marks updated (kept outside the world's fields), and
exits 1 on any difference but those a calls module's ``KNOWN`` accepts.
"""
import argparse
import contextlib
import hashlib
import importlib
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
CALLS = HARBOR / "automationbench_calls"


def _exporter():
    spec = importlib.util.spec_from_file_location(
        "ab_export", HARBOR / "automationbench.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["ab_export"] = module
    spec.loader.exec_module(module)
    return module


ab = _exporter()


class Fake:
    """The fake, started as harbor/fakes.ts starts a job's."""

    service = "automationbench"

    def __init__(self, root: Path):
        self.root = root
        (root / "fixtures" / self.service).mkdir(parents=True, exist_ok=True)
        (root / "fixtures" / self.service /
         "default.json").write_text('{"doc": []}\n')
        self.proc = subprocess.Popen([
            "node",
            str(HARBOR / "fakes.ts"), "--service", self.service, "--root",
            str(root), "--fixture", "default", "--log",
            str(root / "fake.log")
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
        raise RuntimeError(f"the fake did not start (see {root})")

    def open(self, run: str, fixture: dict, epoch: str) -> None:
        data = json.dumps(fixture).encode()
        name = f"f-{hashlib.sha256(data).hexdigest()[:12]}"
        (self.root / "fixtures" / self.service /
         f"{name}.json").write_bytes(data)
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

    def db(self) -> Path:
        files = list(
            self.state_root.glob(f"mirage-kit-{self.service}-*/{self.run}.db"))
        assert len(files) == 1, files
        return files[0]

    def call(self, tool: str, arguments: dict) -> str:
        request = urllib.request.Request(
            f"{self.url}/_run/{self.run}/{tool}",
            data=json.dumps(arguments).encode(),
            headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as reply:
                return json.loads(reply.read())
        except urllib.error.HTTPError as error:
            return f"<HTTP {error.code}: {error.read()[:2000]!r}>"

    def world(self) -> dict:
        with contextlib.closing(sqlite3.connect(self.db())) as conn:
            row = conn.execute(
                "select doc from doc where name = 'world'").fetchone()
        return json.loads(row[0])

    def hidden(self) -> dict:
        with contextlib.closing(sqlite3.connect(self.db())) as conn:
            row = conn.execute(
                "select doc from doc where name = 'meta'").fetchone()
        return json.loads(row[0]).get("hidden") or {}

    def stop(self) -> None:
        self.proc.stdin.close()
        self.proc.wait()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def first_difference(a, b, path="") -> str:
    if type(a) is not type(b):
        return f"{path or '/'}: {canonical(a)[:300]} != {canonical(b)[:300]}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                where = "upstream" if k in a else "fake"
                return f"{path}/{k}: only in {where}"
            d = first_difference(a[k], b[k], f"{path}/{k}")
            if d:
                return d
        return ""
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: {len(a)} items != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{path}[{i}]")
            if d:
                return d
        return ""
    if a == b:
        return ""
    return f"{path}: {canonical(a)[:300]} != {canonical(b)[:300]}"


def calls_module(service: str):
    path = CALLS / f"{service}.py"
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location(f"ab_calls_{service}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tasks_for(service: str, rows: dict, per: int) -> list[str]:
    """``per`` tasks subscribed to the service, taken round-robin over the
    domains (the calls touch that service alone)."""
    by_domain: dict[str, list[str]] = {}
    for name, row in sorted(rows.items()):
        info = row["info"]
        initial = ab.strip_none_values(info.get("initial_state", {}))
        services = ab.compute_allowed_services(initial,
                                               info.get("assertions", []),
                                               info.get("zapier_tools", []))
        if service in services:
            by_domain.setdefault(name.split(".")[0], []).append(name)
    out: list[str] = []
    while len(out) < per and any(by_domain.values()):
        for names in by_domain.values():
            if names and len(out) < per:
                out.append(names.pop(0))
    return out


def compare(service: str, module, task: str, rows: dict, fake: Fake, n: int,
            verbose: bool) -> tuple[int, int]:
    up = ab.Upstream(rows[task])
    fake.open(f"cmp{n}", up.fixture(), up.epoch)
    known = getattr(module, "KNOWN", {})
    sent = failed = 0
    replies: list = []

    def last():
        return replies[-1]

    d = first_difference(up.dump(), fake.world())
    if d:
        failed += 1
        print(f"  DIFF {task} seed world {d}")
    for tool, arguments in module.calls(up.dump(), last):
        label = f"{tool} {json.dumps(arguments, ensure_ascii=False)[:200]}"
        a = up.call(tool, arguments)
        b = fake.call(tool, arguments)
        sent += 1
        try:
            replies.append(json.loads(a))
        except ValueError:
            replies.append(a)
        if a != b:
            why = next((v for k, v in known.items() if k in label), None)
            if why is None:
                failed += 1
            print(f"  {'known' if why else 'DIFF'} {task} {label}" +
                  (f" ({why})" if why else ""))
            print(f"    upstream: {a[:1500]}")
            print(f"    fake:     {b[:1500]}")
        elif verbose:
            print(f"  same {label}: {a[:160]}")
        d = first_difference(up.dump(), fake.world())
        if d:
            failed += 1
            print(f"  DIFF {task} world after {label}: {d}")
        mine = sorted(
            getattr(up.world.google_sheets, "_updated_row_keys", set()))
        theirs = fake.hidden().get("google_sheets",
                                   {}).get("_updated_row_keys", [])
        if mine != theirs:
            failed += 1
            print(
                f"  DIFF {task} rows updated after {label}: {mine} != {theirs}"
            )
    return sent, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("services", nargs="*")
    parser.add_argument("--task", action="append", default=[])
    parser.add_argument("--per", type=int, default=3)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    rows = ab.rows()
    services = args.services or sorted(
        s for s in ab.PORTED | {"common"} if (CALLS / f"{s}.py").is_file())
    total = failed = 0
    n = 0
    with tempfile.TemporaryDirectory(prefix="ab-cmp-") as tmp:
        fake = Fake(Path(tmp))
        try:
            for service in services:
                module = calls_module(service)
                if module is None:
                    print(f"{service}: no calls module")
                    failed += 1
                    continue
                tasks = args.task or tasks_for(
                    "gmail" if service == "common" else service, rows,
                    args.per)
                for task in tasks:
                    n += 1
                    s, f = compare(service, module, task, rows, fake, n,
                                   args.verbose)
                    total += s
                    failed += f
                    print(f"{service} {task}: {s} calls, {f} differences")
        finally:
            fake.stop()
    print(f"{total} calls, {failed} differences")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
