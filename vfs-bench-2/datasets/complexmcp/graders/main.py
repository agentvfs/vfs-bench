# Executed by Monty in the verifier's Mirage workspace, after the pinned judge.
import json
from pathlib import Path

# As upstream's run_benchmark.py calls it: the login, logout and expected
# environments as they are.
state = json.loads(Path('/input/state.json').read_text())
result = judge_env(  # noqa: F821 - defined by the preceding pinned judge
    state['initial'],
    state['final'],
    state['expected'],
    verbose=True)
passed = result['recall'] == result['total'] and result['misbehave'] == 0
Path('/output/reward.json').write_text(
    json.dumps({
        'reward': int(passed),
        **result
    }))
print(f"total {result['total']}, recall {result['recall']}, "
      f"misbehave {result['misbehave']}: {'pass' if passed else 'fail'}")
