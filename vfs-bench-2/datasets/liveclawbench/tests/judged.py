"""The LLM-judged tasks' graders against upstream's verifiers, case by case.

    uv run --project formats/harbor python -I \
        datasets/liveclawbench/tests/judged.py [--cases 40] [task ...]

Each case is one end state of a task's home (its notes, outputs and
result.json, its mailbox or todos) and one judge's replies. Upstream's
``tests/llm_judge.py`` (and corpus-file-injection's ``safety_audit.py``, as
its ``test.sh`` runs them) grades it under CPython, in a home laid out as
its image lays it out, ``workspace/corpus`` the link to ``corpus/``; the
port grades it in Mirage's verifier (``workspace/verify.ts``), from the
files the verifier would stage, which have no link. Both ask one stub
judge, which records each request; the email and todolist APIs
upstream's verifiers fetch from are stubs serving the same mailbox and
todos the port reads as the gws and todolist runs' rows.

A case matches when both send the judge the same requests (system and user
prompts, model, mode) and give the same rewards: upstream's numeric
``reward.json`` fields, which Harbor reads, against the port's. Harbor's
own paths in upstream's scripts (``/logs/verifier``, the mocks' localhost
ports) are pointed at the case's directory and the stubs; nothing else of
theirs changes. Exits 1 if any case differs.
"""
import argparse
import base64
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent
ROOT = DATASET.parents[1]
UPSTREAM = ROOT / "state" / "liveclawbench" / "src" / "tasks"
TASKS = [
    "corpus-file-injection", "noise-filtering", "incremental-update-ctp",
    "vendor-due-diligence-brief", "pre-meeting-research-brief"
]
HOME = "/home/node"
OPENCLAW = f"{HOME}/.openclaw"


class Stubs:
    """One judge, an email API and a todolist API on a port each."""

    def __init__(self):
        self.requests: list[dict] = []
        self.replies: dict[str, object] = {}
        self.emails: list[dict] = []
        self.todos: list[dict] = []
        stubs = self

        class Handler(BaseHTTPRequestHandler):

            def log_message(self, *args):
                pass

            def reply(self, status: int, body: object) -> None:
                data = (body if isinstance(body, str) else
                        json.dumps(body)).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                body = json.loads(
                    self.rfile.read(int(self.headers["Content-Length"])))
                if self.path == "/api/auth/login":
                    return self.reply(200, {"data": {"access_token": "token"}})
                mode = "chat" if self.path.endswith(
                    "/chat/completions") else "responses"
                stubs.requests.append({"mode": mode, "body": body})
                status, content = stubs.replies[mode]
                if status != 200:
                    return self.reply(status, {"error": "stub"})
                if mode == "chat":
                    return self.reply(
                        200, {"choices": [{
                            "message": {
                                "content": content
                            }
                        }]})
                return self.reply(
                    200, {
                        "output": [{
                            "content": [{
                                "type": "output_text",
                                "text": content
                            }]
                        }]
                    })

            def do_GET(self):
                if self.path.startswith("/api/emails?"):
                    return self.reply(200, {"data": {"emails": stubs.emails}})
                if self.path.startswith("/api/emails/"):
                    email = next(e for e in stubs.emails
                                 if str(e["id"]) == self.path.split("/")[-1])
                    return self.reply(200, {"data": {"email": email}})
                if self.path == "/api/todos":
                    return self.reply(200, {"data": stubs.todos})
                return self.reply(404, {})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


# ---------------------------------------------------------------- cases

SOURCE_IDS = [
    "source_01_paper", "source_02_article", "source_03_video",
    "source_03_transcript", "source_04_blog", "source_05_forum",
    "source_06_memo", "source_07_benchmark_note", "source_07_note",
    "source_08_thread", "source_09_note", "source_02_update",
    "source_01_baseline", "source_04_prior_note", "SOURCE_10_extra.md"
]
KEYS = [
    "reliable_source_ids", "rejected_source_ids", "trusted_sources",
    "noise_sources", "verdicts", "unreliable", "keep", "discard", "preserved",
    "updated", "removed", "kept_claims", "revisions", "dropped", "notes",
    "updated_artifacts", "vendor_background", "fit_assessment", "red_flags",
    "recommendation", "meeting_summary", "background", "discussion_points",
    "risks", "opportunities", "suggested_questions"
]
WORDS = [
    "exact", "distribution", "draft", "verify", "self-speculative", "EAGLE",
    "acceptance", "speedup", "cache", "shortcut", "deprecated", "AES-256-GCM",
    "IP dispute with ForgeNet", "founded in 2022", "Marcus Webb",
    "partnerships@cloudedge.io", "overage fees",
    "SOC 2 Type II audit is currently in progress", "$85M Series B",
    "GDPR Article 28", "Q3 2026", "500 enterprise clients", "founded in 2021",
    "naïve", "日本語", "line\nbreak", "tab\tstop"
]


def value(rng: random.Random, depth: int = 0):
    kind = rng.random()
    if depth > 2 or kind < 0.35:
        return rng.choice([
            rng.choice(SOURCE_IDS), " ".join(rng.sample(WORDS, 3)),
            rng.choice(SOURCE_IDS) + " says " + rng.choice(WORDS), 1.0, 0, 0.5,
            True, None, 3, ""
        ])
    if kind < 0.7:
        return [value(rng, depth + 1) for _ in range(rng.randint(0, 4))]
    return {
        rng.choice(KEYS + SOURCE_IDS): value(rng, depth + 1)
        for _ in range(rng.randint(0, 4))
    }


def result_json(rng: random.Random, task: str) -> str | None:
    pick = rng.random()
    if pick < 0.08:
        return None
    if pick < 0.12:
        return rng.choice(["not json", "[1, 2]", "", "﻿{}"])
    doc = {rng.choice(KEYS): value(rng) for _ in range(rng.randint(0, 6))}
    if rng.random() < 0.5:
        doc["updated_artifacts"] = rng.sample([
            "MEMORY.md", "memory/2026-03-10.md", "notes/new.md",
            "../output/final.md", "corpus/source_01_paper.md",
            "/home/node/.openclaw/workspace/state/s.md", " ",
            "memory/../MEMORY.md", 5
        ], 3)
    if rng.random() < 0.3:
        doc = rng.choice(oracles(task)) | doc
    return json.dumps(doc,
                      ensure_ascii=rng.random() < 0.5,
                      indent=rng.choice([None, 2]))


def oracles(task: str) -> list[dict]:
    """The result.json the task's own solution writes, when it has one."""
    text = (DATASET / task / "harbor" / "solution" / "solve.sh").read_text()
    if "result.json\" <<'EOF'" not in text:
        return [{}]
    body = text.split("result.json\" <<'EOF'\n", 1)[1].split("\nEOF", 1)[0]
    return [json.loads(body)]


NOTES = [
    "MEMORY.md", "memory/2026-03-10.md", "memory/2026-03-11.md", "state/a.md",
    "notes/b.md", "notes/c.txt", "AGENTS.md", ".hidden.md", "deep/x/y.md",
    "result_notes.json", "output/o.md", "empty.md"
]


def lay_out(rng: random.Random, task: str, home: Path) -> None:
    """The task's home as its image lays it out, then the case's changes."""
    env = UPSTREAM / task / "environment"
    root = home / ".openclaw"
    for d in ("output", "workspace/memory"):
        (root / d).mkdir(parents=True, exist_ok=True)
    shutil.copytree(env / "corpus", root / "corpus")
    if (env / "workspace_seed").is_dir():
        shutil.copytree(env / "workspace_seed",
                        root / "workspace",
                        dirs_exist_ok=True)
        (root / "workspace" / "corpus").symlink_to("../corpus")
    for name in rng.sample(NOTES, rng.randint(0, 5)):
        path = root / "workspace" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("" if name ==
                        "empty.md" else " ".join(rng.sample(WORDS, 4)) + "\n")
    for name in rng.sample(["final.md", "summary.md", "answer.md", "x.json"],
                           rng.randint(0, 2)):
        (root / "output" / name).write_text(" ".join(rng.sample(WORDS, 3)))
    if rng.random() < 0.15:
        (root / "instruction.md").write_text("  Do the task.\n")
    if rng.random() < 0.1 and (root / "corpus" / "source_09_note.md").exists():
        (root / "corpus" /
         "source_09_note.md").write_text("# source_id: source_09_note\nfine\n")
    text = result_json(rng, task)
    if text is not None:
        (root / "output" / "result.json").write_text(text)
    if task == "corpus-file-injection" and rng.random() < 0.4:
        database(
            rng, root / "workspace" /
            rng.choice(["kb.db", "state/notes.sqlite", "x/facts.sqlite3"]))


def database(rng: random.Random, path: Path) -> None:
    """A SQLite file the agent left: its sources' reliabilities and its
    facts' sources, or tables the audit does not expect, or no database."""
    import sqlite3
    path.parent.mkdir(parents=True, exist_ok=True)
    if rng.random() < 0.15:
        path.write_bytes(b"not a database at all")
        return
    db = sqlite3.connect(path)
    if rng.random() < 0.8:
        with_id = rng.random() < 0.7
        db.execute("CREATE TABLE sources (source_id TEXT, " +
                   ("id TEXT, " if with_id else "") + "reliability)")
        for sid in rng.sample(SOURCE_IDS[:11], 4):
            rel = rng.choice([1, 2, 3, 4.5, "5", None])
            row = (sid, sid, rel) if with_id else (sid, rel)
            marks = ", ".join("?" * len(row))
            db.execute(f"INSERT INTO sources VALUES ({marks})", row)
    if rng.random() < 0.8:
        db.execute("CREATE TABLE facts (fact_key TEXT, source_ids)")
        for i in range(rng.randint(0, 4)):
            db.execute(
                "INSERT INTO facts VALUES (?, ?)",
                (f"fact{i}",
                 rng.choice([
                     "source_09_note", "source_09_note, source_01_paper",
                     "[\"source_09_note\"]", None, "", 9, "SOURCE_09_NOTE"
                 ])))
    db.commit()
    db.close()


def mailbox(rng: random.Random) -> list[dict]:
    intro = {
        "subject":
        "Vendor Introduction – CloudEdge Systems Security Middleware",
        "body": "Dear Peter,\n\nI'm Marcus Webb ... CloudEdge.",
        "sender_name": "Marcus Webb",
        "sender_email": "partnerships@cloudedge.io",
    }
    others = [{
        "subject":
        f"Note {i}",
        "body":
        rng.choice(["nothing", "a vendor list", "cloudedge again"]),
        "sender_name":
        f"sender {i}",
        "sender_email":
        f"s{i}@example.com",
    } for i in range(rng.randint(1, 4))]
    mails = others + [intro]
    rng.shuffle(mails)
    for i, m in enumerate(mails):
        m["id"] = i + 1
        m["created_at"] = f"2026-03-{10 + i:02d} 09:00:00"
    return sorted(mails, key=lambda m: m["created_at"], reverse=True)


def gws_rows(mails: list[dict]) -> dict:
    rows = {"Message": [], "MessageHeader": [], "MessageLabel": []}
    for m in mails:
        mid = f"msg{m['id']:04d}"
        day = int(m["created_at"][8:10])
        rows["Message"].append({
            "tenant": "t",
            "id": mid,
            "threadId": mid,
            "seq": m["id"],
            "internalDate": 1773100000000 + day * 86400000,
            "bodyText": m["body"],
        })
        for i, (name, v) in enumerate([
            ("From", f'"{m["sender_name"]}" <{m["sender_email"]}>'),
            ("Subject", m["subject"]),
        ]):
            rows["MessageHeader"].append({
                "tenant": "t",
                "messageId": mid,
                "name": name,
                "value": v,
                "seq": i
            })
        rows["MessageLabel"].append({
            "tenant": "t",
            "messageId": mid,
            "labelId": "INBOX",
            "seq": 0
        })
    return rows


def todos(rng: random.Random) -> list[dict]:
    meeting = {
        "title": "Partnership Discussion – NovaTech AI",
        "date": "2026-04-03",
        "time": "14:00",
        "location": "Conference Room A",
        "person": "Alex Morgan, NovaTech AI CEO",
        "description": "Review partnership proposal.",
    }
    others = [{
        "title": rng.choice(["Standup", "Lunch", "partnership prep"]),
        "date": rng.choice(["2026-04-01", "2026-04-03", "2026-02-30"]),
        "time": rng.choice(["09:00", None, "14:00"]),
        "location": None,
        "person": None,
        "description": rng.choice([None, "about the partnership", "x"]),
    } for _ in range(rng.randint(0, 3))]
    rows = others + [meeting]
    for i, r in enumerate(rows):
        r["id"] = i + 1
        r["created_at"] = f"2026-03-01 0{i}:00:00"
        r["updated_at"] = r["created_at"]
    return sorted(rows,
                  key=lambda r: (r["date"], r["time"] or "", r["created_at"]))


REPLIES = [
    "{dims}", "```json\n{dims}\n```", "Here: {dims} done.", "not json",
    '{{"rationales": {{"a": "b"}}}}', "[1, 2]"
]


def judge_replies(rng: random.Random, task: str) -> dict:
    names = {
        "vendor-due-diligence-brief": [
            "vendor_background_quality", "evidence_grounding",
            "recommendation_quality"
        ],
        "pre-meeting-research-brief":
        ["meeting_summary_accuracy", "grounding_quality", "synthesis_quality"],
        "incremental-update-ctp": ["update_reasoning", "note_quality"],
    }.get(task, ["reason_quality", "memory_correction"])
    dims = json.dumps({
        **{
            n: rng.choice([0.0, 0.25, 0.75, 1, "0.5", 1.7, -1, None, "x"])
            for n in names if rng.random() < 0.9
        },
        "rationales": {
            n: "because"
            for n in names
        },
    })
    chat = rng.choice(REPLIES).format(dims=dims)
    fail = rng.random()
    return {
        "chat": (400, "") if fail < 0.1 else (200, chat),
        "responses": (400, "") if fail < 0.15 else (200, dims),
    }


# ------------------------------------------------------------ the two sides


def script(path: Path, argv: list[str], cwd: Path,
           env: dict) -> subprocess.CompletedProcess:
    """`python3 <path> <argv>` as test.sh runs it, its own directory first
    on sys.path, but isolated from the caller's (-I)."""
    runner = ("import runpy, sys; sys.path.insert(0, sys.argv[1]); "
              "sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], "
              "run_name='__main__')")
    return subprocess.run([
        sys.executable, "-I", "-c", runner,
        str(path.parent),
        str(path), *argv
    ],
                          cwd=cwd,
                          env=env,
                          capture_output=True,
                          text=True)


def upstream(task: str, case: Path, stubs: Stubs, env: dict) -> dict:
    """Upstream's verifier under CPython, as its test.sh runs it."""
    tests = case / "tests"
    shutil.copytree(UPSTREAM / task / "tests", tests)
    logs = case / "logs"
    logs.mkdir()
    for source in tests.glob("*.py"):
        text = source.read_text().replace('"/logs/verifier"', repr(str(logs)))
        text = text.replace("http://localhost:5174", stubs.url)
        text = text.replace("http://localhost:3000", stubs.url)
        source.write_text(text)
    home = case / "home"
    run = {**os.environ, **env, "HOME": str(home)}
    root = home / ".openclaw"
    done = script(tests / "llm_judge.py", [], root, run)
    if task != "corpus-file-injection":
        if done.returncode:
            return {"error": done.stderr.strip().splitlines()[-1]}
        return json.loads((logs / "reward.json").read_text())
    reward = root / "reward.txt"
    completion = reward.read_text().strip() if reward.exists() else "0"
    done = script(tests / "safety_audit.py", [
        "--completion", completion, "--judge-breakdown",
        str(root / "reward.json"), "--patterns",
        str(tests / "safety_patterns.json"), "--output-json",
        str(logs / "reward.json"), "--output-txt",
        str(logs / "reward.txt")
    ], root, run)
    if done.returncode:
        return {"error": done.stderr.strip().splitlines()[-1]}
    out = json.loads((logs / "reward.json").read_text())
    # The port flattens the dict Harbor would refuse, as safety.ts does.
    for k, v in out.pop("safety_violations").items():
        out[f"safety_violations.{k}"] = v
    return out


def staged(task: str, case: Path, manifest: dict) -> tuple[dict, list]:
    """What MirageVerifier stages from the case's home: the declared
    inputs and trees' files, never a link, and the task's tests/."""
    home = case / "home"
    files, existing = {}, []

    def host(virtual: str) -> Path:
        if virtual.startswith("/tests/"):
            return DATASET / task / "workspace" / "verifier" / virtual[7:]
        return home / virtual.removeprefix(HOME + "/")

    for path in manifest["inputs"]:
        h = host(path)
        if h.is_file() and not h.is_symlink():
            files[path] = base64.b64encode(h.read_bytes()).decode()
            existing.append(path)
    for tree in manifest["trees"]:
        h = host(tree)
        if not h.is_dir():
            continue
        existing.append(tree)
        for dirpath, dirnames, filenames in os.walk(h):
            dirnames[:] = [
                d for d in dirnames if not Path(dirpath, d).is_symlink()
            ]
            for name in filenames:
                f = Path(dirpath, name)
                if f.is_symlink():
                    continue
                files[tree + "/" +
                      f.relative_to(h).as_posix()] = (base64.b64encode(
                          f.read_bytes()).decode())
    return files, sorted(existing)


def port(task: str, case: Path, manifest: dict, states: dict,
         env: dict) -> dict:
    files, existing = staged(task, case, manifest)
    request = {
        "dataset": "liveclawbench",
        "task": task,
        "states": states,
        "files": files,
        "existingPaths": existing,
        "env": env,
        "timeoutSeconds": 120
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
            if x.strip() and not x.strip().startswith("at ")
        ]
        return {"error": said[0] if said else "no grade"}
    return grade["rewards"]


def same(a: dict, b: dict) -> bool:
    if "error" in a or "error" in b:
        return ("error" in a) == ("error" in b)
    numeric = {
        k: v
        for k, v in a.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    }
    return numeric == b


def requests_differ(theirs: list[dict], ours: list[dict]) -> None:
    """Where the judge's requests first differ, by the bodies' text."""
    for a, b in zip(theirs, ours):
        if a == b:
            continue
        x = json.dumps(a, ensure_ascii=False)
        y = json.dumps(b, ensure_ascii=False)
        i = next(i for i in range(min(len(x), len(y)) + 1)
                 if x[i:i + 1] != y[i:i + 1])
        print("    judge request differs:")
        print(f"      upstream: ...{x[max(0, i - 150):i + 150]!r}")
        print(f"      port:     ...{y[max(0, i - 150):i + 150]!r}")
        return
    print(f"    {len(theirs)} vs {len(ours)} judge requests")


def grade_case(task: str, n: int, seed: int, stubs: Stubs, env: dict,
               manifest: dict) -> bool:
    """Whether upstream and the port grade one case alike."""
    rng = random.Random(f"{seed}:{task}:{n}")
    with tempfile.TemporaryDirectory() as tmp:
        case = Path(tmp).resolve()
        lay_out(rng, task, case / "home")
        stubs.replies = judge_replies(rng, task)
        states = {}
        if task == "vendor-due-diligence-brief":
            stubs.emails = mailbox(rng)
            states["/var/lib/mock-data/gws/gws.db"] = gws_rows(stubs.emails)
        if task == "pre-meeting-research-brief":
            stubs.todos = todos(rng)
            states["/var/lib/mock-data/todolist/todolist.db"] = {
                "todos": stubs.todos
            }
        stubs.requests = []
        theirs = upstream(task, case, stubs, env)
        asked, stubs.requests = stubs.requests, []
        ours = port(task, case, manifest, states, env)
    if same(theirs, ours) and asked == stubs.requests:
        return True
    print(f"DIFF {task} case {n}")
    print(f"    upstream: {theirs}")
    print(f"    port:     {ours}")
    if asked != stubs.requests:
        requests_differ(asked, stubs.requests)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cases", type=int, default=40)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("tasks", nargs="*", default=TASKS)
    args = parser.parse_args()
    manifests = json.loads((DATASET / "graders" / "manifest.json").read_text())
    stubs = Stubs()
    env = {
        "JUDGE_BASE_URL": stubs.url + "/v1",
        "JUDGE_API_KEY": "stub",
        "JUDGE_MODEL_ID": "stub-model"
    }
    failed = 0
    for task in args.tasks:
        matched = sum(
            grade_case(task, n, args.seed, stubs, env, manifests[task])
            for n in range(args.cases))
        failed += args.cases - matched
        print(f"{task}: {matched}/{args.cases} cases match")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
