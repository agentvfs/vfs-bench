"""Harbor's verifier, run in a microVM of the trial's own.

    verifier:
      import_path: vfsbench_harbor:MicrosandboxVerifier

``MirageEnvironment`` runs the agent in a Mirage workspace, where
``python3`` is Pyodide: it has no network, no ``subprocess`` and no time
zones. This verifier runs the task's ``tests/test.sh`` in a microsandbox
microVM instead (``msb``, a VM per verification), with real CPython,
while the trial's environment is still up:

- **Files.** Harbor's own verifier uploads ``tests/`` into the workspace's
  ``/tests``; so does this one. The environment then refreshes its copies
  of the mocks' state files, and the VM is created with each of the
  workspace's disk mounts copied in at its own path (``/workspace``,
  ``/logs``, ``/tests``, ``/var/lib/mock-data/...``), before it boots.
  Nothing on the host is mounted into it. Afterwards ``guest.py`` writes
  ``/logs/verifier`` out as a tar, whose regular files go into the trial's
  verifier directory.
- **Network.** Each upstream port the trial reaches on localhost gets a
  proxy of its own on the host's loopback (``Proxy``), which sends each
  request to the trial's route for that port: its run of a shared fake
  (``<fake>/_run/<run>``) or its own mock. As ``preload.ts`` does for the
  workspace, the request's path stays under the run, and the kit's own
  endpoints (``/reset``, ``/_kit/...``) answer 404. The VM may reach those
  host ports alone (``--no-net`` and ``--net-rule allow@host:tcp:<port>``);
  inside it, ``guest.py`` listens on each upstream port and relays to its
  proxy. Without routes, the VM has no network at all.
- **Running.** ``guest.py`` runs Harbor's command for the script, with the
  container's ``ENV`` and the task's verifier environment, and the reward
  files are read as Harbor's own verifier reads them. The VM is removed
  however the verification ends, timed out or canceled included. A VM msb
  hangs before the test starts is replaced (``ATTEMPTS``).

The VM has the task's CPUs, memory and storage, as the container had.
``mirage/verifier.log`` in the trial's directory gives the VM's timings,
its peak memory and each request its proxies passed.
"""
import asyncio
import contextlib
import json
import re
import secrets
import shlex
import shutil
import tarfile
import tempfile
import time
from collections.abc import AsyncIterator
from pathlib import Path, PurePosixPath
from typing import IO
from urllib.parse import urlsplit

import h11
import httpx
from harbor.models.trial.paths import EnvironmentPaths
from harbor.models.verifier.result import VerifierResult
from harbor.utils.env import resolve_env_vars
from harbor.utils.file_staging import selected_directory
from harbor.utils.path_filter import filter_paths_by_patterns
from harbor.utils.scripts import build_execution_command
from harbor.verifier.verifier import (AddTestsDirError,
                                      RewardFileNotFoundError, Verifier)
from vfsbench_harbor.environment import MirageEnvironment
from vfsbench_harbor.fakes import run_name

IMAGE = "python:3.12-slim-bookworm"
GUEST = Path(__file__).with_name("guest.py")
# Where the VM keeps the runner, its config and the trial's /tmp.
STAGE = "/.vfsbench"
# guest.py's first line.
STARTED = b"STARTED\n"
# Hop-by-hop headers, and the framing the proxy sets itself.
HOP = {
    b"connection", b"keep-alive", b"proxy-authenticate",
    b"proxy-authorization", b"proxy-connection", b"te", b"trailer",
    b"trailers", b"transfer-encoding", b"upgrade", b"content-length"
}
# The kit's own endpoints, which no upstream service has.
KIT = re.compile(r"/(reset|_kit)(/|$)")
# msb 0.5.10 now and then hangs a create, or leaves a command in a running
# VM unrun (about one in a hundred of each, concurrent or not). A create
# takes a third of a second, its copies included (300 MB in 3,000 files add
# 0.3 s), and guest.py's first line comes in a tenth of one; past these
# the VM has hung, and the verification starts again in another, up to
# ATTEMPTS times. Nothing of the test has run by then.
ATTEMPTS = 3
CREATE_TIMEOUT = 30
ANSWER_TIMEOUT = 15
# What the host keeps of a VM's answer: its stdout (the pulled logs' tar) is
# spooled to a temporary file, past SPOOL bytes, and refused past
# MAX_OUTPUT; of its stderr (the test's output) only the last ERROR_TAIL
# bytes are kept. /logs is the trial's to write, so neither is bounded
# otherwise.
SPOOL = 2**20
MAX_OUTPUT = 64 * 2**20
ERROR_TAIL = 64 * 2**10


def _msb(name: str | None) -> str:
    """The msb CLI: ``name``, else ``msb`` on ``PATH``, else where its
    installer puts it."""
    for candidate in ([name] if name else ["msb", "~/.local/bin/msb"]):
        found = shutil.which(str(Path(candidate).expanduser()))
        if found:
            return found
    raise FileNotFoundError(
        f"microsandbox's msb CLI is not at {name or 'msb or ~/.local/bin/msb'}"
        "; install it, or name it with --verifier-kwarg msb=<path>")


async def _run(*argv: str,
               timeout: float | None = None) -> tuple[int, bytes, bytes]:
    """Run a command to its end; past ``timeout``, or when canceled, it is
    killed and this raises."""
    process = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(process.communicate(), timeout)
    except BaseException:
        if process.returncode is None:
            process.kill()
        await asyncio.shield(process.wait())
        raise
    assert process.returncode is not None
    return process.returncode, out, err


async def _tail(stream: asyncio.StreamReader, limit: int) -> bytes:
    """A stream read to its end, keeping its last ``limit`` bytes."""
    kept = b""
    while chunk := await stream.read(2**16):
        kept = (kept + chunk)[-limit:]
    return kept


def _path(target: bytes) -> str | None:
    """A request target's path and query, read as a URL parser reads an
    http URL's: a backslash is a slash, ``%2e`` a dot, and dot segments are
    resolved. The fake's URL parser would read them so too, after the run's
    prefix, so the path could climb out of the route; here it cannot. None
    for a target that is not a path."""
    text = target.decode("ascii", "replace")
    if not text.startswith(("/", "\\")):
        return None
    path, mark, query = text.partition("?")
    segments = path.replace("\\", "/").split("/")[1:]
    out: list[str] = []
    for i, segment in enumerate(segments):
        dots = segment.lower().replace("%2e", ".")
        if dots in (".", ".."):
            if dots == ".." and out:
                out.pop()
            if i == len(segments) - 1:
                out.append("")
            continue
        out.append(segment)
    return "/" + "/".join(out) + mark + query


class Proxy:
    """One upstream port of a trial's, on a free port of the host's
    loopback: each request goes to the port's route, under its path.

    A route with a path is a run of a shared fake, whose kit endpoints
    answer 404, as ``preload.ts`` answers them; a trial's own mock has no
    path. Requests are read and sent one at a time (h11), never relayed as
    bytes, so no request reaches the fake but under the route.
    """

    def __init__(self, port: int, url: str, client: httpx.AsyncClient,
                 log: list[str]):
        parts = urlsplit(url)
        self.port = port
        self._origin = f"{parts.scheme}://{parts.netloc}"
        self._base = parts.path.rstrip("/")
        self._client = client
        self._log = log
        self._server: asyncio.Server | None = None

    async def start(self) -> int:
        """Listen; the host port."""
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        return self._server.sockets[0].getsockname()[1]

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _serve(self, reader: asyncio.StreamReader,
                     writer: asyncio.StreamWriter) -> None:
        conn = h11.Connection(h11.SERVER)
        try:
            while True:
                received = await self._receive(conn, reader, writer)
                if received is None:
                    return
                request, body = received
                status, reason, headers, content = await self._answer(
                    request, body)
                writer.write(
                    conn.send(
                        h11.Response(status_code=status,
                                     reason=reason,
                                     headers=headers)))
                if content:
                    writer.write(conn.send(h11.Data(data=content)))
                writer.write(conn.send(h11.EndOfMessage()))
                await writer.drain()
                if h11.MUST_CLOSE in (conn.our_state, conn.their_state):
                    return
                conn.start_next_cycle()
        except h11.RemoteProtocolError:
            if conn.our_state in (h11.IDLE, h11.SEND_RESPONSE):
                writer.write(
                    conn.send(
                        h11.Response(status_code=400,
                                     headers=[(b"content-length", b"0")])))
                writer.write(conn.send(h11.EndOfMessage()))
        except (h11.LocalProtocolError, ConnectionError, OSError):
            pass
        finally:
            writer.close()

    @staticmethod
    async def _receive(
            conn: h11.Connection, reader: asyncio.StreamReader,
            writer: asyncio.StreamWriter) -> tuple[h11.Request, bytes] | None:
        """The next request and its body, or None once the client is done."""
        request: h11.Request | None = None
        body = bytearray()
        while True:
            event = conn.next_event()
            if event is h11.NEED_DATA:
                if conn.they_are_waiting_for_100_continue:
                    writer.write(
                        conn.send(
                            h11.InformationalResponse(status_code=100,
                                                      headers=[])))
                conn.receive_data(await reader.read(65536))
            elif isinstance(event, h11.Request):
                request = event
            elif isinstance(event, h11.Data):
                body += event.data
            elif isinstance(event, h11.EndOfMessage):
                assert request is not None
                return request, bytes(body)
            else:
                return None

    async def _answer(
            self, request: h11.Request, body: bytes
    ) -> tuple[int, bytes, list[tuple[bytes, bytes]], bytes]:
        method = request.method.decode()
        path = _path(request.target)
        if path is None:
            return self._text(400, request, "400 Bad Request")
        if self._base and KIT.match(path.partition("?")[0]):
            return self._text(404, request, "404 Not Found")
        headers = [(k, v) for k, v in request.headers if k.lower() not in HOP]
        try:
            sent = self._client.build_request(method,
                                              self._origin + self._base + path,
                                              headers=headers,
                                              content=body)
            reply = await self._client.send(sent, stream=True)
            try:
                content = b"".join([c async for c in reply.aiter_raw()])
            finally:
                await reply.aclose()
        except httpx.HTTPError as e:
            self._log.append(f"{self.port} {method} {path} -> {e!r}")
            return self._text(502, request, "502 Bad Gateway")
        self._log.append(f"{self.port} {method} {path} -> {reply.status_code}")
        out = [(k, v) for k, v in reply.headers.raw if k.lower() not in HOP]
        bodiless = reply.status_code in (204, 304) or reply.status_code < 200
        if method == "HEAD":
            length = reply.headers.get("content-length")
            if length is not None:
                out.append((b"content-length", length.encode()))
            content = b""
        elif bodiless:
            content = b""
        else:
            out.append((b"content-length", str(len(content)).encode()))
        return (reply.status_code, reply.reason_phrase.encode(), out, content)

    def _text(self, status: int, request: h11.Request, text: str):
        self._log.append(f"{self.port} {request.method.decode()} "
                         f"{request.target.decode('ascii', 'replace')} -> "
                         f"{status} (proxy)")
        data = b"" if request.method == b"HEAD" else text.encode()
        return (status, b"", [(b"content-type", b"text/plain; charset=UTF-8"),
                              (b"content-length", str(len(data)).encode())],
                data)


@contextlib.asynccontextmanager
async def proxies(routes: dict[int, str],
                  log: list[str]) -> AsyncIterator[dict[int, int]]:
    """A proxy for each upstream port's route; each port's host port."""
    async with httpx.AsyncClient(timeout=60,
                                 trust_env=False,
                                 follow_redirects=False) as client:
        started: list[Proxy] = []
        try:
            ports = {}
            for port, url in routes.items():
                proxy = Proxy(port, url, client, log)
                ports[port] = await proxy.start()
                started.append(proxy)
            yield ports
        finally:
            for proxy in started:
                await proxy.close()


_pulls: dict[str, asyncio.Task] = {}


async def _pull(msb: str, image: str) -> None:
    """Pull the image once per event loop, so no VM's boot waits on it;
    trials verifying at once share the one pull."""
    pull = _pulls.get(image)
    if pull is None or pull.get_loop() is not asyncio.get_running_loop():
        pull = _pulls[image] = asyncio.create_task(
            _run(msb, "pull", "-q", image))
    code, _, err = await asyncio.shield(pull)
    if code != 0:
        _pulls.pop(image, None)
        raise RuntimeError(f"msb pull {image} failed: {err.decode()[-2000:]}")


class Hung(Exception):
    """msb left a VM's create or a command in it unanswered."""


class Sandbox:
    """One microVM, created by ``boot`` and removed when it ends."""

    def __init__(self, msb: str, name: str):
        self.msb = msb
        self.name = name
        # Each upstream port the VM relays, and its proxy's host port.
        self.ports: dict[int, int] = {}

    @classmethod
    @contextlib.asynccontextmanager
    async def boot(cls, msb: str, prefix: str, image: str, *,
                   copies: list[tuple[Path, str]], ports: list[int],
                   options: list[str],
                   log: list[str]) -> AsyncIterator["Sandbox"]:
        """A VM from ``image`` with ``copies`` (host directory, VM path)
        put in before it boots, reaching the host's loopback on ``ports``
        alone. It is removed when the block ends, however it ends. Raises
        ``Hung`` if its create does not return in time."""
        argv = ["--no-net", *options]
        for port in ports:
            argv += ["--net-rule", f"allow@host:tcp:{port}"]
        for source, target in copies:
            if ":" in str(source) or ":" in target:
                raise ValueError(f"msb cannot copy a path with ':' ({source})")
            argv += ["--copy-dir", f"{source}:{target}"]
        await _pull(msb, image)
        vm = cls(msb, f"{prefix}-{secrets.token_hex(3)}")
        started = time.monotonic()
        try:
            try:
                code, _, err = await _run(msb,
                                          "create",
                                          "-q",
                                          "-n",
                                          vm.name,
                                          *argv,
                                          "--pull",
                                          "never",
                                          image,
                                          timeout=CREATE_TIMEOUT)
            except TimeoutError:
                raise Hung(f"create {vm.name} did not return in "
                           f"{CREATE_TIMEOUT}s") from None
            if code != 0:
                # msb's own timeout on a hung boot ends this way too.
                raise Hung(f"create {vm.name} exited {code}: "
                           f"{err.decode().strip()[-500:]}")
            log.append(f"create {vm.name}: {time.monotonic() - started:.2f}s")
            yield vm
        finally:
            await asyncio.shield(vm.remove(log))

    async def remove(self, log: list[str]) -> None:
        started = time.monotonic()
        try:
            code, _, err = await _run(self.msb,
                                      "rm",
                                      "-f",
                                      "-q",
                                      self.name,
                                      timeout=60)
        except TimeoutError:
            log.append(f"removing {self.name} timed out")
            return
        if code != 0:
            log.append(f"removing {self.name} failed (exit {code}): "
                       f"{err.decode()[-2000:]}")
            return
        log.append(f"remove {self.name}: {time.monotonic() - started:.2f}s")

    async def guest(self, *args: str) -> tuple[int, IO[bytes], bytes]:
        """Run ``guest.py`` in the VM, to its end: its status, its stdout
        after its first line, spooled and rewound (the caller closes it),
        and its stderr's last ``ERROR_TAIL`` bytes. Raises ``Hung`` if that
        first line does not come in time, so the VM never ran it."""
        process = await asyncio.create_subprocess_exec(
            self.msb,
            "exec",
            "-q",
            "--stream",
            self.name,
            "--",
            "python3",
            "-I",
            f"{STAGE}/guest.py",
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert process.stdout is not None and process.stderr is not None
        errors = asyncio.ensure_future(_tail(process.stderr, ERROR_TAIL))
        out = tempfile.SpooledTemporaryFile(max_size=SPOOL)
        try:
            try:
                first = await asyncio.wait_for(process.stdout.readline(),
                                               ANSWER_TIMEOUT)
            except TimeoutError:
                raise Hung(f"{self.name} ran nothing in {ANSWER_TIMEOUT}s; "
                           "msb left the command unrun") from None
            while chunk := await process.stdout.read(2**16):
                if out.tell() + len(chunk) > MAX_OUTPUT:
                    raise RuntimeError(
                        f"{self.name}'s answer passed {MAX_OUTPUT} bytes")
                out.write(chunk)
            err = await errors
            code = await process.wait()
            if first != STARTED:
                raise RuntimeError(f"guest.py did not start in {self.name} "
                                   f"(exit {code}): {(first + err).decode()}")
        except BaseException:
            out.close()
            errors.cancel()
            if process.returncode is None:
                process.kill()
            await asyncio.shield(process.wait())
            raise
        out.seek(0)
        return code, out, err

    async def metrics(self) -> dict:
        """The VM's live metrics, or nothing if msb has none."""
        try:
            code, out, _ = await _run(self.msb,
                                      "metrics",
                                      self.name,
                                      "--format",
                                      "json",
                                      timeout=10)
            return json.loads(out) if code == 0 else {}
        except (TimeoutError, ValueError):
            return {}


def extract(data: IO[bytes], target: Path, *, include: list[str] | None,
            exclude: list[str] | None, protect: tuple[str, ...]) -> list[str]:
    """A tar's regular files into ``target``: no links, devices or names
    outside it, and only the files ``include`` and ``exclude`` choose, as
    Harbor's own download chooses them, ``protect`` always. The names."""
    if not data.read(1):
        return []
    data.seek(0)
    with tarfile.open(fileobj=data) as tar:
        members = {}
        for member in tar.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or not member.isfile():
                continue
            members[name.as_posix().removeprefix("./")] = member
        chosen = set(members)
        if include or exclude:
            chosen = set(
                filter_paths_by_patterns(list(members),
                                         include=include,
                                         exclude=exclude))
            chosen |= {n for n in members if n in protect}
        target.mkdir(parents=True, exist_ok=True)
        for name in sorted(chosen):
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            extracted = tar.extractfile(members[name])
            assert extracted is not None
            destination.unlink(missing_ok=True)
            with destination.open("wb") as written:
                shutil.copyfileobj(extracted, written)
    return sorted(chosen)


class MicrosandboxVerifier(Verifier):
    """Harbor's verifier, in a microVM of the trial's own (see the module).

    It verifies a trial of ``vfsbench_harbor:MirageEnvironment``. Its
    kwargs (``verifier.kwargs`` in a job config, or ``--verifier-kwarg``):

    Args:
        image: the VM's OCI image, whose ``python3`` runs the tests.
        msb: the microsandbox CLI; ``msb`` on ``PATH``, else
            ``~/.local/bin/msb``.
        cpus, memory_mb, storage_mb: the VM's, the task environment's by
            default.
    """

    def __init__(self,
                 *args,
                 image: str = IMAGE,
                 msb: str | None = None,
                 cpus: int | None = None,
                 memory_mb: int | None = None,
                 storage_mb: int | None = None,
                 **kwargs):
        super().__init__(*args, **kwargs)
        self._image = image
        self._msb = _msb(msb)
        resources = self.task.config.environment
        self._cpus = int(cpus or resources.cpus or 1)
        self._memory_mb = int(memory_mb or resources.memory_mb or 512)
        self._storage_mb = int(storage_mb or resources.storage_mb or 4096)

    async def _upload_tests(self, source_dirs: list[Path], script: Path,
                            target: str) -> None:
        """The tests, into the workspace's ``/tests``, as Harbor's verifier
        uploads them; the VM copies them from there."""
        self.task.file_filter.require_included(script)
        try:
            for source in source_dirs:
                selection = self.task.file_filter.select(source)
                if not selection.relative_paths:
                    continue
                with selected_directory(selection) as directory:
                    await self.environment.upload_dir(source_dir=directory,
                                                      target_dir=target)
        except Exception as e:
            raise AddTestsDirError(
                "Failed to add tests directory to environment.") from e

    def _env(self) -> dict[str, str]:
        merged = {
            **self.task.config.verifier.env,
            **(self.verifier_env or {}),
            **self.override_env,
        }
        return resolve_env_vars(merged) if merged else {}

    def _mirage(self) -> MirageEnvironment:
        if not isinstance(self.environment, MirageEnvironment):
            raise TypeError("MicrosandboxVerifier verifies a trial of "
                            "vfsbench_harbor:MirageEnvironment, not "
                            f"{type(self.environment).__name__}")
        return self.environment

    @contextlib.asynccontextmanager
    async def sandbox(self,
                      command: str,
                      log: list[str],
                      requests: list[str],
                      pull: str | None = None) -> AsyncIterator[Sandbox]:
        """A VM for the trial as it stands, its proxies listening, whose
        ``guest.py`` runs ``command`` and writes ``pull`` out as a tar.
        ``log`` gets its boot and removal, ``requests`` each request its
        proxies pass. Raises ``Hung`` as ``Sandbox.boot`` does."""
        env = self._mirage()
        # The services' state as the agent left it.
        await env.refresh_state()
        mounts = env.disk_mounts
        stage = Path(tempfile.mkdtemp(prefix="vfsbench-msb-"))
        try:
            async with proxies(env.routes, requests) as ports:
                shutil.copyfile(GUEST, stage / "guest.py")
                (stage / "config.json").write_text(
                    json.dumps({
                        "ports": {
                            str(k): v
                            for k, v in ports.items()
                        },
                        "tmp": f"{STAGE}/tmp" if "/tmp" in mounts else None,
                        "command": command,
                        "pull": pull,
                        "cwd": env.workdir,
                        "env": {
                            **env.container_env,
                            **self._env()
                        },
                    }))
                copies = [(stage, STAGE)] + [
                    (root, f"{STAGE}/tmp" if path == "/tmp" else path)
                    for path, root in mounts.items()
                ]
                copies.sort(key=lambda c: len(PurePosixPath(c[1]).parts))
                log.append(f"image {self._image}, {self._cpus} CPUs, "
                           f"{self._memory_mb} MiB; ports {ports}")
                options = [
                    "-c",
                    str(self._cpus),
                    "-m",
                    f"{self._memory_mb}M",
                    "--oci-upper-size",
                    f"{self._storage_mb}M",
                    "--max-duration",
                    self._max_duration(),
                ]
                async with Sandbox.boot(
                        self._msb,
                        f"vfsb-{run_name(env.session_id)[:40]}",
                        self._image,
                        copies=copies,
                        ports=list(ports.values()),
                        options=options,
                        log=log) as vm:
                    vm.ports = ports
                    yield vm
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    async def verify(self) -> VerifierResult:
        env = self._mirage()
        paths = EnvironmentPaths.for_os(env.os)
        source_dirs, tests_dir, script = self._resolve_tests()
        for reward in (paths.reward_text_path, paths.reward_json_path):
            env.host_path(str(reward), write=True).unlink(missing_ok=True)
        self.trial_paths.reward_text_path.unlink(missing_ok=True)
        self.trial_paths.reward_json_path.unlink(missing_ok=True)
        if not self._skip_tests_upload:
            await self._upload_tests(source_dirs, script, str(paths.tests_dir))
        test_script = str(paths.tests_dir /
                          script.relative_to(tests_dir).as_posix())
        stdout = str(paths.verifier_dir /
                     self.trial_paths.test_stdout_path.relative_to(
                         self.trial_paths.verifier_dir).as_posix())
        command = (f"chmod +x {shlex.quote(test_script)}; " +
                   build_execution_command(
                       test_script, stdout_path=stdout, task_os=env.os))

        log: list[str] = []
        requests: list[str] = []
        timings: dict[str, float] = {}
        try:
            for attempt in range(1, ATTEMPTS + 1):
                try:
                    await self._attempt(command, str(paths.verifier_dir), log,
                                        requests, timings)
                    break
                except Hung as e:
                    log.append(f"attempt {attempt}: {e}")
            else:
                raise RuntimeError(f"msb hung on all {ATTEMPTS} attempts "
                                   "(mirage/verifier.log has each)")
            timings["attempts"] = attempt
        finally:
            self._write_log(log, requests, timings)

        if self.trial_paths.reward_json_path.exists():
            rewards = self._parse_reward_json()
        elif self.trial_paths.reward_text_path.exists():
            rewards = self._parse_reward_text()
        else:
            raise RewardFileNotFoundError(
                f"No reward file found at {self.trial_paths.reward_text_path}"
                f" or {self.trial_paths.reward_json_path}")
        return VerifierResult(rewards=rewards)

    async def _attempt(self, command: str, pull: str, log: list[str],
                       requests: list[str], timings: dict) -> None:
        """Run the test in a VM booted for it, and copy ``pull`` back."""
        started = time.monotonic()
        async with self.sandbox(command, log, requests, pull) as vm:
            timings["boot_s"] = time.monotonic() - started
            peak: dict[str, float] = {}
            sampler = asyncio.create_task(self._sample(vm, peak))
            started = time.monotonic()
            try:
                code, out, err = await vm.guest()
            finally:
                sampler.cancel()
            timings["run_s"] = time.monotonic() - started
            log.append(f"test exit {code}" +
                       (f"\n{err.decode()[-4000:]}" if err else ""))
            self._peak(await vm.metrics(), peak)
            timings.update(peak)
            started = time.monotonic()
        timings["remove_s"] = time.monotonic() - started
        with out:
            extract(out,
                    self.trial_paths.verifier_dir,
                    include=self.include_logs,
                    exclude=self.exclude_logs,
                    protect=(self.trial_paths.reward_text_path.name,
                             self.trial_paths.reward_json_path.name))

    def _max_duration(self) -> str:
        """A backstop for a VM whose Harbor process is gone: four times the
        task's verifier timeout, and ten minutes more."""
        return f"{int(self.task.config.verifier.timeout_sec * 4) + 600}s"

    @staticmethod
    def _peak(metrics: dict, peak: dict[str, float]) -> None:
        """Keep the higher memory, the guest's and the host's, in MiB."""
        for key, name in (("memory_bytes", "peak_guest_mib"),
                          ("memory_host_resident_bytes", "peak_host_mib")):
            if key in metrics:
                peak[name] = max(peak.get(name, 0), metrics[key] / 2**20)

    @classmethod
    async def _sample(cls, vm: Sandbox, peak: dict[str, float]) -> None:
        """The VM's peak memory, sampled every half second."""
        while True:
            cls._peak(await vm.metrics(), peak)
            await asyncio.sleep(0.5)

    def _write_log(self, log: list[str], requests: list[str],
                   timings: dict) -> None:
        out = self.trial_paths.trial_dir / "mirage" / "verifier.log"
        out.parent.mkdir(parents=True, exist_ok=True)
        lines = [*log, *(f"proxy {r}" for r in requests)]
        rounded = {
            k: round(v, 3) if isinstance(v, float) else v
            for k, v in timings.items()
        }
        lines.append(f"TIMINGS {json.dumps(rounded)}")
        with out.open("a") as f:
            f.write("\n".join(lines) + "\n")
