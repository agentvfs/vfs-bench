"""Grade one AutomationBench run with upstream's own rubric.

Reads ``{"task", "world"}`` on stdin (the exported task's path and the end
world's JSON) and prints upstream's ``partial_credit`` with its
per-assertion results. Upstream's pass/fail, ``task_completed_correctly``,
is 1.0 iff that credit is 1.0.
"""
import json
import sys
from pathlib import Path

from automationbench.rubric import partial_credit
from automationbench.runner import strip_none_values
from automationbench.schema.world import WorldState


def main() -> int:
    data = json.load(sys.stdin)
    info = json.loads(Path(data["task"]).read_text())["info"]
    state = {
        "info": {**info, "assertions": [strip_none_values(a)
                                        for a in info["assertions"]]},
        "initial_state": strip_none_values(info.get("initial_state", {})),
        "world": WorldState(**data["world"]),
    }
    credit = partial_credit(state)
    print(json.dumps({"partial_credit": credit,
                      "assertions": state.get("_assertion_results", [])},
                     ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
