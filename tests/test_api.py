import asyncio
import io
import json
import tempfile
import unittest
from contextlib import asynccontextmanager, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from vfsbench import AgentResult, TrialEnvironment, run
from vfsbench.cli import main
from vfsbench.verifier import SuiteVerifier


class RunTests(unittest.TestCase):

    def test_run_records_callback_and_cli_answers_before_grading(self):
        task_id = "fantasy-sports-average"
        expected = "31.5 points"

        async def evaluate(view):
            return {"reward": float(view.result.final_answer == expected)}

        @asynccontextmanager
        async def environment(task, config, directory):
            yield TrialEnvironment({}, SuiteVerifier(evaluate), python=False)

        async def action(ws):
            return AgentResult(final_answer=expected, output={"points": 31.5})

        with patch("vfsbench.runtime._prepare", return_value=environment):
            report = asyncio.run(run("mcpatlas", task=task_id, action=action))
            self.assertEqual(report.verification.reward, 1)
            self.assertEqual(report.result.output, {"points": 31.5})
            with self.assertRaisesRegex(ValueError, "final_answer"):
                asyncio.run(
                    run("mcpatlas",
                        task=task_id,
                        action=action,
                        final_answer="a second answer"))
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                main([
                    "run", "mcpatlas", "--task", task_id, "--final-answer",
                    expected
                ])
            saved = json.loads(stdout.getvalue())
            self.assertEqual(saved["result"]["final_answer"], expected)
            self.assertEqual(saved["verification"]["reward"], 1)

    def test_mirage_workspace_limits_in_python_and_cli(self):
        from mirage.config import load_config
        from mirage.errors.types import QuotaExceededError
        from vfsbench import Toolathlon

        async def evaluate(view):
            return {"reward": 0}

        @asynccontextmanager
        async def environment(task, config, directory):
            yield TrialEnvironment({}, SuiteVerifier(evaluate), python=False)

        with tempfile.TemporaryDirectory() as temp, patch(
                "vfsbench.runtime._prepare", return_value=environment):
            root = Path(temp)
            path = root / "workspace.yaml"
            path.write_text(
                'mounts: {/scratch: {vfs: ram, mode: write}}\n'
                'max_memory: 2MB\n'
                'command_limits: {"@line": {timeout_seconds: 0.1}}\n')
            native = load_config(path)
            task = Toolathlon()["wandb-best-score"]

            async def check():
                async with task.start(config=native) as trial:
                    with self.assertRaises(QuotaExceededError):
                        await trial.workspace.vfs.write(
                            "/scratch/large", bytes(3 * 1024 * 1024))
                    result = await trial.exec("sleep 2")
                    self.assertEqual(result.return_code, 124)
                    self.assertIn("timed out", result.stderr)
                    self.assertEqual(trial.trace.commands[-1].return_code, 124)
                    self.assertEqual((await trial.exec("echo ready")).stdout,
                                     "ready\n")
                return await run("toolathlon",
                                 task=task.id,
                                 config=native,
                                 command="sleep 2")

            report = asyncio.run(check())
            self.assertEqual(report.trace.commands[-1].return_code, 124)
            self.assertEqual(report.verification.reward, 0)
            output = root / "report"
            with redirect_stdout(io.StringIO()):
                code = main([
                    "run", "toolathlon", "--task", task.id, "--config",
                    str(path), "--output",
                    str(output), "shell", "-c", "sleep 2", "--json"
                ])
            self.assertEqual(code, 124)
            saved = json.loads((output / "trial.json").read_bytes())
            self.assertEqual(saved["verification"]["reward"], 0)

    def test_cli_and_application_use_same_live_verifier_and_report(self):

        @asynccontextmanager
        async def environment(task, config, directory):

            async def read_state():
                return {"task": task.id}

            async def verify(view):
                state = await view.service_state("mock")
                self.assertEqual(state["task"], task.id)
                self.assertIsNone(view.result)
                observed = await view.read_file("/workspace/out")
                return {
                    "reward": float(observed == b"example\n"),
                    "memory": config.memory
                }

            yield TrialEnvironment({},
                                   SuiteVerifier(verify),
                                   python=False,
                                   state_readers={"mock": read_state})

        with tempfile.TemporaryDirectory() as temp, patch(
                "vfsbench.runtime._prepare", return_value=environment):
            root = Path(temp)
            config = root / "config.toml"
            config.write_text('[trial]\nmemory = "1G"\n')
            task = "wandb-best-score"
            command = "echo example > /workspace/out"
            report = asyncio.run(
                run("toolathlon",
                    task=task,
                    command=command,
                    config=config,
                    output=root / "api"))
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                main([
                    "run", "toolathlon", "--task", task, "--command", command,
                    "--config",
                    str(config), "--output",
                    str(root / "cli")
                ])
            cli = json.loads(stdout.getvalue())
            api = json.loads((root / "api/trial.json").read_text())
            self.assertEqual(cli,
                             json.loads((root / "cli/trial.json").read_text()))
            self.assertEqual(api, json.loads(json.dumps(report.to_dict())))
            self.assertNotEqual(cli["trial_id"], api["trial_id"])
            self.assertEqual(cli.keys(), api.keys())
            for key in ("task_id", "dataset", "revision", "result",
                        "verification"):
                self.assertEqual(cli[key], api[key])
            self.assertEqual(cli["verification"], {
                "reward": 1,
                "details": {
                    "memory": "1G"
                }
            })
            for outcome in (cli, api):
                self.assertEqual(outcome["trace"]["commands"][0]["command"],
                                 command)
                self.assertIsNotNone(outcome["closed_at"])

    def test_native_workspace_shell_and_vfs_cli(self):
        from mirage.workspace.workspace import Workspace

        expected = b"\x00\x80\xff"

        async def evaluate(view):
            self.assertIsNone(view.result)
            found = await view.read_file("/workspace/input")
            return {"reward": int(found == expected)}

        @asynccontextmanager
        async def environment(task, config, directory):

            async def install(ws):
                await ws.vfs.write("/workspace/input", expected)

            yield TrialEnvironment({},
                                   SuiteVerifier(evaluate),
                                   python=False,
                                   install=install)

        async def inspect(ws):
            self.assertIsInstance(ws, Workspace)
            self.assertEqual(await ws.vfs.read("/workspace/input", raw=True),
                             expected)
            result = await ws.shell("pwd")
            self.assertEqual(await result.stdout_str(), "/workspace\n")

        with tempfile.TemporaryDirectory() as temp, patch(
                "vfsbench.runtime._prepare", return_value=environment):
            root = Path(temp)
            args = ["run", "toolathlon", "--task", "wandb-best-score"]
            report = asyncio.run(
                run("toolathlon", task="wandb-best-score", action=inspect))
            self.assertEqual(report.verification.reward, 1)
            types = {event["type"] for event in report.trace.workspace_events}
            self.assertTrue({"command", "result", "vfs"} <= types)

            def launch(name, suffix, stdin=b""):
                out = io.BytesIO()
                text = io.TextIOWrapper(out,
                                        encoding="utf-8",
                                        write_through=True)
                with tempfile.TemporaryFile("w+b") as source:
                    source.write(stdin)
                    source.seek(0)
                    with (io.TextIOWrapper(source) as
                          reader, patch("sys.stdin",
                                        reader), redirect_stdout(text)):
                        code = main(
                            [*args, "--output",
                             str(root / name), *suffix])
                saved = json.loads((root / name / "trial.json").read_bytes())
                self.assertIsNotNone(saved["closed_at"])
                data = out.getvalue()
                text.close()
                return code, data, saved["verification"]["reward"]

            vfs = ["workspace", "vfs"]
            filename = "/workspace/input"
            self.assertEqual(
                launch("read",
                       [*vfs, "read", filename, "--raw", "--offset", "1"]),
                (0, expected[1:], 1))
            self.assertEqual(
                launch("write", [*vfs, "write", filename], b"replacement"),
                (0, b"", 0))
            status, listing, reward = launch("list",
                                             [*vfs, "readdir", "/workspace"])
            self.assertEqual((status, json.loads(listing), reward),
                             (0, [filename], 1))
            self.assertEqual(
                launch("shell", ["shell", "-c", "cat", "--cwd", "/workspace"],
                       expected), (0, expected, 1))
            code, message, reward = launch(
                "nonzero", ["workspace", "shell", "-c", "false", "--json"])
            self.assertEqual((code, json.loads(message)["exit_code"], reward),
                             (1, 1, 1))
