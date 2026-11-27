"""The offline HowToCook service and original Toolathlon evaluators."""

import asyncio
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from ._mcpatlas_services import stdio_service, tool_cli
from ._npm import install_locked

HERE = Path(__file__).parent
MANIFESTS = {
    "cooking-guidance":
    "1d8ef553917e97e0c70e2f356a243401d99b031cb2ea87a99466e88b2d5a569e",
    "dietary-health":
    "fc30d555ae08739bb8d4f61382e5c9d0bd68fd6f889df8e0eb763227753903bc",
}
PREFIX = "mcp_howtocook_"
TOOLS = tuple(PREFIX + name
              for name in ("getAllRecipes", "getRecipesByCategory",
                           "recommendMeals", "whatToEat", "getRecipeById"))


def _inputs(task, manifest, prefix):
    bindings = [
        a for a in manifest["source_assets"] if a["target"].startswith(prefix)
    ]

    def read(asset):
        path = task._dataset._source_file(asset)
        return asset["target"].removeprefix(prefix), path.read_bytes()

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(read, bindings))


@asynccontextmanager
async def prepare_howtocook(task, config, run_dir):
    manifest = await asyncio.to_thread(lambda: task.manifest)
    data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    if hashlib.sha256(data).hexdigest() != MANIFESTS[task.id]:
        raise ValueError(f"Unexpected release manifest for {task.id}")
    node, modules = await asyncio.to_thread(install_locked, task._dataset,
                                            HERE / "vendor/howtocook")
    package = modules / "howtocook-mcp"
    initial = await asyncio.to_thread(_inputs, task, manifest,
                                      "upstream/initial_workspace/")
    root = run_dir / "workspace"
    root.mkdir()
    for relative, contents in initial.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)
    dietary = task.id == "dietary-health"
    clis = {
        name: {
            "cli": name,
            "machine": "in_process"
        }
        for name in ("office", "git")
    } if dietary else {}
    spec = {"env": {"HOME": "/workspace", "LC_CTYPE": "C.UTF-8"}, "clis": clis}
    instructions = (
        "Use the howtocook CLI to query the pinned recipe collection. "
        "Your files are in /workspace.")
    async with stdio_service(
        [str(node),
         str(package / "build/index.js"), "--transport", "stdio"], {}, run_dir,
            TOOLS) as (session, tools):
        # The original VFS CLI strips the MCP server's prefix from its command
        # names.
        class Recipes:

            async def call_tool(self, name, arguments):
                return await session.call_tool(PREFIX + name,
                                               arguments=arguments)

        async def install(workspace):
            exposed = {
                name.removeprefix(PREFIX): tool
                for name, tool in tools.items()
            }
            workspace.register_cli(
                "howtocook", tool_cli("howtocook", Recipes(), exposed,
                                      exposed))

        async def recipe_state():
            # This server loads one immutable recipe corpus on startup.
            return {
                "recipes":
                json.loads(await asyncio.to_thread(
                    (package / "all_recipes.json").read_bytes))
            }

        async def evaluate(trial):
            evaluation, truth = await asyncio.gather(
                asyncio.to_thread(_inputs, task, manifest,
                                  "upstream/evaluation/"),
                asyncio.to_thread(_inputs, task, manifest,
                                  "upstream/groundtruth_workspace/"),
            )
            staged = {
                "driver.py": (HERE / "_toolathlon_grader.py").read_bytes(),
                "requirements.json":
                b"[]",
                "trajectory.json":
                json.dumps(
                    trial.trace.agent or {
                        "final_answer":
                        trial.result.final_answer if trial.result else ""
                    }).encode()
            }
            staged.update({
                "code/evaluation/" + k: v
                for k, v in evaluation.items()
            })
            staged.update({"truth/" + k: v for k, v in truth.items()})
            outputs = ("analysis.md", ) if dietary else ("shopping.csv",
                                                         "cuisine.json",
                                                         "ingredients.csv")
            for name in outputs:
                if await trial.is_file("/workspace/" + name):
                    staged["agent/" +
                           name] = await trial.read_file("/workspace/" + name)
            if not dietary:
                # The evaluator occasionally falls back to the recipe server
                # for ingredients.
                # Give its offline transport the same corpus and selection
                # rules as the live tool.
                staged["recipes.json"] = json.dumps(
                    (await
                     trial.service_state("howtocook"))["recipes"]).encode()
                staged["code/utils/mcp/tool_servers.py"] = (
                    HERE / "_recipe_grader_transport.py").read_bytes()
            async with VerifierGuest(config) as verifier:
                result = await verifier.run(staged,
                                            ["python3", "-I", "driver.py"])
            if result.return_code not in (0, 10):
                raise RuntimeError("HowToCook evaluator failed: " +
                                   result.stderr[-2000:])
            return {
                "reward": int(result.return_code == 0),
                "grader": "toolathlon/evaluation/main.py",
                "output": result.stdout[-4000:]
            }

        yield TrialEnvironment(workspace=spec,
                               verifier=SuiteVerifier(evaluate),
                               instructions=instructions,
                               python=dietary,
                               install=install,
                               state_readers={"howtocook": recipe_state})
