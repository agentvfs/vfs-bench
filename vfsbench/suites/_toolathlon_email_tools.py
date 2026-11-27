import asyncio
import hashlib
import json
import os
import secrets
import shutil
from contextlib import AsyncExitStack, asynccontextmanager, suppress
from pathlib import Path
from uuid import uuid4

from ..cli.tools import tool_cli
from . import _toolathlon_mail as mail
from ._mcpatlas_services import stdio_service
from ._npm import install_locked
from ._woocommerce_store import docker

NODE = ("node@sha256:"
        "dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54")
VENDOR = Path(__file__).parent / "vendor/emails"
SOCKET = """const port = Number(process.argv[1]);
const socket = require('node:net').connect(port, '127.0.0.1');
socket.on('error', () => process.exit(1));
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on('close', () => process.exit(0));"""


async def _image(offline):
    digest = hashlib.sha256()
    for filename in ("Dockerfile", "pyproject.toml", "uv.lock"):
        digest.update((VENDOR / filename).read_bytes())
    tag = "vfsbench/emails:" + digest.hexdigest()[:24]
    if (await docker("image", "inspect", tag, check=False))[0]:
        if offline:
            raise FileNotFoundError(
                f"Original email MCP image is unavailable offline: {tag}")
        await docker("build", "--tag", tag, str(VENDOR))
    return tag


@asynccontextmanager
async def _loopback(container, port):
    """Give Mirage a host loopback port without exposing the private
    container to a network."""
    tasks = set()

    async def copy(reader, writer):
        try:
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
        finally:
            writer.close()

    async def forward(reader, writer):
        tasks.add(asyncio.current_task())
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker",
                "exec",
                "-i",
                container,
                "node",
                "-e",
                SOCKET,
                str(port),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL)
            async with asyncio.TaskGroup() as streams:
                streams.create_task(copy(reader, proc.stdin))
                streams.create_task(copy(proc.stdout, writer))
        except * (ConnectionError, BrokenPipeError):
            pass
        finally:
            writer.close()
            if proc is not None and proc.returncode is None:
                with suppress(ProcessLookupError):
                    proc.kill()
                await proc.wait()
            tasks.discard(asyncio.current_task())

    server = await asyncio.start_server(forward, "127.0.0.1", 0)
    try:
        yield server.sockets[0].getsockname()[1]
    finally:
        server.close()
        await server.wait_closed()
        for task in tuple(tasks):
            task.cancel()
        await asyncio.gather(*tuple(tasks), return_exceptions=True)


def _mount(source, destination, *, readonly=False):
    return f"type=bind,src={source},dst={destination}" + (",readonly"
                                                          if readonly else "")


@asynccontextmanager
async def service(task, run_dir, sender, accounts, timestamp):
    _, node_modules = await asyncio.to_thread(install_locked, task._dataset,
                                              mail.VENDOR)
    image = await _image(task._dataset._local_files_only)
    private = run_dir / "mail-service"
    private.mkdir()
    for name in ("start.mjs", "arms.mjs", "schema.sql"):
        shutil.copyfile(mail.VENDOR / name, private / name)
    key = secrets.token_hex(24)
    tenants = sorted(
        {address.removesuffix("@mcp.com")
         for address in accounts})
    if any("@" in name or not name for name in tenants):
        raise ValueError("All task mailboxes must be private mcp.com accounts")
    (private / "seed.json").write_text(
        json.dumps({
            "run": key,
            "timestamp": timestamp,
            "accounts": tenants
        }))
    container = "vfsbench-mail-" + uuid4().hex
    limits = [
        "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--user",
        f"{os.getuid()}:{os.getgid()}"
    ]
    offline = task._dataset._local_files_only
    pull = "--pull=never" if offline else "--pull=missing"
    async with AsyncExitStack() as scope:
        scope.push_async_callback(docker,
                                  "rm",
                                  "--force",
                                  "--volumes",
                                  container,
                                  missing_ok=True)
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "run",
            "--rm",
            pull,
            "--name",
            container,
            "--network",
            "none",
            *limits,
            "--mount",
            _mount(private, "/mail"),
            "--mount",
            _mount(node_modules, "/node_modules", readonly=True),
            "--workdir",
            "/mail",
            "--env",
            "MIRAGE_MAIL_DOMAIN=mcp.com",
            NODE,
            "node",
            "/mail/start.mjs",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)
        try:
            async with asyncio.timeout(60):
                line = await proc.stdout.readline()
            if not line:
                raise RuntimeError("Mirage mail in Docker failed to start: " +
                                   (await proc.stderr.read()).decode()[-1200:])
            from urllib.parse import urlsplit
            endpoints = json.loads(line)
            settings = {
                "username": sender["email"],
                "password": key,
                "use_ssl": False
            }
            native = {
                **sender, "password": key,
                "imap_server": "127.0.0.1",
                "smtp_server": "127.0.0.1",
                "use_ssl": False,
                "use_starttls": False
            }
            for protocol in ("imap", "smtp"):
                url = urlsplit(endpoints["MAIL_" + protocol.upper() + "_URL"])
                if (url.scheme != protocol or url.hostname != "127.0.0.1"
                        or not url.port):
                    raise ValueError("Invalid private mail listener")
                native[protocol + "_port"] = url.port
                settings[protocol + "_host"] = "127.0.0.1"
                settings[protocol + "_port"] = await scope.enter_async_context(
                    _loopback(container, url.port))
            config = private / "account.json"
            config.write_text(json.dumps(native))
            agent = "vfsbench-emails-" + uuid4().hex
            scope.push_async_callback(docker,
                                      "rm",
                                      "--force",
                                      "--volumes",
                                      agent,
                                      missing_ok=True)
            argv = [
                "docker", "run", "--rm", "-i", "--name", agent, "--network",
                "container:" + container, *limits, "--mount",
                _mount(run_dir / "workspace", "/workspace"), "--mount",
                _mount(config, "/account.json", readonly=True), image,
                "/opt/emails/.venv/bin/emails-mcp", "--config_file",
                "/account.json", "--attachment_download_path",
                "/workspace/emails_download", "--attachment_upload_path",
                "/workspace", "--email_export_path", "/workspace/emails_export"
            ]
            names = json.loads((VENDOR / "tools.json").read_bytes())
            session, schemas = await scope.enter_async_context(
                stdio_service(argv, {}, run_dir, names))

            async def state():
                return await asyncio.to_thread(mail.read_state,
                                               private / "mail.sqlite")

            yield settings, tool_cli("emails",
                                     session,
                                     schemas,
                                     names,
                                     write=True), state
        finally:
            await scope.aclose()
            with suppress(ProcessLookupError):
                if proc.returncode is None:
                    proc.terminate()
            await proc.wait()
