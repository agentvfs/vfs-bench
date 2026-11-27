import asyncio
import os
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

from vfsbench.dataset import MCPAtlas
from vfsbench.runtime import TrialConfig, TrialEnvironment, VerifierGuest
from vfsbench.verifier import AgentResult, SuiteVerifier, VerificationResult


class LifecycleTests(unittest.IsolatedAsyncioTestCase):

    def test_config_paths_and_sections(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trial.toml"
            path.write_text(
                '[trial]\nsnapshot="vfsbench:python"\nwork_dir="runs"\n'
                '[suite_options]\nvalue="native"\n')
            config = TrialConfig.from_toml(path)
            self.assertEqual(config.work_dir, path.resolve().parent / "runs")
            self.assertEqual(config.suite_options["value"], "native")
            path.write_text('[typo]\nsnapshot="bad"\n')
            with self.assertRaisesRegex(ValueError,
                                        "Unknown trial configuration"):
                TrialConfig.from_toml(path)

    async def test_close_waits_for_verifier_reading_mock_state(self):
        reading, release, stopped = asyncio.Event(), asyncio.Event(
        ), asyncio.Event()

        async def snapshot():
            reading.set()
            await release.wait()
            self.assertFalse(stopped.is_set())
            return {"count": 3}

        async def evaluate(view):
            self.assertIsNone(view.result)
            state = await view.service_state("orders")
            return {"reward": float(state["count"] == 3)}

        @asynccontextmanager
        async def environment(task, config, run_dir):
            try:
                yield TrialEnvironment({},
                                       SuiteVerifier(evaluate),
                                       python=False,
                                       state_readers={"orders": snapshot})
            finally:
                stopped.set()

        async with MCPAtlas()[0].open(environment=environment) as trial:
            verification = asyncio.create_task(trial.verify())
            await asyncio.wait_for(reading.wait(), 5)
            closing = asyncio.create_task(trial.close())
            await asyncio.sleep(0)
            self.assertFalse(closing.done())
            release.set()
            self.assertEqual((await verification).reward, 1)
            await closing
        self.assertTrue(stopped.is_set())
        self.assertIsNotNone(trial.report.closed_at)

    async def test_failed_restore_unwinds_resources(self):
        closed = []

        @asynccontextmanager
        async def prepare(task, config, run):
            try:
                yield TrialEnvironment(workspace={}, verifier=AsyncMock())
            finally:
                closed.append(run)

        with tempfile.TemporaryDirectory() as directory:
            trial = MCPAtlas()[0].open(config=TrialConfig(
                snapshot="missing", work_dir=Path(directory)))
            with (patch("vfsbench.runtime._prepare", return_value=prepare),
                  patch("vfsbench.runtime._restore_guest",
                        side_effect=RuntimeError("missing snapshot")),
                  patch("vfsbench.runtime._remove_guest") as remove):
                with self.assertRaisesRegex(RuntimeError, "missing snapshot"):
                    await trial.start()
                remove.assert_awaited_once()
            self.assertEqual(len(closed), 1)
            self.assertFalse(closed[0].exists())
            await trial.close()
            await trial.close()

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_SNAPSHOT"),
                         "requires a local microsandbox snapshot")
    async def test_real_mirage_guest_and_separate_verifier(self):
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])

        async def evaluate(trial):
            async with VerifierGuest(config) as verifier:
                check = await verifier.run(
                    {"answer.txt": trial.result.final_answer.encode()}, [
                        "python3",
                        "-c",
                        "from pathlib import Path; "
                        "print(Path('answer.txt').read_text()); "
                        "assert not Path('/workspace/result.txt').exists()",
                    ])
            self.assertEqual(check.return_code, 0, check.stderr)
            return {"reward": float(check.stdout.strip() == "verified")}

        @asynccontextmanager
        async def prepare(task, config, run):
            yield TrialEnvironment(workspace={},
                                   instructions="Use the workspace",
                                   verifier=SuiteVerifier(evaluate))

        with patch("vfsbench.runtime._prepare", return_value=prepare):
            async with MCPAtlas()[0].open(config=config) as trial:
                run = trial.run_dir
                result = await trial.exec(
                    "python3 -c 'import pathlib, sys; "
                    "pathlib.Path(\"/workspace/result.txt\").write_"
                    "text(sys.platform)'")
                self.assertEqual(result.return_code, 0, result.stderr)
                for path in ("/grading", "/tests", "/solution",
                             "/workspace/solve.py"):
                    self.assertFalse(await trial.workspace.vfs.exists(path),
                                     path)
                result = await trial.exec("cat /workspace/result.txt")
                self.assertEqual(result.stdout.strip(), "linux")
                trial.record_result(AgentResult(final_answer="verified"))
                self.assertEqual((await trial.verify()).reward, 1.0)
                self.assertFalse(
                    await trial.workspace.vfs.exists("/grading/answer.txt"))
                self.assertEqual(trial.instructions, "Use the workspace")
            self.assertFalse(run.exists())
            self.assertEqual(trial.report.verification.reward, 1.0)
            await trial.close()

    async def test_custom_verifier_sees_live_run_trace_and_result(self):
        state = {"rows": ["fixture"]}
        retained = []
        active = []

        async def read_state():
            self.assertTrue(active)
            return state

        class SheetVerifier:

            async def verify(self, trial):
                retained.append(trial)
                snapshot = await trial.service_state("gws")
                snapshot["rows"].clear()
                rows = (await trial.service_state("gws"))["rows"]
                file = await trial.read_file("/workspace/output")
                assert trial.trace.commands[
                    -1].command == "echo done > /workspace/output"
                assert trial.trace.agent == {"steps": [1, 2]}
                assert any(
                    event.get("type") == "command"
                    for event in trial.trace.workspace_events)
                assert trial.result.metadata == {"steps": 2}
                assert trial.result.output == {"written": 1}
                assert trial.result.final_answer is None
                return VerificationResult(
                    float(rows == ["fixture"] and file == b"done\n"),
                    {"rows": len(rows)})

        @asynccontextmanager
        async def prepare(task, config, run):
            active.append(True)
            try:
                yield TrialEnvironment(workspace={},
                                       verifier=None,
                                       python=False,
                                       state_readers={"gws": read_state})
            finally:
                active.clear()

        async with MCPAtlas()[0].open(environment=prepare,
                                      verifier=SheetVerifier()) as trial:
            await trial.exec("echo done > /workspace/output")
            trial.record_agent_trace({"steps": [1, 2]})
            trial.record_result(
                AgentResult(output={"written": 1}, metadata={"steps": 2}))
            self.assertEqual((await trial.verify()).reward, 1.0)
            self.assertEqual(await trial.service_state("gws"),
                             {"rows": ["fixture"]})
            with self.assertRaisesRegex(RuntimeError, "verification"):
                await trial.exec("echo late")
            self.assertTrue(active)
        self.assertFalse(active)
        self.assertEqual(trial.report.to_dict()["verification"]["details"],
                         {"rows": 1})
        self.assertEqual(trial.report.to_dict()["result"]["output"],
                         {"written": 1})
        with self.assertRaisesRegex(RuntimeError, "no longer available"):
            await retained[0].service_state("gws")


class SnapshotTests(unittest.IsolatedAsyncioTestCase):

    async def test_only_default_snapshot_is_automatically_provisioned(self):
        from vfsbench.runtime import _restore_guest

        with patch("vfsbench.runtime.build") as build, patch(
                "vfsbench.runtime._msb") as restore:
            await _restore_guest(TrialConfig(), "first")
            await _restore_guest(TrialConfig(snapshot="custom:disk"), "second")
            cache_only = MCPAtlas(local_files_only=True)[0].open()
            await _restore_guest(cache_only.config, "third")
            build.assert_called_once()
            self.assertEqual(restore.await_count, 3)

    async def test_concurrent_first_use_builds_one_disk(self):
        import threading

        from vfsbench.snapshot import SNAPSHOT, build

        ready = threading.Event()
        with (tempfile.TemporaryDirectory() as
              cache, patch.dict(os.environ, XDG_CACHE_HOME=cache),
              patch("vfsbench.snapshot._installed", side_effect=ready.is_set),
              patch("vfsbench.snapshot._build_guest",
                    side_effect=ready.set) as create):
            disks = await asyncio.gather(*(asyncio.to_thread(build)
                                           for _ in range(4)))
            self.assertEqual(disks, [SNAPSHOT] * 4)
            create.assert_called_once()
