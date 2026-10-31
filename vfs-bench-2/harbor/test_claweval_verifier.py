"""Claw-Eval source integrity, JSON staging and recorded-judge parity gates."""
import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import yaml
from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from harbor.models.verifier.result import VerifierResult
from vfsbench_harbor import MirageEnvironment, MirageVerifier
from vfsbench_harbor import claweval_verifier as claw
from vfsbench_harbor.environment import HARBOR
from vfsbench_harbor.mirage_verifier import _Staging


class ClawEvalVerifierTests(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = Task(HARBOR / "tasks/claweval/T001zh_email_triage")
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
                                       environment=self.env,
                                       override_env={
                                           "OPENAI_API_KEY": "test",
                                           "OPENAI_BASE_URL":
                                           "http://judge.test/v1",
                                           "JUDGE_MODEL": "fixture"
                                       })

    def test_oracle_config_contains_every_packaged_solution(self):
        config = yaml.safe_load((HARBOR / "claweval-oracle.yaml").read_text())
        configured = {Path(item["path"]).name for item in config["tasks"]}
        available = {
            p.parent.parent.name
            for p in (HARBOR / "tasks/claweval").glob("*/solution/solve.sh")
        }
        self.assertEqual(configured, available)
        self.assertEqual(len(config["tasks"]), len(available))
        self.assertLessEqual(configured, claw.definitions().keys())
        self.assertEqual(config["verifier"]["import_path"],
                         "vfsbench_harbor:MirageVerifier")

    async def test_stages_pinned_code_and_private_json_without_sqlite(self):
        if not claw.UPSTREAM.exists():
            self.skipTest("Run claweval/setup.py first")
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
                claw.definitions()[self.task.name], stage)
        self.assertEqual(frozen["states"], {})
        self.assertNotIn("/input/recording.json", frozen["files"])
        self.assertFalse(
            any(
                p.startswith(("/logs/verifier", "/output"))
                for p in frozen["files"]))
        self.assertEqual(
            Path(frozen["files"]["/input/trajectory.json"]).read_text(),
            '{"steps": []}')
        self.assertIn("/reference/tasks/T001zh_email_triage/grader.py",
                      frozen["files"])
        self.env.snapshot_verifier_states.assert_awaited_once()

    def test_changed_or_escaped_upstream_source_fails_closed(self):
        source = self.root / "grader.py"
        source.write_text("changed")
        with patch.object(claw, "UPSTREAM", self.root):
            with self.assertRaisesRegex(ValueError, "reference changed"):
                claw.source_bytes({"sources": {
                    "grader.py": "wrong"
                }}, _Staging(5))
            source.unlink()
            source.symlink_to(HARBOR / "claweval_grade.py")
            with self.assertRaisesRegex(ValueError, "leaves its checkout"):
                claw.source_bytes({"sources": {
                    "grader.py": "wrong"
                }}, _Staging(5))

    async def test_grading_uses_existing_http_server_without_a_subprocess(
            self):
        request = self.root / "request.json"
        request.write_text(
            json.dumps({
                "runtime": "claweval-pyodide",
                "states": {},
                "files": {}
            }))
        expected = {"score": 0.5, "timings": {"execution": "trial-daemon"}}
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200,
                                  text=json.dumps({
                                      "type": "result",
                                      "value": expected
                                  }) + "\n")

        self.env._client = httpx.AsyncClient(
            base_url="http://trial.test",
            transport=httpx.MockTransport(respond))
        self.addAsyncCleanup(self.env._client.aclose)
        with patch("asyncio.create_subprocess_exec",
                   side_effect=AssertionError("spawned verifier process")):
            self.assertEqual(await self.verifier._run("node", request),
                             expected)
        self.assertEqual(requests[0].url.path, "/v1/harbor/claweval/verify")
        self.assertEqual(requests[0].headers["authorization"],
                         f"Bearer {self.env._verifier_token}")
        self.assertEqual(requests[0].headers["accept"], "application/x-ndjson")
        self.assertNotIn(self.env._verifier_token.encode(),
                         requests[0].content)
        self.env._daemon_url = "http://unmanaged.test"
        with self.assertRaisesRegex(ValueError, "managed trial server"):
            await self.env.verify_claweval(b"{}", self.verifier._claw_artifact)

    async def test_recordings_survive_error_disconnect_and_timeout(self):
        recording = [{
            "request": {
                "model": "fixture"
            },
            "response": {
                "choices": []
            }
        }]
        path = self.paths.verifier_dir / "judge-recording.json"
        inputs = self.paths.verifier_dir / "claweval-inputs.json"
        verifier = self.verifier
        request = self.root / "request.json"
        request.write_text(
            json.dumps({
                "runtime": "claweval-pyodide",
                "states": {},
                "files": {}
            }))
        for outcome in ("error", "disconnect", "timeout"):
            with self.subTest(outcome=outcome):
                path.unlink(missing_ok=True)
                inputs.unlink(missing_ok=True)

                class Stream(httpx.AsyncByteStream):

                    async def __aiter__(stream):
                        for name, value in [("claweval-inputs.json", {}),
                                            ("judge-recording.json", recording)
                                            ]:
                            yield (json.dumps({
                                "type": "artifact",
                                "name": name,
                                "value": value
                            }) + "\n").encode()
                        # Artifacts reach disk before the HTTP request ends.
                        self.assertEqual(json.loads(path.read_text()),
                                         recording)
                        if outcome == "timeout":
                            await asyncio.sleep(60)
                        elif outcome == "error":
                            yield (b'{"type":"error",'
                                   b'"detail":"parsing failed"}\n')

                async with httpx.AsyncClient(
                        base_url="http://trial.test",
                        transport=httpx.MockTransport(
                            lambda req: httpx.Response(200, stream=Stream()
                                                       ))) as client:
                    self.env._client = client
                    with self.assertRaises((RuntimeError, TimeoutError)):
                        async with asyncio.timeout(0.1):
                            await verifier._run("node", request)
                self.assertEqual(json.loads(path.read_text()), recording)
                self.assertTrue(inputs.exists())
                self.assertFalse(self.paths.reward_json_path.exists())

    def test_incremental_recordings_honor_log_filters(self):
        self.verifier.exclude_logs = ["judge-recording.json"]
        self.verifier._claw_artifact("judge-recording.json", [])
        self.assertFalse(
            (self.paths.verifier_dir / "judge-recording.json").exists())
        with self.assertRaises(ValueError):
            self.verifier._claw_artifact("../reward.json", {})

    def test_reference_records_calls_before_grading_or_transport_failure(self):
        if not claw.UPSTREAM.exists():
            self.skipTest("Run claweval/setup.py first")
        spec = importlib.util.spec_from_file_location(
            "recording_reference", HARBOR / "claweval_grade.py")
        reference = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reference)
        with patch.object(sys, "path",
                          [str(claw.UPSTREAM / "src"), *sys.path]):
            from claw_eval.graders import llm_judge, registry
        output = self.paths.verifier_dir / "judge-recording.json"
        raw = {"choices": [{"message": {"content": "recorded"}}]}
        for broken in (False, True):
            with self.subTest(transport_error=broken):

                class Client:

                    def __init__(client, **kwargs):
                        client.chat = client.completions = client

                    def create(client, **request):
                        pending = json.loads(output.read_text())
                        self.assertEqual(pending[0]["request"], request)
                        self.assertIn("error", pending[0])
                        if broken:
                            raise RuntimeError("private transport detail")
                        return SimpleNamespace(model_dump=lambda **kw: raw)

                class Grader:

                    def grade(grader, messages, dispatches, task, **kwargs):
                        kwargs["judge"].client.chat.completions.create(
                            model="fixture", messages=[])
                        raise RuntimeError("grade failed after model call")

                with (patch.multiple(reference,
                                     CLAWEVAL=claw.UPSTREAM,
                                     VERIFIER=self.paths.verifier_dir,
                                     messages=lambda prompt: [],
                                     dispatches=lambda: [],
                                     audit=lambda task: {},
                                     gws_trace=lambda task, audit: []),
                      patch.object(llm_judge, "OpenAI", Client),
                      patch.object(registry,
                                   "get_grader",
                                   return_value=Grader()),
                      patch.dict(
                          os.environ, {
                              "OPENAI_API_KEY": "private-test-key",
                              "JUDGE_MODEL": "fixture"
                          }),
                      patch.object(
                          sys, "argv",
                          ["grade.py", "T085_officeqa_army_expenditures"]),
                      self.assertRaises(RuntimeError)):
                    reference.main()
                saved = json.loads(output.read_text())
                self.assertEqual(len(saved), 1)
                if broken:
                    self.assertEqual(saved[0]["error"]["message"],
                                     "Judge transport failed")
                else:
                    self.assertEqual(saved[0]["response"], raw)
                    self.assertNotIn("error", saved[0])
                self.assertNotIn("private", output.read_text())
                self.assertFalse(self.paths.reward_json_path.exists())




if __name__ == "__main__":
    unittest.main()
