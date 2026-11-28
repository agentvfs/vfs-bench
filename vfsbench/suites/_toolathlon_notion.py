import asyncio
import hashlib
import json
import re
import secrets
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from aiohttp import web
from vfsbench.runtime import TrialEnvironment, VerifierGuest
from vfsbench.verifier import SuiteVerifier

from ..cli.tools import tool_cli
from ._mcpatlas_services import stdio_service
from ._toolathlon_documents import document_tools
from ._woocommerce_store import docker

VENDOR = Path(__file__).parent / "vendor/notion"
MANIFESTS = {
    "notion-personal-website":
    "72db9583440cff8ae3a57382ce0cdf4f66db93f04bcc392fe0abcbe2d7333346"
}
UPSTREAM = ("https://raw.githubusercontent.com/hkust-nlp/Toolathlon/"
            "9be8d8fe07a497b18ee61e3f2ae694e9797f39eb/")
SOURCES = {
    "spec":
    ("configs/notion-mcp-patches/notion-openapi.json", 94175,
     "08f2e76e00440854b830bf6344bf713c6c8962d061ed5305c3f13f3a2f28d4f5"),
    "ops":
    ("utils/app_specific/notion/ops.py", 14203,
     "19b43050265b283432d760ac3657aea93e5c8c262a0ef99cddbc25810d66d516"),
}


def source(task, name):
    path, size, digest = SOURCES[name]
    return task._dataset._source_file({
        "url":
        UPSTREAM + path,
        "path":
        "vfs-bench-1/submodule/Toolathlon/" + path,
        "size":
        size,
        "sha256":
        digest,
    })


async def image(offline=False):
    inputs = ("Dockerfile", "bridge.mjs", "mirage.tar.gz", "package-lock.json",
              "package.json", "start.mts")
    content = b"".join((VENDOR / item).read_bytes() for item in inputs)
    name = "vfsbench/notion:" + hashlib.sha256(content).hexdigest()[:24]
    code, _ = await docker("image", "inspect", name, check=False)
    if code:
        if offline:
            raise FileNotFoundError("Notion image unavailable offline: " +
                                    name)
        await docker("build", "--tag", name, str(VENDOR))
    return name


class NotionStore:

    def __init__(self, container, token):
        self.container = container
        self.token = token

    async def request(self, method, path, body=None, version="2022-06-28"):
        payload = {
            "method": method,
            "path": path,
            "body": body,
            "version": version
        }
        _, data = await docker("exec",
                               "-i",
                               self.container,
                               "node",
                               "/srv/bridge.mjs",
                               stdin=json.dumps(payload).encode())
        return json.loads(data)

    async def proxy(self, request):
        if not secrets.compare_digest(request.headers.get("Authorization", ""),
                                      "Bearer " + self.token):
            raise web.HTTPUnauthorized()
        data = await request.read()
        reply = await self.request(
            request.method, request.raw_path,
            data.decode() if data else None,
            request.headers.get("Notion-Version", "2022-06-28"))
        return web.Response(text=reply["body"],
                            status=reply["status"],
                            content_type="application/json")

    async def page_state(self, page_id):
        """Freeze the page and every page of its child list, including the
        raw grader responses."""
        path = "/v1/pages/" + page_id
        page = await self.request("GET", path)
        responses = {path: page}
        blocks = []
        cursor = None
        while True:
            path = f"/v1/blocks/{page_id}/children?page_size=100"
            if cursor:
                path += "&start_cursor=" + quote(cursor, safe="")
            if path in responses:
                raise RuntimeError(
                    "Notion returned a repeated pagination cursor")
            response = await self.request("GET", path)
            responses[path] = response
            data = json.loads(response["body"])
            blocks.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            cursor = data["next_cursor"]
        return {
            "page_id": page_id,
            "page": json.loads(page["body"]),
            "blocks": blocks,
            "responses": responses
        }


@asynccontextmanager
async def serve(task, run_dir, rows, token, page_id, spec, verbs):
    """Bind the original private REST and MCP servers to one captured task
    tenant."""
    name = "vfsbench-notion-" + uuid4().hex
    tag = await image(task._dataset._local_files_only)
    store = NotionStore(name, token)
    staged = []
    for key, original in (("rows", rows), ("spec", spec)):
        destination = run_dir / f"notion-{key}.json"
        destination.write_bytes(original.read_bytes())
        destination.chmod(0o444)
        staged.append(destination)
    rows, spec = staged
    async with AsyncExitStack() as stack:
        stack.push_async_callback(docker,
                                  "rm",
                                  "--force",
                                  "--volumes",
                                  name,
                                  missing_ok=True)
        await docker(
            "run", "--detach", "--name", name, "--network", "none",
            "--read-only", "--tmpfs", "/tmp", "--user", "node", "--cap-drop",
            "ALL", "--security-opt", "no-new-privileges", "--env", "HOME=/tmp",
            "--env", f"NOTION_TENANT={token}", "--mount",
            f"type=bind,src={rows},dst=/fixtures/notion/task.json,readonly",
            "--mount", f"type=bind,src={spec},dst=/srv/node_modules/@notionhq/"
            f"notion-mcp-server/scripts/notion-openapi.json,readonly", tag)
        async with asyncio.timeout(60):
            while True:
                try:
                    reply = await store.request("GET", "/v1/pages/" + page_id)
                except RuntimeError:
                    _, state = await docker("inspect", "--format",
                                            "{{json .State}}", name)
                    status = json.loads(state)
                    if not status["Running"]:
                        raise RuntimeError(
                            f"Notion stopped before serving the fixture "
                            f"(exit {status['ExitCode']})") from None
                    await asyncio.sleep(.2)
                else:
                    if reply["status"] != 200:
                        raise RuntimeError(
                            "Notion did not seed the target page")
                    break
        app = web.Application()
        app.router.add_route("*", "/v1/{path:.*}", store.proxy)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        stack.push_async_callback(runner.cleanup)
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        api = f"http://127.0.0.1:{runner.addresses[0][1]}/v1"
        headers = json.dumps({
            "Authorization": "Bearer " + token,
            "Notion-Version": "2022-06-28"
        })
        command = [
            "docker", "exec", "-i", "-e", "BASE_URL=http://127.0.0.1:5091",
            "-e", "OPENAPI_MCP_HEADERS=" + headers, name, "node",
            "/srv/node_modules/@notionhq/notion-mcp-server/bin/cli.mjs",
            "--page-id", page_id
        ]
        session, tools = await stack.enter_async_context(
            stdio_service(command, {}, run_dir, verbs))
        yield store, api, tool_cli("notion", session, tools, verbs, write=True)


@asynccontextmanager
async def prepare(task, config, run_dir):
    manifest = await asyncio.to_thread(lambda: task.manifest)
    encoded = json.dumps(manifest, sort_keys=True,
                         separators=(",", ":")).encode()
    if hashlib.sha256(encoded).hexdigest() != MANIFESTS[task.id]:
        raise ValueError("Unexpected Toolathlon Notion execution manifest")
    initial = "upstream/initial_workspace/colley_whisson.docx"
    inputs = await asyncio.to_thread(task.files, [
        "shared/notion.json", "shared/notion_rows.json", initial,
        "vfs/SKILL.md", "upstream/evaluation/main.py",
        "upstream/evaluation/check_remote.py"
    ])
    spec, ops = await asyncio.gather(*(asyncio.to_thread(source, task, name)
                                       for name in ("spec", "ops")))
    identity = json.loads(inputs["shared/notion.json"].read_bytes())
    page_id, token = identity["page_id"], identity["workspace"]
    root = run_dir / "workspace"
    root.mkdir()
    (root / Path(initial).name).write_bytes(inputs[initial].read_bytes())
    instructions = inputs["vfs/SKILL.md"].read_text()
    verbs = [
        "API-" + name for name in re.findall(
            r"^\| `notion ([a-z0-9-]+)`", instructions, flags=re.M)
    ]

    async def evaluate(view):
        state = await view.service_state("notion")
        files = {
            "notion.json":
            json.dumps(state["responses"]).encode(),
            "code/utils/app_specific/notion/ops.py":
            ops.read_bytes(),
            "code/files/duplicated_page_id.txt":
            page_id.encode(),
            "code/evaluation/main.py":
            inputs["upstream/evaluation/main.py"].read_bytes(),
            "code/evaluation/check_remote.py":
            inputs["upstream/evaluation/check_remote.py"].read_bytes(),
            "code/configs/token_key_session.py":
            b"from types import SimpleNamespace\nall_token_key_"
            b"session=SimpleNamespace(notion_integration_key='trial')\n",
            "driver.py":
            Path(__file__).with_name("_notion_grader.py").read_bytes(),
            "common.py":
            Path(__file__).with_name("_toolathlon_grader.py").read_bytes(),
            "trajectory.json":
            json.dumps({
                "final_answer":
                view.result.final_answer if view.result else None
            }).encode(),
            "requirements.json":
            b"[]",
        }
        async with VerifierGuest(config) as verifier:
            result = await verifier.run(files, ["python3", "-I", "driver.py"])
        if result.return_code not in {0, 10}:
            raise RuntimeError("Notion verifier failed: " +
                               result.stderr[-1200:])
        return {
            "reward": int(result.return_code == 0),
            "grader": "toolathlon/evaluation/main.py"
        }

    async with serve(task, run_dir, inputs["shared/notion_rows.json"], token,
                     page_id, spec,
                     verbs) as (store, endpoint, notion), document_tools(
                         task, run_dir, root, instructions,
                         ["word"]) as (docs, _):

        async def state():
            return await store.page_state(page_id)

        yield TrialEnvironment(workspace={
            "mounts": {
                "/notion": {
                    "vfs": "notion",
                    "config": {
                        "api_key": token,
                        "base_url": endpoint
                    }
                }
            }
        },
                               verifier=SuiteVerifier(evaluate),
                               clis={
                                   "notion": notion,
                                   "word": docs["word"]
                               },
                               instructions=instructions,
                               state_readers={"notion": state})
