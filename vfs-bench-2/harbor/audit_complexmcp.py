"""Replay frozen ComplexMCP states against the original CPython judge.

uv run --project complexmcp python -I harbor/audit_complexmcp.py \
    JOB... --output REPORT
--mutations also checks noop, gold, missing state, extra changes, and ID/float
perturbations for every captured task. This tool alone needs Levenshtein;
production grading does not import or call it.
"""
import argparse
import base64
import copy
import hashlib
import json
import runpy
import subprocess
import sys
from pathlib import Path

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('jobs', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--mutations', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(
        (HARBOR / 'graders/complexmcp/manifest.json').read_text())
    src = ROOT / 'state/complexmcp/src'
    for name, relative in [('judge.py', 'benchmark/judge.py'),
                           ('dist.py', 'software/utils/dist.py')]:
        assert hashlib.sha256(
            (src /
             relative).read_bytes()).hexdigest() == manifest['reference'][name]
    sys.path.insert(0, str(src))
    judged = runpy.run_path(str(HARBOR / 'complexmcp_grade.py'))['judged']
    report = []
    seen = set()
    for job in args.jobs:
        for path in sorted(job.glob('*/verifier/complexmcp-inputs.json')):
            task = json.loads(
                (path.parent.parent / 'result.json').read_text())['task_name']
            seen.add(task)
            frozen = json.loads(path.read_text())
            cases = [('saved', frozen)]
            if args.mutations:
                for label, final in [('noop', frozen['initial']),
                                     ('gold', frozen['expected']),
                                     ('empty', {}),
                                     ('extra', {
                                         **frozen['expected'], 'unexpected': 1
                                     })]:
                    cases.append((label, {**frozen, 'final': final}))
                changed = copy.deepcopy(frozen['expected'])

                def perturb(value):
                    if isinstance(value, list):
                        return [perturb(x) for x in value]
                    if isinstance(value, dict):
                        return {
                            k:
                            'ignored-id' if k in ('trid', 'timestamp',
                                                  'mid') else perturb(v)
                            for k, v in value.items()
                        }
                    return value + 1e-9 if isinstance(value, float) else value

                cases.append(('ids-floats', {
                    **frozen, 'final': perturb(changed)
                }))
            for label, state in cases:
                counts, _ = judged({'gt_env': state['expected']},
                                   state['initial'], state['final'])
                expected = {
                    'reward':
                    int(counts['recall'] == counts['total']
                        and counts['misbehave'] == 0),
                    **counts
                }
                if label == 'saved':
                    actual = json.loads(
                        (path.parent / 'reward.json').read_text())
                else:
                    request = {
                        'task': task,
                        'timeoutSeconds': 120,
                        'files': {
                            '/input/state.json':
                            base64.b64encode(
                                json.dumps(state).encode()).decode()
                        }
                    }
                    run = subprocess.run([
                        'node', '--no-warnings',
                        str(HARBOR / 'verify-complexmcp.ts')
                    ],
                                         input=json.dumps(request),
                                         text=True,
                                         capture_output=True,
                                         timeout=150,
                                         check=True)
                    actual = json.loads(run.stdout)['rewards']
                entry = {
                    'task': task,
                    'case': label,
                    'reference': expected,
                    'native': actual,
                    'matched': expected == actual
                }
                report.append(entry)
                print(
                    f"{task}/{label}: "
                    f"{'matched' if entry['matched'] else 'MISMATCH'}",
                    flush=True)
    result = {
        'tasks': len(seen),
        'comparisons': len(report),
        'mismatches': sum(not x['matched'] for x in report),
        'results': report
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    if not report or result['mismatches']:
        raise SystemExit(1)
    print(f"{len(report)} exact comparisons across {len(seen)} tasks")


if __name__ == '__main__':
    main()
