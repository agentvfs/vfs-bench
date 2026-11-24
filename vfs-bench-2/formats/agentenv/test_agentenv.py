"""The mirage env's plugin and the bundles bundle.py writes.

oracle.py runs the tasks themselves.
"""
import base64
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from importlib.metadata import entry_points
from pathlib import Path

import httpx
from agentenv_protocol import DataPart, FilePart
from agentenv_protocol.types import FileWithBytes, FileWithUri
from vfsbench_agentenv import grade
from vfsbench_agentenv.server import WORKSPACE, VfsBench, _free_port, _task
from vfsbench_agentenv.topology import MirageTopology

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("bundle", HERE / "bundle.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class PluginTest(unittest.TestCase):

    def test_entry_point_names_the_topology(self):
        providers = {
            e.name: e.load()
            for e in entry_points(group="agent_env.env_providers")
        }
        self.assertIs(providers["mirage"], MirageTopology)
        self.assertEqual(MirageTopology.type, "mirage")

    def test_card_names_the_env(self):
        self.assertEqual(VfsBench()._build_card().name, "mirage")

    def test_server_exits_with_its_parent(self):
        port = _free_port()
        server = subprocess.Popen(
            [sys.executable, "-m", "vfsbench_agentenv.server"],
            env={
                **os.environ, "ENVIRONMENT_NAME": "mirage",
                "MCP_HOST": "127.0.0.1",
                "MCP_PORT": str(port)
            },
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL)
        try:
            for _ in range(300):
                try:
                    httpx.get(f"http://127.0.0.1:{port}"
                              "/.well-known/agent-env.json")
                    break
                except httpx.TransportError:
                    time.sleep(0.1)
            server.stdin.close()
            self.assertIsNotNone(server.wait(30))
        finally:
            server.kill()

    def test_no_harbor(self):
        for path in (HERE / "src").rglob("*.py"):
            self.assertNotIn("harbor",
                             path.read_text().replace("harbor/", ""), path)

    def test_data_add_names_the_task(self):
        task = {"task": "complexmcp/mint-100g"}
        raw = json.dumps(task).encode()
        with tempfile.NamedTemporaryFile(suffix=".json") as f:
            f.write(raw)
            f.flush()
            for parts in (
                [DataPart(data=task)],
                [
                    FilePart(file=FileWithBytes(
                        bytes=base64.b64encode(raw).decode()))
                ],
                [FilePart(file=FileWithUri(uri=Path(f.name).as_uri()))],
            ):
                self.assertEqual(_task(parts), task["task"])
        with self.assertRaisesRegex(ValueError, "no task"):
            _task([])

    def test_grader_runner(self):
        self.assertEqual(grade._runner({"dataset": "complexmcp"}),
                         WORKSPACE / "verify.ts")
        with self.assertRaisesRegex(ValueError, "unknown grader runtime"):
            grade._runner({"dataset": "complexmcp", "runtime": "nope"})


class BundleTest(unittest.TestCase):

    def test_complexmcp_bundle_is_current(self):
        out = bundle.DATASETS / "complexmcp" / "agentenv"
        present = {
            str(p.relative_to(out)): p.read_text()
            for p in out.rglob("*") if p.is_file()
        }
        self.assertEqual(bundle.bundle("complexmcp"), present)

    def test_each_task_loads_its_artifact_and_grades_it(self):
        files = bundle.bundle("complexmcp")
        steps = json.loads(files["tasks/mint-100g.json"])
        self.assertEqual([s["type"] for s in steps], [
            "deploy_env", "deploy_agent", "prompt_agent",
            "env_outcome_verifier", "reset_env"
        ])
        self.assertEqual(steps[0]["artifact_id"], "mint-100g")
        self.assertEqual(steps[1]["builtin_tools"], {"disable": "*"})
        self.assertEqual(steps[3]["file_artifact_id"], "grade")
        self.assertEqual(json.loads(files["artifacts/mint-100g/task.json"]),
                         {"task": "complexmcp/mint-100g"})

    def test_eval_lists_every_task(self):
        files = bundle.bundle("complexmcp")
        tasks = sorted(p[len("tasks/"):-len(".json")] for p in files
                       if p.startswith("tasks/"))
        self.assertEqual(len(tasks), 47)
        for task in tasks:
            self.assertIn(f'"{task}"', files["evals/agent.toml"])


if __name__ == "__main__":
    unittest.main()
