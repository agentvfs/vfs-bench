"""Check an EnterpriseOps-Gym kit fake against upstream's server image.

    uv run --project harbor python -I harbor/enterpriseops_compare.py \
        <domain> <calls.json> [--seed <db file>] [--epoch <iso>] \
        [--user <email>] [-v]

Upstream's server for the domain runs from its image (``enterpriseops/
tools/<server>.json`` names it, by digest) in a container named
``eog-<domain>``, started here if it is not running, its port on
127.0.0.1 only. Both sides are seeded from the same file of gym_dbs.zip
(``state/enterpriseops/dbs``; default: the domain's first). Then each call
of ``calls.json`` (``[{"tool": ..., "args": {...}}, ...]``, or a task's
``solution/calls.json``) goes to both, as upstream's MCP client sends it
and as the CLI sends it to the fake, and:

- each reply is compared: its text, and whether it is an error;
- at the end every table of both databases is compared, row by row.

A timestamp only one side's clock could make (upstream's is the wall
clock, the fake's the run's ``--epoch``) is compared as ``<now>``, unless
it is the seed's own value or one a call supplied. Every
difference is printed, and the script exits 1 on any.
"""
import argparse
import asyncio
import fcntl
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
STATE = ROOT / "state" / "enterpriseops"
DBS = STATE / "dbs" / "Domain Wise DBs and Task-DB Mappings"
TOOLS = ROOT / "enterpriseops" / "tools"


def _fakes():
    """vfsbench_harbor's shared fakes (fakes.py), without the package, which
    imports Harbor."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "fakes", HARBOR / "src" / "vfsbench_harbor" / "fakes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def server_of(domain: str) -> dict:
    for path in TOOLS.glob("*.json"):
        spec = json.loads(path.read_text())
        if spec["domain"] == domain:
            return spec
    raise SystemExit(f"no server for {domain} under {TOOLS}")


def container(spec: dict) -> tuple[str, str]:
    """Upstream's server for the spec, running: its container and URL. A
    running container is reused only if it runs the pinned image. A lock
    per domain holds from the check until it answers, so comparisons
    started together share one container rather than replace each
    other's."""
    name = f"eog-{spec['domain']}"
    lock = Path(tempfile.gettempdir()) / f"{name}.lock"
    with lock.open("w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        return started(spec, name)


def started(spec: dict, name: str) -> tuple[str, str]:
    image = ["docker", "image", "inspect", "-f", "{{.Id}}", spec["image"]]
    if subprocess.run(image, capture_output=True).returncode != 0:
        subprocess.run(
            ["docker", "pull", "--platform", "linux/amd64", spec["image"]],
            check=True,
            capture_output=True)
    pinned = subprocess.run(image, capture_output=True, text=True,
                            check=True).stdout.strip()
    running = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}} {{.Image}}", name],
        capture_output=True,
        text=True).stdout.strip()
    if running != f"true {pinned}":
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        subprocess.run([
            "docker", "run", "-d", "--name", name, "--platform", "linux/amd64",
            "-p", f"127.0.0.1::{spec['container_port']}", spec["image"]
        ],
                       check=True,
                       capture_output=True)
    port = subprocess.run(
        ["docker", "port", name,
         str(spec["container_port"])],
        capture_output=True,
        text=True,
        check=True).stdout.split(":")[-1]
    url = f"http://127.0.0.1:{port.strip()}"
    for _ in range(120):
        try:
            if httpx.get(f"{url}/health", timeout=2).status_code == 200:
                return name, url
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise SystemExit(f"{name} did not come up at {url}")


class Upstream:
    """Upstream's server, called as upstream's MCP client calls it."""

    def __init__(self, url: str, db: str, user: str):
        self.url, self.db, self.user = url, db, user
        self.client = httpx.AsyncClient(timeout=120)
        self.session: str | None = None

    async def rpc(self, method: str, params: dict) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "x-database-id": self.db,
            "x-user-email": self.user,
        }
        if self.session:
            headers["mcp-session-id"] = self.session
        reply = await self.client.post(f"{self.url}/mcp",
                                       json={
                                           "jsonrpc": "2.0",
                                           "id": 1,
                                           "method": method,
                                           "params": params
                                       },
                                       headers=headers)
        self.session = reply.headers.get("mcp-session-id", self.session)
        text = reply.text
        if text.startswith(("event:", "data:")):
            text = "\n".join(line[5:].strip() for line in text.splitlines()
                             if line.startswith("data:"))
        return json.loads(text)

    async def call(self, tool: str, args: dict) -> tuple[str, bool]:
        if self.session is None:
            await self.rpc(
                "initialize", {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "compare",
                        "version": "1"
                    }
                })
        out = await self.rpc("tools/call", {"name": tool, "arguments": args})
        if "error" in out:
            return json.dumps(out["error"]), True
        result = out["result"]
        return result["content"][0]["text"], bool(result.get("isError"))


class Fake:
    """A run of the fake, called as the CLI calls it (harbor/tools.ts)."""

    def __init__(self, url: str, user: str):
        self.url, self.user = url, user
        self.client = httpx.AsyncClient(timeout=120)

    async def call(self, tool: str, args: dict) -> tuple[str, bool]:
        reply = await self.client.post(f"{self.url}/{tool}",
                                       json=args,
                                       headers={"x-user-email": self.user})
        body = reply.json()
        text = body if isinstance(body, str) else reply.text
        return text, reply.status_code >= 400


def tables(path: Path) -> dict[str, list[dict]]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    out = {}
    for (name, ) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT "
            "LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY "
            "name"):
        out[name] = [
            dict(r)
            for r in conn.execute(f'SELECT * FROM "{name}" ORDER BY rowid')
        ]
    conn.close()
    return out


def stamps(value, key: str | None = None) -> set[tuple[str, str]]:
    """Every timestamp in a call's arguments, to the second, with the field
    that carried it: values the caller supplied, which a clock mask leaves
    alone in a field of that name (``closed_on``), and only there."""
    if isinstance(value, dict):
        return set().union(*(stamps(v, k) for k, v in value.items()))
    if isinstance(value, list):
        return set().union(*(stamps(v, key) for v in value))
    if isinstance(value, str) and key is not None:
        return {(key, m.group(0)[:19].replace("T", " "))
                for m in STAMP_IN_TEXT.finditer(value)}
    return set()


def masker(start: datetime, end: datetime, supplied: set[tuple[str, str]]):
    """A value as compared: a timestamp in [start, end] is `<now>`, unless
    a call supplied it. A field whose value is a timestamp keeps it only if
    a call supplied it in a field of that name (``supplied``), so a field
    another clock wrote is masked whatever the calls supplied elsewhere. A
    timestamp inside text (an error that echoes the input) keeps any value
    a call supplied."""
    echoed = {stamp for _, stamp in supplied}

    def mask(value, key: str | None = None):
        if not isinstance(value, str):
            return value
        if key is not None and STAMP_VALUE.fullmatch(value):
            stamp = value[:19].replace("T", " ")
            if (key, stamp) in supplied or not within(value, start, end):
                return value
            return "<now>"
        return STAMP_IN_TEXT.sub(
            lambda t: "<now>"
            if within(t.group(0), start, end) and t.group(0)[:19].replace(
                "T", " ") not in echoed else t.group(0), value)

    return mask


STAMP_IN_TEXT = re.compile(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?")
# A value that is a timestamp and nothing else.
STAMP_VALUE = re.compile(STAMP_IN_TEXT.pattern + r"(Z|[+-]\d{2}:?\d{2})?")


def within(text: str, start: datetime, end: datetime) -> bool:
    try:
        at = datetime.fromisoformat(text[:19].replace(
            "T", " ")).replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return start - timedelta(seconds=2) <= at <= end + timedelta(seconds=2)


def masked_text(text: str, mask) -> str:
    try:
        value = json.loads(text)
    except ValueError:
        return mask(text)

    def walk(v, key=None):
        if isinstance(v, dict):
            return {k: walk(x, k) for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x, key) for x in v]
        return mask(v, key)

    return json.dumps(walk(value), ensure_ascii=False)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("domain")
    parser.add_argument("calls")
    parser.add_argument("--seed")
    parser.add_argument("--epoch", default="2025-11-25T15:28:42Z")
    parser.add_argument("--user", default="jose.roberson@servicenow.com")
    parser.add_argument("--task",
                        help="a committed task: its seed, epoch and user, "
                        "and its verifiers run on both sides at the end")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    verifiers = None
    if args.task:
        task = HARBOR / "tasks" / "enterpriseops" / args.task
        fixture_json = json.loads(
            (task / "environment" / "kit" /
             f"enterpriseops_{args.domain}.json").read_text())
        args.seed = fixture_json["seed"][0]["db"]
        yaml_text = (task / "environment" / "mirage.yaml").read_text()
        args.epoch = re.search(r"epoch: '([^']+)'", yaml_text)[1]
        user = re.search(r'x-user-email: "([^"]+)"', yaml_text)
        if user:
            args.user = user[1]
        verifiers = json.loads((task / "tests" / "verifiers.json").read_text())
    spec = server_of(args.domain)
    seed = args.seed or sorted(
        (DBS / args.domain / "dbs").glob("*.sql"))[0].relative_to(
            DBS.parent).as_posix()
    calls = json.loads(Path(args.calls).read_text())
    service = f"enterpriseops_{args.domain}"
    name, url = container(spec)
    # A database of this run's own, so runs side by side never share one;
    # its id reads as the seed's in upstream's replies, which the fake's
    # errors print.
    stem = Path(seed).stem
    db = f"{stem}_{os.getpid()}_{time.time_ns()}"
    reply = httpx.post(f"{url}/api/seed-database",
                       json={
                           "database_id": db,
                           "name": "compare",
                           "description": "compare",
                           "sql_content": (DBS.parent / seed).read_text()
                       },
                       timeout=1200)
    reply.raise_for_status()
    up = Upstream(url, db, args.user)
    fakes = _fakes()
    pool = fakes.pool()
    logs = STATE / "compare"
    problems: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        fixture = Path(tmp) / "seed.json"
        fixture.write_text(json.dumps({"seed": [{"id": 1, "db": seed}]}))
        fixture_name = pool.register(service, "compare", fixture)
        fake = await asyncio.to_thread(pool.fake, service, fixture_name,
                                       os.environ.get("NODE", "node"),
                                       dict(os.environ), logs)
        run = await pool.open(fake, f"cmp-{os.getpid()}", fixture_name,
                              args.epoch)
        fk = Fake(run.url, args.user)
        # Both sides start from the same seed: a value the run left as the
        # seed has it is compared as it is, never masked.
        seeded = tables(run.db)
        epoch = datetime.fromisoformat(args.epoch.replace("Z", "+00:00"))
        supplied = stamps([call.get("args") for call in calls])
        fake_mask = masker(epoch, epoch + timedelta(seconds=len(calls) + 5),
                           supplied)
        began = datetime.now(timezone.utc)
        try:
            for n, call in enumerate(calls):
                a = await up.call(call["tool"], call.get("args") or {})
                a = (a[0].replace(db, stem), a[1])
                b = await fk.call(call["tool"], call.get("args") or {})
                up_mask = masker(began, datetime.now(timezone.utc), supplied)
                same = (masked_text(a[0], up_mask) == masked_text(
                    b[0], fake_mask) and a[1] == b[1])
                if args.verbose or not same:
                    print(f"{'  ' if same else '! '}{n} {call['tool']} "
                          f"{json.dumps(call.get('args'))[:300]}")
                if not same:
                    problems.append(f"call {n} {call['tool']}")
                    print(f"    upstream ({'error' if a[1] else 'ok'}): "
                          f"{a[0][:1500]}")
                    print(f"    fake     ({'error' if b[1] else 'ok'}): "
                          f"{b[0][:1500]}")
            up_mask = masker(began, datetime.now(timezone.utc), supplied)
            path = Path(tmp) / "upstream.sqlite"
            found = subprocess.run([
                "docker", "exec", name, "sh", "-c",
                f"find / -xdev -name '*{db}*' 2>/dev/null | head -1"
            ],
                                   capture_output=True,
                                   text=True).stdout.strip()
            subprocess.run(
                ["docker", "cp", "-q", f"{name}:{found}",
                 str(path)],
                check=True)
            ta, tb = tables(path), tables(run.db)
            for table in sorted(set(ta) | set(tb)):
                seed = seeded.get(table, [])

                def kept(i, k, v):
                    return i < len(seed) and seed[i].get(k) == v

                ra = [{
                    k: v if kept(i, k, v) else up_mask(v, k)
                    for k, v in r.items()
                } for i, r in enumerate(ta.get(table, []))]
                rb = [{
                    k: v if kept(i, k, v) else fake_mask(v, k)
                    for k, v in r.items()
                } for i, r in enumerate(tb.get(table, []))]
                if ra == rb:
                    continue
                problems.append(f"table {table}")
                print(f"! table {table}: upstream {len(ra)} rows, "
                      f"fake {len(rb)}")
                for x, y in zip(ra, rb):
                    if x != y:
                        print(f"    upstream: {x}\n    fake:     {y}")
                for x in ra[len(rb):]:
                    print(f"    upstream only: {x}")
                for x in rb[len(ra):]:
                    print(f"    fake only:     {x}")
            if verifiers is not None:
                sys.path.insert(0, str(HARBOR))
                import enterpriseops_grade as grade
                for side, base in (("upstream", url), ("fake", run.url)):
                    passed = 0
                    for v in verifiers:
                        config = v["validation_config"]
                        reply = httpx.post(f"{base}/api/sql-runner",
                                           json={
                                               "query": config["query"],
                                               "database_id": db
                                           },
                                           headers={"x-database-id": db},
                                           timeout=60)
                        result = ({
                            "success": True,
                            "result": reply.json()
                        } if reply.status_code == 200 else {
                            "success": False
                        })
                        actual = grade.extract(result)
                        ok = grade.compare(
                            actual, config.get("expected_value"),
                            config.get("comparison_type", "equals"))
                        passed += ok
                        if not ok:
                            print(f"  {side}: FAIL {v.get('name')}: "
                                  f"{actual!r} vs "
                                  f"{config.get('expected_value')!r}")
                    print(f"{side}: {passed} of {len(verifiers)} verifiers "
                          "pass")
                    if passed != len(verifiers):
                        problems.append(f"{side} verifiers")
        finally:
            await pool.drop(run)
            httpx.request("DELETE",
                          f"{url}/api/delete-database",
                          json={"database_id": db},
                          headers={"x-database-id": db},
                          timeout=60)
    print(f"{len(calls)} calls, {len(problems)} differences")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
