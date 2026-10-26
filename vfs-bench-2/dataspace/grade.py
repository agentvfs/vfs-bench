"""Grade one DataSpace prediction with upstream's own evaluator.

Reads ``{"evaluator", "config", "prediction", "gold"}`` (paths) on stdin
and prints upstream's ``TaskEvaluationResult.to_dict()``: one prediction
CSV against the gold CSV under the task's frozen config.
"""
import importlib.util
import json
import sys
from pathlib import Path


def main() -> int:
    data = json.load(sys.stdin)
    spec = importlib.util.spec_from_file_location("evaluate",
                                                  data["evaluator"])
    evaluate = importlib.util.module_from_spec(spec)
    sys.modules["evaluate"] = evaluate  # its dataclasses resolve their module
    spec.loader.exec_module(evaluate)
    config = evaluate.load_task_config(Path(data["config"]))
    result = evaluate.evaluate_task(config=config,
                                    prediction_path=Path(data["prediction"]),
                                    gold_path=Path(data["gold"]))
    print(json.dumps(result.to_dict(), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
