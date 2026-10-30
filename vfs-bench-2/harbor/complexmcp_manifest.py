"""Pin the ComplexMCP rows and original graders; --check detects drift.

Run after complexmcp/setup.py. Reference files are deliberately untouched.
"""
import argparse
import hashlib
import json
import runpy
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
DIRECTORY = HARBOR / 'graders/complexmcp'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def row_digest(row):
    return digest(json.dumps(row, sort_keys=True, ensure_ascii=True).encode())


def expected():
    rows = json.loads((ROOT / 'state/complexmcp/tasks.json').read_text())
    slugs = runpy.run_path(str(HARBOR / 'complexmcp.py'))['TASKS']
    tasks = {}
    for slug, index in slugs.items():
        tests = HARBOR / 'tasks/complexmcp' / slug / 'tests'
        tasks[slug] = {
            'runtime': 'complexmcp-monty',
            'row': index,
            'row_sha256': row_digest(rows[index]),
            'apps': ['LightSystem', *rows[index]['apps']],
            'files': {
                name: digest((tests / name).read_bytes())
                for name in ('grade.py', 'test.sh')
            },
        }
    sources = {
        'benchmark/judge.py': 'judge.py',
        'software/utils/dist.py': 'dist.py',
        'LICENSE': 'LICENSE'
    }
    for upstream, vendor in sources.items():
        assert (ROOT / 'state/complexmcp/src' /
                upstream).read_bytes() == (DIRECTORY / 'reference' /
                                           vendor).read_bytes(), upstream
    return {
        'upstream_commit': '7c01f92e38be6e0c193d5c6c9a55baa92fb628cb',
        'reference': {
            name: digest((DIRECTORY / 'reference' / name).read_bytes())
            for name in sources.values()
        },
        'tasks': tasks
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.dumps(expected(), indent=2) + '\n'
    target = DIRECTORY / 'manifest.json'
    if args.check:
        assert target.read_text() == data, 'ComplexMCP reference/row drift'
    else:
        target.write_text(data)
    print('47 ComplexMCP reference definitions verified')
