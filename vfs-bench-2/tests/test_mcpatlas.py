"""Atlas release contracts and opt-in tests using the published environment
and scorer."""

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from multidict import MultiDict
from vfsbench.dataset import MCPAtlas
from vfsbench.runtime import TrialConfig
from vfsbench.suites import mcpatlas
from vfsbench.suites._mcpatlas_github import _allowed
from vfsbench.verifier import AgentResult, SuiteVerifier


def suite():
    return MCPAtlas(cache_dir=os.environ.get("VFSBENCH_TEST_ATLAS_CACHE"))


class AtlasTests(unittest.IsolatedAsyncioTestCase):

    def test_execution_manifest_pins_match_all_released_tasks(self):
        expected = json.loads(mcpatlas.MANIFESTS.read_bytes())
        self.assertEqual(set(expected), {task.id for task in suite()})
        for task in suite():
            data = json.dumps(task.manifest,
                              sort_keys=True,
                              separators=(",", ":")).encode()
            self.assertEqual(expected[task.id],
                             hashlib.sha256(data).hexdigest())

    def test_github_routes_respect_both_repository_and_tool(self):
        path = "/repos/lgrammel/storyteller/commits"
        self.assertTrue(
            _allowed(path, {"per_page": "100"}, ["list_commits"], True))
        self.assertFalse(_allowed(path, {}, ["get_commit"], True))
        self.assertFalse(
            _allowed("/repos/user/other/commits", {}, ["list_commits"], True))
        self.assertFalse(
            _allowed("/repos/../../reset", {}, ["get_repository"], False))
        self.assertFalse(_allowed("/reset", {}, [], False))
        self.assertFalse(
            _allowed(
                "/search/issues",
                MultiDict([("q", "repo:lgrammel/storyteller"),
                           ("q", "other")]), ["search_issues"], True))

    def test_requirements_share_the_launch_plan(self):
        task = suite()["serpent-repo-first-pr-branch"]
        self.assertEqual(
            mcpatlas.requirements(task, TrialConfig(snapshot="unused")),
            ("github", ))
        live = TrialConfig(snapshot="unused",
                           suite_options={"atlas_live_github": True})
        self.assertEqual(mcpatlas.requirements(task, live), ())
        local = TrialConfig(snapshot="unused")
        self.assertEqual(
            mcpatlas.requirements(suite()["florida-keys-meal-spending"],
                                  local), ())
        task = suite()["age-group-consumption-boss-email"]
        self.assertEqual(mcpatlas.requirements(task, local), ("notion", ))
        local_provider = TrialConfig(
            snapshot="unused",
            suite_options={"atlas_providers": {
                "notion": ["/opt/notion"]
            }})
        self.assertEqual(mcpatlas.requirements(task, local_provider), ())

    async def test_unavailable_provider_fails_before_docker_or_guest_starts(
            self):
        task = suite()["apartment-117-paris-temperature"]
        with tempfile.TemporaryDirectory() as tmp, patch.object(
                mcpatlas, "_extract_data") as extract:
            with self.assertRaisesRegex(RuntimeError,
                                        "atlas_providers.*notion"):
                async with mcpatlas.prepare(task,
                                            TrialConfig(snapshot="unused"),
                                            Path(tmp)):
                    self.fail("incomplete trial started")
            extract.assert_not_called()

    async def test_missing_judge_credentials_do_not_turn_into_a_zero(self):
        with patch.dict(os.environ, {
                "EVAL_LLM_BASE_URL": "",
                "EVAL_LLM_API_KEY": ""
        }):
            with self.assertRaisesRegex(RuntimeError, "EVAL_LLM_API_KEY"):
                await mcpatlas._grade(None, None, ["a claim"], "an answer")

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_ATLAS_SCORER"),
                         "requires uv and pinned scorer inputs")
    async def test_official_scorer_with_a_local_judge(self):

        async def judge(req):
            payload = await req.json()
            self.assertEqual(payload["model"], mcpatlas.JUDGE)
            self.assertEqual(payload["response_format"]["type"], "json_schema")
            prompt = payload["messages"][0]["content"]
            first = "example claim one" in prompt
            outcome = "fulfilled" if first else (
                "partially_fulfilled"
                if "partial answer" in prompt else "not_fulfilled")
            result = {
                "claim_text":
                "example claim one" if first else "example claim two",
                "coverage_outcome": outcome,
                "justification": "local fixed verdict",
                "confidence_level": 1
            }
            return web.json_response(
                {"choices": [{
                    "message": {
                        "content": json.dumps(result)
                    }
                }]})

        app = web.Application()
        app.router.add_post("/v1/chat/completions", judge)
        runner = web.AppRunner(app)
        await runner.setup()
        self.addAsyncCleanup(runner.cleanup)
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        endpoint = f"http://127.0.0.1:{runner.addresses[0][1]}/v1"
        task = suite()["fantasy-sports-average"]
        with tempfile.TemporaryDirectory() as tmp, patch.dict(
                os.environ, {
                    "EVAL_LLM_BASE_URL": endpoint,
                    "EVAL_LLM_API_KEY": "local-test-only"
                }):
            for answer, coverage, reward in [("partial answer", 0.75, 1),
                                             ("other answer", 0.5, 0)]:
                verdict = await mcpatlas._grade(
                    task, Path(tmp),
                    ["example claim one", "example claim two"], answer)
                self.assertEqual(
                    (verdict["coverage_score"], verdict["reward"]),
                    (coverage, reward))

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_ATLAS_GITHUB"),
                         "requires Docker and benchmark GitHub reads")
    async def test_real_git_and_github_task(self):
        config = TrialConfig(snapshot="unused",
                             suite_options={"atlas_live_github": True})
        async with suite()["serpent-repo-first-pr-branch"].open(
                config=config) as trial:
            commit = await trial.exec(
                "git -C /data/repos/snake-game log -1 --format=%H")
            self.assertEqual(commit.stdout.strip(),
                             "93c5c9a0c9105ef08c3042e6433f2e504998932b")
            branch = await trial.exec(
                "gh api repos/Atamyrat2005/snake-game/pulls -X GET -f "
                "state=all "
                "-f direction=asc --jq '.[0].head.ref'")
            self.assertEqual(branch.return_code, 0, branch.stderr)
            self.assertEqual(branch.stdout.strip(), "Atamyrat2005-1")
            files = await trial.exec(
                "gh api repos/lgrammel/storyteller/commits/"
                "0865ef487b8100848fcab25af80e60bffb4f42da --jq "
                "'.files[].filename'")
            self.assertEqual(files.return_code, 0, files.stderr)
            self.assertEqual(files.stdout.strip(), "README.md")
            trial.record_result(AgentResult(final_answer=""))
            self.assertEqual((await trial.verify()).reward, 0)

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_ATLAS_SNAPSHOT"),
                         "requires Docker and a microsandbox snapshot")
    async def test_offline_calendar_and_scoped_tools(self):
        config = TrialConfig(
            snapshot=os.environ["VFSBENCH_TEST_ATLAS_SNAPSHOT"])
        async with suite()["florida-keys-meal-spending"].open(
                config=config) as trial:
            query = {
                "timeMin": "2025-07-15T04:00:00Z",
                "timeMax": "2025-07-16T04:00:00Z",
                "maxResults": 50
            }
            result = await trial.exec("google-workspace list-events '" +
                                      json.dumps(query) + "'")
            self.assertEqual(result.return_code, 0, result.stderr)
            ids = sorted(row["id"] for row in json.loads(result.stdout))
            self.assertTrue(ids)
            listing = await trial.exec(
                "ls /calendar/primary/2025-07-15 | sed 's/__.*//' | sort")
            self.assertEqual(listing.stdout.splitlines(), ids)
            self.assertEqual(
                (await
                 trial.exec("calculator calculate '{\"expression\":\"2+3\"}'")
                 ).stdout.strip(), "5")
            memory = await trial.exec(
                "memory search-nodes '{\"query\":\"Alice\"}'")
            self.assertIn("Alice Gomez", memory.stdout)
            self.assertNotEqual(
                (await
                 trial.exec("gh api search/repositories -X GET -f q=other")
                 ).return_code, 0)
            trial.record_result(AgentResult())
            self.assertEqual((await trial.verify()).reward, 0)

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_ATLAS_SNAPSHOT"),
                         "requires Docker and a microsandbox snapshot")
    async def test_agent_writes_and_service_state_are_private_to_one_trial(
            self):
        sample = "AtlasIsolationSample"
        graph = "/data/repos/memory_mcp_server/memories-for-mcp.json"
        config = TrialConfig(
            snapshot=os.environ["VFSBENCH_TEST_ATLAS_SNAPSHOT"])
        task = suite()["florida-keys-meal-spending"]
        readings = []

        async def evaluate(view):
            readings.append(await view.service_state("memory"))
            self.assertTrue((await view.service_state("calendar"))["items"])
            return {"reward": 0}

        async with task.open(config=config,
                             verifier=SuiteVerifier(evaluate)) as first:
            row = json.dumps({
                "type": "entity",
                "name": sample,
                "entityType": "example",
                "observations": []
            })
            addition = await first.exec(
                f"""printf '\\n%s\\n' '{row}' >> '{graph}'""")
            self.assertEqual(addition.return_code, 0, addition.stderr)
            await first.verify()
        async with task.open(config=config,
                             verifier=SuiteVerifier(evaluate)) as second:
            await second.verify()
        self.assertIn(sample, {e["name"] for e in readings[0]["entities"]})
        self.assertNotIn(sample, {e["name"] for e in readings[1]["entities"]})

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_ATLAS_SNAPSHOT"),
                         "requires Docker and a microsandbox snapshot")
    async def test_optional_provider_state_is_private_to_the_verifier(self):
        provider = """import json, os
from mcp.server import MCPServer
from pydantic import BaseModel
server = MCPServer("test operator provider")
def visible() -> str:
    return "public response"
for tool in json.loads(os.environ["VFSBENCH_ATLAS_TOOLS"]):
    server.tool(name=tool)(visible)
class PrivateState(BaseModel):
    count: int
@server.tool()
def vfsbench_state() -> PrivateState:
    return PrivateState(count=42)
server.run()
"""

        async def evaluate(view):
            state = await view.service_state("notion")
            self.assertEqual(state, {"count": 42})
            return {"reward": 1}

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "notion.py"
            path.write_text(provider)
            config = TrialConfig(
                snapshot=os.environ["VFSBENCH_TEST_ATLAS_SNAPSHOT"],
                suite_options={
                    "atlas_providers": {
                        "notion": [sys.executable, "-I",
                                   str(path)]
                    }
                })
            task = suite()["age-group-consumption-boss-email"]
            async with task.open(config=config,
                                 verifier=SuiteVerifier(evaluate)) as trial:
                self.assertEqual(
                    (await trial.exec("notion get-users '{}'")).stdout.strip(),
                    "public response")
                self.assertNotIn("vfsbench",
                                 (await trial.exec("notion --help")).stdout)
                for name in ("vfsbench-state", "vfsbench_state"):
                    self.assertNotEqual(
                        (await trial.exec(f"notion {name}")).return_code, 0)
                self.assertEqual((await trial.verify()).reward, 1)
