"""The mirage sandbox provider, the env's server, and the bundles bundle.py
writes.

oracle.py runs the tasks themselves.
"""
import asyncio
import base64
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from datetime import datetime
from importlib.metadata import entry_points
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import httpx
from agent_env.providers import build_sandbox_provider
from agentenv_protocol import DataPart, FilePart
from agentenv_protocol.computer.card import COMPUTER_EXEC
from agentenv_protocol.types import FileWithBytes, FileWithUri
from mirage.config import WorkspaceConfig
from mirage.workspace.workspace import Workspace as Mirage
from vfsbench_agentenv import fakes, sandbox, tools
from vfsbench_agentenv.sandbox import MirageSandboxProvider, task_of
from vfsbench_agentenv.server import (GRADE, REWARD, ROOT, WORKSPACE_EXTENSION,
                                      Workspace, _free_port, _request, run_id)

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
            workspace = next(e for e in capabilities["extensions"]
                             if e["uri"] == WORKSPACE_EXTENSION)
            self.assertEqual(
                {
                    op: m["method"]
                    for op, m in workspace["params"]["methods"].items()
                }, {
                    "snapshot": "GET",
                    "load": "POST"
                })
            self.assertIn("data/get", capabilities["operations"])
            # It exits when its stdin closes.
            server.stdin.close()
            self.assertIsNotNone(server.wait(30))
        finally:
            server.kill()

    def test_a_failed_run_ends_the_others_first(self):
        entered, ended, dropped = [], [], []

        async def start(self,
                        fake,
                        run,
                        fixture,
                        epoch,
                        faults=None,
                        extras=None):
            # The news run fails once every other has started; the math
            # run has opened by then, and the rest are still opening.
            if fake == "complexmcp_news":
                while len(entered) < 14:
                    await asyncio.sleep(0.01)
                raise ValueError("no fixture")
            entered.append(fake)
            if fake == "complexmcp_math":
                return fakes.Run(fake, run, Path(), "")
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                ended.append(fake)
                raise

        async def drop(self, run):
            dropped.append(run.service)

        with (mock.patch.object(fakes.SharedFakes, "fake",
                                lambda self, service, fixture: service),
              mock.patch.object(fakes.SharedFakes, "open", start),
              mock.patch.object(fakes.SharedFakes, "drop", drop)):
            with self.assertRaisesRegex(ValueError, "no fixture"):
                asyncio.run(
                    asyncio.wait_for(
                        fakes.open_task("complexmcp/mint-100g", "t"), 5))
        # Every other run ended before open_task raised, and the one that
        # opened was dropped.
        self.assertEqual(len(ended), 13)
        self.assertEqual(dropped, ["complexmcp_math"])

    def test_failed_deletion_is_retried_on_stop(self):

        async def check():
            pool = fakes.pool()
            fake = mock.Mock(url="http://fake")
            fake.process.poll.return_value = None
            run = fakes.Run("service", "run", Path(), "")
            process = mock.Mock(returncode=0)
            statuses = iter([503, 404])

            async def delete(request):
                self.assertEqual(request.method, "DELETE")
                return httpx.Response(next(statuses))

            key = "mirage-123-1234"
            clients = [
                httpx.AsyncClient(transport=httpx.MockTransport(delete))
                for _ in range(2)
            ]
            with (mock.patch.dict(pool._fakes, service=fake),
                  mock.patch.dict(sandbox._SERVERS, {key: process}),
                  mock.patch.dict(sandbox._RUNS, {key: [run]}),
                  mock.patch.object(fakes, "_send"),
                  mock.patch.object(httpx, "AsyncClient",
                                    side_effect=clients)):
                with self.assertRaises(ExceptionGroup) as caught:
                    await sandbox._stop(key)
                self.assertIsInstance(caught.exception.exceptions[0],
                                      httpx.HTTPStatusError)
                self.assertEqual(sandbox._RUNS[key], [run])
                await sandbox._stop(key)
                self.assertNotIn(key, sandbox._RUNS)
                self.assertNotIn(key, sandbox._SERVERS)

        asyncio.run(check())

    def test_a_workspace_takes_its_task_s_fakes(self):
        workspace = Workspace("complexmcp/mint-100g")
        try:
            with self.assertRaisesRegex(ValueError, "runs on the fakes"):
                asyncio.run(workspace.open({"complexmcp_math": {}}))
        finally:
            shutil.rmtree(workspace.run, ignore_errors=True)

    def test_a_load_takes_its_own_task_s_snapshot(self):
        workspace = Workspace("complexmcp/mint-100g")
        with self.assertRaisesRegex(ValueError,
                                    "a snapshot of complexmcp/other"):
            asyncio.run(workspace.load({"task": "complexmcp/other"}))
        self.assertFalse(workspace.run.exists())

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
                self.assertEqual(_request(parts), task)
        with self.assertRaisesRegex(ValueError, "no task"):
            _request([])

    def test_no_harbor(self):
        for path in (HERE / "src").rglob("*.py"):
            self.assertNotIn("harbor",
                             path.read_text().replace("harbor/", ""), path)


# The tools CLIs of cli.ts in the TypeScript Mirage, each call's reply its
# tool and arguments: [clis, lines] on stdin, each line's [exit code,
# stdout, stderr] out.
TS_TOOLS = """
import { readFileSync } from 'node:fs'
import { MountMode } from '@struktoai/mirage-core/types'
import { RAMVFS } from '@struktoai/mirage-core/vfs/ram/ram'
import { Workspace }
  from '@struktoai/mirage-core/workspace/workspace/workspace'
const { specName, toolsCli } =
  await import(`${process.cwd()}/workspace/cli.ts`)
const [clis, lines] = JSON.parse(readFileSync(0, 'utf8'))
const send = async (tool, args) =>
  tool.name === 'fail' ? { ok: false, error: 'it failed' }
                       : { ok: true, result: { tool: tool.name, args } }
const ws = new Workspace({ '/': [new RAMVFS(), MountMode.WRITE] })
for (const cli of clis) {
  const spec = toolsCli(specName(cli), cli.tools, cli.description, send)
  ws.registerCli(cli.name, spec, { url: 'http://svc' })
}
await ws.skillMd('/SKILL.md')
const out = []
for (const line of lines) {
  const r = await ws.shell(line)
  out.push([r.exitCode, r.stdoutText, r.stderrText])
}
console.log(JSON.stringify(out))
await ws.close()
"""

# Every kind of parameter cli.ts maps to a flag.
KINDS = [{
    "name":
    "svc",
    "description":
    "A service.",
    "tools": [{
        "name": "make",
        "description": "Make one.",
        "parameters": {
            "type": "object",
            "properties": {
                "count": {
                    "type": "integer",
                    "description": "How many."
                },
                "ratio": {
                    "type": "number"
                },
                "kind": {
                    "type": "string",
                    "enum": ["a", "b"]
                },
                "tags": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    }
                },
                "ids": {
                    "type": "array",
                    "items": {
                        "type": "integer"
                    }
                },
                "on": {
                    "type": "boolean"
                },
                "force": {
                    "type": "boolean",
                    "x-flag": True
                },
                "meta": {
                    "type": "object",
                    "properties": {
                        "x": {
                            "type": "number"
                        }
                    },
                    "required": ["x"]
                },
                "note": {
                    "anyOf": [{
                        "type": "string"
                    }, {
                        "type": "null"
                    }],
                    "default": None
                },
            },
            "required": ["count", "kind", "note"]
        }
    }, {
        "name": "items.list_all",
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer"
                },
                "size": {
                    "type": "number",
                    "enum": [10, 2.5]
                }
            },
            "required": ["page"]
        },
        "strict": False
    }, {
        "name": "fail"
    }]
}]
KIND_LINES = [
    "svc --help", "svc make --help", "svc items --help",
    "svc items list-all --help", "svc make --count 3 --kind a --ratio 2.0 "
    "--tags x --tags y --ids 1 --ids 20 --on true --force "
    "--meta '{\"x\": 1.0, \"2\": [], \"1\": 1e-7}'",
    "svc make --count 3 --kind c", "svc make --kind a",
    "svc make --count 1 --kind a --ids '[1, 2.50]'",
    "svc make --count 1 --kind a --meta nope", "svc items list-all --page x",
    "svc items list-all --page 7 --size 1e3", "svc fail", "cat /SKILL.md"
]


def _python_tools(clis: list, lines: list) -> list:
    """The lines on tools.py's CLIs, as TS_TOOLS runs them."""

    async def send(tool, args, config):
        if tool["name"] == "fail":
            return False, "it failed"
        return True, {"tool": tool["name"], "args": args}

    async def run():
        ws = Mirage(**WorkspaceConfig.model_validate({
            "mounts": {
                "/": {
                    "vfs": "ram",
                    "mode": "write"
                }
            }
        }).to_workspace_kwargs())
        try:
            for cli in clis:
                ws.register_cli(
                    cli["name"],
                    tools.tools_cli(tools.spec_name(cli), cli["tools"],
                                    cli.get("description")),
                    {"url": "http://svc"})
            await ws.skill_md("/SKILL.md")
            out = []
            for line in lines:
                io = await ws.shell(line)
                stdout, stderr = await io.stdout_str(), await io.stderr_str()
                out.append([io.exit_code, stdout, stderr])
            return out
        finally:
            await ws.close()

    with mock.patch.object(tools, "send", send):
        return asyncio.run(run())


class ToolsTest(unittest.TestCase):
    """tools.py against cli.ts: what the agent sees of a task's tools is
    the same on either Mirage."""

    def _same(self, clis: list, lines: list):
        ts = subprocess.run(
            ["node", "--no-warnings", "--input-type=module", "-e", TS_TOOLS],
            input=json.dumps([clis, lines]),
            capture_output=True,
            text=True,
            cwd=ROOT,
            check=True)
        expected = json.loads(ts.stdout)
        for line, want, got in zip(lines, expected, _python_tools(clis,
                                                                  lines)):
            self.assertEqual(got, want, line)

    def test_every_kind_of_parameter(self):
        self._same(KINDS, KIND_LINES)

    def test_complexmcp_tools(self):
        clis = json.loads(
            (bundle.DATASETS / "complexmcp" /
             "unblock-relatives/workspace/tools.json").read_text())
        lines = ["cat /SKILL.md"] + [
            f"{cli['name']} {' '.join(tools.command_path(t['name']))} --help"
            for cli in clis for t in cli["tools"]
        ]
        self._same(clis, lines)

    def test_spec_names(self):
        clis = [
            cli for path in sorted(
                bundle.DATASETS.glob("*/*/workspace/tools.json"))
            for cli in json.loads(path.read_text())
        ]
        ts = subprocess.run([
            "node", "--no-warnings", "--input-type=module", "-e",
            "import { readFileSync } from 'node:fs'\n"
            "const { specName } = await import('./workspace/cli.ts')\n"
            "const clis = JSON.parse(readFileSync(0, 'utf8'))\n"
            "console.log(JSON.stringify(clis.map(specName)))"
        ],
                            input=json.dumps(clis),
                            capture_output=True,
                            text=True,
                            cwd=ROOT,
                            check=True)
        self.assertEqual([tools.spec_name(c) for c in clis],
                         json.loads(ts.stdout))


class SnapshotTest(unittest.TestCase):
    """A task's environment snapshotted, loaded back and loaded into a
    clone, on the shared fakes."""

    TASK = "complexmcp/mint-100g"
    CART = "light-shop get-cart-summary"

    def test_a_load_and_a_clone(self):
        asyncio.run(self._load_and_clone())

    async def _open(self) -> tuple[Workspace, list]:
        own = run_id(self.TASK)
        runs = await fakes.open_task(self.TASK, own)
        workspace = Workspace(self.TASK, own)
        try:
            await workspace.open(fakes.views(self.TASK, runs))
        except BaseException:
            await workspace.close()
            await fakes.close_task(runs)
            raise
        return workspace, runs

    async def _line(self, workspace: Workspace, line: str) -> str:
        done = await workspace.shell(line)
        self.assertEqual(done["exit_code"], 0, f"{line}: {done['stderr']}")
        return done["stdout"]

    def _dispatches(self, workspace: Workspace) -> list[dict]:
        return [
            json.loads(line)
            for line in Path(workspace.dispatches).read_text().splitlines()
        ]

    async def _is_taken(self, workspace: Workspace, cart: str) -> None:
        """The workspace is as the snapshot took it."""
        self.assertEqual(await self._line(workspace, "pwd; echo $KEPT"),
                         "/tmp\n1\n")
        self.assertEqual(
            await self._line(workspace, "cat /workspace/kept.txt"), "before\n")
        made = await workspace.shell("ls /workspace/made.txt")
        self.assertNotEqual(made["exit_code"], 0)
        self.assertEqual(len(self._dispatches(workspace)), 2)
        self.assertEqual(await self._line(workspace, self.CART), cart)
        calls = self._dispatches(workspace)
        self.assertEqual([c["tool_use_id"] for c in calls],
                         ["call_1", "call_2", "call_3"])
        # The clock goes on from the snapshot's time.
        seconds = (_stamp(calls[2]) - _stamp(calls[1])).total_seconds()
        self.assertTrue(0 <= seconds < 60, seconds)

    async def _load_and_clone(self) -> None:
        workspace, runs = await self._open()
        clone, clone_runs = None, []
        try:
            await self._line(
                workspace, "cd /tmp && export KEPT=1 && "
                "echo before > /workspace/kept.txt && "
                "light-shop delete-item-in-cart "
                "--caid cart_A75LCUeJ8mPfp5avEwhbym")
            cart = await self._line(workspace, self.CART)
            taken = await workspace.snapshot()
            self.assertEqual(sorted(taken["fakes"]), sorted(workspace.fakes))
            await self._line(
                workspace, "echo after > /workspace/made.txt && "
                "rm /workspace/kept.txt && cd / && export KEPT=2 && "
                "light-shop delete-item-in-cart "
                "--caid cart_X7M5Px84kFZatHvqMLJdcw")
            changed_cart = await self._line(workspace, self.CART)
            self.assertNotEqual(changed_cart, cart)

            changed = await workspace.snapshot()
            # Have one fake reject its load after its peers have started.
            # The other fakes must have their changes rolled back.
            runs_to_load = dict(taken["fakes"])
            runs_to_load["complexmcp_math"] = dict(
                runs_to_load["complexmcp_math"], schema="wrong")
            invalid = dict(taken, fakes=runs_to_load)
            with self.assertRaises(ExceptionGroup):
                await workspace.load(invalid)
            restored = await workspace.snapshot()
            for service, before in changed["fakes"].items():
                self.assertEqual(restored["fakes"][service]["tenants"],
                                 before["tenants"], service)
            # Fail once after the workspace has already been replaced.
            documents = workspace._documents

            async def fail_once():
                workspace._documents = documents
                raise ValueError("document restore failed")

            with mock.patch.object(workspace, "_documents", fail_once):
                with self.assertRaisesRegex(ValueError, "document restore"):
                    await workspace.load(taken)
            self.assertEqual(
                await self._line(workspace, "cat /workspace/made.txt"),
                "after\n")
            self.assertEqual(await self._line(workspace, "pwd; echo $KEPT"),
                             "/\n2\n")
            self.assertEqual(len(self._dispatches(workspace)),
                             changed["calls"])
            self.assertEqual(await self._line(workspace, self.CART),
                             changed_cart)

            await workspace.load(taken)
            await self._is_taken(workspace, cart)

            clone, clone_runs = await self._open()
            await clone.load(taken)
            await self._is_taken(clone, cart)
            await self._line(
                clone, "light-shop delete-item-in-cart "
                "--caid cart_X7M5Px84kFZatHvqMLJdcw")
            self.assertNotEqual(await self._line(clone, self.CART), cart)
            self.assertEqual(await self._line(workspace, self.CART), cart,
                             "a clone's runs are its own")

            # A canceled call may reserve an ID without writing a line.
            tools.CALLS[clone.dispatches] = 9
            gap = await clone.snapshot()
            await clone.load(gap)
            await self._line(clone, self.CART)
            self.assertEqual(
                self._dispatches(clone)[-1]["tool_use_id"], "call_10")
            legacy = await clone.snapshot()
            del legacy["calls"]
            await clone.load(legacy)
            await self._line(clone, self.CART)
            self.assertEqual(
                self._dispatches(clone)[-1]["tool_use_id"], "call_11")

            other = dict(taken, task="complexmcp/apple-watch-delete-history")
            with self.assertRaisesRegex(ValueError, "a snapshot of"):
                await workspace.load(other)
        finally:
            for opened, opened_runs in ((workspace, runs), (clone,
                                                            clone_runs)):
                if opened is not None:
                    await opened.close()
                    await fakes.close_task(opened_runs)
                    shutil.rmtree(opened.run, ignore_errors=True)


def _stamp(dispatch: dict) -> datetime:
    return datetime.fromisoformat(dispatch["timestamp"].replace("Z", "+00:00"))


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

    def test_refuses_datasets_it_does_not_grade(self):
        for dataset in ("complexmcp-typo", "dataspace"):
            with self.assertRaisesRegex(ValueError, "isn't graded here"):
                bundle.bundle(dataset)
        with self.assertRaisesRegex(ValueError, "isn't graded here"):
            Workspace("dataspace/some-task")

    def test_eval_lists_every_task(self):
        files = bundle.bundle("complexmcp")
        tasks = sorted(p[len("tasks/"):-len(".json")] for p in files
                       if p.startswith("tasks/"))
        self.assertEqual(len(tasks), 47)
        for task in tasks:
            self.assertIn(f'"{task}"', files["evals/agent.toml"])


if __name__ == "__main__":
    unittest.main()
