import os
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path

from vfsbench import ComplexMCP, TrialConfig, load_dataset
from vfsbench.suites.complexmcp import prepare

PORT = Path(__file__).resolve().parents[1] / "vfs-bench-2/datasets/complexmcp"


class ComplexMCPTests(unittest.IsolatedAsyncioTestCase):

    async def test_isolated_service_state_and_yaml(self):
        # This case only invokes service CLIs. Exercise them on real Mirage
        # without requiring a guest VM in the default test suite.
        @asynccontextmanager
        async def environment(task, config, run):
            async with prepare(task, config, run) as prepared:
                prepared.python = False
                yield prepared

        task = load_dataset("complexmcp")["good-morning-paisley"]
        self.assertEqual(len(ComplexMCP()), 47)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workspace.yaml"
             ).write_text("mounts:\n  /scratch: {vfs: ram, mode: write}\n")
            settings = root / "trial.toml"
            settings.write_text('[trial]\nworkspace_yaml = "workspace.yaml"\n')
            config = TrialConfig.from_toml(settings)
            async with (task.open(config=config, environment=environment) as
                        first, task.open(config=config,
                                         environment=environment) as second):
                self.assertEqual(await first.service_state("complexmcp"), await
                                 second.service_state("complexmcp"))
                await first.workspace.vfs.write("/scratch/test", b"one trial")
                self.assertFalse(await
                                 second.workspace.vfs.is_file("/scratch/test"))
                self.assertFalse(
                    await
                    first.workspace.vfs.is_file("/verifier/expected.json"))
                self.assertEqual((await second.verify()).reward, 0)
                source = PORT / task.id / "harbor/solution/solve.sh"
                result = await first.exec(source.read_text())
                self.assertEqual(result.return_code, 0, result.stderr)
                grade = await first.verify()
                self.assertEqual(grade.reward, 1)
                self.assertEqual(grade.details, {
                    "total": 3,
                    "recall": 3,
                    "misbehave": 0
                })
                self.assertNotEqual(await first.service_state("complexmcp"),
                                    await second.service_state("complexmcp"))

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_SNAPSHOT"),
                         "requires microsandbox")
    async def test_reference_trajectories(self):
        suite = ComplexMCP()
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        for task in suite:
            with self.subTest(task=task.id):
                async with task.open(config=config) as trial:
                    self.assertEqual((await trial.verify()).reward, 0)
                async with task.open(config=config) as trial:
                    script = (PORT / task.id /
                              "harbor/solution/solve.sh").read_text()
                    result = await trial.exec(script)
                    self.assertEqual(result.return_code, 0, result.stderr)
                    self.assertEqual((await trial.verify()).reward, 1)
