"""GAIA2 frozen-input provenance, source pins and parity routing."""
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from vfsbench_harbor.gaia2_verifier import definitions, freeze
from vfsbench_harbor.mirage_verifier import MirageVerifier, _Staging


class Gaia2VerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / 'stage'
        self.stage.mkdir()
        self.logs = self.root / 'agent'
        self.logs.mkdir()
        self.trajectory = self.logs / 'trajectory.json'
        self.trajectory.write_text('{"steps": []}')
        scenario = self.root / 'state/gaia2/harbor/search-0002/scenario.json'
        scenario.parent.mkdir(parents=True)
        scenario.write_text('{"events": []}')
        self.scenario = scenario
        self.definition = {
            'task_id': 'search-0002',
            'scenario_sha256':
            hashlib.sha256(scenario.read_bytes()).hexdigest(),
            'native_state': {
                'gaia2_contacts': {
                    'service': 'gaia2_contacts',
                    'tables': ['doc', 'event']
                }
            }
        }
        self.states = {'gaia2_contacts': {'doc': [], 'event': []}}
        env = SimpleNamespace(
            snapshot_verifier_states=AsyncMock(return_value=self.states),
            host_path=lambda _: self.trajectory,
            disk_mounts={'/logs/agent': self.logs})
        self.verifier = SimpleNamespace(
            environment=env,
            trial_paths=SimpleNamespace(verifier_dir=self.root / 'verifier'),
            include_logs=None,
            exclude_logs=None,
            task=SimpleNamespace(config=SimpleNamespace(
                verifier=SimpleNamespace(timeout_sec=10))))
        self.verifier._background = MirageVerifier._background.__get__(
            self.verifier)
        self.verifier._log = MirageVerifier._log.__get__(self.verifier)
        self.enterContext(
            patch('vfsbench_harbor.gaia2_verifier.ROOT', self.root))

    async def snapshot(self):
        return await freeze(self.verifier, self.definition, self.stage,
                            _Staging(10))

    async def test_json_snapshot_uses_no_sqlite_and_is_independent(self):
        with patch('sqlite3.connect',
                   side_effect=AssertionError('No verifier SQLite')):
            result = await self.snapshot()
        self.states['gaia2_contacts']['event'].append(
            {'entry': 'later mutation'})
        self.trajectory.write_text('{"steps": [{"message":"later"}]}')
        staged = json.loads(
            Path(result['files']['/input/state.json']).read_text())
        self.assertEqual(staged['trajectory'], {'steps': []})
        self.assertEqual(staged['states']['gaia2_contacts']['event'], [])
        self.assertEqual(result['states'], {})
        snapshot = self.verifier.environment.snapshot_verifier_states
        snapshot.assert_awaited_once_with(self.definition['native_state'])

    async def test_replay_inputs_survive_cleanup(self):
        self.states['gaia2_contacts'] = {
            'doc': [{
                'name': 'state',
                'doc': json.dumps({'contacts': {
                    'me': {
                        'is_user': True
                    }
                }})
            }],
            'event': [{
                'wall':
                1730000000.125,
                'seq':
                1,
                'entry':
                json.dumps({
                    't': 1720000000,
                    'app': 'Contacts',
                    'fn': 'add_contact',
                    'args': {
                        'first_name': 'Alice'
                    },
                    'ret': {
                        'id': 'created-contact'
                    }
                })
            }]
        }
        self.trajectory.write_text(
            '{"steps": [{"source": "agent", "message": "Done"}]}')
        self.verifier.verifier_env = {'OPENAI_API_KEY': 'never-log-this-key'}
        frozen = await self.snapshot()
        expected_state = Path(
            frozen['files']['/input/state.json']).read_bytes()
        expected_scenario = self.scenario.read_bytes()
        self.states.clear()
        self.trajectory.unlink()
        self.scenario.unlink()
        shutil.rmtree(self.stage)

        logs = self.verifier.trial_paths.verifier_dir
        self.assertEqual((logs / 'gaia2-inputs.json').read_bytes(),
                         expected_state)
        self.assertEqual((logs / 'gaia2-scenario.json').read_bytes(),
                         expected_scenario)
        self.assertNotIn(b'never-log-this-key',
                         expected_state + expected_scenario)
        self.assertFalse(logs.is_relative_to(self.logs))

    async def test_replay_logs_obey_include_filter(self):
        self.verifier.include_logs = ['gaia2-inputs.json']
        await self.snapshot()
        logs = self.verifier.trial_paths.verifier_dir
        self.assertTrue((logs / 'gaia2-inputs.json').is_file())
        self.assertFalse((logs / 'gaia2-scenario.json').exists())

    async def test_replay_logs_obey_exclude_filter(self):
        self.verifier.exclude_logs = ['gaia2-*.json']
        await self.snapshot()
        logs = self.verifier.trial_paths.verifier_dir
        self.assertFalse((logs / 'gaia2-inputs.json').exists())
        self.assertFalse((logs / 'gaia2-scenario.json').exists())

    async def test_missing_reply_remains_missing(self):
        self.trajectory.unlink()
        result = await self.snapshot()
        self.assertEqual(
            json.loads(Path(result['files']['/input/state.json']).read_text())
            ['trajectory'], {})

    async def test_source_drift_is_rejected(self):
        self.scenario.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'scenario changed'):
            await self.snapshot()

    async def test_trajectory_symlink_cannot_escape_mount(self):
        outside = self.root / 'private'
        outside.write_text('{}')
        self.trajectory.unlink()
        self.trajectory.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'leaves its workspace'):
            await self.snapshot()

    async def test_recording_is_required_and_transported_only_for_parity(self):
        recording = self.root / 'reward_details.json'
        recording.write_text('{}')
        self.verifier.gaia2_judge_replay = recording
        with self.assertRaisesRegex(ValueError, 'recorded judge calls'):
            await self.snapshot()
        recording.write_text(
            json.dumps({
                'judge_calls': [],
                'judgments': [{
                    'oracle_events': [{
                        'id': 'second'
                    }, {
                        'id': 'first'
                    }]
                }]
            }))
        for file in self.stage.iterdir():
            file.unlink()
        self.assertEqual((await self.snapshot())['judgeReplay'], [])
        logged = self.verifier.trial_paths.verifier_dir / 'gaia2-inputs.json'
        self.assertEqual(
            json.loads(logged.read_text())['oracle_order'],
            ['second', 'first'])

    async def test_staging_limit_is_enforced(self):
        with patch('vfsbench_harbor.mirage_verifier.MAX_STAGING_BYTES', 1):
            with self.assertRaisesRegex(ValueError, 'byte limit'):
                await self.snapshot()

    def test_all_460_tasks_registered_with_reference_sources(self):
        from vfsbench_harbor.environment import HARBOR
        registered = definitions()
        self.assertEqual(len(registered), 460)
        for task, definition in registered.items():
            for name, expected in definition['files'].items():
                self.assertEqual(
                    hashlib.sha256((HARBOR / 'tasks/gaia2' / task / 'tests' /
                                    name).read_bytes()).hexdigest(), expected)
            self.assertEqual(definition['runtime'], 'gaia2-monty')

    async def test_parity_passes_reference_recording_and_preserves_reward(
            self):
        from harbor.models.task.task import Task
        from harbor.models.trial.paths import TrialPaths
        from harbor.models.verifier.result import VerifierResult
        from vfsbench_harbor.environment import HARBOR
        from vfsbench_harbor.parity import MirageParityVerifier
        task_dir = self.root / 'gaia2/search-0002'
        task_dir.mkdir(parents=True)
        shutil.copyfile(HARBOR / 'tasks/gaia2/search-0002/task.toml',
                        task_dir / 'task.toml')
        shutil.copytree(HARBOR / 'tasks/gaia2/search-0002/tests',
                        task_dir / 'tests')
        (task_dir / 'instruction.md').write_text('Routing fixture')
        paths = TrialPaths(self.root / 'trial')
        paths.mkdir()
        recording = paths.verifier_dir / 'reward_details.json'
        recording.write_text('{"judge_calls": [], "judgments": []}')
        verifier = MirageParityVerifier(task=Task(task_dir),
                                        environment=self.verifier.environment,
                                        trial_paths=paths)
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards={'reward': 0})

        async def candidate(native, **kwargs):
            self.assertEqual(native.gaia2_judge_replay, recording)
            self.assertFalse(kwargs['refresh'])
            return {'score': 0, 'checks': {}, 'timings': {}}

        with patch.object(verifier, '_reference',
                          return_value=backend), patch.object(
                              MirageVerifier, 'evaluate', candidate):
            result = await verifier.verify()
        self.assertEqual(result.rewards, {'reward': 0})
        self.assertEqual(recording.read_text(),
                         '{"judge_calls": [], "judgments": []}')
        self.assertEqual(
            json.loads((paths.verifier_dir /
                        'mirage_parity.json').read_text())['status'],
            'matched')


if __name__ == '__main__':
    unittest.main()
