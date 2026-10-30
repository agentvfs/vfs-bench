# This program sees only the separate verifier VFS workspace.
import json
from pathlib import Path

# Globals are supplied by the preceding pinned evaluator in one Monty program.

input_status = json.loads(Path('/.verifier-input/status.json').read_text())
config = load_task_config(  # noqa: F821
    Path('/opt/dataspace-evaluation/configs/' + input_status['task_id'] +
         '.json'))
result = evaluate_task(  # noqa: F821
    config=config,
    prediction_path=Path('/output/prediction.csv'),
    gold_path=Path('/opt/dataspace-evaluation/gold/gold.csv'))
Path('/.verifier-output/evaluation.json').write_text(
    json.dumps(result.to_dict(), ensure_ascii=False))
print(json.dumps(result.to_dict(), ensure_ascii=False))
