# Executed by Monty in the verifier's Mirage workspace, after the pinned judge.
import json
from pathlib import Path


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, list):
        return [rounded(item) for item in value]
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    return value


state = json.loads(Path('/input/state.json').read_text())
exclude_keys.add('trid')  # noqa: F821 - defined by the preceding pinned judge
result = judge_env(  # noqa: F821
    rounded(state['initial']),
    rounded(state['final']),
    rounded(state['expected']),
    verbose=True)
passed = result['recall'] == result['total'] and result['misbehave'] == 0
Path('/output/reward.json').write_text(
    json.dumps({
        'reward': int(passed),
        **result
    }))
print(f"total {result['total']}, recall {result['recall']}, "
      f"misbehave {result['misbehave']}: {'pass' if passed else 'fail'}")
