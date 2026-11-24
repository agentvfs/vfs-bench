"""The mirage sandbox provider, the env's server, and the bundles bundle.py
writes.

oracle.py runs the tasks themselves.
"""
import base64
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from importlib.metadata import entry_points
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import httpx
from agent_env.providers import build_sandbox_provider
from agentenv_protocol import DataPart, FilePart
from agentenv_protocol.computer.card import COMPUTER_EXEC
from agentenv_protocol.types import FileWithBytes, FileWithUri
from vfsbench_agentenv import sandbox
from vfsbench_agentenv.sandbox import MirageSandboxProvider, task_of
from vfsbench_agentenv.server import GRADE, REWARD, _free_port, _task

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("bundle", HERE / "bundle.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def _context(dockerfile: str) -> bytes:
    """A build context tar.gz holding ``dockerfile``."""
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as tar:
        data = dockerfile.encode()
        info = tarfile.TarInfo("./Dockerfile")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return out.getvalue()


class ProviderTest(unittest.TestCase):

    def test_entry_point_names_the_provider(self):
        providers = {
            e.name: e.load()
            for e in entry_points(group="agent_env.sandbox_providers")
        }
        self.assertIs(providers["mirage"], MirageSandboxProvider)
        provider = build_sandbox_provider("mirage")
        self.assertEqual(sorted(provider.SUPPORTED_SANDBOX_MODES),
                         ["container"])

    def test_task_of_a_workspace(self):
        self.assertEqual(
            task_of("datasets/complexmcp/mint-100g/workspace/workspace.yaml"),
            "complexmcp/mint-100g")
        with self.assertRaisesRegex(ValueError, "workspace.yaml"):
            task_of("datasets/complexmcp/mint-100g/harbor/task.toml")

    def test_image_names_its_workspace(self):
        dockerfile = bundle.dockerfile("complexmcp", "mint-100g")
        store = mock.Mock(get=mock.Mock(return_value=_context(dockerfile)))
        config = mock.Mock(get_object_store_at=mock.Mock(return_value=store))
        image = SimpleNamespace(image_name="mint",
                                dockerfile_path=None,
                                build_context_object_url="file:///context")
        with mock.patch.object(sandbox, "get_config", return_value=config):
            self.assertEqual(
                sandbox.workspace_of(image),
                "datasets/complexmcp/mint-100g/workspace/workspace.yaml")


class ServerTest(unittest.TestCase):

    def test_card_serves_shell_and_computer_exec(self):
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
            card = None
            for _ in range(300):
                try:
                    card = httpx.get(f"http://127.0.0.1:{port}"
                                     "/.well-known/agent-env.json").json()
                    break
                except httpx.TransportError:
                    time.sleep(0.1)
            capabilities = card["capabilities"]
            self.assertEqual([t["name"] for t in capabilities["tools"]],
                             ["shell"])
            run = next(e for e in capabilities["extensions"]
                       if e["uri"] == COMPUTER_EXEC)
            self.assertIn("run", run["params"]["methods"])
            self.assertIn("data/get", capabilities["operations"])
            # It exits when its stdin closes.
            server.stdin.close()
            self.assertIsNotNone(server.wait(30))
        finally:
            server.kill()

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

    def test_no_harbor(self):
        for path in (HERE / "src").rglob("*.py"):
            self.assertNotIn("harbor",
                             path.read_text().replace("harbor/", ""), path)


class BundleTest(unittest.TestCase):

    def test_complexmcp_bundle_is_current(self):
        out = bundle.DATASETS / "complexmcp" / "agentenv"
        present = {
            str(p.relative_to(out)): p.read_text()
            for p in out.rglob("*") if p.is_file()
        }
        self.assertEqual(bundle.bundle("complexmcp"), present)

    def test_each_task_runs_on_mirage_and_tests_in_it(self):
        files = bundle.bundle("complexmcp")
        steps = json.loads(files["tasks/mint-100g.json"])
        self.assertEqual([s["type"] for s in steps], [
            "deploy_env", "deploy_agent", "prompt_agent",
            "run_container_unit_tests_verifier"
        ])
        self.assertEqual(steps[0]["sandbox_type"], "mirage")
        self.assertEqual(steps[1]["builtin_tools"], {"disable": "*"})
        self.assertEqual(steps[3]["env_id"], "mint-100g")
        self.assertEqual(steps[3]["command"], GRADE)
        self.assertEqual(steps[3]["reward_path"], REWARD)
        self.assertIn("server", files["envs/mint-100g/env.toml"])

    def test_eval_lists_every_task(self):
        files = bundle.bundle("complexmcp")
        tasks = sorted(p[len("tasks/"):-len(".json")] for p in files
                       if p.startswith("tasks/"))
        self.assertEqual(len(tasks), 47)
        for task in tasks:
            self.assertIn(f'"{task}"', files["evals/agent.toml"])


if __name__ == "__main__":
    unittest.main()
