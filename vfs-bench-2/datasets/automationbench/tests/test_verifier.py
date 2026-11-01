"""Native snapshot, source pins, artifact provenance and detailed parity."""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor.environment import ROOT


class AutomationVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.fixture = json.loads(
            (ROOT / "datasets/automationbench/graders/fixtures/"
             "finance-invoice-email-extract.json").read_text())
        task = root / "automationbench" / self.fixture["task"]
        shutil.copytree(ROOT / "datasets/automationbench" /
                        self.fixture["task"],
                        task,
                        ignore=shutil.ignore_patterns("fixtures", "task.json"))
        (task / "workspace/verifier").mkdir(exist_ok=True)
        (task / "workspace/verifier/task.json").write_text(
            self.fixture["task_json"])
        self.task = Task(task / "harbor")
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
        (self.task.paths.task_dir.parent /
         "workspace/verifier/task.json").write_text("{}")
        self.paths.reward_json_path.write_text('{"reward": 1}')
        with self.assertRaisesRegex(ValueError, "task.json changed"):
            await self.verifier.verify()
        self.env.snapshot_verifier_states.assert_not_called()
        self.assertFalse(self.paths.reward_json_path.exists())


if __name__ == "__main__":
    unittest.main()
