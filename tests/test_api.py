import asyncio
import io
import json
import tempfile
import unittest
from contextlib import asynccontextmanager, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from vfsbench import TrialEnvironment, run
from vfsbench.cli import main
from vfsbench.verifier import SuiteVerifier


class RunTests(unittest.TestCase):

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
