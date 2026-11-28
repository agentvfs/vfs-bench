import asyncio
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
from weakref import WeakKeyDictionary

import aiohttp

DEFAULT_ENDPOINT = "http://127.0.0.1:8931"
_start_locks = WeakKeyDictionary()


def _local_token():
    # Publish a complete key atomically even if several kernels start at once.
    root = Path(tempfile.gettempdir(
    )) / f"vfsbench-{os.getuid() if hasattr(os, 'getuid') else 'user'}"
    root.mkdir(mode=0o700, exist_ok=True)
    if os.name == "posix" and (root.is_symlink() or root.stat().st_uid
                               != os.getuid() or root.stat().st_mode & 0o077):
        raise RuntimeError(
            "The vfsbench credential directory must be private to your account"
        )
    key = root / "server.key"
    if not key.exists():
        with tempfile.NamedTemporaryFile(dir=root, delete=False) as tmp:
            tmp.write(secrets.token_hex(32).encode())
        try:
            os.link(tmp.name, key)
        except FileExistsError:
            pass
        finally:
            os.unlink(tmp.name)
    return key.read_text()


def _run_path(run):
    if not isinstance(run, str) or not re.fullmatch("[a-f0-9]{32}", run):
        raise ValueError("Expected a vfsbench mock run ID")
    return f"/_kit/runs/{run}"


@dataclass(frozen=True)
class MockServer:
    endpoint: str
    _token: str = field(repr=False)

    async def _request(self, method, path, body=None):
        headers = {"Authorization": f"Bearer {self._token}"}
        async with aiohttp.ClientSession(headers=headers) as client:
            async with client.request(method,
                                      self.endpoint + path,
                                      json=body,
                                      allow_redirects=False) as response:
                if response.status == 409 and (path == "/reset"
                                               or path.endswith("/clone")):
                    raise FileExistsError("Mock run ID already exists")
                if response.status == 404:
                    raise KeyError("Unknown mock run or endpoint")
                if not 200 <= response.status < 300:
                    raise RuntimeError(
                        f"Mock server returned HTTP {response.status}: "
                        f"{(await response.text())[:300]}")
                if response.status != 204:
                    return await response.json()

    @asynccontextmanager
    async def _run(self, run_id, settings, corpus):
        try:
            await self._request("POST", "/reset", {
                "run": run_id,
                "settings": settings,
                "corpus": corpus
            })
        except FileExistsError:
            raise
        except BaseException:
            # The run may exist even if the reply was lost.
            await self.stop(run_id)
            raise
        try:
            yield
        finally:
            await self.stop(run_id)

    async def list_runs(self):
        return await self._request("GET", "/_kit/runs")

    async def info(self, run):
        return await self._request("GET", _run_path(run))

    async def state(self, run):
        """Read the current app data used by the ComplexMCP verifier."""
        return await self._request("GET", _run_path(run) + "/state")

    async def clone(self, run):
        return await self._request("POST",
                                   _run_path(run) + "/clone",
                                   {"run": uuid4().hex})

    async def _release(self, method, path):
        try:
            await self._request(method, path)
        except aiohttp.ClientConnectorError as exc:
            # An idle local controller may have exited since an explicit stop.
            if not (isinstance(exc.os_error, ConnectionRefusedError)
                    and urlsplit(
                        self.endpoint).hostname in ("localhost", "127.0.0.1")):
                raise

    async def stop(self, run):
        await self._release("DELETE", _run_path(run))

    async def shutdown(self):
        """Shut down after all trials and clones close."""
        await self._release("POST", "/shutdown")

    async def call(self, run, service, tool, args):
        return await self._request("POST",
                                   _run_path(run) + "/call", {
                                       "service": service,
                                       "tool": tool,
                                       "args": args
                                   })


async def get_server(endpoint=None, *, start=True):
    """Connect to the controller, optionally starting it."""
    endpoint = (endpoint or os.getenv("VFSBENCH_SERVER_URL")
                or DEFAULT_ENDPOINT).rstrip("/")
    url = urlsplit(endpoint)
    local = url.hostname in ("127.0.0.1", "localhost")
    if (url.scheme not in ("http", "https") or not url.hostname
            or url.username is not None or url.query or url.fragment
            or (not local and url.scheme != "https")):
        raise ValueError(
            "Expected a loopback HTTP endpoint or an HTTPS server URL")
    token = os.getenv("VFSBENCH_SERVER_TOKEN")
    if not token:
        if not local:
            raise ValueError("Set VFSBENCH_SERVER_TOKEN for a remote server")
        token = _local_token()
    server = MockServer(endpoint, token)

    async def ready():
        health = await server._request("GET", "/_kit/health")
        if health.get("service") != "vfsbench":
            raise RuntimeError(f"{endpoint} is not a vfsbench controller")

    if not start or not (local and url.scheme == "http" and not url.path
                         and url.port):
        await ready()
        return server

    # A batch in one kernel should launch just one controller process.
    lock = _start_locks.setdefault(asyncio.get_running_loop(), asyncio.Lock())
    async with lock:
        try:
            await ready()
        except aiohttp.ClientConnectorError:
            pass
        else:
            return server
        # Parallel starters race at bind(). All clients connect to the winner.
        env = {
            key: os.environ[key]
            for key in ("PATH", "HOME", "SYSTEMROOT", "USERPROFILE", "TMP",
                        "TEMP", "TMPDIR", "PYTHONPATH") if key in os.environ
        }
        env["VFSBENCH_SERVER_TOKEN"] = token
        process = subprocess.Popen([
            sys.executable, "-m", "vfsbench._mock_server",
            str(url.port), "--idle-exit"
        ],
                                   env=env,
                                   start_new_session=True,
                                   stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL)
        threading.Thread(target=process.wait, daemon=True).start()
        for _ in range(100):
            await asyncio.sleep(.05)
            try:
                await ready()
            except aiohttp.ClientConnectorError:
                if process.poll() is not None:
                    break
            else:
                return server
        raise RuntimeError(
            f"Could not start the mock server at {endpoint}. "
            f"Run vfsbench server serve --port {url.port} for startup errors.")
