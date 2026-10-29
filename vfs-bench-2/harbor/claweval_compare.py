"""Check each Claw-Eval kit fake against upstream's FastAPI service.

    uv run --project harbor python -I harbor/claweval_compare.py [service ...] [--task <id> ...] [-v]

For each service (default: every one with a fake under ``mocks/``; gmail's
is its drafts, for the tasks with that tool) and each
in-scope task that runs it, this starts upstream's ``server.py`` as
upstream's runner does (``claweval/serve.py``, the task's environment, its
``MOCK_TODAY``), seeds a run of the fake from the task's committed fixture
(``claweval.py``'s ``fixture``), and sends both the same requests: each of
the task's tools on that service with an empty body, with its required
fields, with every field, with an id that does not exist, and bodies that
are not a JSON object; then a path no route has, and the service's
``/audit``. Values come from the fixture and the replies before, so writes
hit real rows and later reads see them. It compares each reply's status and
JSON body, with the times upstream stamps from its wall clock
(``+00:00`` ISO times) read as equal, and exits 1 on any other difference.

Two of upstream's values are read as equal too: the categories of an rss
feed (``list_feeds`` lists a Python ``set``, whose order changes with each
process's string hashing) as a set, and the date kb stamps an updated
article with (``last_updated``), the wall clock's upstream and the run's
here. Known differences are printed, not failed: notes' ``days_back``
reads the wall clock upstream where a task has no ``MOCK_TODAY``, and the
run's clock here.
"""
import argparse
import itertools
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
sys.path.insert(0, str(HARBOR))
import claweval  # noqa: E402

NOW = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?\+00:00$")
MISSING = "nope-404"
DAY = re.compile(r"^\d{4}-\d\d-\d\d$")
# The dates an article updated now reads, upstream's and the run's.
STAMPED = {datetime.now(timezone.utc).strftime("%Y-%m-%d"): "<today>"}


def norm(value):
    """A reply with upstream's wall-clock times made equal."""
    if isinstance(value, dict):
        out = {k: norm(v) for k, v in value.items()}
        if isinstance(out.get("categories"), list):
            out["categories"] = sorted(out["categories"], key=str)
        if isinstance(out.get("last_updated"), str) and DAY.match(out["last_updated"]):
            out["last_updated"] = STAMPED.get(out["last_updated"], out["last_updated"])
        return out
    if isinstance(value, list):
        return [norm(v) for v in value]
    if isinstance(value, str) and NOW.match(value):
        return "<now>"
    return value


def harvest(value, pool: dict, key: str | None = None) -> None:
    """Every scalar in a reply or fixture, by the key it is under."""
    if isinstance(value, dict):
        for k, v in value.items():
            harvest(v, pool, k)
    elif isinstance(value, list):
        for v in value:
            harvest(v, pool, key)
    elif key is not None and isinstance(value, (str, int, float, bool)):
        pool.setdefault(key, [])
        if value not in pool[key]:
            pool[key].append(value)


def sample(name: str, schema: dict, pool: dict, missing: bool):
    kind = schema.get("type", "string")
    seen = [v for v in pool.get(name, [])]
    if kind == "array":
        item = schema.get("items") or {"type": "string"}
        inner = sample(name.rstrip("s") or name, item, pool, missing)
        return [inner] if inner is not None else []
    if kind == "object":
        return {}
    if kind == "integer":
        ints = [v for v in seen if isinstance(v, int) and not isinstance(v, bool)]
        return ints[0] if ints else 3
    if kind == "number":
        nums = [v for v in seen if isinstance(v, (int, float)) and not isinstance(v, bool)]
        return nums[0] if nums else 1.5
    if kind == "boolean":
        return True
    if "enum" in schema:
        return schema["enum"][0]
    if missing and (name.endswith("id") or name.endswith("_id")):
        return MISSING
    strs = [v for v in seen if isinstance(v, str)]
    return strs[0] if strs else f"sample {name}"


def bodies(tool: dict, pool: dict):
    """The bodies each tool is sent with, in order."""
    schema = tool.get("input_schema") or {}
    props = schema.get("properties") or {}
    required = schema.get("required") or []
    yield {}
    yield {p: sample(p, props[p], pool, False) for p in required if p in props}
    yield {p: sample(p, s, pool, False) for p, s in props.items()}
    if any(p.endswith("id") for p in props):
        yield {p: sample(p, s, pool, True) for p, s in props.items()}


class Upstream:
    def __init__(self, service: dict, today: str | None, log: Path):
        env = {**os.environ, **{k: str(v) for k, v in (service.get("env") or {}).items()},
               "ERROR_RATE": "0"}
        env.pop("MOCK_TODAY", None)
        if today:
            env["MOCK_TODAY"] = today
        script = service["command"].split()[1]
        self.proc = subprocess.Popen(
            ["uv", "run", "--quiet", "--project", str(ROOT / "claweval"), "python", "-I",
             str(ROOT / "claweval" / "serve.py"), script, "UP"],
            cwd=claweval.UPSTREAM, env=env, stdout=subprocess.PIPE,
            stderr=log.open("w"), text=True)
        line = self.proc.stdout.readline().strip()
        if not line.startswith("UP_URL="):
            raise RuntimeError(f"upstream did not start: {line!r} (see {log})")
        self.url = line.split("=", 1)[1]

    def stop(self):
        self.proc.terminate()
        self.proc.wait()


class Fake:
    def __init__(self, name: str, root: Path, first: bytes):
        (root / "fixtures" / name).mkdir(parents=True, exist_ok=True)
        (root / "fixtures" / name / "default.json").write_bytes(first)
        self.name, self.root = name, root
        self.proc = subprocess.Popen(
            ["node", str(HARBOR / "fakes.ts"), "--service", name, "--root", str(root),
             "--fixture", "default", "--log", str(root / f"{name}.log")],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        for line in self.proc.stdout:
            if line.startswith("FAKE="):
                self.url = json.loads(line[5:])["url"]
                return
        raise RuntimeError(f"{name} did not start (see {root / f'{name}.log'})")

    def run(self, run: str, fixture_name: str, data: bytes, epoch: str) -> str:
        (self.root / "fixtures" / self.name / f"{fixture_name}.json").write_bytes(data)
        reply = httpx.post(f"{self.url}/reset", json={"run": run, "fixture": fixture_name,
                                                       "epoch": epoch}, timeout=60)
        reply.raise_for_status()
        return f"{self.url}/_run/{run}"

    def stop(self):
        self.proc.stdin.close()
        self.proc.wait()


def send(client: httpx.Client, method: str, url: str, body):
    if body is None:
        reply = client.request(method, url)
    elif isinstance(body, bytes):
        reply = client.request(method, url, content=body,
                               headers={"content-type": "application/json"})
    else:
        reply = client.request(method, url, json=body)
    try:
        data = reply.json()
    except ValueError:
        data = reply.text
    return reply.status_code, norm(data)


def compare(service_name: str, tasks: list[tuple[str, dict, dict]], verbose: bool,
            tmp: Path) -> tuple[int, int]:
    """Every task's requests to one service; (requests, differences)."""
    sent = failed = 0
    fake = Fake(claweval.fake(service_name), tmp / service_name,
                claweval.fixture(tasks[0][1], tasks[0][2]))
    try:
        for n, (task_id, task, service) in enumerate(tasks):
            today = (task.get("environment") or {}).get("mock_today")
            epoch = f"{today}T09:00:00Z" if today else claweval.EPOCH
            data = claweval.fixture(task, service)
            base = fake.run(f"cmp{n}", task_id, data, epoch)
            STAMPED[epoch[:10]] = "<today>"
            up = Upstream(service, today, tmp / f"{service_name}-{task_id}.log")
            pool: dict = {}
            harvest([json.loads(r["doc"]) for r in json.loads(data)["doc"]], pool)
            endpoints = {e["tool_name"]: e for e in task["tool_endpoints"]}
            port = f":{service['port']}/"
            tools = [t for t in task["tools"] if port in endpoints[t["name"]]["url"]]
            # Gmail's fake is its drafts alone; the rest is Mirage's gws.
            if service_name == "gmail":
                tools = [t for t in tools if t["name"] == claweval.DRAFT]
            requests = []
            try:
                with httpx.Client(timeout=30) as client:
                    def both(method, path, body, label):
                        nonlocal sent, failed
                        a = send(client, method, f"{up.url}{path}", body)
                        b = send(client, method, f"{base}{path}", body)
                        harvest(a[1], pool)
                        sent += 1
                        known = (service_name == "notes" and not today
                                 and isinstance(body, dict) and body.get("days_back"))
                        if a != b:
                            if known:
                                print(f"  known {task_id} {label}: notes days_back reads the wall clock upstream")
                            else:
                                failed += 1
                                print(f"  DIFF {task_id} {label}\n    upstream: {json.dumps(a, ensure_ascii=False)[:1500]}\n    fake:     {json.dumps(b, ensure_ascii=False)[:1500]}")
                        elif verbose:
                            print(f"  same {task_id} {label}: {a[0]}")
                    for tool in tools:
                        endpoint = endpoints[tool["name"]]
                        path = httpx.URL(endpoint["url"]).path
                        method = endpoint.get("method", "POST")
                        for body in itertools.chain(bodies(tool, pool), [b"not json", b"[]", b"null"]):
                            requests.append((method, path, body, f"{tool['name']} {body!r}"[:200]))
                    for method, path, body, label in requests:
                        both(method, path, body, label)
                    # Once more, now that every write has happened.
                    for method, path, body, label in requests:
                        if method == "POST" and isinstance(body, dict):
                            both(method, path, body, "again " + label)
                    both("POST", f"/{service_name.split('_')[0]}/no-such-route", {}, "unrouted")
                    for method, path, _body, label in requests[:1]:
                        other = "GET" if method == "POST" else "POST"
                        both(other, path, None, f"{other} for {label}")
                    reset = service.get("reset_endpoint")
                    if reset:
                        audit = httpx.URL(reset).path.removesuffix("/reset") + "/audit"
                        both("GET", audit, None, "audit")
            finally:
                up.stop()
            print(f"{service_name} {task_id}: {len(requests)} requests")
    finally:
        fake.stop()
    return sent, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("services", nargs="*")
    parser.add_argument("--task", action="append", default=[])
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    ours = sorted(p.name.removeprefix("claweval_") for p in (ROOT / "mocks").glob("claweval_*")
                  if (p / "main.ts").is_file())
    services = args.services or ours
    by_service: dict[str, list] = {}
    for task_id in claweval.TASKS:
        if args.task and task_id not in args.task:
            continue
        task = yaml.safe_load((claweval.UPSTREAM / "tasks" / task_id / "task.yaml").read_text())
        for service in task["services"]:
            name = "ocr" if service["name"].startswith("ocr") else service["name"]
            if name == "gmail" and not claweval.has_draft(task):
                continue
            if name in services:
                by_service.setdefault(name, []).append((task_id, task, service))
    total = failed = 0
    with tempfile.TemporaryDirectory(prefix="claweval-cmp-") as tmp:
        for name in services:
            if name not in by_service:
                continue
            s, f = compare(name, by_service[name], args.verbose, Path(tmp))
            total += s
            failed += f
    print(f"{total} requests, {failed} differences")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
