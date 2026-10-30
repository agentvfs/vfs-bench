"""Native snapshot, source pins, artifact provenance and detailed parity."""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from harbor.models.verifier.result import VerifierResult
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor.environment import HARBOR
from vfsbench_harbor.parity import GradeMismatchError, MirageParityVerifier


class AutomationVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.fixture = json.loads(
            (HARBOR / "graders/automationbench/fixtures/"
             "finance-invoice-email-extract.json").read_text())
        task = root / "automationbench" / self.fixture["task"]
        shutil.copytree(
            HARBOR / "tasks/automationbench" / self.fixture["task"], task)
        (task / "tests/task.json").write_text(self.fixture["task_json"])
        self.task = Task(task)
        self.paths = TrialPaths(root / "trial")
        self.paths.mkdir()
        self.env = MirageEnvironment(
            environment_dir=self.task.paths.environment_dir,
            environment_name=self.task.name,
            session_id="test",
            trial_paths=self.paths,
            task_env_config=self.task.config.environment,
            node=os.environ.get("VFSBENCH_TEST_NODE", "node"))
        self.env.refresh_verifier_files = AsyncMock()
        self.env.snapshot_verifier_states = AsyncMock(
            return_value={"automationbench": self.fixture["state"]})
        self.verifier = MirageVerifier(task=self.task,
                                       environment=self.env,
                                       trial_paths=self.paths)

    async def test_real_state_is_frozen_and_replayed_without_database(self):
        result = await self.verifier.verify()
        self.assertEqual(result.rewards, {"reward": 1})
        self.env.snapshot_verifier_states.assert_awaited_once_with({
            "automationbench": {
                "service": "automationbench",
                "tables": ["doc"]
            }
        })
        self.assertEqual(
            json.loads(
                (self.paths.verifier_dir / "reward_details.json").read_text()),
            self.fixture["expected"])
        self.assertEqual(
            json.loads((self.paths.verifier_dir /
                        "automationbench-inputs.json").read_text()),
            self.fixture["state"])

    async def test_task_tampering_fails_before_state_export_and_clears_rewards(
            self):
        (self.task.paths.task_dir / "tests/task.json").write_text("{}")
        self.paths.reward_json_path.write_text('{"reward": 1}')
        with self.assertRaisesRegex(ValueError, "reference.*changed"):
            await self.verifier.verify()
        self.env.snapshot_verifier_states.assert_not_called()
        self.assertFalse(self.paths.reward_json_path.exists())

    async def test_parity_detects_assertion_mismatch_even_when_reward_matches(
            self):
        parity = MirageParityVerifier(task=self.task,
                                      environment=self.env,
                                      trial_paths=self.paths)
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards={"reward": 1})
        expected = self.fixture["expected"]
        reference = self.paths.verifier_dir / "reward_details.json"
        reference.write_text(json.dumps(expected))
        native = json.loads(json.dumps(expected))
        native["assertions"][0]["excluded"] = True
        result = {
            "rewards": {
                "reward": 1
            },
            "checks": native,
            "timings": {},
            "artifacts": {
                "reward_details.json": native
            }
        }
        with patch.object(parity, "_reference",
                          return_value=backend), patch.object(
                              MirageVerifier, "evaluate",
                              AsyncMock(return_value=result)):
            with self.assertRaises(GradeMismatchError):
                await parity.verify()
        self.assertEqual(json.loads(reference.read_text()), expected)
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertIn("reward_details", report["differences"])


if __name__ == "__main__":
    unittest.main()
