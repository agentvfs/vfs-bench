import asyncio
import hashlib
import json
import os
import shutil
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from vfsbench.runtime import TrialEnvironment
from vfsbench.verifier import SuiteVerifier

from ..cli.tools import STATE_TOOL, tool_cli
from ._mcpatlas_calendar import calendar
from ._mcpatlas_github import LIVE_TASKS, github_api
from ._mcpatlas_services import (check_snapshot, provider_command,
                                 provider_state, stdio_service)

ATLAS_REV = "f24ba3fb0bfa484c86acb28431fad6d7282455f9"
V1_REV = "3f45f90f620c8096dd85bbe854b757eae1231392"
IMAGE = ('ghcr.io/scaleapi/mcp-atlas@sha256:'
         '24e6ed3534916afe2c6825382da159a30e23516ef612be5d074fd96a74f9184c')
JUDGE = "google/gemini-3.1-pro-preview"
PASS = 0.75

MANIFESTS = Path(__file__).with_name("mcpatlas_manifests.json")
IMAGE_TOOLS = {
    "calculator": "/usr/local/bin/mcp-server-calculator",
    "memory": "/usr/bin/mcp-server-memory"
}

POLICY_PATH = "vfs-bench-1/task/mcpatlas/whole_mount.py"
POLICY = {
    "path": POLICY_PATH,
    "url": f"https://raw.githubusercontent.com/agentvfs/vfs-bench/{V1_REV}/"
    f"{POLICY_PATH}",
    "size": 11946,
    "sha256":
    "4fa08610a4fedb8003b24a284deaa717ab3af0568ad7eb04e306a93fe0edd05e",
}
SCORER_FILES = {
    "services/scoring/score_claims.py":
    (36622,
     "fff3ca8c8175b3e85449126ba6cd7f55a8462ffe7d57abe3b5b1a0ec60cefbcc"),
    "requirements.txt":
    (226, "87661769036f4fe2807bb5c29a1aaf0a15d9991fa4602f1829d904aaa10283be"),
}

# Same one-row entry point as v1's grade_task.py. Loading the upstream
# scorer in a child confines its nest_asyncio patch to the verifier.
SCORE_ANSWER = """
import asyncio, json, sys
sys.path.insert(0, sys.argv[1])
import pandas
import score_claims as scorer
row = json.load(sys.stdin)
config = scorer.EvaluatorConfig(model_name=row.pop("judge"))
evaluator = scorer.CoverageEvaluator(scorer.AsyncLiteLLMClient(config), config)
scored = asyncio.run(scorer.evaluate_dataframe_async(
    pandas.DataFrame([row]), evaluator, "response"))
print(scored.loc[0, "coverage_details_json"])
"""


async def _command(*argv, stdin=None, env=None, cwd=None):
    process = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE
        if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=cwd,
    )
    try:
        stdout, stderr = await process.communicate(stdin)
    except BaseException:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode:
        raise RuntimeError(
            f"{argv[0]} {argv[1]} failed: "
            f"{stderr.decode(errors='replace')[-2000:].strip()}")
    return stdout


async def _extract_data(data, *, offline):
    """Copy the full image fixture into private writable trial storage."""
    name = f"vfsbench-atlas-{uuid4().hex}"
    data.mkdir()
    try:
        await _command("docker", "create", "--network", "none", "--name", name,
                       "--pull", "never" if offline else "missing", IMAGE)
        await _command("docker", "cp", f"{name}:/data/.", str(data))
    finally:
        await _remove_container(name)


async def _remove_container(name):
    try:
        await _command("docker", "rm", "--force", "-v", name)
    except RuntimeError as exc:
        if "No such container" not in str(exc):
            raise


async def _memory_state(session):
    async with asyncio.timeout(60):
        graph = await session.call_tool("read_graph", arguments={})
    if graph.is_error:
        raise RuntimeError(
            "The trial memory server could not read its knowledge graph")
    return json.loads(graph.content[0].text)


def _workspace(task):
    policy = task._dataset._source_file(POLICY).read_text(encoding="utf-8")
    # Mirage 0.1.0 calls named methods. The pinned policy received the same
    # contexts through MIRAGE_POLICY_CTX. Reuse its decisions on both hooks.
    policy = policy.split(
        "\nctx = json.loads(os.environ['MIRAGE_POLICY_CTX'])", 1)[0]
    policy += """
def pre_execute(ctx):
    return {"kind": "deny"} if held(ctx) else None

def pre_command(ctx):
    return {"kind": "deny"} if refused(ctx) else None
"""
    hook = {
        "script": {
            "language": "python",
            "source": policy
        },
        "runtime": "monty"
    }
    from mirage.policy.builtin.output_cap import DEFAULT_COMMAND_LIMITS

    return {
        "mode": "EXEC",
        "network": False,
        "env": {
            "LC_CTYPE": "C.UTF-8"
        },
        "mounts": {
            "/tmp": {
                "vfs": "ram"
            }
        },
        "clis": {},
        "profiles": {
            "default": {
                "policy": {
                    "pre_execute": [hook],
                    "pre_command": [hook]
                }
            }
        },
        "command_limits": {
            name: {
                "max_lines": None
            }
            for name in DEFAULT_COMMAND_LIMITS
        },
    }


async def _grade(task, run_dir, claims, answer):
    # The upstream dataframe evaluator skips its judge on these answers.
    if not answer.strip() or answer.startswith("ERROR:"):
        return {
            "reward": 0,
            "coverage_score": 0.0,
            "total_claims": len(claims),
            "explanation": "Skipped — empty or error response"
        }

    endpoint = os.environ.get("EVAL_LLM_BASE_URL",
                              "").rstrip("/").removesuffix("/v1")
    key = os.environ.get("EVAL_LLM_API_KEY")
    if not endpoint or not key:
        raise RuntimeError(
            "MCP-Atlas grading requires EVAL_LLM_BASE_URL and EVAL_LLM_API_KEY"
        )

    with TemporaryDirectory(prefix="atlas-grader-", dir=run_dir) as tmp:
        verifier = Path(tmp)
        for source, (size, digest) in SCORER_FILES.items():
            ref = {
                "size":
                size,
                "sha256":
                digest,
                "path":
                f"vfs-bench-1/submodule/mcp-atlas/{source}",
                "url":
                f"https://raw.githubusercontent.com/scaleapi/mcp-atlas/"
                f"{ATLAS_REV}/{source}"
            }
            file = await asyncio.to_thread(task._dataset._source_file, ref)
            shutil.copyfile(file, verifier / Path(source).name)
        environment = {
            **os.environ, "EVAL_LLM_BASE_URL": endpoint,
            "EVAL_LLM_API_KEY": key,
            "MPLCONFIGDIR": tmp,
            "PYTHON_DOTENV_DISABLED": "1"
        }
        if task._dataset.local_files_only:
            environment["UV_OFFLINE"] = "true"
        row = {"GTFA_CLAIMS": claims, "response": answer, "judge": JUDGE}
        output = await _command(
            "uv",
            "run",
            "--isolated",
            "--no-project",
            "--python",
            "3.12",
            "--with-requirements",
            str(verifier / "requirements.txt"),
            "python",
            "-I",
            "-c",
            SCORE_ANSWER,
            tmp,
            stdin=json.dumps(row).encode(),
            cwd=tmp,
            env=environment,
        )
    verdict = json.loads(output.strip().splitlines()[-1])
    coverage = verdict.get("coverage_score")
    if not isinstance(coverage, (int, float)) or not 0 <= coverage <= 1:
        raise RuntimeError("MCP-Atlas scorer returned no valid coverage score")
    return {**verdict, "reward": int(coverage >= PASS), "judge": JUDGE}


@dataclass(frozen=True)
class _TaskEnvironment:
    manifest: dict
    workspace: dict
    services: tuple[str, ...]
    provider_commands: dict[str, list[str]]
    live_github: bool
    builtin_github: bool
    missing: tuple[str, ...]


def _plan(task, config) -> _TaskEnvironment:
    import yaml

    manifest = task.manifest
    fingerprint = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode())
    if fingerprint.hexdigest() != json.loads(MANIFESTS.read_bytes()).get(
            task.id):
        raise ValueError(
            f"Unrecognized MCP-Atlas execution manifest for {task.id!r}")
    config_file = task.file("vfs/workspace.yaml")
    spec = yaml.safe_load(config_file.read_bytes())
    commands = spec.get("clis", {})
    services = [
        name if name != "gh" else "github" for name in commands
        if name != "git"
    ]
    providers = config.suite_options.get("atlas_providers", {})
    if not isinstance(providers, dict):
        raise ValueError(
            "atlas_providers must map MCP service names to command argument "
            "arrays")
    live = config.suite_options.get("atlas_live_github", False)
    if type(live) is not bool:
        raise ValueError("atlas_live_github must be a boolean")
    live = live and task.id in LIVE_TASKS and "github" not in providers
    builtin_gh = "github" not in providers and (live
                                                or task.id not in LIVE_TASKS)
    missing = [
        name for name in services
        if name not in providers and name not in IMAGE_TOOLS and name !=
        "google-workspace" and not (name == "github" and builtin_gh)
    ]
    configured = {
        name: provider_command(providers[name], name)
        for name in services if name in providers
    }
    return _TaskEnvironment(manifest, spec, tuple(services), configured, live,
                            builtin_gh, tuple(missing))


def requirements(task, config):
    """Return each required service with no built-in or configured provider."""
    return _plan(task, config).missing


@asynccontextmanager
async def prepare(task, config, run_dir: Path):
    plan = await asyncio.to_thread(_plan, task, config)
    spec = plan.workspace
    if plan.missing:
        raise RuntimeError(
            f"MCP-Atlas {task.id}: configure run-scoped atlas_providers for "
            f"{', '.join(plan.missing)}" +
            (" or enable atlas_live_github for GitHub" if task.id in
             LIVE_TASKS else ""))
    documents = await asyncio.gather(*(asyncio.to_thread(task.file, name)
                                       for name in ("vfs/VFS.md",
                                                    "vfs/SKILL.md",
                                                    "verifier/claims.json")))
    claims = json.loads(documents[2].read_bytes())
    instructions = "\n\n".join(path.read_text() for path in documents[:2])
    workspace = await asyncio.to_thread(_workspace, task)
    data = run_dir / "atlas-data"
    if any(m["vfs"] == "disk" for m in spec["mounts"].values()):
        await _extract_data(data, offline=task._dataset._local_files_only)
    mount_exports = {}
    for path, mount in spec["mounts"].items():
        if mount["vfs"] == "ram":
            continue
        if mount["vfs"] == "disk":
            root = data / mount["config"]["root"].removeprefix(
                "${AGENT_WORKSPACE}").lstrip("/")
            workspace["mounts"][path] = {
                "vfs": "disk",
                "config": {
                    "root": str(root)
                }
            }
        else:
            service = path.lstrip("/")
            if path == "/calendar":
                service = "google-workspace"
            root = run_dir / ("provider-" + service) / "mount"
            mount_exports[service] = root
            workspace["mounts"][path] = {
                "vfs": "disk",
                "mode": "read",
                "config": {
                    "root": str(root)
                }
            }
    if "git" in spec.get("clis", {}):
        workspace["clis"]["git"] = {"cli": "git", "machine": "in_process"}

    async def evaluate(view):
        return await _grade(
            task, run_dir, claims,
            (view.result.final_answer or "") if view.result else "")

    async with AsyncExitStack() as stack:
        clis, origins, state_readers = {}, [], {}
        for service in plan.services:
            prefix = service + "_"
            enabled = [
                t.removeprefix(prefix) for t in plan.manifest["enabled_tools"]
                if t.startswith(prefix)
            ]
            private = run_dir / ("provider-" + service)
            private.mkdir()
            bundled = service not in plan.provider_commands
            if service == "google-workspace" and bundled:
                url, clis[service], state_readers[
                    "calendar"] = await stack.enter_async_context(
                        calendar(task, private))
                workspace["mounts"]["/calendar"] = {
                    "vfs": "gcal",
                    "mode": "read",
                    "config": {
                        "access_token": "gws-integ-token",
                        "api_base": url
                    }
                }
                origins.append(url)
                continue
            state = {
                "VFSBENCH_ATLAS_TASK": task.id,
                "VFSBENCH_ATLAS_SERVICE": service,
                "VFSBENCH_ATLAS_TOOLS": json.dumps(enabled)
            }
            if service in mount_exports:
                state["VFSBENCH_ATLAS_MOUNT"] = str(mount_exports[service])
            if service == "github":
                state["VFSBENCH_ATLAS_GITHUB_ORIGIN_FILE"] = str(private /
                                                                 "origin")
            if not (service == "github" and plan.builtin_github):
                if service in plan.provider_commands:
                    argv = plan.provider_commands[service]
                else:
                    container = f"vfsbench-{service}-{uuid4().hex}"
                    stack.push_async_callback(_remove_container, container)
                    argv = [
                        "docker", "run", "--rm", "-i", "--name", container,
                        "--network", "none", "--pull", "never"
                        if task._dataset._local_files_only else "missing"
                    ]
                    if service == "memory":
                        graph = ("/data/repos/memory_mcp_server/"
                                 "memories-for-mcp.json")
                        argv += ["--env", "MEMORY_FILE_PATH=" + graph]
                        local_graph = data / graph.removeprefix("/data/")
                        if local_graph.is_file():
                            argv += [
                                "--mount",
                                f"type=bind,src={local_graph.parent},"
                                f"dst={Path(graph).parent}"
                            ]
                    argv += ["--entrypoint", IMAGE_TOOLS[service], IMAGE]
                optional = (
                    STATE_TOOL, ) if service in plan.provider_commands else ()
                session, listed = await stack.enter_async_context(
                    stdio_service(argv,
                                  state,
                                  private,
                                  enabled,
                                  optional=optional))
                if STATE_TOOL in listed:
                    state_readers[service] = partial(provider_state, session)
                if service == "memory" and bundled:
                    state_readers[service] = partial(_memory_state, session)
                if service in mount_exports:
                    await asyncio.to_thread(check_snapshot,
                                            mount_exports[service])
                if service != "github":
                    clis[service] = tool_cli(service, session, listed, enabled)
            if service == "github":
                origin = None if plan.builtin_github else (
                    private / "origin").read_text().strip()
                url = await stack.enter_async_context(
                    github_api(enabled, origin=origin, live=plan.live_github))
                origins.append(url)
                workspace["clis"]["gh"] = {
                    "cli": "gh",
                    "machine": "in_process",
                    "config": {
                        "token": "atlas",
                        "base_url": url
                    }
                }

        if origins:
            workspace["network"] = {
                "allowed_domains":
                [url.removeprefix("http://") for url in origins]
            }
        yield TrialEnvironment(workspace=workspace,
                               verifier=SuiteVerifier(evaluate),
                               state_readers=state_readers,
                               instructions=instructions,
                               clis=clis,
                               python="pyodide" in spec.get("runtimes", []))
