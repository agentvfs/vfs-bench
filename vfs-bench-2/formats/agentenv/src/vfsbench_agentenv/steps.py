"""The task steps a mirage env's tasks take beside agent-env's own.

``mirage_oracle`` runs the task's ``solution/solve.sh`` in the workspace,
as Harbor's oracle agent does. ``mirage_grade`` grades the run with
vfsbench_harbor's ``MirageVerifier``, the dataset's own grader, and writes
its reward as the step's grade.
"""
import json
from typing import Any, ClassVar

from agent_env.entity.refs import EntityRef
from agent_env.task_step.context import StepContextError, TaskStepContext
from agent_env.task_step.task_step import TaskStep, TaskStepDependency
from agent_env.task_step.task_steps.verifiers.verifier import (
    Verification, VerifierTaskStep)
from harbor.agents.oracle import OracleAgent
from harbor.models.agent.context import AgentContext
from vfsbench_agentenv.env import Trial, trial_of
from vfsbench_harbor.mirage_verifier import MirageVerifier


def _trial(context: TaskStepContext, env_id: str) -> Trial:
    deployed = next((d for d in context.deployed_envs if d.env_id == env_id),
                    None)
    if deployed is None:
        raise StepContextError(f"env '{env_id}' is not deployed")
    return trial_of(deployed)


class MirageOracleTaskStep(TaskStep):
    """Run the task's solution in the env's workspace."""

    type: ClassVar[str] = "mirage_oracle"
    entity_refs = (EntityRef.env("env_id"), )

    def __init__(self,
                 id: str,
                 version: int | None,
                 env_id: str,
                 depends_on: list[TaskStepDependency] | None = None,
                 **base: Any):
        super().__init__(id, version, depends_on=depends_on, **base)
        self.env_id = env_id

    def to_dict(self) -> dict[str, Any]:
        return {**super().to_dict(), "env_id": self.env_id}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MirageOracleTaskStep":
        return cls(env_id=data["env_id"], **cls._base_from_dict(data))

    async def execute(self, context: TaskStepContext) -> TaskStepContext:
        trial = _trial(context, self.env_id)
        agent = OracleAgent(
            logs_dir=trial.paths.agent_dir,
            task_dir=trial.task.paths.task_dir,
            trial_paths=trial.paths,
            agent_timeout_sec=trial.task.config.agent.timeout_sec)
        await agent.run(trial.task.instruction, trial.environment,
                        AgentContext())
        return context


class MirageGradeTaskStep(VerifierTaskStep):
    """Grade the env's run with the dataset's grader."""

    type: ClassVar[str] = "mirage_grade"
    entity_refs = (EntityRef.env("env_id"), )

    def __init__(self,
                 id: str,
                 version: int | None,
                 env_id: str,
                 depends_on: list[TaskStepDependency] | None = None,
                 fail_task_on_error: bool = True,
                 **verifier: Any):
        super().__init__(id,
                         version,
                         depends_on=depends_on,
                         fail_task_on_error=fail_task_on_error,
                         **verifier)
        self.env_id = env_id

    def to_dict(self) -> dict[str, Any]:
        return {**super().to_dict(), "env_id": self.env_id}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MirageGradeTaskStep":
        return cls(env_id=data["env_id"], **cls._base_from_dict(data))

    async def verify(self, context: TaskStepContext) -> Verification:
        trial = _trial(context, self.env_id)
        verifier = MirageVerifier(task=trial.task,
                                  trial_paths=trial.paths,
                                  environment=trial.environment)
        result = await verifier.verify()
        score = float(trial.paths.reward_text_path.read_text())
        checks = trial.paths.verifier_dir / "checks.json"
        return Verification(
            score=score,
            output={
                "rewards": result.rewards,
                "checks":
                json.loads(checks.read_text()) if checks.is_file() else None,
                "trial_dir": str(trial.paths.trial_dir),
            })
