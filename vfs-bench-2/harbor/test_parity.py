"""Reference preservation and rollout gates across all six Harbor datasets."""
import importlib.util
import json
import shutil
import unittest
from unittest.mock import AsyncMock, patch

from harbor.models.task.task import Task
from harbor.models.verifier.result import VerifierResult
from vfsbench_harbor.environment import HARBOR
from vfsbench_harbor.mirage_verifier import MirageVerifier
from vfsbench_harbor.parity import (REFERENCE_BACKENDS, GradeMismatchError,
                                    MirageParityVerifier, differences)

# Reuse the adapter's real, temporary SQLite environment without a daemon.
spec = importlib.util.spec_from_file_location(
    "mirage_verifier_tests", HARBOR / "test_mirage_verifier.py")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


class ParityTests(helpers.MirageVerifierTests):
    # This class intentionally reruns the inherited adapter checks as well.
    async def test_matching_native_keeps_reference_rewards_and_logs(self):
        verifier = MirageParityVerifier(task=self.task,
                                        environment=self.env,
                                        trial_paths=self.paths)

        async def reference():
            await self.env.refresh_state()
            self.paths.reward_text_path.write_text("0.0\n")
            self.paths.test_stdout_path.write_text("original Python output\n")
            return VerifierResult(rewards={"reward": 0.0})

        backend = AsyncMock()
        backend.verify.side_effect = reference
        with patch.object(verifier, "_reference",
                          return_value=backend) as select:
            result = await verifier.verify()
        select.assert_called_once_with("workspace")
        self.assertEqual(result.rewards, {"reward": 0})
        self.assertEqual(self.paths.test_stdout_path.read_text(),
                         "original Python output\n")
        self.assertEqual(self.paths.reward_text_path.read_text(), "0.0\n")
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertEqual(report["status"], "matched")
        self.assertEqual(report["differences"], {})

    async def test_mismatch_fails_without_overwriting_reference(self):
        verifier = MirageParityVerifier(task=self.task,
                                        environment=self.env,
                                        trial_paths=self.paths)
        await self.env.refresh_state()
        self.paths.reward_text_path.write_text("1.0\n")
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards={"reward": 1.0})
        with patch.object(verifier, "_reference", return_value=backend):
            with self.assertRaisesRegex(GradeMismatchError, "mismatch"):
                await verifier.verify()
        self.assertEqual(self.paths.reward_text_path.read_text(), "1.0\n")
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertEqual(report["differences"],
                         {"reward": {
                             "reference": 1,
                             "native": 0
                         }})

    async def test_every_unported_dataset_preserves_its_backend(self):
        for dataset, kind in REFERENCE_BACKENDS.items():
            if dataset == "complexmcp":
                continue  # Its registered Monty port is covered separately.
            with self.subTest(dataset=dataset):
                task_dir = next((HARBOR / "tasks" / dataset).iterdir())
                if dataset == "liveclawbench":
                    task_dir = (HARBOR / "tasks/liveclawbench" /
                                "pre-meeting-research-brief")
                # Some upstream instruction.md files are generated and
                # gitignored. Backend selection doesn't read their content.
                fixture = self.root / "fixtures" / dataset / task_dir.name
                shutil.copytree(task_dir, fixture)
                if not (fixture / "instruction.md").exists():
                    (fixture / "instruction.md"
                     ).write_text("Backend selection fixture.\n")
                task = Task(fixture)
                verifier = MirageParityVerifier(task=task,
                                                environment=self.env,
                                                trial_paths=self.paths)
                self.assertEqual(verifier._backend(dataset), kind)
                backend = AsyncMock()
                backend.verify.return_value = VerifierResult(rewards={
                    "reward": 0.25,
                    "detail": 0.5
                })
                with patch.object(verifier, "_reference",
                                  return_value=backend), patch.object(
                                      MirageVerifier, "evaluate",
                                      AsyncMock()) as native:
                    result = await verifier.verify()
                    native.assert_not_called()
                self.assertEqual(result.rewards, {
                    "reward": 0.25,
                    "detail": 0.5
                })
                report = json.loads((self.paths.verifier_dir /
                                     "mirage_parity.json").read_text())
                self.assertEqual(report["status"], "unported")

    async def test_native_error_and_reference_error_are_distinct(self):
        verifier = MirageParityVerifier(task=self.task,
                                        environment=self.env,
                                        trial_paths=self.paths)
        await self.env.refresh_state()
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards={"reward": 0})
        with patch.object(
                verifier, "_reference", return_value=backend), patch.object(
                    MirageVerifier, "evaluate",
                    AsyncMock(side_effect=RuntimeError("native broke"))):
            with self.assertRaisesRegex(GradeMismatchError, "native_error"):
                await verifier.verify()
        backend.verify.side_effect = RuntimeError("reference broke")
        with patch.object(verifier, "_reference",
                          return_value=backend), patch.object(
                              MirageVerifier, "evaluate",
                              AsyncMock()) as native:
            with self.assertRaisesRegex(RuntimeError, "reference broke"):
                await verifier.verify()
            native.assert_not_called()
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertEqual(report["status"], "reference_error")

    async def test_rollout_options_preserve_reference_and_reject_unported(
            self):
        verifier = MirageParityVerifier(task=self.task,
                                        environment=self.env,
                                        trial_paths=self.paths,
                                        fail_on_mismatch=False)
        await self.env.refresh_state()
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards={"reward": 1})
        with patch.object(verifier, "_reference", return_value=backend):
            result = await verifier.verify()
        self.assertEqual(result.rewards, {"reward": 1})
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertEqual(report["status"], "mismatch")

        task = Task(HARBOR / "tasks/liveclawbench/pre-meeting-research-brief")
        verifier = MirageParityVerifier(task=task,
                                        environment=self.env,
                                        trial_paths=self.paths,
                                        require_native=True)
        with patch.object(verifier, "_reference", return_value=backend):
            with self.assertRaisesRegex(GradeMismatchError,
                                        "No native grader"):
                await verifier.verify()

    async def test_nonfinite_scores_leave_a_readable_error_report(self):
        verifier = MirageParityVerifier(task=self.task,
                                        environment=self.env,
                                        trial_paths=self.paths)
        await self.env.refresh_state()
        backend = AsyncMock()
        backend.verify.return_value = VerifierResult(rewards={"reward": 0})
        with patch.object(verifier, "_reference",
                          return_value=backend), patch.object(
                              MirageVerifier, "evaluate",
                              AsyncMock(return_value={"score": float("nan")})):
            with self.assertRaisesRegex(GradeMismatchError, "native_error"):
                await verifier.verify()
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertIn("finite numbers", report["error"])

        backend.verify.return_value = VerifierResult(
            rewards={"reward": float("inf")})
        with patch.object(verifier, "_reference", return_value=backend):
            with self.assertRaisesRegex(ValueError, "finite numbers"):
                await verifier.verify()
        report = json.loads(
            (self.paths.verifier_dir / "mirage_parity.json").read_text())
        self.assertEqual(report["status"], "reference_error")

    def test_all_dimensions_are_compared(self):
        self.assertEqual(differences({"reward": 1.0}, {"reward": 1}), {})
        self.assertIn(
            "partial", differences({
                "reward": 1,
                "partial": 0.5
            }, {"reward": 1}))
        self.assertIn("reward",
                      differences({"reward": 0.5}, {"reward": 0.50001}))
        self.assertIn("reward",
                      differences({"reward": 0}, {"reward": float("nan")}))

    def test_job_config_inventory_is_1349_not_24(self):
        spec = importlib.util.spec_from_file_location(
            "inventory", HARBOR / "grader_inventory.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.inventory()
        self.assertEqual(result["total"], 1349)
        self.assertEqual({
            k: v["tasks"]
            for k, v in result["datasets"].items()
        }, {
            "liveclawbench": 70,
            "dataspace": 46,
            "claweval": 126,
            "complexmcp": 47,
            "automationbench": 600,
            "gaia2": 460,
        })
        self.assertEqual(result["native_candidates"], 117)


if __name__ == "__main__":
    unittest.main()
