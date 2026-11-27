"""Run a Harbor task and verifier on one VFS-Bench trial."""

from __future__ import annotations

import asyncio
import json
import re
import tempfile
from dataclasses import replace
from pathlib import Path, PurePosixPath

from harbor.environments.base import BaseEnvironment, ExecResult
from harbor.environments.capabilities import (EnvironmentCapabilities,
                                              EnvironmentResourceCapabilities)
from harbor.models.task.config import NetworkMode
from harbor.models.trial.paths import EnvironmentPaths
from harbor.models.verifier.result import VerifierResult
from harbor.utils.path_filter import filter_paths_by_patterns
from harbor.utils.path_safety import validate_output_path
from harbor.verifier.base import BaseVerifier
from vfsbench.dataset import Dataset
from vfsbench.runtime import Trial, TrialConfig
from vfsbench.verifier import AgentResult

from .export import manifest_hash


class MirageEnvironment(BaseEnvironment):

    def __init__(self,
                 *args,
                 trial_config=None,
                 release_path=None,
                 repo_id=None,
                 revision=None,
                 local_files_only=False,
                 **kwargs):
        if bool(release_path) == bool(repo_id):
            raise ValueError("Set exactly one of release_path or repo_id in "
                             "environment.kwargs")
        if repo_id is not None and not re.fullmatch(r"[0-9a-f]{40}", revision
                                                    or ""):
            raise ValueError("A Hub job requires the full dataset commit SHA")
        self.trial_config = Path(trial_config) if trial_config else None
        self.release_path = release_path
        self.repo_id = repo_id
        self.revision = revision
        self.local_files_only = local_files_only
        self.trial: Trial | None = None
        self.report_root: Path | None = None
        super().__init__(*args, **kwargs)

    @staticmethod
    def type() -> str:
        return "vfsbench-mirage"

    @property
    def capabilities(self):
        return EnvironmentCapabilities(disable_internet=True)

    @classmethod
    def resource_capabilities(cls):
        return EnvironmentResourceCapabilities(cpu_limit=True,
                                               memory_limit=True)

    def validate_network_policy_support(self, network_policy=None):
        policy = network_policy or self.network_policy
        if policy.network_mode != NetworkMode.NO_NETWORK:
            raise ValueError(
                "These VFS-Bench tasks require network_mode='no-network'")

    def _validate_definition(self):
        if self._host_mounts:
            raise ValueError("VFS-Bench trials use their own workspace mounts")
        if self.task_env_config.storage_mb is not None:
            raise ValueError(
                "This provider does not support a Harbor storage limit")
        self.descriptor = json.loads(
            (self.environment_dir / "vfsbench.json").read_bytes())

    def _open_trial(self):
        config = (TrialConfig.from_toml(self.trial_config)
                  if self.trial_config else TrialConfig())
        cpus, memory = self._effective_cpus, self._effective_memory_mb
        if cpus is not None:
            config = replace(config, cpus=int(cpus))
        if memory is not None:
            config = replace(config, memory=f"{memory}M")
        if self.repo_id:
            dataset = Dataset.from_hub(self.repo_id,
                                       revision=self.revision,
                                       local_files_only=self.local_files_only)
        else:
            dataset = Dataset(self.release_path,
                              local_files_only=self.local_files_only)
        task = dataset[self.descriptor["id"]]
        if manifest_hash(task.manifest) != self.descriptor["manifest_sha256"]:
            raise ValueError(
                f"Release manifest changed since export for {task.id}")
        return task.open(config=config)

    async def start(self, force_build=False):
        if self.trial is not None:
            raise RuntimeError("Trial already started")
        self.trial = await asyncio.to_thread(self._open_trial)
        try:
            await self.trial.start()
            for directory in (EnvironmentPaths.agent_dir,
                              EnvironmentPaths.artifacts_dir,
                              EnvironmentPaths.user_agent_dir):
                await self._mkdir(directory)
        except BaseException:
            await self.stop(delete=True)
            raise

    async def stop(self, delete=True):
        if self.trial is not None:
            try:
                await self.trial.close()
            finally:
                try:
                    self.write_trial_report()
                finally:
                    self.report_root = self.trial = None

    def write_trial_report(self):
        if self.report_root is not None:
            path = self.report_root / "vfsbench.json"
            validate_output_path(path, self.report_root)
            path.write_text(
                json.dumps(
                    self.trial.report.to_dict(), indent=2, allow_nan=False) +
                "\n")

    @property
    def files(self):
        if self.trial is None:
            raise RuntimeError("No running VFS-Bench trial")
        return self.trial.workspace.vfs

    def _reset_dirs_user(self):
        # Harbor can prepare its log directories as the trial user.
        return None

    async def exec(self,
                   command,
                   cwd=None,
                   env=None,
                   timeout_sec=None,
                   user=None):
        if self._resolve_user(user) is not None:
            raise ValueError("The trial runs commands as its default identity")
        result = await self.trial.exec(command,
                                       cwd=cwd or self.task_env_config.workdir,
                                       env=self._merge_env(env),
                                       timeout_sec=timeout_sec)
        return ExecResult(stdout=result.stdout,
                          stderr=result.stderr,
                          return_code=result.return_code)

    async def is_dir(self, path, user=None):
        return await self.files.is_dir(str(path))

    async def is_file(self, path, user=None):
        return await self.files.is_file(str(path))

    async def _mkdir(self, path):
        for directory in [*reversed(path.parents), path]:
            if directory != PurePosixPath("/") and not await self.files.is_dir(
                    str(directory)):
                await self.files.mkdir(str(directory))

    async def upload_file(self, source_path, target_path):
        source = Path(source_path)
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Expected a regular input file: {source}")
        await self._mkdir(PurePosixPath(target_path).parent)

        async def chunks():
            with source.open("rb") as stream:
                while chunk := await asyncio.to_thread(stream.read,
                                                       1024 * 1024):
                    yield chunk

        await self.files.write(str(target_path), chunks())
        await self.files.setattr(str(target_path),
                                 mode=source.stat().st_mode & 0o777)

    async def upload_dir(self, source_dir, target_dir):
        root = Path(source_dir)
        if root.is_symlink() or not root.is_dir():
            raise ValueError(f"Expected an input directory: {root}")
        await self._mkdir(PurePosixPath(target_dir))
        for source in root.rglob("*"):
            if source.is_symlink():
                continue
            dest = PurePosixPath(target_dir) / source.relative_to(
                root).as_posix()
            if source.is_dir():
                await self._mkdir(dest)
            elif source.is_file():
                await self.upload_file(source, str(dest))

    async def download_file(self, source_path, target_path):
        target = Path(target_path)
        if target.is_symlink():
            raise ValueError(f"Refusing redirected output: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        chunks = await self.files.read(str(source_path), raw=True, stream=True)
        with tempfile.NamedTemporaryFile(dir=target.parent,
                                         delete=False) as stream:
            stage = Path(stream.name)
            try:
                async for chunk in chunks:
                    await asyncio.to_thread(stream.write, chunk)
                stream.close()
                stage.replace(target)
            finally:
                stage.unlink(missing_ok=True)

    async def download_dir(self, source_dir, target_dir):
        await self.download_dir_filtered(source_dir=source_dir,
                                         target_dir=target_dir)

    async def download_dir_with_exclusions(self, *, source_dir, target_dir,
                                           exclude):
        await self.download_dir_filtered(source_dir=source_dir,
                                         target_dir=target_dir,
                                         exclude=exclude)

    async def download_dir_filtered(self,
                                    *,
                                    source_dir,
                                    target_dir,
                                    include=None,
                                    exclude=None,
                                    protect=None):
        root, target = PurePosixPath(source_dir), Path(target_dir)
        if root.is_relative_to(EnvironmentPaths.verifier_dir):
            return  # The verifier writes these artifacts on the controller.
        if self.trial is None and root.is_relative_to("/logs"):
            return  # Harbor collects logs even if trial preparation failed.
        target.mkdir(parents=True, exist_ok=True)
        pending = [root]
        while pending:
            directory = pending.pop()
            for name in await self.files.readdir(str(directory)):
                child = directory / name
                if child.parent != directory or child.name in {"", ".", ".."}:
                    raise ValueError(
                        f"Invalid workspace directory entry {name!r}")
                if child == EnvironmentPaths.verifier_dir:
                    continue
                relative = child.relative_to(root).as_posix()
                dest = target / relative
                validate_output_path(dest, target)
                stat = await self.files.stat(str(child), nofollow=True)
                if stat.type == "directory":
                    dest.mkdir(parents=True, exist_ok=True)
                    pending.append(child)
                elif stat.type == "file" and (relative in (
                        protect or ()) or filter_paths_by_patterns(
                            [relative], include=include, exclude=exclude)):
                    await self.download_file(str(child), dest)


def _agent_evidence(paths):
    """Read the full ATIF and an optional agent-authored final answer."""
    path = paths.agent_dir / "trajectory.json"
    validate_output_path(path, paths.agent_dir)
    trajectory = json.loads(path.read_bytes()) if path.exists() else None
    answer = paths.agent_dir / "final-answer.txt"
    validate_output_path(answer, paths.agent_dir)
    if answer.is_file():
        return trajectory, AgentResult(final_answer=answer.read_text(),
                                       metadata={"source": answer.name})
    if trajectory is None:
        return None, None
    for step in reversed(trajectory["steps"]):
        if step["source"] != "agent" or step.get("is_copied_context"):
            continue
        if step.get("tool_calls"):
            break  # The run ended on a tool call without a final answer.
        message = step["message"]
        if not isinstance(message, str):
            message = "\n".join(part["text"] for part in message
                                if part["type"] == "text")
        return trajectory, AgentResult(final_answer=message,
                                       metadata={"source": path.name})
    return trajectory, None


class MirageVerifier(BaseVerifier):

    async def verify(self):
        if not isinstance(self.environment,
                          MirageEnvironment) or self.environment.trial is None:
            raise ValueError("MirageVerifier requires a running "
                             "vfsbench.harbor:MirageEnvironment")
        trial = self.environment.trial
        root = self.trial_paths.verifier_dir
        root.mkdir(parents=True, exist_ok=True)
        self.environment.report_root = root
        trajectory, result = _agent_evidence(self.trial_paths)
        if trajectory is not None and trial.trace.agent is None:
            trial.record_agent_trace(trajectory)
        if result is not None and trial.result is None:
            trial.record_result(result)
        try:
            verification = await trial.verify()
        finally:
            self.environment.write_trial_report()
        rewards = {"reward": verification.reward}
        validate_output_path(self.trial_paths.reward_json_path, root)
        self.trial_paths.reward_json_path.write_text(
            json.dumps(rewards) + "\n")
        return VerifierResult(rewards=rewards)
