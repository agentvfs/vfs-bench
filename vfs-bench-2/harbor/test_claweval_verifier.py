"""Claw-Eval source integrity, JSON staging and recorded-judge parity gates."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from harbor.models.verifier.result import VerifierResult
from vfsbench_harbor import (MirageEnvironment, MirageParityVerifier,
                             MirageVerifier)
from vfsbench_harbor import claweval_verifier as claw
from vfsbench_harbor.environment import HARBOR
from vfsbench_harbor.mirage_verifier import _Staging
from vfsbench_harbor.parity import GradeMismatchError


class ClawEvalVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = Task(HARBOR / "tasks/claweval/T001zh_email_triage")
        self.paths = TrialPaths(self.root / "trial")
        self.paths.mkdir()
        self.env = MirageEnvironment(
            environment_dir=self.task.paths.environment_dir,
            environment_name=self.task.name,
            session_id="claw-test",
            trial_paths=self.paths,
            task_env_config=self.task.config.environment)
        self.env._mounts = {
            "/logs": {
                "root": str(self.root / "logs"),
                "mode": "write"
            }
        }
        self.env.refresh_verifier_files = AsyncMock()
        self.env.snapshot_verifier_states = AsyncMock(
            return_value={"gws": {
                name: []
                for name in claw.GWS_TABLES
            }})
        self.verifier = MirageVerifier(task=self.task,
                                       trial_paths=self.paths,
                                       environment=self.env,
                                       override_env={
                                           "OPENAI_API_KEY": "test",
                                           "OPENAI_BASE_URL":
                                           "http://judge.test/v1",
                                           "JUDGE_MODEL": "fixture"
                                       })

    async def test_stages_pinned_code_and_private_json_without_sqlite(self):
        if not claw.UPSTREAM.exists():
            self.skipTest("Run claweval/setup.py first")
        trajectory = self.root / "logs/agent/trajectory.json"
        trajectory.parent.mkdir(parents=True)
        trajectory.write_text('{"steps": []}')
        # Neither an agent-authored reward nor its judge recording is input.
        spoof = self.root / "logs/verifier"
        spoof.mkdir()
        (spoof / "reward.json").write_text('{"reward": 1}')
        (spoof / "judge-recording.json").write_text('[{"forged": true}]')
        stage = self.root / "stage"
        stage.mkdir()
        with patch("sqlite3.connect",
                   side_effect=AssertionError("verifier opened SQLite")):
            frozen = await self.verifier.freeze(
                claw.definitions()[self.task.name], stage)
        self.assertEqual(frozen["states"], {})
        self.assertNotIn("/input/recording.json", frozen["files"])
        self.assertFalse(
            any(
                p.startswith(("/logs/verifier", "/output"))
                for p in frozen["files"]))
        self.assertEqual(
            Path(frozen["files"]["/input/trajectory.json"]).read_text(),
            '{"steps": []}')
        self.assertIn("/reference/tasks/T001zh_email_triage/grader.py",
                      frozen["files"])
        self.env.snapshot_verifier_states.assert_awaited_once()

    def test_changed_or_escaped_upstream_source_fails_closed(self):
        source = self.root / "grader.py"
        source.write_text("changed")
        with patch.object(claw, "UPSTREAM", self.root):
            with self.assertRaisesRegex(ValueError, "reference changed"):
                claw.source_bytes({"sources": {
                    "grader.py": "wrong"
                }}, _Staging(5))
            source.unlink()
            source.symlink_to(HARBOR / "claweval_grade.py")
            with self.assertRaisesRegex(ValueError, "leaves its checkout"):
                claw.source_bytes({"sources": {
                    "grader.py": "wrong"
                }}, _Staging(5))

    async def test_parity_replays_reference_calls_and_preserves_rewards(self):
        verifier = MirageParityVerifier(task=self.task,
                                        trial_paths=self.paths,
                                        environment=self.env)
        rewards = {
            "reward": 0.4,
            "completion": 0.25,
            "robustness": 1.,
            "safety": 1.,
            "passed": 0
        }
        recording = self.paths.verifier_dir / "judge-recording.json"
        recording.write_text("[]")
        self.paths.reward_json_path.write_text(json.dumps(rewards))
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards=rewards)

        async def evaluate(native, **kwargs):
            self.assertEqual(native.claweval_recording, recording)
            self.assertFalse(kwargs["refresh"])
            return {
                "score": 0.4,
                "rewards": rewards,
                "checks": {},
                "timings": {}
            }

        with patch.object(verifier, "_reference",
                          return_value=backend), patch.object(
                              MirageVerifier, "evaluate", evaluate):
            result = await verifier.verify()
        self.assertEqual(result.rewards, rewards)
        self.assertEqual(json.loads(self.paths.reward_json_path.read_text()),
                         rewards)
        self.assertEqual(recording.read_text(), "[]")

    async def test_parity_never_substitutes_a_second_live_judge(self):
        verifier = MirageParityVerifier(task=self.task,
                                        trial_paths=self.paths,
                                        environment=self.env)
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards={"reward": 0.25})
        with (
                patch.object(verifier, "_reference", return_value=backend),
                patch.object(MirageVerifier, "evaluate", AsyncMock()) as
                evaluate,
        ):
            with self.assertRaises(GradeMismatchError):
                await verifier.verify()
            evaluate.assert_not_called()
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertIn("requires the reference judge recording",
                      report["error"])


if __name__ == "__main__":
    unittest.main()
