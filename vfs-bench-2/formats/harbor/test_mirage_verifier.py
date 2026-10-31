"""Check snapshots, output provenance, reference drift and cancellation.

    uv run --project harbor python -I harbor/test_mirage_verifier.py
"""
import asyncio
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor.environment import ROOT
from vfsbench_harbor.mirage_verifier import _Staging

TASKS = ROOT / "datasets/liveclawbench"
NODE = os.environ.get("VFSBENCH_TEST_NODE", "node")
SCHEMA = """
CREATE TABLE user_sticker_pack (user_id INTEGER, sticker_pack_id INTEGER);
CREATE TABLE user_sticker (user_id INTEGER, pack_id INTEGER, category TEXT);
CREATE TABLE message (sender TEXT, message_kind TEXT, channel_id INTEGER);
"""


class MirageVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(
            prefix="vfsbench-verifier-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = Task(TASKS / "chat-sticker-engagement" / "harbor")
        self.paths = TrialPaths(self.root / "trial")
        self.paths.mkdir()
        self.env = MirageEnvironment(
            environment_dir=self.task.paths.environment_dir,
            environment_name=self.task.name,
            session_id="test",
            trial_paths=self.paths,
            task_env_config=self.task.config.environment,
            node=NODE,
        )
        self.live = self.root / "live.sqlite"
        with sqlite3.connect(self.live) as db:
            db.executescript(SCHEMA)
        snapshot = self.root / "state"
        snapshot.mkdir()
        self.env._mounts = {
            "/opt/mock/data/chat": {
                "root": str(snapshot),
                "mode": "read",
            }
        }
        self.env._state = [(snapshot / "chat.sqlite", self.live)]

        async def snapshot_states(definitions):
            with sqlite3.connect(self.live) as db:
                db.row_factory = sqlite3.Row
                return {
                    alias: {
                        table: [
                            dict(row) for row in db.execute('SELECT * FROM "' +
                                                            table + '"')
                        ]
                        for table in definition["tables"]
                    }
                    for alias, definition in definitions.items()
                }

        self.env.snapshot_verifier_states = snapshot_states
        (self.root / "request.json").write_text(
            json.dumps({
                "task": self.task.paths.task_dir.parent.name,
                "states": {},
                "files": {},
                "timeoutSeconds": 30
            }))

        self.verifier = MirageVerifier(task=self.task,
                                       environment=self.env,
                                       trial_paths=self.paths)

    async def test_rewards_use_fresh_state_and_ignore_agent_output(self):
        # An agent can forge its /logs, which is not the verifier's output.
        agent_logs = self.root / "agent-logs/verifier"
        agent_logs.mkdir(parents=True)
        (agent_logs / "reward.txt").write_text("1.0\n")
        self.env._mounts["/logs"] = {
            "root": str(agent_logs.parent),
            "mode": "write",
        }
        self.paths.reward_json_path.write_text('{"reward": 1}')
        result = await self.verifier.verify()
        self.assertEqual(result.rewards, {"reward": 0})
        self.assertFalse(self.paths.reward_json_path.exists())
        self.assertEqual((agent_logs / "reward.txt").read_text(), "1.0\n")
        with sqlite3.connect(self.live) as db:
            db.executescript("""
            INSERT INTO user_sticker_pack VALUES (1, 1), (1, 2);
            INSERT INTO message VALUES
                ('You', 'sticker', 2), ('You', 'sticker', 3);
            """)
        result = await self.verifier.verify()
        self.assertEqual(result.rewards, {"reward": 0.5})
        with sqlite3.connect(self.live) as db:
            db.execute("INSERT INTO user_sticker VALUES (1, 1, 'favorite')")
        before = self.live.read_bytes()
        result = await self.verifier.verify()
        self.assertEqual(result.rewards, {"reward": 1})
        self.assertEqual(self.live.read_bytes(), before)
        self.assertEqual(self.paths.test_stdout_path.read_text(),
                         "Score: 1.0/1.0\n")
        timings = json.loads(
            (self.paths.verifier_dir / "timings.json").read_text())
        self.assertGreater(timings["peak_node_mib"], 0)
        self.assertGreater(timings["total_s"], timings["run_s"])

    async def test_changed_input_is_rejected_and_stale_rewards_removed(self):
        # The task's dataset is the name of the directory it is in.
        copied = self.root / "liveclawbench" / "stale-client-escalation"
        shutil.copytree(TASKS / "stale-client-escalation", copied)
        source = (copied /
                  "workspace/verifier/_seed_snapshots/client-escalation-log.md")
        source.write_text(source.read_text() + "\n# changed\n")
        self.verifier.task = Task(copied / "harbor")
        self.verifier._run = AsyncMock()
        self.paths.reward_text_path.write_text("1.0\n")
        with self.assertRaisesRegex(ValueError, "client-escalation-log.md changed"):
            await self.verifier.verify()
        self.verifier._run.assert_not_called()
        self.assertFalse(self.paths.reward_text_path.exists())


    async def test_invalid_state_does_not_leave_a_reward(self):
        self.env.snapshot_verifier_states = AsyncMock(return_value={
            "/opt/mock/data/chat/chat.sqlite": {
                "message": "invalid"
            }
        })
        self.paths.reward_text_path.write_text("1\n")
        with self.assertRaisesRegex(RuntimeError, "Mirage grader exited"):
            await self.verifier.verify()
        self.assertFalse(self.paths.reward_text_path.exists())

    async def test_native_grading_never_opens_sqlite(self):
        self.env.snapshot_verifier_states = AsyncMock(
            return_value={
                "/opt/mock/data/chat/chat.sqlite": {
                    "user_sticker_pack": [],
                    "user_sticker": [],
                    "message": []
                }
            })
        with patch("sqlite3.connect",
                   side_effect=AssertionError("host SQLite")):
            result = await self.verifier.verify()
        self.assertEqual(result.rewards, {"reward": 0})

    async def test_log_filters_keep_rewards(self):
        self.verifier.exclude_logs = ["*"]
        result = await self.verifier.verify()
        self.assertEqual(result.rewards, {"reward": 0})
        self.assertTrue(self.paths.reward_text_path.exists())
        self.assertFalse(self.paths.test_stdout_path.exists())

    async def test_verifier_env_precedence_and_custom_policy_are_used(self):
        task = Task(TASKS / "finance-dashboard-repair" / "harbor")
        task.config.verifier.env = {
            "POLICY_PATH": "/workspace/task.md",
            "TASK_SETTING": "task"
        }
        workspace = self.root / "workspace"
        workspace.mkdir()
        self.env._mounts["/workspace"] = {
            "root": str(workspace),
            "mode": "readwrite"
        }
        self.env._env = {
            "POLICY_PATH": "/workspace/base.md",
            "BASE_SETTING": "base"
        }
        (workspace / "chosen.md").write_text(
            "## Audit\nReplace total_expenses with actual_expense_amount; "
            "correct budget_deviation to budget_amount.\n")
        self.env.snapshot_verifier_states = AsyncMock(
            return_value={
                "/opt/mock/data/finance_app.sqlite": {
                    "dashboard_config": [{
                        "user_id": 1,
                        "formula_json": "{}"
                    }]
                }
            })
        verifier = MirageVerifier(task=task,
                                  environment=self.env,
                                  trial_paths=self.paths,
                                  verifier_env={
                                      "POLICY_PATH": "/workspace/verifier.md",
                                      "VERIFIER_SETTING": "verifier"
                                  },
                                  override_env={
                                      "POLICY_PATH": "${MIRAGE_TEST_POLICY}",
                                      "OVERRIDE_SETTING": "override"
                                  })
        run = verifier._run

        async def inspect(node, request):
            value = json.loads(request.read_text())
            self.assertEqual(
                value["env"], {
                    "POLICY_PATH": "/workspace/chosen.md",
                    "BASE_SETTING": "base",
                    "TASK_SETTING": "task",
                    "VERIFIER_SETTING": "verifier",
                    "OVERRIDE_SETTING": "override"
                })
            self.assertIn("/workspace/chosen.md", value["files"])
            return await run(node, request)

        verifier._run = inspect
        with patch.dict(os.environ,
                        {"MIRAGE_TEST_POLICY": "/workspace/chosen.md"}):
            result = await verifier.verify()
        self.assertEqual(result.rewards["_meta_policy_audit"], 0.15)
        self.assertEqual(result.rewards["_meta_policy_content"], 0.15)

    async def test_unsupported_overrides_fail_before_grading(self):
        task = Task(TASKS / "finance-dashboard-repair" / "harbor")
        for override in [{
                "MOCK_FINANCE_DB_PATH": "/workspace/other.db"
        }, {
                "POLICY_PATH": "/etc/passwd"
        }, {
                "POLICY_PATH": "/tests/../../private.md"
        }, {
                "POLICY_PATH": "relative.md"
        }]:
            with self.subTest(override=override):
                verifier = MirageVerifier(task=task,
                                          environment=self.env,
                                          trial_paths=self.paths,
                                          override_env=override)
                verifier._run = AsyncMock()
                self.paths.reward_text_path.write_text("1\n")
                with self.assertRaises(ValueError):
                    await verifier.verify()
                verifier._run.assert_not_called()
                self.assertFalse(self.paths.reward_text_path.exists())

    async def test_staging_limits_stop_large_files_and_directory_trees(self):
        workspace = self.root / "bounded"
        workspace.mkdir()
        (workspace / "a").write_bytes(b"x" * 128)
        (workspace / "b").write_text("small")
        self.env._mounts["/workspace"] = {
            "root": str(workspace),
            "mode": "readwrite"
        }
        self.env.snapshot_verifier_states = AsyncMock(return_value={})
        self.verifier._definition = Mock(return_value=(self.task.name, {
            "inputs": [],
            "trees": ["/workspace"],
            "native_state": {}
        }))
        self.verifier._run = AsyncMock()
        for limit, value, error in [("MAX_STAGING_BYTES", 64, "byte limit"),
                                    ("MAX_STAGING_PATHS", 1, "path limit")]:
            with patch("vfsbench_harbor.mirage_verifier." + limit, value):
                with self.assertRaisesRegex(ValueError, error):
                    await self.verifier.verify()
            self.verifier._run.assert_not_called()
            self.assertFalse(self.paths.reward_text_path.exists())

    async def test_staging_yields_and_stops_before_temporary_cleanup(self):
        loop = asyncio.get_running_loop()
        errors = []
        previous = loop.get_exception_handler()
        loop.set_exception_handler(
            lambda _loop, context: errors.append(context))
        self.addCleanup(loop.set_exception_handler, previous)
        workspace = self.root / "slow"
        workspace.mkdir()
        (workspace / "input").write_text("data")
        self.env._mounts["/workspace"] = {
            "root": str(workspace),
            "mode": "readwrite"
        }
        self.verifier._definition = Mock(return_value=(self.task.name, {
            "inputs": ["/workspace/input"],
            "native_state": {}
        }))
        self.verifier._run = AsyncMock()
        main_thread = threading.get_ident()
        for cancel in (False, True):
            entered = threading.Event()
            stopped = threading.Event()
            locations = []

            def slow_copy(budget, source, target):
                self.assertNotEqual(threading.get_ident(), main_thread)
                locations.append(target.parent)
                entered.set()
                try:
                    while True:
                        budget.check()
                        time.sleep(0.005)
                finally:
                    stopped.set()

            self.task.config.verifier.timeout_sec = 10 if cancel else 0.1
            with patch.object(_Staging, "copy", slow_copy):
                running = asyncio.create_task(self.verifier.verify())
                self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                # The coroutine runs while the copy owns its directory.
                self.assertFalse(stopped.is_set())
                if cancel:
                    running.cancel()
                with self.assertRaises(
                        asyncio.CancelledError if cancel else TimeoutError):
                    await asyncio.wait_for(running, 2)
                self.assertTrue(stopped.is_set())
                self.assertFalse(locations[0].exists())
                self.verifier._run.assert_not_called()
                self.assertFalse(self.paths.reward_text_path.exists())
        await asyncio.sleep(0)
        self.assertEqual(errors, [])

    async def test_timeout_stops_actual_child_processes(self):
        child_pid_file = self.root / "child.pid"
        runner = self.root / "child-runner.mjs"
        runner.write_text("import { spawn } from 'node:child_process';\n"
                          "import { writeFileSync } from 'node:fs';\n"
                          "const child = spawn(process.execPath, "
                          "['-e', 'setInterval(() => {}, 1000)']);\n"
                          f"writeFileSync({json.dumps(str(child_pid_file))}, "
                          "String(child.pid));\n"
                          "setInterval(() => {}, 1000);\n")
        self.task.config.verifier.timeout_sec = 2
        with patch("vfsbench_harbor.mirage_verifier.RUNNER", runner):
            with self.assertRaises(TimeoutError):
                await self.verifier._run(NODE, self.root / "request.json")
        pid = int(child_pid_file.read_text())
        for _ in range(100):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            await asyncio.sleep(0.02)
        else:
            self.fail("Verifier timeout left its child process alive")

    async def test_timeout_and_cancellation_reap_the_runner(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                entered = asyncio.Event()

                async def communicate(_input):
                    entered.set()
                    await asyncio.Event().wait()

                process = Mock(returncode=None, pid=12345)
                process.communicate = communicate
                process.wait = AsyncMock(return_value=-9)
                self.task.config.verifier.timeout_sec = 30 if cancel else 0.02
                with patch(
                        "vfsbench_harbor.mirage_verifier.asyncio."
                        "create_subprocess_exec",
                        AsyncMock(return_value=process)
                ), patch(
                        "vfsbench_harbor.mirage_verifier.os.killpg") as killpg:
                    running = asyncio.create_task(
                        self.verifier._run(NODE, self.root / "request.json"))
                    await entered.wait()
                    if cancel:
                        running.cancel()
                    with self.assertRaises(asyncio.CancelledError
                                           if cancel else TimeoutError):
                        await running
                killpg.assert_called_once_with(12345, 9)
                process.wait.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
