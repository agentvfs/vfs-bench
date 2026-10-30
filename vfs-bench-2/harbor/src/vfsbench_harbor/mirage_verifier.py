"""Registered TypeScript/Monty graders in separate Mirage VFS workspaces.

Only tasks in the registered grader manifests are supported. Original Python
and shell files stay untouched as references; a changed reference must be
ported and parity-tested before its manifest hashes are updated. No code
from the task or agent workspace is executed by this verifier.
"""
import asyncio
import base64
import hashlib
import json
import math
import os
import signal
import tempfile
import threading
import time
from pathlib import Path, PurePosixPath

from harbor.models.verifier.result import VerifierResult
from harbor.utils.env import resolve_env_vars
from harbor.utils.path_filter import filter_paths_by_patterns
from harbor.verifier.verifier import Verifier
from vfsbench_harbor.automationbench_verifier import \
    definitions as automationbench_definitions
from vfsbench_harbor.automationbench_verifier import \
    freeze as freeze_automationbench
from vfsbench_harbor.complexmcp_verifier import definitions
from vfsbench_harbor.complexmcp_verifier import freeze as freeze_complexmcp
from vfsbench_harbor.dataspace_verifier import \
    definitions as dataspace_definitions
from vfsbench_harbor.dataspace_verifier import freeze as freeze_dataspace
from vfsbench_harbor.environment import HARBOR, ROOT, MirageEnvironment

MANIFEST = HARBOR / "graders/manifest.json"
RUNNER = HARBOR / "verify.ts"
MAX_STAGING_BYTES = 64 * 1024 * 1024
MAX_STAGING_PATHS = 10_000
COPY_CHUNK = 1024 * 1024


class _Staging:
    """Bound file traversal/copies and cooperatively stop a staging thread."""

    def __init__(self, timeout: float):
        self.deadline = time.monotonic() + timeout
        self.cancelled = threading.Event()
        self.bytes = 0
        self.paths = 0

    def check(self):
        if self.cancelled.is_set() or time.monotonic() >= self.deadline:
            raise TimeoutError("Mirage verifier staging stopped")

    def path(self):
        self.check()
        self.paths += 1
        if self.paths > MAX_STAGING_PATHS:
            raise ValueError("Mirage verifier staging exceeds path limit")

    def charge(self, size: int):
        self.check()
        self.bytes += size
        if self.bytes > MAX_STAGING_BYTES:
            raise ValueError("Mirage verifier staging exceeds byte limit")

    def chunks(self, path: Path):
        self.check()
        if path.stat().st_size > MAX_STAGING_BYTES - self.bytes:
            raise ValueError("Mirage verifier staging exceeds byte limit")
        with path.open("rb") as source:
            while True:
                self.check()
                chunk = source.read(COPY_CHUNK)
                if not chunk:
                    break
                self.charge(len(chunk))
                yield chunk

    def copy(self, source: Path, target: Path):
        with target.open("wb") as output:
            for chunk in self.chunks(source):
                output.write(chunk)
        target.chmod(0o400)

    def write_json(self, target: Path, value):
        with target.open("wb") as output:
            for chunk in json.JSONEncoder().iterencode(value):
                data = chunk.encode()
                self.charge(len(data))
                output.write(data)

    def walk(self, root: Path):
        pending = [root]
        while pending:
            self.check()
            directory = pending.pop()
            entries = []
            with os.scandir(directory) as scan:
                for entry in scan:
                    self.path()
                    entries.append(entry)
            for entry in sorted(entries, key=lambda e: e.name):
                self.check()
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
                elif entry.is_file(follow_symlinks=False):
                    yield Path(entry.path)


class MirageVerifier(Verifier):
    """Run a registered grader in a fresh, verifier-only Mirage workspace.

    A disposable Node process gives timeout/cancellation a hard stop. This
    is trusted host code, not an isolation boundary for arbitrary scripts.
    LiveClawBench uses the workspace runtime; ComplexMCP, DataSpace and
    AutomationBench use Monty.
    Each grader reads declared JSON and file bytes through read-only VFS
    mounts and writes rewards to a separate RAM output mount.
    """

    async def _background(self, work, *args, budget=None):
        budget = budget or _Staging(self.task.config.verifier.timeout_sec)
        worker = asyncio.create_task(asyncio.to_thread(work, *args, budget))
        try:
            # wait() leaves the worker alive on cancellation without a second
            # shield future reporting the cooperatively stopped worker's error.
            await asyncio.wait({worker})
            return worker.result()
        except BaseException:
            budget.cancelled.set()
            # Do not delete the temporary directory while a copy still owns it.
            while not worker.done():
                try:
                    await asyncio.wait({worker})
                except asyncio.CancelledError:
                    continue
                except Exception:
                    break
            if not worker.cancelled():
                worker.exception()
            raise

    def _effective_inputs(self, definition: dict) -> tuple[dict, dict]:
        merged = {
            **self.task.config.verifier.env,
            **(self.verifier_env or {}),
            **self.override_env,
        }
        env = {**self.environment.container_env, **resolve_env_vars(merged)}
        states = definition.get("native_state", {})
        finance = "/opt/mock/data/finance_app.sqlite"
        if finance in states and env.get("MOCK_FINANCE_DB_PATH",
                                         finance) not in states:
            raise ValueError("MirageVerifier does not support this "
                             "MOCK_FINANCE_DB_PATH override; "
                             "use the reference verifier")
        paths = list(definition.get("inputs", []))
        dashboard = self.task.name == "finance-dashboard-repair"
        if dashboard and "POLICY_PATH" in env:
            policy = env["POLICY_PATH"]
            virtual = PurePosixPath(policy)
            if (not virtual.is_absolute() or ".." in virtual.parts
                    or "\0" in policy or str(virtual) != policy):
                raise ValueError(
                    "POLICY_PATH must be a canonical absolute VFS path")
            if not policy.startswith("/tests/"):
                try:
                    self.environment.host_path(policy)
                except (ValueError, FileNotFoundError) as exc:
                    raise ValueError(
                        "POLICY_PATH is outside supported VFS mounts") from exc
            paths.append(policy)
        if "/.bash_history" in paths and "HOME" in env:
            home = PurePosixPath(env["HOME"])
            if not home.is_absolute() or ".." in home.parts:
                raise ValueError("HOME must be an absolute VFS path")
            paths.append(str(home / ".bash_history"))
        return {**definition, "inputs": list(dict.fromkeys(paths))}, env

    def _definition(self) -> tuple[str, dict]:
        if self._skip_tests_upload or self.step_name is not None:
            raise ValueError("MirageVerifier requires a single-step task with "
                             "its reference tests available on the host")
        _, tests, script = self._resolve_tests()
        task = self.task.paths.task_dir.name
        manifest = json.loads(MANIFEST.read_text())
        manifest.update(definitions())
        manifest.update(dataspace_definitions())
        manifest.update(automationbench_definitions())
        definition = manifest.get(task)
        if definition is None:
            raise ValueError(f"No Mirage grader for {task}; use Harbor's "
                             "default verifier or MicrosandboxVerifier")
        if script != tests / "test.sh":
            raise ValueError(
                "MirageVerifier only supports the registered test.sh")
        for name, expected in definition["files"].items():
            source = tests / name
            self.task.file_filter.require_included(source)
            if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
                raise ValueError(
                    f"The reference {task}/tests/{name} changed; "
                    "update the port and verify score parity first")
        return task, definition

    async def verify(self) -> VerifierResult:
        if not isinstance(self.environment, MirageEnvironment):
            raise TypeError("MirageVerifier requires MirageEnvironment")
        # Outputs belong to the host verifier, not the agent's /logs mount.
        # Remove old rewards even when validation or execution fails.
        self.trial_paths.verifier_dir.mkdir(parents=True, exist_ok=True)
        for reward in (self.trial_paths.reward_text_path,
                       self.trial_paths.reward_json_path):
            reward.unlink(missing_ok=True)
        started = time.monotonic()
        result = await self.evaluate(refresh=True)
        score = result.get("score")
        if (type(score) not in (float, int) or not math.isfinite(score)
                or not 0 <= score <= 1):
            raise ValueError(f"Invalid Mirage reward: {score!r}")
        rewards = result.get("rewards", {"reward": score})
        if any(
                type(v) not in (int, float) or not math.isfinite(v)
                for v in rewards.values()):
            raise ValueError("Native rewards must be finite numbers")
        self.trial_paths.reward_text_path.write_text(f"{score}\n")
        if "rewards" in result:
            self.trial_paths.reward_json_path.write_text(
                json.dumps(rewards) + "\n")
        self._log(self.trial_paths.test_stdout_path, result["stdout"])
        self._log(self.trial_paths.verifier_dir / "checks.json",
                  json.dumps(result["checks"], indent=2) + "\n")
        timings = {**result["timings"], "total_s": time.monotonic() - started}
        self._log(self.trial_paths.verifier_dir / "timings.json",
                  json.dumps(timings, indent=2) + "\n")
        for name, value in result.get("artifacts", {}).items():
            if name != Path(name).name:
                raise ValueError(f"Invalid grader artifact name: {name}")
            self._log(
                self.trial_paths.verifier_dir / name,
                value if name == "judge.log" and isinstance(value, str) else
                json.dumps(value, indent=2) + "\n")
        return VerifierResult(rewards=rewards)

    async def evaluate(self, *, refresh: bool) -> dict:
        """Evaluate staged state without changing Harbor's reference outputs.

        Parity mode passes refresh=False: the reference verifier's final exec
        already refreshed the state views its Python grader read.
        Refreshing again could compare two different states.
        """
        async with asyncio.timeout(self.task.config.verifier.timeout_sec):
            return await self._evaluate(refresh=refresh)

    async def _evaluate(self, *, refresh: bool) -> dict:
        env = self.environment
        assert isinstance(env, MirageEnvironment)
        started = time.monotonic()
        task, definition = self._definition()
        definition, verifier_env = self._effective_inputs(definition)
        if refresh:
            await env.refresh_verifier_files()
        with tempfile.TemporaryDirectory(prefix="vfsbench-verify-") as temp:
            stage = Path(temp)
            frozen = await self.freeze(definition, stage)
            request = stage / "request.json"
            await self._background(lambda budget: budget.write_json(
                request, {
                    "task": task,
                    "runtime": definition.get("runtime", "typescript"),
                    **frozen,
                    "epoch": env.now().isoformat(),
                    "env": verifier_env,
                    "timeoutSeconds": self.task.config.verifier.timeout_sec,
                }))
            result = await self._run(env.node_binary, request)
            result["timings"]["total_s"] = time.monotonic() - started

            def hashes(budget):
                result = {}
                for path, host in {
                        **frozen["states"],
                        **frozen["files"]
                }.items():
                    digest = hashlib.sha256()
                    for chunk in budget.chunks(Path(host)):
                        digest.update(chunk)
                    result[path] = digest.hexdigest()
                return result

            result["input_sha256"] = await self._background(hashes)
            return result

    async def freeze(self, definition: dict, stage: Path) -> dict:
        """Copy declared files/trees only, keeping all host paths private.

        Reference resources come from the checked host sources. Agent files
        must resolve within a mounted directory; symlinks cannot read the host.
        Safety directory scans skip symlinks as the reference's os.walk does.
        """
        budget = _Staging(self.task.config.verifier.timeout_sec)
        if definition.get("runtime") == "automationbench-monty":
            return await freeze_automationbench(self, definition, stage,
                                                budget)
        if definition.get("runtime") == "dataspace-monty":
            return await freeze_dataspace(self, definition, stage, budget)
        if definition.get("runtime") == "complexmcp-monty":
            return await freeze_complexmcp(self, definition, stage, budget)
        frozen = await self._background(self._freeze_files,
                                        definition,
                                        stage,
                                        budget=budget)
        states = await self.environment.snapshot_verifier_states(
            definition.get("native_state", {}))
        history = None
        if "/.bash_history" in definition.get("inputs", []):
            history = await self.environment.read_virtual_file("/.bash_history"
                                                               )

        def store(budget):
            for i, (alias, tables) in enumerate(sorted(states.items())):
                target = stage / f"state-{i}.json"
                budget.write_json(target, tables)
                target.chmod(0o400)
                frozen["states"][alias] = str(target)
            if history is not None:
                budget.charge(len(history))
                target = stage / "shell-history"
                target.write_bytes(history)
                target.chmod(0o400)
                frozen["files"]["/.bash_history"] = str(target)
                # test.sh copies the virtual history here before the audit.
                frozen["files"]["/logs/verifier/bash_history"] = str(target)
            return frozen

        return await self._background(store, budget=budget)

    def _freeze_files(self, definition, stage, budget):
        env = self.environment
        sources: dict[str, Path] = {}
        existing = set()
        tests = self._resolve_tests()[1]

        def source(path: str) -> Path | None:
            if path.startswith("/tests/"):
                host = tests / path.removeprefix("/tests/")
                if not host.resolve().is_relative_to(tests.resolve()):
                    raise ValueError(
                        "Verifier resource leaves its tests directory")
                self.task.file_filter.require_included(host)
                return host
            try:
                host = env.host_path(path)
            except (ValueError, FileNotFoundError):
                return None
            if host.exists() and not any(
                    host.resolve().is_relative_to(root.resolve())
                    for root in env.disk_mounts.values()):
                raise ValueError(
                    f"Verifier input leaves its workspace mount: {path}")
            return host

        for path in definition.get("inputs", []):
            budget.path()
            host = source(path)
            if host is not None and host.exists():
                existing.add(path)
                if host.is_file():
                    sources[path] = host
        for tree in definition.get("trees", []):
            roots = {tree: source(tree)}
            roots.update({
                p: host
                for p, host in env.disk_mounts.items()
                if p.startswith(tree.rstrip("/") + "/")
            })
            for virtual, host in roots.items():
                if host is None or not host.is_dir():
                    continue
                existing.add(virtual)
                for file in budget.walk(host):
                    path = virtual.rstrip("/") + "/" + file.relative_to(
                        host).as_posix()
                    sources[path] = file
        frozen = {"states": {}, "files": {}, "existingPaths": sorted(existing)}
        for i, (virtual, host) in enumerate(sorted(sources.items())):
            target = stage / f"input-{i}"
            budget.copy(host, target)
            frozen["files"][virtual] = str(target)
        return frozen

    def _log(self, path: Path, text: str) -> None:
        relative = path.relative_to(self.trial_paths.verifier_dir).as_posix()
        if filter_paths_by_patterns([relative],
                                    include=self.include_logs,
                                    exclude=self.exclude_logs):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.unlink(missing_ok=True)
            path.write_text(text)

    async def _run(self, node: str, request: Path) -> dict:
        payload = await self._background(self._request_bytes, request)
        runtime = json.loads(payload).get("runtime", "typescript")
        runners = {
            "typescript": RUNNER,
            "complexmcp-monty": HARBOR / "verify-complexmcp.ts",
            "dataspace-monty": HARBOR / "verify-dataspace.ts",
            "automationbench-monty": HARBOR / "verify-automationbench.ts"
        }
        if runtime not in runners:
            raise ValueError(f"Unknown verifier runtime: {runtime}")
        runner = runners[runtime]
        process = await asyncio.create_subprocess_exec(
            node,
            "--no-warnings",
            str(runner),
            cwd=ROOT,
            # No model credentials, NODE_OPTIONS or task-controlled env.
            env={
                "PATH": os.environ.get("PATH", ""),
                "TZ": "UTC"
            },
            start_new_session=True,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            async with asyncio.timeout(self.task.config.verifier.timeout_sec):
                stdout, stderr = await process.communicate(payload)
        finally:
            # Monty owns child workers. Kill the whole dedicated process
            # group on timeout/cancellation, even if Node exited first.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()
        if process.returncode:
            diagnostic = stderr.decode(errors="replace")
            raise RuntimeError(f"Mirage grader exited {process.returncode}: "
                               f"{diagnostic[-4000:]}")
        return json.loads(stdout)

    @staticmethod
    def _request_bytes(request, budget):
        budget.check()
        value = json.loads(request.read_text())
        if "databases" in value:
            raise ValueError("Native grading takes JSON state, not databases")
        value["states"] = {
            alias: json.loads(b"".join(budget.chunks(Path(host))))
            for alias, host in value["states"].items()
        }
        value["files"] = {
            path:
            base64.b64encode(b"".join(budget.chunks(
                Path(host)))).decode("ascii")
            for path, host in value.get("files", {}).items()
        }
        payload = json.dumps(value).encode()
        budget.check()
        return payload
