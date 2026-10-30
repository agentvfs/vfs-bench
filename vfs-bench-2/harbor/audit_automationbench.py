"""Compare all 600 task rubrics with pinned CPython 3.12/Pydantic 2.12.5.

Run with the reference-only Python environment, from vfs-bench-2:
  python -I harbor/audit_automationbench.py \
      --mutations --output state/harbor/parity.json [JOB...]
Production grading never imports Pydantic, SQLite or this audit harness.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
DIRECTORY = HARBOR / "graders/automationbench"
os.environ.pop("AUTOMATIONBENCH_STRICT_ASSERTIONS", None)
sys.path.insert(0, str(HARBOR))
sys.path.insert(0, str(DIRECTORY / "reference"))
from automationbench.rubric import partial_credit  # noqa: E402
from automationbench.schema.world import WorldState  # noqa: E402


def strip_none(obj):
    if isinstance(obj, dict):
        return {k: strip_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [strip_none(v) for v in obj if v is not None]
    return obj


def reference(task, snapshot):
    docs = {row["name"]: row["doc"] for row in snapshot["doc"]}
    world = WorldState(**json.loads(docs["world"]))
    hidden = json.loads(docs.get("meta") or "{}").get("hidden") or {}
    for service, attrs in hidden.items():
        for name, value in attrs.items():
            object.__setattr__(
                getattr(world, service), name,
                set(value) if
                (service, name) == ("google_sheets",
                                    "_updated_row_keys") else value)
    state = {
        "info": {
            **task, "assertions": [strip_none(a) for a in task["assertions"]]
        },
        "initial_state":
        strip_none(copy.deepcopy(task.get("initial_state", {}))),
        "world": world
    }
    credit = partial_credit(state)
    return {
        "partial_credit": credit,
        "task_completed_correctly": float(credit == 1),
        "assertions": state.get("_assertion_results", [])
    }


def snapshot(world, hidden=None):
    return {
        "doc": [{
            "name": "world",
            "doc": json.dumps(world)
        }, {
            "name": "meta",
            "doc": json.dumps({"hidden": hidden or {}})
        }]
    }


def mutate(value, kind):
    if isinstance(value, dict):
        return {k: mutate(v, kind) for k, v in value.items()}
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            return copy.deepcopy(value[1:] if kind == "remove" else value +
                                 value[:1])
        return copy.deepcopy(value)
    return value


def synthetic_writes(task, initial):
    """Stress shared checks with both requested and forbidden writes.

    These deliberately violate guards too; they are not oracle solutions.
    Pydantic serializes typed records so this probes grading rather than
    malformed input rejection. All 600 assertion lists remain unchanged.
    """
    from automationbench.schema.gmail import Message as Email
    from automationbench.schema.google_sheets import Row
    from automationbench.schema.slack import Channel, Message

    world = WorldState(**copy.deepcopy(initial))
    updates = []

    def words(value):
        if isinstance(value, dict):
            return " ".join(words(v) for v in value.values())
        if isinstance(value, list):
            return " ".join(words(v) for v in value)
        return str(value) if value is not None else ""

    for i, assertion in enumerate(task["assertions"]):
        a = strip_none(assertion)
        kind = a["type"]
        text = words({k: v for k, v in a.items() if k != "type"})
        if kind.startswith("gmail_"):
            recipient = a.get("to") or a.get("email") or a.get(
                "recipient") or "parity@example.com"
            recipients = recipient if isinstance(recipient,
                                                 list) else [str(recipient)]
            world.gmail.messages.append(
                Email(id=f"audit-{i}",
                      to=recipients,
                      from_=str(a.get("from", "user@gmail.com")),
                      subject=text,
                      body_plain=text,
                      label_ids=["SENT"],
                      is_read=True,
                      is_starred=True))
        elif kind.startswith("slack_"):
            channel = str(
                a.get("channel") or a.get("channel_id")
                or a.get("channel_name") or "audit-channel")
            existing = world.slack.get_channel_by_id(
                channel) or world.slack.get_channel_by_name(
                    channel.lstrip("#"))
            if existing is None:
                existing = Channel(id=channel, name=channel.lstrip("#"))
                world.slack.channels.append(existing)
            world.slack.messages.append(
                Message(id=f"audit-{i}",
                        ts=str(i),
                        channel_id=existing.id,
                        user_id=str(a.get("user_id", "audit-user")),
                        text=text))
        elif kind.startswith("google_sheets_"):
            sheet = a.get("spreadsheet_id") or a.get("spreadsheet")
            if not sheet:
                continue
            sheet = world.google_sheets._resolve_spreadsheet_id(str(sheet))
            worksheet = a.get("worksheet_id") or a.get("worksheet") or a.get(
                "worksheet_name")
            candidates = world.google_sheets.get_worksheets_for_spreadsheet(
                sheet)
            worksheet = str(
                worksheet
                or (candidates[0].id if candidates else "audit-sheet"))
            worksheet = world.google_sheets._resolve_worksheet_id(
                sheet, worksheet)
            row_id = a.get("row_id", i + 1000)
            cells = {"A": text}
            for key in ("cells", "cell_contains"):
                if isinstance(a.get(key), dict):
                    cells.update(a[key])
            if "column" in a:
                cells[str(a["column"])] = a.get("value", text)
            world.google_sheets.rows.append(
                Row(id=f"audit-{i}",
                    spreadsheet_id=sheet,
                    worksheet_id=worksheet,
                    row_id=row_id,
                    cells=cells))
            updates.append(f"{sheet}:{worksheet}:{row_id}")
        elif "action_key" in a:
            service = kind.split("_action_")[0]
            app = getattr(world, service, None)
            if app is None or not isinstance(getattr(app, "actions", None),
                                             dict):
                continue
            data = app.model_dump(mode="json")
            action = a["action_key"]
            data["actions"].setdefault(action, []).append({
                "id":
                f"audit-{i}",
                "action_key":
                action,
                "params":
                a.get("params", {})
            })
            setattr(world, service, type(app)(**data))
    return snapshot(world.model_dump(mode="json"),
                    {"google_sheets": {
                        "_updated_row_keys": updates
                    }})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", nargs="*", type=Path)
    parser.add_argument("--mutations", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--task")
    parser.add_argument("--saved-only", action="store_true")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise SystemExit(
            "Use CPython 3.12, matching the existing reference VM")
    import pydantic
    assert pydantic.__version__ == "2.12.5"
    manifest = json.loads((DIRECTORY / "manifest.json").read_text())
    for name, pin in manifest["reference"].items():
        assert hashlib.sha256((DIRECTORY / "reference" /
                               name).read_bytes()).hexdigest() == pin, name
    started = time.monotonic()
    results = []
    saved = {}
    for job in args.jobs:
        paths = sorted(job.glob("*/verifier/automationbench-inputs.json"))
        if not paths:
            raise ValueError(f"No saved AutomationBench inputs in {job}")
        for path in paths:
            trial = json.loads(
                (path.parent.parent / "result.json").read_text())
            saved.setdefault(trial["task_name"], []).append(path)
    process = subprocess.Popen(
        ["node", "--no-warnings",
         str(HARBOR / "automationbench_replay.ts")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        cwd=HARBOR.parent,
        env={
            **os.environ, "TZ": "UTC"
        })
    try:
        tasks = [(k, v) for k, v in manifest["tasks"].items()
                 if not args.task or k == args.task]
        if args.saved_only:
            tasks = [(k, v) for k, v in tasks if k in saved]
        if args.limit:
            tasks = tasks[:args.limit]
        for index, (name, definition) in enumerate(tasks):
            directory = HARBOR / "tasks/automationbench" / name
            task_bytes = (directory / "tests/task.json").read_bytes()
            assert hashlib.sha256(
                task_bytes).hexdigest() == definition["files"]["task.json"]
            task = json.loads(task_bytes)
            fixture = json.loads(
                (directory /
                 "environment/kit/automationbench.json").read_text())
            cases = [] if args.saved_only else [("noop", fixture)]
            if args.mutations and not args.saved_only:
                world = json.loads(
                    next(row["doc"] for row in fixture["doc"]
                         if row["name"] == "world"))
                cases += [("empty", snapshot({})),
                          ("remove", snapshot(mutate(world, "remove"))),
                          ("duplicate", snapshot(mutate(world, "duplicate"))),
                          ("synthetic-writes", synthetic_writes(task, world))]
            cases += [("saved:" + str(path), json.loads(path.read_text()))
                      for path in saved.get(name, [])]
            for label, frozen in cases:
                expected = reference(task, frozen)
                request = {
                    "task": name,
                    "timeoutSeconds": 120,
                    "files": {
                        "/input/task.json":
                        base64.b64encode(task_bytes).decode(),
                        "/input/state.json":
                        base64.b64encode(json.dumps(frozen).encode()).decode()
                    }
                }
                process.stdin.write(json.dumps(request) + "\n")
                process.stdin.flush()
                reply = process.stdout.readline()
                if not reply:
                    raise RuntimeError(
                        f"Native audit worker exited {process.poll()}")
                result = json.loads(reply)
                actual = result.get("result", {}).get("checks")
                matched = actual == expected
                if label.startswith("saved:"):
                    original = json.loads((Path(label[6:]).parent /
                                           "reward_details.json").read_text())
                    matched = matched and original == expected
                entry = {
                    "task": name,
                    "case": label,
                    "matched": matched,
                    "reference": expected,
                    "native": actual
                }
                if "error" in result:
                    entry["error"] = result["error"]
                results.append(entry)
                if not matched:
                    print(
                        f"MISMATCH {name}/{label}: "
                        f"{result.get('error', 'assertion details differ')}",
                        flush=True)
            if index % 25 == 0:
                print(
                    f"{index + 1}/{len(tasks)} tasks, "
                    f"{len(results)} comparisons, "
                    f"{sum(not r['matched'] for r in results)} mismatches",
                    flush=True)
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdout.close()
        report = {
            "tasks": len({r["task"]
                          for r in results}),
            "comparisons": len(results),
            "mismatches": sum(not r["matched"] for r in results),
            "elapsed_seconds": time.monotonic() - started,
            "results": results
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    print({k: v for k, v in report.items() if k != "results"})
    if not results or report["mismatches"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
