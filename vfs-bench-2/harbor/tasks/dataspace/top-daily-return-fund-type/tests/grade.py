"""Grade a DataSpace prediction with upstream's evaluator, in the verifier.

    python3 /tests/grade.py <task_id>

Each committed DataSpace task's ``tests/grade.py`` (harbor/dataspace.py
writes it). Upstream's ``evaluation/evaluate.py``, the task's frozen config
and its gold CSV are under ``/opt/dataspace-evaluation``, which only
``MicrosandboxVerifier``'s VM gets (mirage.yaml's ``verifier.copy``): the
agent's workspace has none of them. This grades ``/output/prediction.csv``
as upstream's ``evaluate.py`` grades a task, writes its score (1 or 0, no
partial credit) to ``reward.txt`` and its result to ``evaluation.json``.
"""
import importlib.util
import json
import sys
from pathlib import Path

EVALUATION = Path("/opt/dataspace-evaluation")
PREDICTION = Path("/output/prediction.csv")
LOGS = Path("/logs/verifier")


def main() -> int:
    task_id = sys.argv[1]
    evaluator = EVALUATION / "evaluator" / "evaluate.py"
    if not evaluator.is_file():
        print(f"{evaluator} is missing: the gold answer and upstream's "
              "evaluator reach MicrosandboxVerifier's VM alone "
              "(--verifier vfsbench_harbor:MicrosandboxVerifier)")
        return 1
    spec = importlib.util.spec_from_file_location("evaluate", evaluator)
    evaluate = importlib.util.module_from_spec(spec)
    sys.modules["evaluate"] = evaluate  # its dataclasses resolve their module
    spec.loader.exec_module(evaluate)
    config = evaluate.load_task_config(EVALUATION / "configs" /
                                       f"{task_id}.json")
    result = evaluate.evaluate_task(config=config,
                                    prediction_path=PREDICTION,
                                    gold_path=EVALUATION / "gold" / "gold.csv")
    LOGS.mkdir(parents=True, exist_ok=True)
    details = json.dumps(result.to_dict(), ensure_ascii=False, indent=1)
    (LOGS / "evaluation.json").write_text(details + "\n")
    (LOGS / "reward.txt").write_text(f"{result.score}\n")
    print(details)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
