"""DataSpace source pins, file metadata, output provenance and routing."""
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from harbor.models.verifier.result import VerifierResult
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor.environment import HARBOR
from vfsbench_harbor.parity import MirageParityVerifier


class DataSpaceVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = Task(HARBOR / 'tasks/dataspace/fund-ytd-returns')
        self.paths = TrialPaths(self.root / 'trial')
        self.paths.mkdir()
        self.env = MirageEnvironment(
            environment_dir=self.task.paths.environment_dir,
            environment_name=self.task.name,
            session_id='test',
            trial_paths=self.paths,
            task_env_config=self.task.config.environment,
            node=os.environ.get('VFSBENCH_TEST_NODE', 'node'))
        self.output = self.root / 'agent/output'
        self.output.mkdir(parents=True)
        self.prediction = self.output / 'prediction.csv'
        self.env._mounts = {
            '/output': {
                'root': str(self.output),
                'mode': 'write'
            }
        }
        self.env.refresh_verifier_files = AsyncMock()
        self.verifier = MirageVerifier(task=self.task,
                                       environment=self.env,
                                       trial_paths=self.paths)
        state = self.root / 'state/dataspace'
        self.source = state / 'evaluation/evaluate.py'
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(
            (HARBOR / 'graders/dataspace/reference/evaluate.py').read_bytes())
        self.config = state / 'benchmark/evaluation/configs/task_33.json'
        self.config.parent.mkdir(parents=True)
        self.config.write_text(
            json.dumps({
                'schema_version':
                '1.0',
                'task_id':
                'task_33',
                'order_sensitive':
                False,
                'columns': [{
                    'gold_index': 0,
                    'gold_name': 'v',
                    'type': 'text'
                }]
            }))
        self.gold = state / 'benchmark/output/task_33/gold.csv'
        self.gold.parent.mkdir(parents=True)
        self.gold.write_text('v\na\n')
        self.definition = {
            'runtime': 'dataspace-monty',
            'task_id': 'task_33',
            'gold_sha256': hashlib.sha256(self.gold.read_bytes()).hexdigest(),
            'config_sha256':
            hashlib.sha256(self.config.read_bytes()).hexdigest()
        }
        self.enterContext(
            patch('vfsbench_harbor.dataspace_verifier.ROOT', self.root))
        self.enterContext(
            patch.object(self.verifier,
                         '_definition',
                         return_value=(self.task.name, self.definition)))

    async def test_frozen_prediction_and_gold_are_independent_of_agent_reward(
            self):
        self.prediction.write_text('v\na\n')
        (self.output / 'reward.txt').write_text('0')
        result = await self.verifier.verify()
        self.assertEqual(result.rewards, {'reward': 1})
        self.assertEqual((self.output / 'reward.txt').read_text(), '0')
        self.assertFalse(self.paths.reward_json_path.exists())
        self.assertTrue(
            json.loads((self.paths.verifier_dir /
                        'evaluation.json').read_text())['passed'])
        self.prediction.write_text('v\nb\n')
        self.assertEqual((await self.verifier.verify()).rewards, {'reward': 0})

    async def test_missing_directory_symlink_and_oversize_errors(self):
        cases = [('missing', 'missing_prediction'),
                 ('directory', 'invalid_prediction_csv'),
                 ('symlink', 'invalid_prediction_csv'),
                 ('oversize', 'invalid_prediction_csv')]
        for kind, code in cases:
            with self.subTest(kind=kind):
                if kind == 'directory':
                    self.prediction.mkdir()
                elif kind == 'symlink':
                    target = self.output / 'target.csv'
                    target.write_text('v\na\n')
                    self.prediction.symlink_to(target)
                elif kind == 'oversize':
                    with self.prediction.open('wb') as f:
                        f.truncate(20 * 1024 * 1024 + 1)
                self.assertEqual((await self.verifier.verify()).rewards,
                                 {'reward': 0})
                result = json.loads(
                    (self.paths.verifier_dir / 'evaluation.json').read_text())
                self.assertEqual(result['error_code'], code)
                if kind == 'directory':
                    self.prediction.rmdir()
                else:
                    self.prediction.unlink(missing_ok=True)

    async def test_reference_config_and_gold_drift_clear_stale_rewards(self):
        for source in (self.source, self.config, self.gold):
            with self.subTest(source=source.name):
                original = source.read_bytes()
                source.write_bytes(original + b'\n')
                self.paths.reward_text_path.write_text('1')
                with self.assertRaisesRegex(ValueError, 'reference'):
                    await self.verifier.verify()
                self.assertFalse(self.paths.reward_text_path.exists())
                source.write_bytes(original)

    async def test_symlink_cannot_read_outside_agent_mount(self):
        outside = self.root / 'private.csv'
        outside.write_text('v\na\n')
        self.prediction.symlink_to(outside)
        self.verifier._run = AsyncMock()
        with self.assertRaisesRegex(ValueError, 'leaves its workspace'):
            await self.verifier.verify()
        self.verifier._run.assert_not_called()

    async def test_parity_preserves_microvm_reference(self):
        verifier = MirageParityVerifier(task=self.task,
                                        environment=self.env,
                                        trial_paths=self.paths)
        reference = AsyncMock()
        reference.verify.return_value = VerifierResult(rewards={'reward': 1})
        native = {'score': 1, 'checks': {}, 'timings': {}}
        with (patch.object(verifier, '_reference', return_value=reference) as
              selected,
              patch.object(MirageVerifier, 'evaluate',
                           AsyncMock(return_value=native))):
            self.assertEqual((await verifier.verify()).rewards, {'reward': 1})
        selected.assert_called_once_with('microsandbox')
        report = json.loads(
            (self.paths.verifier_dir / 'mirage_parity.json').read_text())
        self.assertEqual(report['status'], 'matched')


if __name__ == '__main__':
    unittest.main()
