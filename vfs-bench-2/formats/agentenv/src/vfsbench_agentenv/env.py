"""A vfs-bench-2 task's workspace as an agent-env env.

``type = "mirage"`` in an env.toml, with ``task = "<dataset>/<task>"``.
``deploy()`` starts the task the way a Harbor trial does, through
vfsbench_harbor's ``MirageEnvironment``: the task's runs on the shared
fakes, its workspace on a Mirage daemon, ``/VFS.md`` and ``/SKILL.md``.
The deployment is the workspace's MCP endpoint, which agent-env hands the
agent. No container or sandbox is made.

A deployment is held in this process, by its session, until ``close()``:
the steps of one ``agent-env run`` find it there.
"""
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar

from agent_env.env.env import DeployedEnv, Env
from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor.environment import ROOT, MirageEnvironment

DATASETS = ROOT / "datasets"
# Each deployment's files, as a Harbor trial's: mirage/ (plan.json,
# history.json, the daemon's log), agent/ and verifier/.
RUNS = ROOT / "state" / "agentenv"
SESSION = "mirage_session"


@dataclass
class Trial:
    """One deployment: the task, its files and its live environment."""
    task: Task
    paths: TrialPaths
    environment: MirageEnvironment


_TRIALS: dict[str, Trial] = {}


def trial_of(deployed: DeployedEnv) -> Trial:
    """The live deployment a record names."""
    session = (deployed.metadata or {}).get(SESSION)
    if session not in _TRIALS:
        raise RuntimeError(
            f"env '{deployed.env_id}' has no live Mirage workspace in this "
            "process; a mirage env's steps run in the process that "
            "deployed it")
    return _TRIALS[session]


class MirageEnv(Env):
    """A vfs-bench-2 task's Mirage workspace, served over MCP."""

    type: ClassVar[str] = "mirage"
    description: ClassVar[str] = (
        "A vfs-bench-2 task's workspace on a Mirage daemon")

    def __init__(self,
                 id: str,
                 version: int | None,
                 task: str,
                 metadata: dict[str, Any] | None = None):
        super().__init__(id, version, metadata)
        self.task = task
        self.trial: Trial | None = None

    @property
    def task_dir(self) -> Path:
        """The task's harbor/, which holds its config and solution."""
        return DATASETS / self.task / "harbor"

    def to_dict(self) -> dict[str, Any]:
        return {**super().to_dict(), "task": self.task}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MirageEnv":
        return cls(data["id"], data.get("version"), data["task"],
                   data.get("metadata"))

    async def deploy(self, **options) -> DeployedEnv:
        task = Task(self.task_dir)
        session = f"{Path(self.task).name}-{uuid.uuid4().hex[:8]}"
        paths = TrialPaths(RUNS / session)
        paths.mkdir()
        environment = MirageEnvironment(
            environment_dir=task.paths.environment_dir,
            environment_name=task.name,
            session_id=session,
            trial_paths=paths,
            task_env_config=task.config.environment,
            node=os.environ.get("VFSBENCH_NODE", "node"),
        )
        try:
            await environment.start(force_build=False)
        except BaseException:
            await environment.stop(delete=False)
            raise
        self.trial = _TRIALS[session] = Trial(task, paths, environment)
        return DeployedEnv(env_id=self.id,
                           env_version=self.version,
                           mcp_url=environment.mcp_url,
                           mcp_server_name="mirage",
                           metadata={
                               SESSION: session,
                               "trial_dir": str(paths.trial_dir)
                           })

    @classmethod
    async def from_deployed_env(cls, deployed: DeployedEnv) -> "MirageEnv":
        env = Env.get(deployed.env_id, deployed.env_version)
        if not isinstance(env, cls):
            raise TypeError(f"env '{deployed.env_id}' is not a mirage env")
        env.trial = trial_of(deployed)
        return env

    async def close(self) -> None:
        """Stop the workspace and drop the task's runs; its files stay."""
        if self.trial is None:
            return
        _TRIALS.pop(self.trial.environment.session_id, None)
        trial, self.trial = self.trial, None
        await trial.environment.stop(delete=False)
