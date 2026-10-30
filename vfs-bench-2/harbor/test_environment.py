"""MirageEnvironment's refresh of the services' state copies.

    uv run --project harbor python -I harbor/test_environment.py

A refresh whose caller is canceled while it copies (a host agent's
refresh loop as its CLI exits, an exec's timeout) still holds the
refresh until its copy is done: the next refresh, the verifier's, starts
its copy only then, since the two would share each state file's
temporary copy.
"""
import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import environment
from vfsbench_harbor.environment import MirageEnvironment


class CanceledRefresh(unittest.TestCase):

    def setUp(self) -> None:
        self.started = threading.Semaphore(0)
        self.release = threading.Event()
        self.copies = 0
        self.active = 0
        self.peak = 0
        self.snapshot = environment._snapshot
        environment._snapshot = self._copy
        # The refresh's own state, without a trial to start.
        self.env = object.__new__(MirageEnvironment)
        self.env._state = [("view", "live")]
        self.env._refreshing = threading.Lock()
        self.root = tempfile.TemporaryDirectory()
        self.env.trial_paths = TrialPaths(Path(self.root.name))

    def tearDown(self) -> None:
        self.release.set()
        environment._snapshot = self.snapshot
        self.root.cleanup()

    def _copy(self, view, live) -> None:
        self.copies += 1
        self.active += 1
        self.peak = max(self.peak, self.active)
        self.started.release()
        self.release.wait(5)
        self.active -= 1

    async def _scenario(self) -> None:
        first = asyncio.create_task(self.env.refresh_state())
        await asyncio.to_thread(self.started.acquire, timeout=5)
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        second = asyncio.create_task(self.env.refresh_state())
        # The first copy is still running: the second must not start.
        self.assertFalse(await asyncio.to_thread(self.started.acquire,
                                                 timeout=0.3))
        self.assertEqual(self.copies, 1)
        self.release.set()
        await second
        self.assertEqual(self.copies, 2)
        self.assertEqual(self.peak, 1)

    def test_next_refresh_waits_for_a_canceled_copy(self) -> None:
        asyncio.run(self._scenario())


class AgentTrajectory(unittest.TestCase):

    def setUp(self) -> None:
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        root = Path(self.root.name)
        self.env = object.__new__(MirageEnvironment)
        self.env.trial_paths = TrialPaths(root)
        self.env._mounts = {
            "/logs": {
                "root": str(root / "mirage/logs"),
                "mode": "readwrite"
            }
        }
        self.env._state = []
        self.env._refreshing = threading.Lock()
        self.source = self.env.trial_paths.agent_dir / "trajectory.json"
        self.source.parent.mkdir(parents=True)
        self.target = self.env.host_path("/logs/agent/trajectory.json")

    def test_refresh_copies_finished_host_trajectory_into_verifier_mount(
            self) -> None:
        self.source.write_text(
            '{"steps": [{"source": "agent", "message": "$350"}]}')
        asyncio.run(self.env.refresh_state())
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        self.assertTrue(
            self.target.is_relative_to(self.env.disk_mounts["/logs"]))

    def test_exec_refreshes_trajectory_before_running_pyodide_verifier(
            self) -> None:
        self.source.write_text('{"steps": []}')

        async def post(*args, **kwargs):
            self.assertEqual(self.target.read_bytes(),
                             self.source.read_bytes())
            return environment.httpx.Response(
                200,
                json={"job_id": "verify"},
                request=environment.httpx.Request("POST",
                                                  "http://mirage/shell"))

        async def wait(*args):
            return {
                "status": "done",
                "result": {
                    "stdout": "",
                    "stderr": "",
                    "exit_code": 0
                }
            }

        self.env._client = SimpleNamespace(post=post)
        self.env._workspace_id = "trial"
        self.env._workdir = "/workspace"
        self.env._merge_env = lambda env: env
        self.env._wait = wait
        asyncio.run(self.env.exec("bash /tests/test.sh"))

    def test_no_host_trajectory_preserves_oracle_file(self) -> None:
        self.target.parent.mkdir(parents=True)
        self.target.write_text(
            '{"steps": [{"source": "agent", "message": "oracle"}]}')
        before = self.target.read_bytes()
        asyncio.run(self.env.refresh_state())
        self.assertEqual(self.target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
