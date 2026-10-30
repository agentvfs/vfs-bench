"""Freeze GAIA2 JSON and trajectory; all grading runs in Mirage/Monty."""
import hashlib
import json

from vfsbench_harbor.environment import HARBOR, ROOT

MANIFEST = HARBOR / 'graders/gaia2/manifest.json'


def definitions():
    manifest = json.loads(MANIFEST.read_text())
    return {
        task: {
            'runtime': 'gaia2-monty',
            'task_id': task,
            'files': manifest['files'],
            **definition, 'native_state': {
                service: {
                    'service': service,
                    'tables': ['doc', 'event']
                }
                for service in definition['services']
            }
        }
        for task, definition in manifest['tasks'].items()
    }


async def freeze(verifier, definition, stage, budget):
    states = await verifier.environment.snapshot_verifier_states(
        definition['native_state'])

    def snapshot(budget):
        scenario = ROOT / 'state/gaia2/harbor' / definition[
            'task_id'] / 'scenario.json'
        source = b''.join(budget.chunks(scenario))
        if hashlib.sha256(source).hexdigest() != definition['scenario_sha256']:
            raise ValueError('GAIA2 scenario changed; verify parity first')
        scenario_path = stage / 'scenario.json'
        scenario_path.write_bytes(source)
        scenario_path.chmod(0o400)
        path = verifier.environment.host_path('/logs/agent/trajectory.json')
        trajectory = {}
        if path.exists():
            if not any(path.resolve().is_relative_to(root.resolve())
                       for root in verifier.environment.disk_mounts.values()):
                raise ValueError('GAIA2 trajectory leaves its workspace mount')
            trajectory = json.loads(b''.join(budget.chunks(path)))
        state = {'states': states, 'trajectory': trajectory}
        target = stage / 'state.json'
        frozen = {
            'states': {},
            'files': {
                '/input/state.json': str(target),
                '/input/scenario.json': str(scenario_path)
            }
        }
        if getattr(verifier, 'gaia2_judge_replay', None) is not None:
            details = json.loads(b''.join(
                budget.chunks(verifier.gaia2_judge_replay)))
            if not isinstance(details.get('judge_calls'), list):
                raise ValueError('GAIA2 parity requires recorded judge calls')
            frozen['judgeReplay'] = details['judge_calls']
            judgments = details.get('judgments', [])
            if judgments:
                state['oracle_order'] = [
                    e['id'] for e in judgments[-1]['oracle_events']
                ]
        budget.write_json(target, state)
        target.chmod(0o400)
        return frozen

    return await verifier._background(snapshot, budget=budget)
