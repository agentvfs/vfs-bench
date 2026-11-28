import importlib.util
import json
import tempfile
import unittest
from contextlib import asynccontextmanager, chdir
from pathlib import Path, PurePosixPath
from unittest.mock import patch

from vfsbench.dataset import MCPAtlas, Toolathlon
from vfsbench.harbor.export import export
from vfsbench.runtime import TrialEnvironment
from vfsbench.verifier import SuiteVerifier


@unittest.skipUnless(importlib.util.find_spec("harbor"),
                     "install vfsbench[harbor]")
class HarborTests(unittest.IsolatedAsyncioTestCase):

    def test_export_cli_and_python_write_equivalent_jobs(self):
        from vfsbench.cli import main
        from vfsbench.harbor import export

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            task = "wandb-best-score"
            workspace = root / "workspace.yaml"
            workspace.write_text("mounts: {/scratch: {vfs: ram}}\n")
            programmatic = export("toolathlon",
                                  root / "api",
                                  config=workspace,
                                  task_ids=[task],
                                  instructions_file=False,
                                  concurrency=2)
            main([
                "harbor", "export", "toolathlon", "--output",
                str(root / "cli"), "--task", task, "--concurrency", "2",
                "--config",
                str(workspace), "--no-instructions-file"
            ])
            self.assertEqual(programmatic.read_bytes(),
                             (root / "cli/job.json").read_bytes())
            job = json.loads(programmatic.read_bytes())
            for target in ("api", "cli"):
                folder = root / target / "tasks" / task
                self.assertNotIn("/INSTRUCTIONS.md",
                                 (folder / "instruction.md").read_text())
                descriptor = json.loads(
                    (folder / "environment/vfsbench.json").read_text())
                self.assertIs(descriptor["instructions_file"], False)
            self.assertEqual(job["verifier"]["import_path"],
                             "vfsbench.harbor:MirageVerifier")
            self.assertEqual(job["environment"]["import_path"],
                             "vfsbench.harbor:MirageEnvironment")
            self.assertEqual(job["n_concurrent_trials"], 2)
            self.assertEqual(job["environment"]["kwargs"]["workspace_yaml"],
                             "../workspace.yaml")
            self.assertNotIn("local_files_only", job["environment"]["kwargs"])
            self.assertEqual(
                {item.name
                 for item in (root / "cli/tasks").iterdir()}, {task})

    def test_export_embeds_a_native_workspace_config(self):
        from mirage.config import WorkspaceConfig

        workspace = WorkspaceConfig(
            mounts={},
            max_memory="64MB",
            command_limits={"@line": {
                "timeout_seconds": 7
            }})
        with tempfile.TemporaryDirectory() as directory:
            path = export("toolathlon",
                          Path(directory) / "job",
                          config=workspace,
                          task_ids=["wandb-best-score"])
            kwargs = json.loads(path.read_bytes())["environment"]["kwargs"]
            spec = WorkspaceConfig.model_validate(kwargs["workspace_config"])
            self.assertEqual(spec, workspace)
            self.assertEqual(spec.model_fields_set, workspace.model_fields_set)

    def test_export_ported_toolathlon_tasks(self):
        from vfsbench.suites.toolathlon import SUPPORTED

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            suite = Toolathlon()
            self.assertEqual({task.id for task in suite}, SUPPORTED)
            job = export(suite, root / "job")
            ids = {folder.name for folder in (job.parent / "tasks").iterdir()}
            self.assertEqual(ids, SUPPORTED)
            self.assertIn("nhl-b2b-analysis", ids)

    def test_missing_agent_output_remains_absent(self):
        from harbor.models.trial.paths import TrialPaths
        from vfsbench.harbor.adapter import _agent_evidence

        with tempfile.TemporaryDirectory() as root:
            paths = TrialPaths(Path(root))
            paths.mkdir()
            self.assertEqual(_agent_evidence(paths), (None, None))

    async def test_export_discovery_transfers_grading_and_cleanup(self):
        from harbor.environments.factory import EnvironmentFactory
        from harbor.models.job.config import JobConfig
        from harbor.models.task.task import Task
        from harbor.models.trial.paths import TrialPaths
        from harbor.verifier.factory import VerifierFactory
        from vfsbench.runtime import _workspace_config

        @asynccontextmanager
        async def prepare(task, config, run_dir):

            async def evaluate(view):
                answer = view.result.final_answer
                self.assertEqual(view.trace.agent["steps"][0]["message"],
                                 "Do the task")
                self.assertEqual(view.trace.commands[-1].command,
                                 "cat /workspace/data/omit")
                return {"reward": float(answer == "done"), "answer": answer}

            yield TrialEnvironment(workspace={},
                                   instructions="Public task guide.",
                                   verifier=SuiteVerifier(evaluate))

        def no_machine(*args):
            return {**_workspace_config(*args), "machines": {}}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            config = root / "trial.toml"
            config.write_text('[trial]\nsnapshot="test"\nwork_dir="runs"\n')
            release = MCPAtlas(local_files_only=True)
            task_id = "fantasy-sports-average"
            workspace_yaml = root / "workspace.yaml"
            workspace_yaml.write_text("mounts: {/scratch: {vfs: ram}}\n")
            job = export(release,
                         root / "export",
                         config,
                         workspace_yaml=workspace_yaml,
                         task_ids=[task_id],
                         local_files_only=True)
            with chdir(job.parent):
                spec = JobConfig.model_validate_json(job.read_bytes())
                found = await spec.datasets[0].get_task_configs()
                self.assertEqual([entry.path.name for entry in found],
                                 [task_id])
                task = Task(found[0].path)
                self.assertIn(release[task_id].instruction, task.instruction)
                self.assertIn("/INSTRUCTIONS.md", task.instruction)
                paths = TrialPaths(root / "trial")
                paths.mkdir()
                env = EnvironmentFactory.create_environment_from_import_path(
                    spec.environment.import_path,
                    environment_dir=task.paths.environment_dir,
                    environment_name=task_id,
                    session_id="test-session",
                    trial_paths=paths,
                    task_env_config=task.config.environment,
                    network_policy=task.config.environment.resolve_baseline(),
                    **spec.environment.kwargs,
                )
                verifier = VerifierFactory.create_verifier_from_import_path(
                    spec.verifier.import_path,
                    task=task,
                    trial_paths=paths,
                    environment=env)
                with (patch("vfsbench.runtime._prepare", return_value=prepare),
                      patch("vfsbench.runtime._workspace_config",
                            side_effect=no_machine),
                      patch("vfsbench.runtime._restore_guest"),
                      patch("vfsbench.runtime._remove_guest")):
                    await env.start()
                    self.assertTrue(await
                                    env.trial.workspace.vfs.is_dir("/scratch"))
                    private = env.trial.run_dir
                    try:
                        self.assertFalse(await env.is_dir("/vfsbench"))
                        self.assertEqual(
                            await env.files.read("/INSTRUCTIONS.md"),
                            b"Public task guide.")
                        self.assertTrue(await env.is_dir("/logs/agent"))
                        for path in ("/grading", "/tests", "/solution",
                                     "/logs/verifier"):
                            self.assertFalse(await env.is_dir(path), path)
                        source = root / "source"
                        source.mkdir()
                        (source / "bytes").write_bytes(b"\x00\x80\xff")
                        (source / "omit").write_text("skip")
                        (source / "empty").mkdir()
                        await env.upload_dir(source, "/workspace/data")
                        shell = await env.exec("cat /workspace/data/omit")
                        self.assertEqual((shell.return_code, shell.stdout),
                                         (0, "skip"))
                        await env.download_dir_filtered(
                            source_dir="/workspace/data",
                            target_dir=root / "out",
                            exclude=["omit"])
                        self.assertEqual((root / "out/bytes").read_bytes(),
                                         b"\x00\x80\xff")
                        self.assertTrue((root / "out/empty").is_dir())
                        self.assertFalse((root / "out/omit").exists())
                        paths.agent_dir.joinpath("trajectory.json").write_text(
                            json.dumps({
                                "steps": [
                                    {
                                        "source": "user",
                                        "message": "Do the task"
                                    },
                                    {
                                        "source":
                                        "agent",
                                        "message": [{
                                            "type": "text",
                                            "text": "done"
                                        }]
                                    },
                                ]
                            }))
                        self.assertEqual((await verifier.verify()).rewards,
                                         {"reward": 1})
                        self.assertEqual(
                            json.loads(paths.reward_json_path.read_bytes()),
                            {"reward": 1})
                        # Guest log collection must preserve the graded reward.
                        await env._mkdir(PurePosixPath("/logs/verifier"))
                        await env.files.write("/logs/verifier/reward.json",
                                              b"{}")
                        await env.download_dir("/logs/verifier",
                                               paths.verifier_dir)
                        self.assertEqual(
                            json.loads(paths.reward_json_path.read_bytes()),
                            {"reward": 1})
                        report = json.loads((paths.verifier_dir /
                                             "vfsbench.json").read_bytes())
                        self.assertEqual(report["result"]["final_answer"],
                                         "done")
                        self.assertEqual(report["verification"]["details"],
                                         {"answer": "done"})
                    finally:
                        await env.stop()
                    self.assertFalse(private.exists())
                    report = json.loads(
                        (paths.verifier_dir / "vfsbench.json").read_bytes())
                    self.assertGreaterEqual(report["closed_at"],
                                            report["started_at"])
                    env.descriptor["instructions_file"] = False
                    await env.start()
                    try:
                        self.assertFalse(await env.is_file("/INSTRUCTIONS.md"))
                        self.assertTrue(await env.is_dir("/logs/agent"))
                    finally:
                        await env.stop()
                    del env.descriptor["instructions_file"]
                    await env.start()
                    try:
                        self.assertEqual(
                            await env.files.read("/vfsbench/INSTRUCTIONS.md"),
                            b"Public task guide.")
                    finally:
                        await env.stop()


if __name__ == "__main__":
    unittest.main()
