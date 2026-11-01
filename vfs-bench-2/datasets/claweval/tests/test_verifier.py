"""Claw-Eval's staging for its native grader, and the port's pins."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import yaml
from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor.environment import ROOT
from vfsbench_harbor.mirage_verifier import dataset_module

claw = dataset_module("claweval")
GRADERS = ROOT / "datasets/claweval/graders"


def build_module():
    spec = importlib.util.spec_from_file_location("claweval_build",
                                                  GRADERS / "build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    return build


class ClawEvalVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = Task(ROOT / "datasets/claweval/T001zh_email_triage/harbor")
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
                                       environment=self.env)

    def test_oracle_config_contains_every_packaged_solution(self):
        config = yaml.safe_load(
            (ROOT / "datasets/claweval/jobs/oracle.yaml").read_text())
        configured = {
            Path(item["path"]).parent.name
            for item in config["tasks"]
        }
        available = {
            p.parents[2].name
            for p in (ROOT /
                      "datasets/claweval").glob("*/harbor/solution/solve.sh")
        }
        self.assertEqual(configured, available)
        self.assertEqual(len(config["tasks"]), len(available))
        self.assertLessEqual(configured, claw.definitions().keys())
        self.assertEqual(config["verifier"]["import_path"],
                         "vfsbench_harbor:MirageVerifier")

    def test_every_task_grades_natively(self):
        definitions = claw.definitions()
        self.assertEqual(len(definitions), 126)
        self.assertEqual({d["runtime"]
                          for d in definitions.values()}, {"typescript"})
        tasks = json.loads((GRADERS / "reference/tasks.json").read_text())
        self.assertEqual(set(tasks), set(definitions))
        registry = (GRADERS / "port/registry.ts").read_text()
        withheld = build_module().WITHHELD
        for task in definitions:
            self.assertIn(json.dumps(task) + ":", registry)
            # fetch.py writes the withheld three.
            if task not in withheld:
                self.assertTrue(
                    (GRADERS.parent / task / "grader.ts").is_file())

    async def test_stages_the_run_as_json_without_sqlite(self):
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
                claw.definitions()["T001zh_email_triage"], stage)
        self.assertEqual(frozen["states"], {})
        self.assertEqual(set(frozen["files"]), {
            "/input/trajectory.json", "/input/gws_seed.json",
            "/input/state.json"
        })
        self.assertEqual(
            Path(frozen["files"]["/input/trajectory.json"]).read_text(),
            '{"steps": []}')
        state = json.loads(
            Path(frozen["files"]["/input/state.json"]).read_text())
        self.assertEqual(state["task"], "T001zh_email_triage")
        self.assertEqual(state["audit"], {})
        self.assertEqual(set(state["gws"]), set(claw.GWS_TABLES))
        self.env.snapshot_verifier_states.assert_awaited_once()

    def test_port_matches_its_reference(self):
        build = subprocess.run(
            [sys.executable,
             str(GRADERS / "build.py"), "--check"],
            capture_output=True,
            text=True)
        self.assertEqual(build.returncode, 0, build.stderr)

    def test_vendoring_refuses_a_changed_upstream_source(self):
        build = build_module()
        upstream = self.root / "upstream"
        source = upstream / "tasks/T001zh_email_triage/grader.py"
        source.parent.mkdir(parents=True)
        source.write_text("changed")
        manifest = self.root / "manifest.json"
        manifest.write_text(
            json.dumps({
                "tasks": {
                    "T001zh_email_triage": {
                        "sources": {
                            "tasks/T001zh_email_triage/grader.py": "0" * 64
                        }
                    }
                }
            }))
        reference = self.root / "reference"
        with patch.multiple(build,
                            UPSTREAM=upstream,
                            MANIFEST=manifest,
                            REFERENCE=reference):
            with self.assertRaisesRegex(SystemExit, "changed upstream"):
                build.vendor()
        self.assertFalse(reference.exists())


if __name__ == "__main__":
    unittest.main()
