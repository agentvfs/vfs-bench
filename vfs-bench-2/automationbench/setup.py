"""Export the AutomationBench tasks this repo ports.

    uv run --project automationbench python -I automationbench/setup.py

Upstream (zapier/AutomationBench v1.0.6, MIT) builds its tasks in Python,
noise included, through each domain's dataset loader; the pinned package
comes in through this directory's pyproject. This writes each ported
task's row, as the loader returns it, to
``state/automationbench/tasks/<task_name>.json`` for the TypeScript side,
the world and the grader to read.
"""
import json
from pathlib import Path

from automationbench.domains import get_domain_dataset

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent
STATE = ROOT / "state" / "automationbench" / "tasks"


def main() -> int:
    wanted = [json.loads(p.read_text()) for p in HERE.glob("*/task.json")]
    STATE.mkdir(parents=True, exist_ok=True)
    for domain in sorted({w["domain"] for w in wanted}):
        names = {w["task_name"] for w in wanted if w["domain"] == domain}
        for row in get_domain_dataset(domain):
            info = row["info"]
            info = json.loads(info) if isinstance(info, str) else info
            if info["task_name"] in names:
                (STATE / f"{info['task_name']}.json").write_text(json.dumps(
                    {**row, "info": info}, indent=1, ensure_ascii=False))
                names.discard(info["task_name"])
        if names:
            raise SystemExit(f"not in {domain}: {sorted(names)}")
    print(f"{len(wanted)} tasks in {STATE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
