"""ComplexMCP snapshots, reference pins and native dispatch."""
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from harbor.models.verifier.result import VerifierResult
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor.environment import HARBOR
from vfsbench_harbor.parity import MirageParityVerifier


class ComplexMCPVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = Task(HARBOR / 'tasks/complexmcp/mark-sean-baker-read')
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
        rows = self.root / 'state/complexmcp/tasks.json'
        rows.parent.mkdir(parents=True)
        rows.write_text(json.dumps([self.row]))
        for name, relative in (("judge.py", "benchmark/judge.py"),
                               ("dist.py", "software/utils/dist.py")):
            target = self.root / "state/complexmcp/src" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(
                (HARBOR / "graders/complexmcp/reference" / name).read_bytes())
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
                             return_value=(self.task.name, self.definition)),
                patch('vfsbench_harbor.complexmcp_verifier.ROOT', self.root),
                patch('vfsbench_harbor.complexmcp_verifier.httpx.AsyncClient',
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
                             return_value=(self.task.name, self.definition)),
                patch('vfsbench_harbor.complexmcp_verifier.ROOT', self.root),
        ):
            with self.assertRaisesRegex(ValueError, 'row changed'):
                await self.verifier.verify()
        self.assertFalse(self.paths.reward_text_path.exists())
        self.assertEqual(self.requests, [])
        await self.client.aclose()

    async def test_changed_upstream_judge_is_rejected(self):
        source = self.root / "state/complexmcp/src/benchmark/judge.py"
        source.write_text(source.read_text() + "\n# drift\n")
        with (
                patch.object(self.verifier,
                             '_definition',
                             return_value=(self.task.name, self.definition)),
                patch('vfsbench_harbor.complexmcp_verifier.ROOT', self.root),
        ):
            with self.assertRaisesRegex(ValueError, 'reference judge.py'):
                await self.verifier.verify()
        self.assertEqual(self.requests, [])
        await self.client.aclose()

    async def test_parity_uses_reference_and_compares_counts(self):
        rewards = {'reward': 1, 'total': 2, 'recall': 2, 'misbehave': 0}
        verifier = MirageParityVerifier(task=self.task,
                                        environment=self.env,
                                        trial_paths=self.paths)
        reference = AsyncMock()
        reference.verify.return_value = VerifierResult(rewards=rewards)
        native = {
            'score': 1,
            'rewards': rewards,
            'checks': rewards,
            'timings': {}
        }
        with (
                patch.object(verifier, '_reference', return_value=reference) as
                selected,
                patch.object(MirageVerifier, 'evaluate',
                             AsyncMock(return_value=native)) as evaluate,
        ):
            result = await verifier.verify()
        selected.assert_called_once_with('microsandbox')
        evaluate.assert_awaited_once_with(refresh=False)
        self.assertEqual(result.rewards, rewards)
        self.assertEqual(
            json.loads((self.paths.verifier_dir /
                        'mirage_parity.json').read_text())['status'],
            'matched')
        await self.client.aclose()


if __name__ == '__main__':
    unittest.main()
