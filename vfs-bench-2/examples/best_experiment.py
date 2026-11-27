"""Read the trial's W&B mount and write Toolathlon's requested CSV."""

import csv
import json
from pathlib import Path


def main():
    project = Path("/wandb/mluo/deepscaler-1.5b")
    candidates = []
    for run in project.iterdir():
        name = json.loads((run / "run.json").read_bytes())["display_name"]
        with (run / "history.jsonl").open() as history:
            for line in history:
                row = json.loads(line)
                if row.get("val/test_score/") is not None:
                    candidates.append(
                        (row["val/test_score/"], row["_step"], name))
    score, step, name = max(candidates, key=lambda item: item[0])
    best = {
        "best_experiment_name": name,
        "best_step": step,
        "best_val_score": score,
    }
    with Path("/workspace/best_experiment.csv").open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(best))
        writer.writeheader()
        writer.writerow(best)
    print(json.dumps(best))


if __name__ == "__main__":
    main()
