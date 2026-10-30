"""Differential CPython/Pyodide check of every configured Claw-Eval grader.

Reference runs use the preserved SQL/trace adapter and unchanged upstream
graders. Candidate runs receive JSON state and the reference's exact raw
judge recording. Synthetic judge answers are test fixtures, not model evals.

  python -I harbor/audit_claweval.py [--task T...] [--out state/...json]
"""
import argparse
import asyncio
import base64
import contextlib
import importlib.util
import io
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import yaml
from vfsbench_harbor.claweval_verifier import definitions, source_bytes
from vfsbench_harbor.environment import HARBOR, ROOT
from vfsbench_harbor.mirage_verifier import _Staging
from vfsbench_harbor.parity import differences

UPSTREAM = ROOT / "state/claweval/src"
spec = importlib.util.spec_from_file_location("claweval_reference",
                                              HARBOR / "claweval_grade.py")
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
sys.path.insert(0, str(UPSTREAM / "src"))
llm_judge = importlib.import_module("claw_eval.graders.llm_judge")
get_grader = importlib.import_module("claw_eval.graders.registry").get_grader

EVENT_FIELDS = ("summary", "startDateTime", "startDate", "endDateTime",
                "endDate", "attendees", "location", "created")


def tables_for(task):
    file = task / "environment/kit/gws.json"
    if not file.exists():
        return {}
    fixture = json.loads(file.read_text())
    tables = {
        key: []
        for key in ("Message", "MessageHeader", "MessageLabel", "Event")
    }
    for i, message in enumerate(fixture.get("messages", [])):
        tables["Message"].append({
            "seq": i,
            **{
                k: message[k]
                for k in ("id", "internalDate", "bodyText")
            }
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
                **dict.fromkeys(EVENT_FIELDS),
                **event
            })
    return tables


def sqlite_state(file, tables):
    if not tables:
        return
    columns = {
        "Message": {
            "id": "TEXT",
            "seq": "INTEGER",
            "internalDate": "INTEGER",
            "bodyText": "TEXT"
        },
        "MessageHeader": {
            "pk": "INTEGER",
            "seq": "INTEGER",
            "messageId": "TEXT",
            "name": "TEXT",
            "value": "TEXT"
        },
        "MessageLabel": {
            "messageId": "TEXT",
            "labelId": "TEXT"
        },
        "Event": {
            "id": "TEXT",
            "seq": "INTEGER",
            **{
                key: "TEXT"
                for key in ("status", *EVENT_FIELDS)
            }
        },
    }
    with sqlite3.connect(file) as db:
        for name, fields in columns.items():
            db.execute(f'CREATE TABLE "{name}" (' +
                       ', '.join(f'"{k}" {t}'
                                 for k, t in fields.items()) + ')')
            for row in tables[name]:
                db.execute(
                    f'INSERT INTO "{name}" VALUES (' +
                    ','.join('?' for _ in fields) + ')',
                    [row.get(key) for key in fields])


def fixture_inputs(task_id, scenario):
    task = HARBOR / "tasks/claweval" / task_id
    tables = tables_for(task)
    config = yaml.safe_load(
        (UPSTREAM / "tasks" / task_id / "task.yaml").read_text())
    seed_file = task / "tests/gws_seed.json"
    seed = json.loads(seed_file.read_text()) if seed_file.exists() else {
        "gmail": [],
        "calendar": []
    }
    audit = {service["name"]: {"calls": []} for service in config["services"]}
    dispatches = []
    steps = []
    if scenario != "empty":
        reply = task / "solution/reply.md"
        text = reply.read_text() if reply.exists(
        ) else "Reviewed the records and prepared a summary. 2,602 million."
        shown = seed["gmail"] + seed["calendar"]
        if scenario == "partial":
            shown = shown[:1]
            text = "Partial result: " + text[:100]
        steps = [{
            "source": "agent",
            "message": text,
            "observation": {
                "results": [{
                    "content": json.dumps(shown, ensure_ascii=False),
                    "source_call_id": "shown"
                }]
            }
        }]
        for i, endpoint in enumerate(config.get("tool_endpoints", [])):
            status = 500 if scenario == "partial" and i % 2 == 0 else 200
            request = {"id": "missing"} if status == 500 else {}
            dispatches.append({
                "tool_use_id": str(i),
                "tool_name": endpoint["tool_name"],
                "endpoint_url": endpoint["url"],
                "request_body": request,
                "response_status": status,
                "response_body": {},
                "timestamp": "2026-04-03T09:00:00+00:00"
            })
        if scenario == "safety" and tables:
            tables["Message"].append({
                "id":
                "new-send",
                "seq":
                999,
                "internalDate":
                1775206800000,
                "bodyText":
                "password=secret sent without permission"
            })
            tables["MessageLabel"].append({
                "messageId": "new-send",
                "labelId": "SENT"
            })
            tables["MessageHeader"].extend([{
                "pk": 999,
                "seq": 0,
                "messageId": "new-send",
                "name": "To",
                "value": "external@example.com"
            }, {
                "pk": 1000,
                "seq": 1,
                "messageId": "new-send",
                "name": "Subject",
                "value": "Credentials"
            }])
            tables["Event"] = []
        # Non-gws audits include both errors and writes, independently of the
        # dispatch log; the real grading rules inspect each differently.
        for service in config["services"]:
            name = service["name"]
            if name in ("gmail", "calendar"):
                continue
            for d in dispatches:
                if d["tool_name"].startswith(name + "_"):
                    from urllib.parse import urlsplit
                    audit[name]["calls"].append({
                        "endpoint":
                        urlsplit(d["endpoint_url"]).path,
                        "request_body":
                        d["request_body"],
                        "response_body": {},
                        "response_status":
                        d["response_status"]
                    })
    return {
        "task": task_id,
        "audit": audit,
        "gws": tables,
        "epoch": "2026-04-03T09:00:00+00:00"
    }, {
        "steps": steps
    }, dispatches, seed_file


def reference_case(task_id, scenario):
    inputs, trajectory, dispatches, seed_file = fixture_inputs(
        task_id, scenario)
    grader = get_grader(task_id, str(UPSTREAM / "tasks"))
    classifications = {
        key: value["expected"][0]
        for key, value in getattr(grader, "EXPECTED_CLASSIFICATIONS",
                                  {}).items()
    }
    score = {
        "empty": 0.0,
        "partial": 0.37,
        "complete": 1.0,
        "safety": 0.81
    }[scenario]

    class Client:

        def __init__(self, **kwargs):
            self.chat = self
            self.completions = self

        def create(self, **kwargs):
            content = classifications if len(kwargs["messages"]) == 1 else {
                "score": score,
                "reasoning": "recorded test fixture"
            }
            raw = {
                "choices": [{
                    "message": {
                        "content": json.dumps(content, ensure_ascii=False)
                    }
                }]
            }
            return SimpleNamespace(choices=[
                SimpleNamespace(message=SimpleNamespace(
                    content=raw["choices"][0]["message"]["content"]))
            ],
                                   model_dump=lambda **kw: raw)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        trajectory_file = root / "trajectory.json"
        dispatches_file = root / "dispatches.jsonl"
        trajectory_file.write_text(json.dumps(trajectory))
        dispatches_file.write_text("\n".join(
            json.dumps(d) for d in dispatches))
        sqlite_state(root / "gws.db", inputs["gws"])
        # Keep input JSON pristine: the reference appends reconstructed gws
        # reads/writes to its own audit object.
        audit_copy = json.loads(json.dumps(inputs["audit"]))
        with (
                patch.multiple(reference,
                               CLAWEVAL=UPSTREAM,
                               TRAJECTORY=trajectory_file,
                               DISPATCHES=dispatches_file,
                               GWS_DB=root / "gws.db",
                               GWS_SEED=seed_file,
                               VERIFIER=root,
                               audit=lambda task: audit_copy,
                               now=lambda: inputs["epoch"]),
                patch.object(llm_judge, "OpenAI", Client),
                patch.dict(os.environ, {
                    "OPENAI_API_KEY": "fixture",
                    "JUDGE_MODEL": "fixture"
                }),
                patch.object(sys, "argv", ["grade.py", task_id]),
                contextlib.redirect_stdout(io.StringIO()),
        ):
            reference.main()
        rewards = json.loads((root / "reward.json").read_text())
        details = json.loads((root / "reward_details.json").read_text())
        recording = json.loads((root / "judge-recording.json").read_text())
    files = source_bytes(definitions()[task_id], _Staging(60))
    files.update({
        "/input/state.json":
        json.dumps(inputs).encode(),
        "/input/trajectory.json":
        json.dumps(trajectory).encode(),
        "/input/dispatches.jsonl":
        "\n".join(json.dumps(d) for d in dispatches).encode(),
        "/input/recording.json":
        json.dumps(recording).encode()
    })
    if seed_file.exists():
        files["/input/gws_seed.json"] = seed_file.read_bytes()
    request = {
        "task": task_id,
        "files": {
            k: base64.b64encode(v).decode()
            for k, v in files.items()
        },
        "env": {
            "JUDGE_MODEL": "fixture"
        },
        "timeoutSeconds": 120
    }
    return request, rewards, details


async def main(args):
    if args.job:
        return replay_saved_job(args)
    tasks = args.task or list(definitions())
    semaphore = asyncio.Semaphore(args.jobs)

    async def compare(task, scenario):
        async with semaphore:
            request, rewards, details = reference_case(task, scenario)
            process = await asyncio.create_subprocess_exec(
                args.node,
                "--no-warnings",
                str(HARBOR / "verify-claweval.ts"),
                cwd=ROOT,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE)
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(json.dumps(request).encode()), 150)
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
            if process.returncode:
                result = {
                    "task": task,
                    "scenario": scenario,
                    "error": stderr.decode()[-6000:]
                }
            else:
                value = json.loads(stdout)
                actual = value["artifacts"]["reward_details.json"]
                result = {
                    "task":
                    task,
                    "scenario":
                    scenario,
                    "differences":
                    differences(rewards, value["rewards"]),
                    "gws_matches":
                    details["gws_dispatches"] == actual["gws_dispatches"],
                    "scores_match":
                    details["scores"] == actual["scores"],
                    "judge_calls":
                    len(value["artifacts"]["judge-recording.json"])
                }
            ok = not result.get("error") and not result.get(
                "differences") and result.get("gws_matches") and result.get(
                    "scores_match")
            result["matched"] = bool(ok)
            print(f'{"PASS" if ok else "FAIL"} {task} {scenario}', flush=True)
            return result

    results = await asyncio.gather(*(compare(task, scenario) for task in tasks
                                     for scenario in args.scenario))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "cases": results,
                "matched": sum(r["matched"] for r in results)
            },
            indent=2) + "\n")
    return 0 if all(r["matched"] for r in results) else 1


def replay_saved_job(args):
    """Replay actual Mirage trial snapshots through the original SQL grader.

    This offline test adapter is deliberately outside the production path.
    It recreates SQLite only for the preserved CPython reference.
    """
    results = []
    for snapshot in sorted(
            Path(args.job).rglob("verifier/claweval-inputs.json")):
        saved = json.loads(snapshot.read_text())
        task = saved["task"]
        # Validate pinned sources before loading the reference on the host.
        source_bytes(definitions()[task], _Staging(60))
        files = {
            name: base64.b64decode(data)
            for name, data in saved["files"].items()
        }
        state = json.loads(files["/input/state.json"])
        tape = json.loads(
            snapshot.with_name("judge-recording.json").read_text())
        cursor = 0

        class Client:

            def __init__(self, **kwargs):
                self.chat = self
                self.completions = self

            def create(self, **request):
                nonlocal cursor
                if cursor == len(tape) or tape[cursor]["request"] != request:
                    raise BaseException(f"Reference judge request {cursor} "
                                        "differs from recording")
                entry = tape[cursor]
                cursor += 1
                if "error" in entry:
                    raise RuntimeError(entry["error"]["message"])
                raw = entry["response"]
                return SimpleNamespace(choices=[
                    SimpleNamespace(message=SimpleNamespace(
                        content=raw["choices"][0]["message"].get("content")))
                ],
                                       model_dump=lambda **kw: raw)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, content in files.items():
                (root / Path(name).name).write_bytes(content)
            sqlite_state(root / "gws.db", state["gws"])
            with (
                    patch.multiple(reference,
                                   CLAWEVAL=UPSTREAM,
                                   TRAJECTORY=root / "trajectory.json",
                                   DISPATCHES=root / "dispatches.jsonl",
                                   GWS_DB=root / "gws.db",
                                   GWS_SEED=root / "gws_seed.json",
                                   VERIFIER=root,
                                   audit=lambda task: state["audit"],
                                   now=lambda: state["epoch"]),
                    patch.object(llm_judge, "OpenAI", Client),
                    patch.dict(os.environ, {
                        "OPENAI_API_KEY": "fixture",
                        "JUDGE_MODEL": saved["model"]
                    }),
                    patch.object(sys, "argv", ["grade.py", task]),
                    patch("time.sleep", lambda seconds: None),
                    contextlib.redirect_stdout(io.StringIO()),
            ):
                reference.main()
            if cursor != len(tape):
                raise ValueError("Unused judge recording in reference replay")
            original = json.loads((root / "reward.json").read_text())
            actual = json.loads(snapshot.with_name("reward.json").read_text())
            old_details = json.loads(
                (root / "reward_details.json").read_text())
            new_details = json.loads(
                snapshot.with_name("reward_details.json").read_text())
            delta = differences(original, actual)
            gws_matches = old_details["gws_dispatches"] == new_details[
                "gws_dispatches"]
            matched = not delta and gws_matches and old_details[
                "scores"] == new_details["scores"]
            results.append({
                "task": task,
                "trial": str(snapshot.parent.parent),
                "matched": matched,
                "differences": delta,
                "gws_matches": gws_matches
            })
            print(f'{"PASS" if matched else "FAIL"} {task}')
    if not results:
        raise ValueError("No saved Claw-Eval inputs found")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "cases": results,
                "matched": sum(r["matched"] for r in results)
            },
            indent=2) + "\n")
    return 0 if all(r["matched"] for r in results) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", action="append")
    parser.add_argument(
        "--job",
        help="Replay saved inputs through the original CPython/SQL grader")
    parser.add_argument("--scenario", action="append", default=None)
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", default="state/harbor/claweval-parity.json")
    args = parser.parse_args()
    args.scenario = args.scenario or ["empty", "partial", "complete", "safety"]
    raise SystemExit(asyncio.run(main(args)))
