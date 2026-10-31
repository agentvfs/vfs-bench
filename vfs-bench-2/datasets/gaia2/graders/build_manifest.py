"""Pin registered Harbor tasks and private scenario bytes after GAIA2 setup.

Run build_manifest.py --check after setup to detect scenario drift.
"""
import argparse
import hashlib
import json
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent
ROOT = DATASET.parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    tasks = {}
    config = yaml.safe_load((DATASET / 'jobs' / 'harbor.yaml').read_text())
    for item in config['tasks']:
        task = (ROOT / item['path']).parent
        split, number = task.name.split('-')
        scenarios = list(
            (ROOT / 'state/gaia2/scenarios' / split).glob(f'{number}_*.json'))
        if len(scenarios) != 1:
            raise ValueError(
                f'Run datasets/gaia2/fetch.py first: no unique scenario for {task.name}'
            )
        environment = yaml.safe_load(
            (task / 'workspace/workspace.yaml').read_text())
        tasks[task.name] = {
            'scenario_sha256': digest(scenarios[0]),
            'services': list(environment['fakes'])
        }
    return {'tasks': tasks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.dumps(build(), indent=2) + '\n'
    path = HERE / 'manifest.json'
    if args.check:
        if path.read_text() != data:
            raise SystemExit(
                'GAIA2 manifest changed; regenerate it')
    else:
        path.write_text(data)
