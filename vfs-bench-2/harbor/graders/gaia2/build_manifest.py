"""Pin registered Harbor tasks and private scenario bytes after GAIA2 setup.

Run build_manifest.py --check after setup to detect scenario drift.
"""
import argparse
import hashlib
import json
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
HARBOR = HERE.parents[1]
ROOT = HARBOR.parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    tasks = {}
    files = None
    config = yaml.safe_load((HARBOR / 'gaia2.yaml').read_text())
    for item in config['tasks']:
        task = ROOT / item['path']
        sources = {
            name: digest(task / 'tests' / name)
            for name in ('test.sh', 'grade.py')
        }
        if files is not None and sources != files:
            raise ValueError(
                f'Unexpected GAIA2 reference scripts: {task.name}')
        files = sources
        split, number = task.name.split('-')
        scenarios = list(
            (ROOT / 'state/gaia2/scenarios' / split).glob(f'{number}_*.json'))
        if len(scenarios) != 1:
            raise ValueError(
                f'Run gaia2/setup.py first: no unique scenario for {task.name}'
            )
        environment = yaml.safe_load(
            (task / 'environment/mirage.yaml').read_text())
        tasks[task.name] = {
            'scenario_sha256': digest(scenarios[0]),
            'services': list(environment['fakes'])
        }
    return {'files': files, 'tasks': tasks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.dumps(build(), indent=2) + '\n'
    path = HERE / 'manifest.json'
    if args.check:
        if path.read_text() != data:
            raise SystemExit(
                'GAIA2 manifest changed; review and verify parity first')
    else:
        path.write_text(data)
