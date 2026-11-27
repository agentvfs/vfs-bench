"""Run Toolathlon's original document services over a trial-private
workspace."""

import asyncio
import hashlib
import json
import os
import re
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import replace
from pathlib import Path, PurePosixPath
from uuid import uuid4

from vfsbench.runtime import TrialEnvironment, VerifierGuest
from vfsbench.verifier import SuiteVerifier

from ._mcpatlas_services import stdio_service, tool_cli

MANIFESTS = {
    "interview-report":
    "dd44d6cb1f68d33b209717115ccf398137f99338e45d9df5368841cd4be6192a",
    "ppt-analysis":
    "6ebedafeb91be5919699926c5367fed5666cadcd45ff2deb25e7d6913e91684d",
}
PACKAGE = Path(__file__).parent / "vendor/toolathlon_documents"
PDF_WRAPPER = {
    "path":
    "vfs-bench-1/submodule/Toolathlon/utils/local_servers/pdf_tools_"
    "local_wrapper.py",
    "url":
    "https://raw.githubusercontent.com/hkust-nlp/Toolathlon/"
    "9be8d8fe07a497b18ee61e3f2ae694e9797f39eb/utils/local_servers/"
    "pdf_tools_local_wrapper.py",
    "size":
    2038,
    "sha256":
    "3d86502cda09fa6739460c9ea123de885245c4fd26fa95366da2a157f86c0382",
}
FILE_ARGUMENTS = {
    "word": {
        "filename", "source_filename", "source_filenames",
        "destination_filename", "output_filename", "target_filename",
        "image_path", "directory"
    },
    "pptx": {
        "file_path", "template_path", "image_source", "image_paths",
        "output_path", "font_path"
    },
    "pdf-tools": {"pdf_file_path", "pdf_paths", "output_path", "source_path"},
}


async def _docker(*args, check=True):
    proc = await asyncio.create_subprocess_exec(
        "docker",
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE)
    try:
        _, error = await proc.communicate()
    except BaseException:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise
    if check and proc.returncode:
        raise RuntimeError(f"docker {args[0]} failed: "
                           f"{error.decode(errors='replace')[-2000:]}")
    return proc.returncode


async def documents_image(*, offline=False):
    h = hashlib.sha256()
    for name in ("Dockerfile", "sources.tar.gz"):
        h.update((PACKAGE / name).read_bytes())
    tag = "vfsbench/documents:" + h.hexdigest()[:24]
    if await _docker("image", "inspect", tag, check=False):
        if offline:
            raise FileNotFoundError(
                f"Document tool image unavailable offline: {tag}")
        await _docker("build", "--tag", tag, str(PACKAGE))
    return tag


class _WorkspaceDocuments:

    def __init__(self, session, service, root):
        self.session = session
        self.service = service
        self.root = root

    def _file(self, value):
        if isinstance(value, list):
            return [self._file(item) for item in value]
        if not isinstance(value, str):
            return value
        if "://" in value:
            raise ValueError("Use a document in /workspace")
        path = PurePosixPath(value)
        if path.is_absolute():
            path = path.relative_to("/workspace")
        target = (self.root / path).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("Document path escapes /workspace")
        return str(PurePosixPath("/workspace") / target.relative_to(self.root))

    async def call_tool(self, name, *, arguments):
        keys = FILE_ARGUMENTS[self.service]
        args = {
            key:
            self._file(value)
            if key in keys and not (key == "image_source" and arguments.get(
                "source_type", "file") != "file") else value
            for key, value in arguments.items()
        }
        return await self.session.call_tool(name, arguments=args)


def _inputs(task, prefix, suffix=""):
    return {
        item["target"][len(prefix):]: task.file(item["target"]).read_bytes()
        for item in task.manifest["source_assets"] if
        item["target"].startswith(prefix) and item["target"].endswith(suffix)
    }


@asynccontextmanager
async def prepare(task, config, run_dir):
    manifest = await asyncio.to_thread(lambda: task.manifest)
    serialized = json.dumps(manifest, sort_keys=True,
                            separators=(",", ":")).encode()
    if hashlib.sha256(serialized).hexdigest() != MANIFESTS[task.id]:
        raise ValueError(f"Unexpected document-task manifest for {task.id}")
    root = run_dir / "workspace"
    root.mkdir()
    initial = await asyncio.to_thread(_inputs, task,
                                      "upstream/initial_workspace/")
    for name, contents in initial.items():
        (root / name).write_bytes(contents)
    instructions = (await asyncio.to_thread(task.file,
                                            "vfs/SKILL.md")).read_text()
    needed = ("word", ) if task.id == "interview-report" else ("pptx",
                                                               "pdf-tools")

    async def evaluate(view):
        truth = await asyncio.to_thread(_inputs, task,
                                        "upstream/groundtruth_workspace/",
                                        ".docx")
        files = {"truth/" + name: doc for name, doc in truth.items()}
        files["code/evaluation/__init__.py"] = b""
        files["trajectory.json"] = json.dumps({
            "final_answer":
            view.result.final_answer if view.result else None
        }).encode()
        requirements = ["docx"] if task.id == "interview-report" else []
        files["requirements.json"] = json.dumps(requirements).encode()
        files["driver.py"] = Path(__file__).with_name(
            "_toolathlon_grader.py").read_bytes()
        for target in ("main.py", "check_local.py"):
            path = await asyncio.to_thread(task.file,
                                           "upstream/evaluation/" + target)
            files["code/evaluation/" + target] = path.read_bytes()
        outputs = ["recommend.txt", *truth
                   ] if task.id == "interview-report" else ["NOTE.md"]
        for name in outputs:
            if await view.is_file("/workspace/" + name):
                files["agent/" + name] = await view.read_file("/workspace/" +
                                                              name)
        async with VerifierGuest(config) as verifier:
            verdict = await verifier.run(files, ["python3", "-I", "driver.py"])
        if verdict.return_code not in {0, 10}:
            raise RuntimeError(
                f"Document verifier failed: {verdict.stderr[-1000:]}")
        return {
            "reward": int(verdict.return_code == 0),
            "grader": "toolathlon/evaluation/main.py"
        }

    async with document_tools(task, run_dir, root, instructions,
                              needed) as (clis, readers):

        async def install(workspace):
            for service, cli in clis.items():
                workspace.register_cli(service, cli)

        yield TrialEnvironment(
            workspace={"env": {
                "HOME": "/workspace",
                "LC_CTYPE": "C.UTF-8"
            }},
            verifier=SuiteVerifier(evaluate),
            install=install,
            instructions=instructions,
            state_readers=readers,
            python=False)


@asynccontextmanager
async def document_tools(task, run_dir, root, instructions, needed):
    """Expose the original document servers over a private task workspace."""
    image = await documents_image(offline=task._dataset._local_files_only)
    async with AsyncExitStack() as stack:
        clis, readers = {}, {}
        for service in needed:
            container = f"vfsbench-document-{uuid4().hex}"
            stack.push_async_callback(_docker,
                                      "rm",
                                      "--force",
                                      "--volumes",
                                      container,
                                      check=False)
            argv = [
                "docker", "run", "--rm", "-i", "--name", container,
                "--network", "none", "--read-only", "--tmpfs", "/tmp",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--user", f"{os.getuid()}:{os.getgid()}", "--env", "HOME=/tmp",
                "--env", "PYTHONDONTWRITEBYTECODE=1", "--mount",
                f"type=bind,src={root},dst=/workspace"
            ]
            directory = f"/opt/documents/{service}/.venv/bin"
            if service == "pdf-tools":
                wrapper = await asyncio.to_thread(task._dataset._source_file,
                                                  PDF_WRAPPER)
                argv += [
                    "--mount",
                    f"type=bind,src={wrapper},dst=/pdf_wrapper.py,readonly",
                    image, directory + "/python", "/pdf_wrapper.py",
                    "--workspace_path", "/workspace", "--tempfile_dir",
                    "/workspace/.pdf_tools_tempfiles"
                ]
            else:
                program = {
                    "word": "word_mcp_server",
                    "pptx": "ppt_mcp_server"
                }[service]
                argv += [image, directory + "/" + program]
            documented = re.findall(
                r"^\| `" + re.escape(service) + r" ([a-z0-9_-]+)`",
                instructions, re.M)
            if not documented:
                raise ValueError(f"Missing {service} tool inventory")
            enabled = [name.replace("-", "_") for name in documented]
            session, listed = await stack.enter_async_context(
                stdio_service(argv, {}, run_dir, enabled))
            cli = tool_cli(service,
                           _WorkspaceDocuments(session, service,
                                               root), listed, enabled)
            handlers = {
                key: replace(handler, write=True)
                for key, handler in cli.handlers.items()
            }
            clis[service] = replace(cli, handlers=handlers)
            if service == "pptx":

                async def presentations(client=session):
                    async with asyncio.timeout(60):
                        reply = await client.call_tool("list_presentations",
                                                       arguments={})
                    if reply.is_error:
                        raise RuntimeError(
                            "The PPTX service could not list its presentations"
                        )
                    return json.loads(reply.content[0].text)

                readers["pptx"] = presentations

        yield clis, readers
