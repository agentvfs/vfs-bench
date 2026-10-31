"""Differential check of the TypeScript port against upstream's graders.

Each case is a trial's frozen inputs: the trajectory, the tool CLIs'
dispatches, each service's audit and the gws run's tables. The reference
(reference.py: upstream's Python under CPython) grades it with a scripted
judge and records the judge's tape; the port grades it replaying that
tape, so its every judge request must be the reference's, byte for byte.
A case matches when both give the same rewards, dimension scores, judge
call log, built gws calls and printed output, or both fail the same way.
Cases are generated from each task's own grader (the strings, numbers
and keys it tests for), its tools and fixtures, and its packaged
solution's reply: an empty run, the solution, and seeded random runs.
The scripted judge's replies are test fixtures, not model judgments.

  uv run --project datasets/claweval python -I \\
      datasets/claweval/tests/audit.py [--task T...] [--cases N] \\
      [--job <harbor job dir>] [--out state/claweval/audit.json]

``--job`` checks a Harbor job's trials instead: each trial's saved inputs
and judge replies, graded on both sides, against the reward it got.

From vfs-bench-2/, after datasets/claweval/fetch.py.
"""
import argparse
import ast
import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent
ROOT = DATASET.parents[1]
sys.path.insert(0, str(HERE))
import reference  # noqa: E402

GRADERS = DATASET / "graders"
REFERENCE = GRADERS / "reference"
EPOCH = "2026-03-02T09:00:00+00:00"
MODEL = "fixture-judge"
GWS = ("gmail", "calendar")
EVENT_FIELDS = ("summary", "startDateTime", "startDate", "endDateTime",
                "endDate", "attendees", "location", "created", "status")


def tasks():
    return sorted(json.loads((REFERENCE / "tasks.json").read_text()))


def grader_sources(task):
    """The task's grader module and the peers it loads, in that order."""
    out, pending = [], [task]
    while pending:
        name = pending.pop()
        source = (REFERENCE / "tasks" / name / "grader.py").read_text()
        out.append(source)
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Call) and getattr(
                    node.func, "id", None) == "load_peer_grader":
                pending.append(node.args[0].value)
    return out


class Vocabulary:
    """What a task's grader looks for: its strings, numbers and the keys it
    reads, and the audit lists it reads by service."""

    def __init__(self, task):
        self.strings, self.numbers, self.keys = [], [], []
        self.actions = {}
        for source in grader_sources(task):
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant):
                    v = node.value
                    if isinstance(v, str) and 0 < len(v) <= 160:
                        self.strings.append(v)
                    elif isinstance(v,
                                    (int, float)) and not isinstance(v, bool):
                        self.numbers.append(v)
                if isinstance(node, ast.Call) and isinstance(
                        node.func, ast.Attribute):
                    args = [
                        a.value for a in node.args
                        if isinstance(a, ast.Constant)
                        and isinstance(a.value, str)
                    ]
                    if node.func.attr == "get" and args:
                        self.keys.append(args[0])
                    if node.func.attr == "get_service_actions" and len(
                            args) >= 2:
                        self.actions.setdefault(args[0], set()).add(args[1])
                if isinstance(node, ast.Subscript) and isinstance(
                        node.slice, ast.Constant) and isinstance(
                            node.slice.value, str):
                    self.keys.append(node.slice.value)
        self.strings = list(dict.fromkeys(self.strings))
        self.keys = list(dict.fromkeys(self.keys))
        self.numbers = list(dict.fromkeys(self.numbers)) or [0]
        self.tools = [
            s for s in self.strings if re.fullmatch(r"[a-z]+_[a-z_]+", s)
        ]
        self.dates = sorted({
            m
            for s in self.strings
            for m in re.findall(r"\d{4}-\d{2}-\d{2}", s)
        }) or ["2026-03-04"]
        # Numbers the grader's answers name, written as answers write them.
        self.figures = [
            s for s in self.strings if re.search(r"\d", s) and len(s) <= 40
        ]

    def figure(self, rng):
        """One of the grader's figures, or a number near it."""
        if not self.figures:
            return str(rng.choice(self.numbers))
        text = rng.choice(self.figures)
        m = re.search(r"-?\d[\d,]*\.?\d*", text)
        if not m or rng.random() < 0.4:
            return text
        number = float(m.group().replace(",", "") or 0)
        number *= rng.choice([1, 1, 1.01, 0.97, 1.2, 10, -1])
        shown = rng.choice(
            [f"{number:,.2f}", f"{number:.0f}", f"{number}", f"{number:.1f}%"])
        unit = rng.choice(["", "", " million", " billion", " thousand", "k"])
        return text[:m.start()] + shown + unit + text[m.end():]

    def moment(self, rng):
        day = rng.choice(self.dates)
        clock = f"{rng.randint(7, 19):02d}:{rng.choice([0, 0, 30, 45]):02d}:00"
        return day + "T" + clock + rng.choice(["", "Z", "+08:00", "+00:00"])


def upstream_task(task):
    import yaml
    return yaml.safe_load(
        (reference.UPSTREAM / "tasks" / task / "task.yaml").read_text())


def audit_keys(service):
    """The lists upstream's service returns from its ``/audit``."""
    server = reference.UPSTREAM / "mock_services" / service / "server.py"
    if not server.exists():
        return []
    tree = ast.parse(server.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "get_audit":
            for ret in ast.walk(node):
                if isinstance(ret, ast.Return) and isinstance(
                        ret.value, ast.Dict):
                    return [
                        k.value for k in ret.value.keys
                        if isinstance(k, ast.Constant) and k.value != "calls"
                    ]
    return []


def gws_tables(task):
    """The gws fake's tables as its fixture seeds them."""
    file = DATASET / task / "workspace/fixtures/gws.json"
    if not file.exists():
        return {}
    fixture = json.loads(file.read_text())
    tables = {
        k: []
        for k in ("Message", "MessageHeader", "MessageLabel", "Event")
    }
    for i, message in enumerate(fixture.get("messages", [])):
        tables["Message"].append({
            "seq": i,
            "id": message["id"],
            "internalDate": message["internalDate"],
            "bodyText": message.get("bodyText")
        })
        for j, header in enumerate(message.get("headers", [])):
            tables["MessageHeader"].append({
                "pk": len(tables["MessageHeader"]),
                "seq": j,
                "messageId": message["id"],
                **header
            })
        for label in message.get("labels", []):
            tables["MessageLabel"].append({
                "messageId": message["id"],
                **label
            })
    for calendar in fixture.get("calendars", []):
        for event in calendar.get("events", []):
            tables["Event"].append({
                "seq": len(tables["Event"]),
                **dict.fromkeys(EVENT_FIELDS), "status": "confirmed",
                **event
            })
    return tables


def js(value):
    """``value`` as JSON from the fakes and the daemon (JavaScript) reads
    back: a whole float is an int there."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [js(v) for v in value]
    if isinstance(value, dict):
        return {k: js(v) for k, v in value.items()}
    return value


def text(rng, vocab, n):
    words = rng.sample(vocab.strings, min(n, len(vocab.strings)))
    numbers = [
        str(rng.choice(vocab.numbers)) for _ in range(rng.randint(0, 3))
    ]
    figures = [vocab.figure(rng) for _ in range(rng.randint(0, 3))]
    out = words + numbers + figures
    rng.shuffle(out)
    sep = rng.choice(["\n", " ", "\n- ", "，", "; "])
    return sep.join(out)


def value(rng, vocab, depth=0, key=""):
    if re.search(r"time|date|start|end", key) and rng.random() < 0.7:
        return vocab.moment(rng)
    kind = rng.random()
    if kind < 0.45:
        return rng.choice(vocab.strings) if vocab.strings else "x"
    if kind < 0.65:
        return rng.choice(vocab.numbers)
    if kind < 0.75:
        return rng.choice([True, False, None])
    if kind < 0.9 or depth > 1:
        return [
            rng.choice(vocab.strings or ["x"])
            for _ in range(rng.randint(0, 3))
        ]
    return record(rng, vocab, depth + 1)


def record(rng, vocab, depth=0):
    keys = rng.sample(vocab.keys, min(rng.randint(1, 6), len(vocab.keys)))
    return {k: value(rng, vocab, depth, k) for k in keys}


def case(task, index, empty=False, solution=None):
    """The ``index``th case of ``task``: seeded, so both sides see it."""
    rng = random.Random(f"{task}/{index}")
    vocab = Vocabulary(task)
    config = upstream_task(task)
    services = [s["name"] for s in config.get("services", [])]
    tools = config.get("tools", [])
    endpoints = {
        e["tool_name"]: e["url"]
        for e in config.get("tool_endpoints", [])
    }
    seed_file = DATASET / task / "workspace/verifier/gws_seed.json"
    seed = json.loads(seed_file.read_text()) if seed_file.exists() else None
    tables = gws_tables(task) if any(s in GWS for s in services) else {}
    dispatches, steps = [], []
    audit = {}
    drafts = any(t["name"] == "gmail_save_draft" for t in tools)
    for service in services:
        # Gmail's audit is the drafts fake's, where the task has drafts.
        if service == "calendar" or (service == "gmail" and not drafts):
            continue
        audit[service] = {"calls": []}
    if not empty:
        for i in range(rng.randint(0, 14)):
            if not tools:
                break
            tool = rng.choice(tools)
            if vocab.tools and rng.random() < 0.25:
                tool = {"name": rng.choice(vocab.tools), "input_schema": {}}
            props = list((tool.get("input_schema")
                          or {}).get("properties", {}))
            body = {}
            for p in rng.sample(props, rng.randint(0, len(props))):
                body[p] = value(rng, vocab, key=p)
            if rng.random() < 0.4 and vocab.keys:
                body.update(record(rng, vocab))
            status = rng.choice([200] * 7 + [400, 404, 422, 500])
            response = record(rng, vocab) if rng.random() < 0.7 else {
                "error": "fixture"
            }
            url = endpoints.get(tool["name"], "http://localhost:9999/x")
            dispatches.append({
                "tool_use_id": f"call_{i}",
                "tool_name": tool["name"],
                "endpoint_url": url,
                "request_body": body,
                "response_status": status,
                "response_body": response,
                "timestamp": EPOCH
            })
            service = tool["name"].split("_")[0]
            if service in audit and rng.random() < 0.85:
                audit[service]["calls"].append({
                    "endpoint":
                    "/" + url.split("/", 3)[-1],
                    "request_body":
                    body,
                    "response_body":
                    response,
                    "timestamp":
                    EPOCH
                })
        for service in list(audit):
            keys = set(audit_keys(service)) | vocab.actions.get(service, set())
            for key in sorted(keys):
                if rng.random() < 0.7:
                    audit[service][key] = [
                        record(rng, vocab) for _ in range(rng.randint(0, 3))
                    ]
        for name, keys in vocab.actions.items():
            if name not in audit and rng.random() < 0.3:
                audit[name] = {k: [record(rng, vocab)] for k in keys}
        shown = []
        if seed:
            shown = [
                json.dumps(e, ensure_ascii=rng.random() < 0.3)
                for e in seed["gmail"] + seed["calendar"] if rng.random() < 0.5
            ]
        for s in range(rng.randint(1, 4)):
            results = []
            for r in range(rng.randint(0, 3)):
                content = text(rng, vocab, rng.randint(0, 8))
                if shown and rng.random() < 0.6:
                    content += "\n" + rng.choice(shown)
                results.append({
                    "source_call_id": f"s{s}r{r}",
                    "content": content
                })
            steps.append({
                "source":
                "agent",
                "message":
                text(rng, vocab, rng.randint(0, 6)),
                "tool_calls": [{
                    "tool_call_id": f"s{s}r{r}",
                    "function_name": "shell",
                    "arguments": {
                        "command": "ls"
                    }
                } for r in range(len(results))],
                "observation": {
                    "results": results
                }
            })
        final = text(rng, vocab, rng.randint(0, 40))
        if solution and rng.random() < 0.5:
            final = solution if rng.random() < 0.5 else final + "\n" + solution
        if rng.random() < 0.15:
            answer = rng.choice(vocab.strings or ["1"])
            final = f"<FINAL_ANSWER>{answer}</FINAL_ANSWER>\n" + final
        steps.append({"source": "agent", "message": final})
        if tables:
            if rng.random() < 0.4:
                tables["Message"].append({
                    "seq":
                    999,
                    "id":
                    "sent-1",
                    "internalDate":
                    1772442000000 + rng.randint(0, 999),
                    "bodyText":
                    text(rng, vocab, 6)
                })
                tables["MessageLabel"].append({
                    "messageId": "sent-1",
                    "labelId": "SENT"
                })
                for j, (name, v) in enumerate([
                    ("To", rng.choice(vocab.strings or ["a@b.c"])),
                    ("Subject", text(rng, vocab, 2))
                ]):
                    tables["MessageHeader"].append({
                        "pk": 1000 + j,
                        "seq": j,
                        "messageId": "sent-1",
                        "name": name,
                        "value": v
                    })
            if rng.random() < 0.4:
                tables["Event"].append({
                    "seq":
                    999,
                    **dict.fromkeys(EVENT_FIELDS), "id":
                    "evt-new",
                    "status":
                    "confirmed",
                    "summary":
                    text(rng, vocab, 2),
                    "startDateTime":
                    "2026-03-04T10:00:00+08:00",
                    "endDateTime":
                    "2026-03-04T11:00:00+08:00",
                    "attendees":
                    json.dumps([{
                        "email": rng.choice(vocab.strings or ["a"])
                    }]),
                    "created":
                    "2026-03-02T09:30:00Z"
                })
            if tables["Event"] and rng.random() < 0.3:
                victim = rng.choice(tables["Event"])
                if rng.random() < 0.5:
                    tables["Event"].remove(victim)
                else:
                    victim["status"] = "cancelled"
    trajectory = None if empty and index % 2 else json.dumps(
        {
            "schema_version":
            "ATIF-v1.4",
            "steps": [{
                "source": "user",
                "message": config["prompt"]["text"]
            }] + steps
        },
        ensure_ascii=False)
    return {
        "task":
        task,
        "model":
        MODEL,
        "epoch":
        EPOCH,
        "audit":
        json.dumps(js(audit), ensure_ascii=False),
        "gws":
        js(tables),
        "trajectory":
        trajectory,
        "dispatches":
        "\n".join(json.dumps(js(d), ensure_ascii=False)
                  for d in dispatches) + ("\n" if dispatches else ""),
        "seed":
        seed_file.read_text() if seed_file.exists() else None,
    }


def kind(error):
    """An error's exception name, or None for no error."""
    return None if error is None else error.split(":", 1)[0]


def responder(case_id):
    """The scripted judge: seeded replies, among them the malformed ones
    upstream's parsing recovers from and errors it retries."""
    rng = random.Random(f"judge/{case_id}")

    def respond(request, index):
        roll = rng.random()
        if roll < 0.03:
            return {"error": {"message": "Judge HTTP 500", "status": 500}}
        prompt = request["messages"][-1]["content"]
        if not isinstance(prompt, str):
            prompt = json.dumps(prompt)
        if "msg_ids as keys" in prompt:
            import re
            ids = list(dict.fromkeys(re.findall(r"msg_\d+", prompt)))
            options = re.findall(r'^\s+"([^"]+)"', prompt, re.M)
            content = json.dumps(
                {i: rng.choice(options or ["x"])
                 for i in ids},
                ensure_ascii=False)
        else:
            score = round(rng.random(), rng.choice([1, 2, 3]))
            reasoning = rng.choice(["fixture", "含\"引号\"", "a\nb"])
            shapes = [
                json.dumps({
                    "score": score,
                    "reasoning": reasoning
                },
                           ensure_ascii=False),
                "```json\n" + json.dumps({
                    "score": score,
                    "reasoning": reasoning
                }) + "\n```",
                f'Result: "score": {score}, "reasoning": "{reasoning}',
                json.dumps({
                    "score": str(score),
                    "reasoning": reasoning
                }),
                json.dumps({
                    "score": score * 3 - 1,
                    "reasoning": reasoning
                }),
                "no judgment here",
            ]
            weights = [50, 15, 10, 8, 10, 3]
            content = rng.choices(shapes, weights)[0]
        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": content
                }
            }]
        }

    return respond


def same(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(
        b, sort_keys=True) or a == b


def recorded(trial):
    """A Harbor trial's frozen inputs as a case, and its judge's replies."""
    verifier = trial / "verifier"
    inputs = json.loads((verifier / "claweval-inputs.json").read_text())
    files = inputs["files"]
    state = json.loads(files["/input/state.json"])
    c = {
        "task": inputs["task"],
        "model": inputs["model"],
        "epoch": state["epoch"],
        "audit": json.dumps(state["audit"]),
        "gws": state["gws"],
        "trajectory": files.get("/input/trajectory.json"),
        "dispatches": files.get("/input/dispatches.jsonl"),
        "seed": files.get("/input/gws_seed.json"),
    }
    tape = json.loads((verifier / "judge-recording.json").read_text())

    def respond(request, index):
        entry = tape[index]
        if entry["request"] != request:
            raise AssertionError(
                f"judge request {index} differs from the trial's")
        return {
            "error": entry["error"]
        } if "error" in entry else entry["response"]

    reward = json.loads((verifier / "reward.json").read_text())
    return c, respond, reward


def main(args):
    cases, responders, trials, failed = [], [], [], []
    if args.job:
        for inputs in sorted(
                Path(args.job).rglob("verifier/claweval-inputs.json")):
            trial = inputs.parent.parent
            # A failed grade saves its inputs and replies but no reward.
            if not (trial / "verifier/reward.json").exists():
                failed.append(trial.name)
                continue
            c, respond, reward = recorded(trial)
            cases.append((c["task"], trial.name, c))
            responders.append(respond)
            trials.append(reward)
    if failed:
        print(f"skipped {len(failed)} trials whose grade failed: " +
              ", ".join(failed[:10]),
              file=sys.stderr)
    for task in [] if args.job else args.task or tasks():
        reply = DATASET / task / "harbor/solution/reply.md"
        solution = reply.read_text() if reply.exists() else None
        cases.append((task, "empty-0", case(task, 0, empty=True)))
        cases.append((task, "empty-1", case(task, 1, empty=True)))
        for i in range(args.cases):
            cases.append(
                (task, f"random-{i}", case(task, i + 2, solution=solution)))
    references = []
    for i, (task, name, c) in enumerate(cases):
        respond = responders[i] if args.job else responder(f"{task}/{name}")
        references.append(reference.grade(c, respond))
    lines = "".join(
        json.dumps({
            "id": i,
            "case": c,
            "tape": ref["tape"]
        },
                   ensure_ascii=False) + "\n"
        for i, ((_, _, c), ref) in enumerate(zip(cases, references)))
    node = os.environ.get("NODE", "node")
    run = subprocess.run(
        [node, "--no-warnings",
         str(HERE / "audit-driver.ts")],
        input=lines.encode(),
        capture_output=True,
        cwd=ROOT)
    if run.returncode:
        sys.exit(run.stderr.decode()[-4000:])
    ports = {}
    for line in run.stdout.decode().splitlines():
        out = json.loads(line)
        ports[out["id"]] = out
    report = []
    for i, ((task, name, c), ref) in enumerate(zip(cases, references)):
        port = ports.get(i, {"error": "no output"})
        if "error" in ref or "error" in port:
            # The same exception; CPython's wording varies by version.
            ok = kind(ref.get("error")) == kind(port.get("error"))
            entry = {
                "task": task,
                "case": name,
                "matched": ok,
                "reference_error": ref.get("error"),
                "port_error": port.get("error")
            }
            if not ok and "stack" in port:
                entry["stack"] = port["stack"]
        else:
            diffs = [k for k in ("rewards", ) if not same(ref[k], port[k])]
            diffs += [
                f"details.{k}" for k in ("scores", "judge", "gws_dispatches")
                if not same(ref["details"][k], port["details"][k])
            ]
            if ref["details"]["output"] != port["details"]["output"]:
                diffs.append("details.output")
            if args.job and not same(trials[i], ref["rewards"]):
                diffs.append("trial reward.json")
            entry = {
                "task": task,
                "case": name,
                "matched": not diffs,
                "differences": diffs,
                "judge_calls": len(ref["tape"]),
                "reward": ref["rewards"]["reward"]
            }
            if diffs:
                entry["reference"] = {
                    k: ref[k]
                    for k in ("rewards", )
                } | {
                    "details": ref["details"]
                }
                entry["port"] = {
                    k: port[k]
                    for k in ("rewards", )
                } | {
                    "details": port["details"]
                }
        report.append(entry)
        if not entry["matched"]:
            why = (entry.get("differences") or entry.get("port_error")
                   or entry.get("reference_error"))
            print(f"FAIL {task} {name} {why}", flush=True)
    matched = sum(e["matched"] for e in report)
    by_task = {}
    for e in report:
        by_task.setdefault(e["task"], []).append(e["matched"])
    tasks_ok = sum(all(v) for v in by_task.values())
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "cases": report,
                "matched": matched,
                "tasks_matched": tasks_ok,
                "tasks": len(by_task)
            },
            indent=1,
            ensure_ascii=False) + "\n")
    errors = sum(1 for e in report if e.get("reference_error"))
    print(f"{matched}/{len(report)} cases match ({errors} where both fail); "
          f"{tasks_ok}/{len(by_task)} tasks match on every case")
    return 0 if matched == len(report) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--task", action="append")
    parser.add_argument("--cases", type=int, default=12)
    parser.add_argument(
        "--job",
        help="a Harbor job directory: grade its trials again, from the "
        "inputs and judge replies they saved, on both sides")
    parser.add_argument("--out",
                        default=str(ROOT / "state/claweval/audit.json"))
    raise SystemExit(main(parser.parse_args()))
