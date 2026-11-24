"""The JobBench grader against upstream's verifier, case by case.

    uv run --project datasets/jobbench python -I \
        datasets/jobbench/tests/parity.py [--cases 20] [--seed 0] [task ...]

Each case is one output directory (text files under nested names, now and
then an image, a file past the judge's 200,000-character cut, or nothing at
all) and one judge's reply to each rubric item. Upstream's
``harbor/runtime/verify.py`` runs its ``eval/judge.py`` on it under CPython,
as its test.sh does; the port grades it in Mirage's verifier
(``workspace/verify.ts``), from the files the verifier would stage. Both ask
one stub judge, which records each request's body and answers each rubric item
with that case's reply for it: JSON as asked, fenced, with trailing commas
or off-schema, no JSON, or an HTTP error.

A case matches when both send the judge the same request bodies, byte for
byte (in any order,
as both ask in parallel) and either give the same reward or both publish
none. Upstream's deliverables that only its own libraries read (.xlsx,
.docx, .pdf and the rest) are left out: the port does not read them. Exits 1
if any case differs.
"""
import argparse
import base64
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent
ROOT = DATASET.parents[1]
UPSTREAM = ROOT / "state" / "jobbench" / "upstream"
OUTPUT = "/workspace/output"
# A one-pixel PNG, and another, for the judge's image attachments.
PNGS = [
    base64.b64decode(s) for s in (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42"
        "mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42"
        "mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    )
]


class Judge:
    """A stub chat-completions judge: each rubric item's reply, by its text."""

    def __init__(self):
        self.requests: list[str] = []
        self.replies: dict[str, tuple[int, str]] = {}
        self.lock = threading.Lock()
        judge = self

        class Handler(BaseHTTPRequestHandler):

            def log_message(self, *args):
                pass

            def do_POST(self):
                data = self.rfile.read(int(self.headers["Content-Length"]))
                body = json.loads(data)
                with judge.lock:
                    judge.requests.append(data.decode())
                user = body["messages"][1]["content"]
                prompt = user if isinstance(user, str) else user[0]["text"]
                rubric = re.search(
                    r"## Rubric Description\n(.*?)\n\n## Criteria", prompt,
                    re.S).group(1)
                status, content = judge.replies[rubric]
                data = json.dumps({
                    "choices": [{
                        "message": {
                            "content": content
                        }
                    }]
                } if status == 200 else {
                    "error": "stub"
                }).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/v1"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


WORDS = [
    "memo", "reconciliation", "Ünïcödé", "naïve", "表格", "—", "API", "v2.2",
    "#", "|", "\t", "\r\n", "  "
]


def text(rng: random.Random, size: int) -> str:
    return " ".join(rng.choice(WORDS) for _ in range(size))


def lay_out(rng: random.Random, output: Path) -> None:
    """One output directory, or none."""
    shape = rng.random()
    if shape < 0.08:
        return
    output.mkdir(parents=True)
    if shape < 0.15:
        return
    names = [
        "memo.md", "a-b.md", "a/b.md", "notes/summary.txt", "table.csv",
        "data.json", "Report.MD", "z/y/x.yaml", "out.bin", "README",
        ".hidden.md", "page.html"
    ]
    for name in rng.sample(names, rng.randint(1, 5)):
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if rng.random() < 0.05:
            path.write_text("x" * 200_001 + text(rng, 5))
        elif rng.random() < 0.1:
            path.write_bytes(b"\xff\xfe" + text(rng, 20).encode())
        else:
            path.write_text(text(rng, rng.randint(0, 60)))
    if rng.random() < 0.3:
        for i in range(rng.randint(1, 3)):
            (output / f"chart{i}.png").write_bytes(rng.choice(PNGS))


def reply(rng: random.Random, criteria: int) -> tuple[int, str]:
    """A judge's answer to one rubric item."""
    shape = rng.random()
    results = [{
        "index": i,
        "passed": rng.random() < 0.7,
        "reasoning": "r",
        "evidence": "e"
    } for i in range(criteria)]
    payload = {
        "criteria_results": results,
        "rubric_passed": all(r["passed"] for r in results),
        "overall_reasoning": "because"
    }
    plain = json.dumps(payload)
    if shape < 0.6:
        return 200, plain
    if shape < 0.7:
        return 200, f"Here it is:\n```json\n{plain}\n```"
    if shape < 0.78:
        return 200, plain.replace("}]", "},]").replace('"because"}',
                                                       '"because",}')
    if shape < 0.84:
        return 200, "noise " + plain + " trailing"
    if shape < 0.88:
        payload["rubric_passed"] = "yes"
        return 200, json.dumps(payload)
    if shape < 0.91:
        return 200, json.dumps({**payload, "criteria_results": results[:-1]})
    if shape < 0.94:
        return 200, "I cannot judge this."
    if shape < 0.97:
        return 400, ""
    return 500, ""


def upstream(case: Path, judge: Judge, env: dict) -> dict:
    """verify.py around judge.py, as upstream's test.sh runs them."""
    logs = case / "logs"
    done = subprocess.run([
        sys.executable, "-I",
        str(UPSTREAM / "harbor/runtime/verify.py"), "--output-dir",
        str(case / "output"), "--rubrics-file",
        str(case / "RUBRICS.json"), "--judge-path",
        str(UPSTREAM / "eval/judge.py"), "--logs-dir",
        str(logs)
    ],
                          env={
                              **os.environ,
                              **env
                          },
                          capture_output=True,
                          text=True)
    if done.returncode:
        return {
            "error":
            done.stderr.strip().splitlines()[-1]
            if done.stderr.strip() else "error"
        }
    return json.loads((logs / "reward.json").read_text())


def port(task: str, case: Path, env: dict) -> dict:
    """The port, from what MirageVerifier stages: the rubric and the
    output's files, never a link."""
    files = {
        "/tests/RUBRICS.json":
        base64.b64encode((case / "RUBRICS.json").read_bytes()).decode()
    }
    existing = ["/tests/RUBRICS.json"]
    output = case / "output"
    if output.is_dir():
        existing.append(OUTPUT)
        for dirpath, dirnames, filenames in os.walk(output):
            for name in filenames:
                f = Path(dirpath, name)
                virtual = f"{OUTPUT}/{f.relative_to(output).as_posix()}"
                files[virtual] = base64.b64encode(f.read_bytes()).decode()
    request = {
        "dataset": "jobbench",
        "task": task,
        "states": {},
        "files": files,
        "existingPaths": sorted(existing),
        "env": env,
        "timeoutSeconds": 600
    }
    done = subprocess.run(
        ["node", "--experimental-transform-types", "workspace/verify.ts"],
        cwd=ROOT,
        input=json.dumps(request),
        capture_output=True,
        text=True)
    lines = [x for x in done.stdout.splitlines() if x.startswith("{")]
    grade = json.loads(lines[-1]) if lines else {}
    if done.returncode or "rewards" not in grade:
        said = [
            x.strip() for x in done.stderr.splitlines()
            if x.strip() and not x.strip().startswith(("at ", "(node:",
                                                       "(Use `node"))
        ]
        return {"error": said[0] if said else "no grade"}
    return grade["rewards"]


def canonical(requests: list[str]) -> list[str]:
    """The requests' bodies as sent, byte for byte, in any order."""
    return sorted(requests)


def grade_case(task: str, n: int, seed: int, judge: Judge, env: dict) -> bool:
    rng = random.Random(f"{seed}:{task}:{n}")
    rubrics = json.loads(
        (DATASET / task /
         "workspace/verifier/RUBRICS.json").read_text())["rubrics"]
    with tempfile.TemporaryDirectory() as tmp:
        case = Path(tmp).resolve()
        (case / "RUBRICS.json").write_text(json.dumps({"rubrics": rubrics}))
        lay_out(rng, case / "output")
        judge.replies = {
            r["rubric"]: reply(rng, len(r["criterion"]))
            for r in rubrics
        }
        judge.requests = []
        theirs = upstream(case, judge, env)
        asked, judge.requests = judge.requests, []
        ours = port(task, case, env)
    same = ("error" in theirs) == ("error" in ours) and ("error" in theirs
                                                         or theirs == ours)
    if same and canonical(asked) == canonical(judge.requests):
        return True
    print(
        f"DIFF {task} case {n}\n    upstream: {theirs}\n    port:     {ours}")
    a, b = canonical(asked), canonical(judge.requests)
    if a != b:
        print(f"    {len(asked)} vs {len(judge.requests)} judge requests")
        for x, y in zip(a, b):
            if x != y:
                i = next(i for i in range(min(len(x), len(y)) + 1)
                         if x[i:i + 1] != y[i:i + 1])
                print(f"    upstream: ...{x[max(0, i - 120):i + 120]!r}\n"
                      f"    port:     ...{y[max(0, i - 120):i + 120]!r}")
                break
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cases", type=int, default=20)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("tasks",
                        nargs="*",
                        default=sorted(
                            json.loads((DATASET /
                                        "graders/manifest.json").read_text())))
    args = parser.parse_args()
    judge = Judge()
    env = {
        "JUDGE_API_BASE": judge.url,
        "JUDGE_API_KEY": "stub",
        "JUDGE_MODEL": "stub-model"
    }
    failed = 0
    for task in args.tasks:
        matched = sum(
            grade_case(task, n, args.seed, judge, env)
            for n in range(args.cases))
        failed += args.cases - matched
        print(f"{task}: {matched}/{args.cases} cases match", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
