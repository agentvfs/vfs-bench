"""ComplexMCP snapshots, reference pins and native dispatch."""
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch

import httpx
from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor.environment import ROOT
from vfsbench_harbor.mirage_verifier import dataset_module


class ComplexMCPVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = Task(ROOT / 'datasets/complexmcp/mark-sean-baker-read/harbor')
        self.paths = TrialPaths(self.root / 'trial')
        self.paths.mkdir()
        self.env = MirageEnvironment(
            environment_dir=self.task.paths.environment_dir,
            environment_name=self.task.name,
            session_id='test',
            trial_paths=self.paths,
            task_env_config=self.task.config.environment,
            node=os.environ.get('VFSBENCH_TEST_NODE', 'node'))
        self.env._routes = {'9000': 'http://fake/run/test'}
        self.env.refresh_verifier_files = AsyncMock()
        self.verifier = MirageVerifier(task=self.task,
                                       environment=self.env,
                                       trial_paths=self.paths)
        self.row = {'gt_env': {'LightSystem': {'value': 2}}}
        self.inputs = self.root / 'verifier-inputs'
        self.inputs.mkdir()
        (self.inputs / 'row.json').write_text(json.dumps(self.row))
        self.definition = {
            'runtime':
            'complexmcp-monty',
            'row':
            0,
            'apps': ['LightSystem'],
            'row_sha256':
            hashlib.sha256(
                json.dumps(self.row, sort_keys=True,
                           ensure_ascii=True).encode()).hexdigest()
        }
        self.requests = []

        def reply(request):
            self.requests.append(str(request.url))
            return httpx.Response(
                200,
                json={'value': 1 if request.url.path.endswith('login') else 2})

        self.client = httpx.AsyncClient(transport=httpx.MockTransport(reply))

    async def test_freezes_only_trial_json_and_runs_in_monty(self):
        with (
                patch.object(self.verifier,
                             '_definition',
                             return_value=(self.task.paths.task_dir.parent.name,
                                           self.definition)),
                patch.object(MirageVerifier, 'inputs_dir', new_callable=PropertyMock,
                             return_value=self.inputs),
                patch.object(dataset_module('complexmcp').httpx, 'AsyncClient',
                      return_value=self.client),
        ):
            result = await self.verifier.verify()
        self.assertEqual(result.rewards, {
            'reward': 1,
            'total': 1,
            'recall': 1,
            'misbehave': 0
        })
        self.assertEqual(
            self.requests,
            ['http://fake/run/test/login', 'http://fake/run/test/logout'])
        self.assertIn('total 1',
                      (self.paths.verifier_dir / 'judge.log').read_text())
        self.assertTrue(
            (self.paths.verifier_dir / 'complexmcp-inputs.json').is_file())

    async def test_gold_drift_fails_before_service_reads_and_clears_rewards(
            self):
        self.paths.reward_text_path.write_text('1')
        self.definition['row_sha256'] = 'invalid'
        with (
                patch.object(self.verifier,
                             '_definition',
                             return_value=(self.task.paths.task_dir.parent.name,
                                           self.definition)),
                patch.object(MirageVerifier, 'inputs_dir', new_callable=PropertyMock,
                             return_value=self.inputs),
        ):
            with self.assertRaisesRegex(ValueError, 'row changed'):
                await self.verifier.verify()
        self.assertFalse(self.paths.reward_text_path.exists())
        self.assertEqual(self.requests, [])
        await self.client.aclose()




if __name__ == '__main__':
    unittest.main()
