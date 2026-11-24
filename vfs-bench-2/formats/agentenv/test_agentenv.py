"""The agent-env plugin's types and the bundles bundle.py writes."""
import importlib.util
import json
import unittest
from importlib.metadata import entry_points
from pathlib import Path

from agent_env.env.env import DeployedEnv
from vfsbench_agentenv.env import _TRIALS, MirageEnv, trial_of
from vfsbench_agentenv.steps import MirageGradeTaskStep, MirageOracleTaskStep

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("bundle", HERE / "bundle.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class PluginTest(unittest.TestCase):

    def test_entry_points_name_the_types(self):
        envs = {e.name: e.load() for e in entry_points(group="agent_env.envs")}
        steps = {
            e.name: e.load()
            for e in entry_points(group="agent_env.task_steps")
        }
        self.assertIs(envs["mirage"], MirageEnv)
        self.assertIs(steps["mirage_oracle"], MirageOracleTaskStep)
        self.assertIs(steps["mirage_grade"], MirageGradeTaskStep)

    def test_env_round_trips(self):
        env = MirageEnv.from_dict({
            "id": "t",
            "version": 2,
            "task": "complexmcp/mint-100g"
        })
        self.assertEqual(env.to_dict()["task"], "complexmcp/mint-100g")
        self.assertTrue((env.task_dir / "task.toml").is_file())

    def test_steps_round_trip(self):
        oracle = MirageOracleTaskStep.from_dict({
            "id": "solve",
            "env_id": "t",
            "depends_on": ["env"]
        })
        grade = MirageGradeTaskStep.from_dict({
            "id": "grade",
            "env_id": "t",
            "verifier_id": "reward"
        })
        self.assertEqual(oracle.to_dict()["env_id"], "t")
        self.assertEqual(grade.to_dict()["verifier_id"], "reward")
        self.assertEqual(
            MirageGradeTaskStep.from_dict(grade.to_dict()).env_id, "t")

    def test_a_record_with_no_live_workspace_is_refused(self):
        deployed = DeployedEnv(env_id="t",
                               env_version=1,
                               metadata={"mirage_session": "gone"})
        self.assertNotIn("gone", _TRIALS)
        with self.assertRaisesRegex(RuntimeError, "no live Mirage workspace"):
            trial_of(deployed)


class BundleTest(unittest.TestCase):

    def test_complexmcp_bundle_is_current(self):
        out = bundle.DATASETS / "complexmcp" / "agentenv"
        files = bundle.bundle("complexmcp")
        present = {
            str(p.relative_to(out)): p.read_text()
            for p in out.rglob("*") if p.is_file()
        }
        self.assertEqual(files, present)

    def test_each_task_deploys_its_env_and_grades_it(self):
        files = bundle.bundle("complexmcp")
        steps = json.loads(files["tasks/mint-100g.json"])
        self.assertEqual(
            [s["type"] for s in steps],
            ["deploy_env", "deploy_agent", "prompt_agent", "mirage_grade"])
        self.assertEqual(steps[1]["env_ids"], ["mint-100g"])
        oracle = json.loads(files["tasks/mint-100g-oracle.json"])
        self.assertEqual([s["type"] for s in oracle],
                         ["deploy_env", "mirage_oracle", "mirage_grade"])
        self.assertIn('"mint-100g-oracle"', files["evals/oracle.toml"])


if __name__ == "__main__":
    unittest.main()
