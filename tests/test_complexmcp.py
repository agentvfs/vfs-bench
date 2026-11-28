import asyncio
import json
import os
import shlex
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiohttp
from vfsbench import ComplexMCP, TrialConfig, get_server, load_dataset

PORT = Path(__file__).resolve().parents[1] / "vfs-bench-2/datasets/complexmcp"


class ComplexMCPTests(unittest.IsolatedAsyncioTestCase):

    async def test_isolated_service_state_and_yaml(self):
        task = load_dataset("complexmcp")["mark-sean-baker-read"]
        self.assertEqual(len(ComplexMCP()), 47)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workspace.yaml"
             ).write_text("mounts:\n  /scratch: {vfs: ram, mode: write}\n")
            settings = root / "trial.toml"
            settings.write_text('[trial]\nworkspace_yaml = "workspace.yaml"\n')
            config = TrialConfig.from_toml(settings)
            async with (task.start(config=config) as
                        first, task.start(config=config,
                                          instructions_file=True) as second):
                python = await first.exec(
                    "echo hello | python3 -c 'print(stdin.decode().strip())'")
                self.assertEqual(python.stdout.strip(), "hello")
                self.assertEqual(await first.service_state("complexmcp"), await
                                 second.service_state("complexmcp"))
                await first.workspace.vfs.write("/scratch/test", b"one trial")
                self.assertFalse(await
                                 second.workspace.vfs.is_file("/scratch/test"))
                self.assertFalse(
                    await
                    first.workspace.vfs.is_file("/verifier/expected.json"))
                layout = await first.workspace.vfs.read("/VFS.md")
                self.assertFalse(
                    await first.workspace.vfs.exists("/INSTRUCTIONS.md"))
                self.assertEqual(
                    await second.workspace.vfs.read("/INSTRUCTIONS.md"),
                    second.instructions.encode())
                self.assertNotEqual(
                    (await second.exec("echo changed > /INSTRUCTIONS.md")
                     ).return_code, 0)
                self.assertFalse(await second.workspace.vfs.exists("/logs"))
                for path in ("/vfsbench", "/logs"):
                    self.assertFalse(await first.workspace.vfs.is_dir(path))
                    self.assertNotIn(f"`{path}`".encode(), layout)
                self.assertEqual((await second.verify()).reward, 0)
                command = "light-talk get-uid-from-name"
                help_text = await first.exec(f"{command} --help")
                self.assertIn("JSON arguments (schema)", help_text.stdout)
                returns = "On success, output is the UID string"
                self.assertIn(returns, help_text.stdout)
                self.assertIn(returns, first.instructions)
                status_hint = "A command can exit 0"
                self.assertIn(status_hint, first.instructions)
                self.assertIn(status_hint.encode(), await
                              first.workspace.vfs.read("/SKILL.md"))
                bad = await first.exec(f"{command} '[]'")
                self.assertEqual(bad.return_code, 2)
                missing = await first.exec(
                    command + """ '{"name":"absent-contact-for-test"}'""")
                self.assertEqual(missing.return_code, 0, missing.stderr)
                response = json.loads(missing.stdout)
                self.assertNotEqual(response["status"], "ok")
                self.assertTrue(response["output"])
                lookup = await first.exec(command +
                                          """ '{"name":"Sean Baker"}'""")
                self.assertEqual(lookup.return_code, 0, lookup.stderr)
                uid = json.loads(lookup.stdout)["output"]
                result = await first.exec("light-talk mark-as-read " +
                                          shlex.quote(json.dumps({"uid": uid}))
                                          )
                self.assertEqual(result.return_code, 0, result.stderr)
                grade = await first.verify()
                self.assertEqual(grade.reward, 1)
                self.assertEqual(grade.details, {
                    "total": 1,
                    "recall": 1,
                    "misbehave": 0
                })
                self.assertNotEqual(await first.service_state("complexmcp"),
                                    await second.service_state("complexmcp"))

    async def test_server_discovery_clone_and_stop(self):
        task = ComplexMCP()["mark-sean-baker-read"]
        server = await get_server()

        async def cli(*args):
            child = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "vfsbench.cli",
                "server",
                "--endpoint",
                server.endpoint,
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE)
            out, err = await child.communicate()
            self.assertEqual(child.returncode, 0, err.decode())
            return json.loads(out) if out else None

        async with task.start(config=TrialConfig(
                server_url=server.endpoint)) as trial:
            self.assertEqual(trial.server.endpoint, server.endpoint)
            self.assertIn(trial.id, [r["run"] for r in await cli("runs")])
            uid = json.loads(await
                             server.call(trial.id, "light-talk",
                                         "get_uid_from_name",
                                         {"name": "Sean Baker"}))["output"]
            initial = await server.state(trial.id)
            branch = (await cli("clone", trial.id))["run"]
            self.addAsyncCleanup(server.stop, branch)
            args = {"uid": uid, "content": "hello"}
            await server.call(branch, "light-talk", "send_message", args)
            changed = await server.state(branch)
            self.assertNotEqual(changed, initial)
            self.assertEqual(await server.state(trial.id), initial)
            # Replaying the source operation reproduces the timestamp and ID.
            await server.call(trial.id, "light-talk", "send_message", args)
            self.assertEqual(await server.state(trial.id), changed)
            await cli("stop", trial.id)
            with self.assertRaises(KeyError):
                await server.state(trial.id)
        self.assertEqual(await server.state(branch), changed)
        await server.stop(branch)
        self.assertNotIn(branch, [r["run"] for r in await server.list_runs()])

    async def test_controller_shutdown_preserves_active_trials_and_clones(
            self):
        # This test shuts down its own controller.
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            endpoint = f"http://127.0.0.1:{sock.getsockname()[1]}"
        server = await get_server(endpoint)
        self.addAsyncCleanup(server.shutdown)
        task = ComplexMCP()["mark-sean-baker-read"]
        config = TrialConfig(server_url=endpoint)
        async with task.start(config=config) as first, task.start(
                config=config) as second:
            directory = first.run_dir
            with self.assertRaisesRegex(RuntimeError, "Close active trials"):
                await server.shutdown()
            await first.close()
            self.assertFalse(directory.exists())
            self.assertEqual([r["run"] for r in await server.list_runs()],
                             [second.id])
            lookup = await second.exec(
                """light-talk get-uid-from-name '{"name":"Sean Baker"}'""")
            self.assertEqual(lookup.return_code, 0, lookup.stderr)
            self.assertTrue(json.loads(lookup.stdout)["output"])
            branch = (await server.clone(second.id))["run"]
            self.addAsyncCleanup(server.stop, branch)
        with self.assertRaisesRegex(RuntimeError, "Close active trials"):
            await server.shutdown()
        await server.stop(branch)
        child = await asyncio.create_subprocess_exec(sys.executable, "-m",
                                                     "vfsbench.cli", "server",
                                                     "--endpoint", endpoint,
                                                     "shutdown")
        self.assertEqual(await child.wait(), 0)
        for _ in range(100):
            try:
                await get_server(endpoint, start=False)
            except aiohttp.ClientConnectorError:
                break
            await asyncio.sleep(.02)
        else:
            self.fail("Controller still accepts connections after shutdown")

    async def test_stop_interrupts_worker_and_rejects_waiting_calls(self):
        from aiohttp import web
        from vfsbench._mock_server import Registry

        registry = Registry()
        rid = "a" * 32
        await registry.create(rid, dict(task="test", seed=1, apps=[],
                                        tools={}))
        worker = registry.runs[rid].mock.process
        entered = asyncio.Event()

        async def call():
            async with registry.live(rid):
                entered.set()
                await asyncio.Event().wait()

        active = asyncio.create_task(call())
        await entered.wait()
        waiting = asyncio.create_task(call())
        await asyncio.wait_for(registry.stop(rid), 3)
        with self.assertRaises(web.HTTPGone):
            await active
        with self.assertRaises(web.HTTPNotFound):
            await waiting
        self.assertIsNotNone(worker.returncode)
        self.assertNotIn(rid, registry.runs)

    async def test_trial_close_interrupts_a_blocked_stdio_read(self):
        from aiohttp.test_utils import TestServer
        from vfsbench._mock_server import Registry, application
        from vfsbench.suites import _complexmcp_stdio as stdio

        registry = Registry()
        with (tempfile.TemporaryDirectory() as
              tmp, patch.dict(os.environ, {"VFSBENCH_SERVER_TOKEN": "test"})):
            bundle = Path(tmp) / "worker.mjs"
            bundle.write_text(
                "import {createInterface} from 'node:readline';"
                "const lines = createInterface({input: process.stdin});"
                "for await (const line of lines) {"
                "  if (JSON.parse(line).op === 'call') continue;"
                "  console.log('{\"result\":{}}');"
                "}")
            async with TestServer(application("test", registry)) as controller:
                config = TrialConfig(server_url=str(controller.make_url("/")))
                task = ComplexMCP()["mark-sean-baker-read"]
                with patch.object(stdio, "BUNDLE", bundle):
                    async with task.start(config=config) as trial:
                        run = registry.runs[trial.id]
                        worker = run.mock.process
                        call = asyncio.create_task(
                            trial.exec("light-system now"))
                        async with asyncio.timeout(5):
                            while run.active is None:
                                await asyncio.sleep(.01)
                            await trial.close()
                            await asyncio.gather(call, return_exceptions=True)
                        self.assertIsNotNone(worker.returncode)
                        self.assertNotIn(trial.id, registry.runs)

    async def test_kit_stop_retries_only_failed_deletions(self):
        from aiohttp import web
        from vfsbench._mock_server import Registry
        from vfsbench.suites._complexmcp_kit import KitRun

        endpoints = {
            "light-system": "http://system",
            "light-talk": "http://talk"
        }
        settings = dict(task="task",
                        apps=["LightSystem", "LightTalk"],
                        system_time="2026-01-01T00:00:00Z",
                        tools=endpoints,
                        endpoints=endpoints)
        for partial_startup in (False, True):
            with self.subTest(partial_startup=partial_startup):
                registry = Registry()
                rid = "a" * 32
                post = AsyncMock(side_effect=[{}, {
                    "status": "ok"
                },
                                              RuntimeError("reset failed")
                                              if partial_startup else {}, {
                                                  "status": "ok"
                                              }])
                delete = AsyncMock(
                    side_effect=[OSError("unreachable"), None, None])
                with patch.object(KitRun, "_post",
                                  post), patch.object(KitRun, "_delete",
                                                      delete):
                    with self.assertRaises(ExceptionGroup):
                        await registry.create(rid, settings)
                        await registry.stop(rid)
                    self.assertIn(rid, registry.runs)
                    with self.assertRaises(web.HTTPNotFound):
                        async with registry.live(rid):
                            self.fail("Closing run still accepts calls")
                    await registry.stop(rid)
                    self.assertNotIn(rid, registry.runs)
                    self.assertEqual(
                        [call.args[0] for call in delete.await_args_list],
                        ["http://talk", "http://system", "http://talk"])

    async def test_kit_workspace_api_only_serves_catalog_tools(self):
        from vfsbench.suites._complexmcp_kit import tool_api

        kit = AsyncMock()
        kit.return_value = "5.0"
        catalog = [{"name": "math-server", "tools": [{"name": "add"}]}]
        async with tool_api(kit, catalog) as (invoke, address):
            async with aiohttp.ClientSession() as anonymous:
                async with anonymous.post(f"http://{address}/math-server/add",
                                          json={}) as reply:
                    self.assertEqual(reply.status, 403)
            with self.assertRaisesRegex(RuntimeError, "404"):
                await invoke("math-server", "reset", {})
            args = {"a": 2, "b": 3}
            self.assertEqual(await invoke("math-server", "add", args), "5.0")
            kit.assert_awaited_once_with(service="math-server",
                                         tool="add",
                                         args=args)

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_KIT_ENDPOINTS"),
                         "requires provisioned ComplexMCP Kit endpoints")
    async def test_kit_matches_stdio_and_releases_run(self):
        endpoints = json.loads(
            Path(os.environ["VFSBENCH_TEST_KIT_ENDPOINTS"]).read_bytes())
        config = TrialConfig(
            suite_options={"complexmcp_kit_endpoints": endpoints})
        task = ComplexMCP()["mark-sean-baker-read"]
        async with task.start(config=config) as trial, task.start() as stdio:
            state = await stdio.service_state("complexmcp")
            self.assertEqual(await trial.service_state("complexmcp"), state)
            kit = await trial.service_state("complexmcp_kit")
            self.assertEqual(set(kit["services"]),
                             {"light-talk", "light-system", "light-shop"})
            add = """math-server add '{"a":2,"b":3}'"""
            result = await trial.exec(add)
            self.assertEqual(result.return_code, 0, result.stderr)
            self.assertEqual(result.stdout, (await stdio.exec(add)).stdout)
            kit = await trial.service_state("complexmcp_kit")
            self.assertIn("math-server", kit["services"])
            server = trial.server
            branch = (await server.clone(trial.id))["run"]
            self.addAsyncCleanup(server.stop, branch)
            lookup = await trial.exec(
                """light-talk get-uid-from-name '{"name":"Sean Baker"}'""")
            self.assertEqual(lookup.return_code, 0, lookup.stderr)
            uid = json.loads(lookup.stdout)["output"]
            await trial.exec("light-talk mark-as-read " +
                             shlex.quote(json.dumps({"uid": uid})))
            self.assertEqual((await trial.verify()).reward, 1)
            self.assertEqual((await stdio.verify()).reward, 0)
            self.assertEqual(await server.state(branch), state)
        self.assertEqual(await server.state(branch), state)
        await server.stop(branch)
        async with aiohttp.ClientSession() as client:
            for base in kit["services"].values():
                async with client.get(
                        f"{base}/_kit/runs/{kit['run']}/snapshot") as reply:
                    self.assertEqual(reply.status, 404)

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_SNAPSHOT"),
                         "requires microsandbox")
    async def test_legacy_release_cpython_reference_trajectories(self):
        current = ComplexMCP()
        # The original release omitted python_runtime and ran CPython.
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        for name in ("index.jsonl", "assets"):
            (root / name).symlink_to(current.root / name)
        for task in current:
            manifest = task.manifest
            del manifest["python_runtime"]
            del manifest["cli_format"]
            path = root / "tasks" / task.id / "manifest.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(manifest))
        suite = ComplexMCP(root)
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        for task in suite:
            with self.subTest(task=task.id):
                async with task.start(config=config) as trial:
                    self.assertEqual((await trial.verify()).reward, 0)
                async with task.start(config=config) as trial:
                    script = (PORT / task.id /
                              "harbor/solution/solve.sh").read_text()
                    result = await trial.exec(script)
                    self.assertEqual(result.return_code, 0, result.stderr)
                    self.assertEqual((await trial.verify()).reward, 1)
