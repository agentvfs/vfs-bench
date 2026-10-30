"""Trusted TypeScript graders through Mirage, without Pyodide or a microVM.

Only tasks in graders/manifest.json are supported. Their original Python
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
import shutil
import tempfile
import time
from pathlib import Path

from harbor.models.verifier.result import VerifierResult
from harbor.utils.path_filter import filter_paths_by_patterns
from harbor.verifier.verifier import Verifier
from vfsbench_harbor.environment import HARBOR, ROOT, MirageEnvironment

MANIFEST = HARBOR / "graders/manifest.json"
RUNNER = HARBOR / "verify.ts"


class MirageVerifier(Verifier):
    """Run a registered grader in a fresh, verifier-only Mirage workspace.

    A disposable Node process gives timeout/cancellation a hard stop. This
    is trusted host code, not an isolation boundary for arbitrary scripts.
    The workspace has only the workspace runtime and RAM output; the grader
    reads declared JSON state and file bytes through a read-only Mirage VFS.
    """

    def _definition(self) -> tuple[str, dict]:
        if self._skip_tests_upload or self.step_name is not None:
            raise ValueError("MirageVerifier requires a single-step task with "
                             "its reference tests available on the host")
        _, tests, script = self._resolve_tests()
        task = self.task.paths.task_dir.name
        definition = json.loads(MANIFEST.read_text()).get(task)
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
            self._log(self.trial_paths.verifier_dir / name,
                      json.dumps(value, indent=2) + "\n")
        return VerifierResult(rewards=rewards)

    async def evaluate(self, *, refresh: bool) -> dict:
        """Evaluate staged state without changing Harbor's reference outputs.

        Parity mode passes refresh=False: the reference verifier's final exec
        already refreshed the state views its Python grader read.
        Refreshing again could compare two different states.
        """
        env = self.environment
        assert isinstance(env, MirageEnvironment)
        started = time.monotonic()
        task, definition = self._definition()
        if refresh:
            await env.refresh_verifier_files()
        with tempfile.TemporaryDirectory(prefix="vfsbench-verify-") as temp:
            stage = Path(temp)
            frozen = await self.freeze(definition, stage)
            request = stage / "request.json"
            request.write_text(
                json.dumps({
                    "task":
                    task,
                    **frozen,
                    "epoch":
                    env.now().isoformat(),
                    "env":
                    env.container_env,
                    "timeoutSeconds":
                    self.task.config.verifier.timeout_sec,
                }))
            result = await self._run(env.node_binary, request)
            result["timings"]["total_s"] = time.monotonic() - started
            result["input_sha256"] = {
                p: hashlib.sha256(Path(host).read_bytes()).hexdigest()
                for p, host in {
                    **frozen["states"],
                    **frozen["files"]
                }.items()
            }
            return result

    async def freeze(self, definition: dict, stage: Path) -> dict:
        """Copy declared files/trees only, keeping all host paths private.

        Reference resources come from the checked host sources. Agent files
        must resolve within a mounted directory; symlinks cannot read the host.
        Safety directory scans skip symlinks as the reference's os.walk does.
        """
        env = self.environment
        sources: dict[str, Path] = {}
        existing = set()
        tests = self._resolve_tests()[1]

        def source(path: str) -> Path | None:
            if path.startswith("/tests/"):
                return tests / path.removeprefix("/tests/")
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
                for directory, dirs, files in os.walk(host, followlinks=False):
                    dirs[:] = sorted(d for d in dirs
                                     if not (Path(directory) / d).is_symlink())
                    for name in sorted(files):
                        file = Path(directory) / name
                        if not file.is_symlink() and file.is_file():
                            path = virtual.rstrip(
                                "/") + "/" + file.relative_to(host).as_posix()
                            sources[path] = file
        frozen = {"states": {}, "files": {}, "existingPaths": sorted(existing)}
        for i, (virtual, host) in enumerate(sorted(sources.items())):
            target = stage / f"input-{i}"
            shutil.copyfile(host, target)
            target.chmod(0o400)
            frozen["files"][virtual] = str(target)
        states = await env.snapshot_verifier_states(
            definition.get("native_state", {}))
        for i, (alias, tables) in enumerate(sorted(states.items())):
            target = stage / f"state-{i}.json"
            target.write_text(json.dumps(tables))
            target.chmod(0o400)
            frozen["states"][alias] = str(target)
        if "/.bash_history" in definition.get("inputs", []):
            history = await env.read_virtual_file("/.bash_history")
            if history is not None:
                target = stage / "shell-history"
                target.write_bytes(history)
                target.chmod(0o400)
                frozen["files"]["/.bash_history"] = str(target)
                # test.sh copies the virtual history here before the audit.
                frozen["files"]["/logs/verifier/bash_history"] = str(target)
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
        value = json.loads(request.read_text())
        if "databases" in value:
            raise ValueError("Native grading takes JSON state, not databases")
        value["states"] = {
            alias: json.loads(Path(host).read_text())
            for alias, host in value["states"].items()
        }
        value["files"] = {
            path: base64.b64encode(Path(host).read_bytes()).decode("ascii")
            for path, host in value.get("files", {}).items()
        }
        process = await asyncio.create_subprocess_exec(
            node,
            "--no-warnings",
            str(RUNNER),
            cwd=ROOT,
            # No model credentials, NODE_OPTIONS or task-controlled env.
            env={
                "PATH": os.environ.get("PATH", ""),
                "TZ": "UTC"
            },
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            async with asyncio.timeout(self.task.config.verifier.timeout_sec):
                stdout, stderr = await process.communicate(
                    json.dumps(value).encode())
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
        if process.returncode:
            diagnostic = stderr.decode(errors="replace")
            raise RuntimeError(f"Mirage grader exited {process.returncode}: "
                               f"{diagnostic[-4000:]}")
        return json.loads(stdout)
