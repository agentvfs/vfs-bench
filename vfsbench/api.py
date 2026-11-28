from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from .dataset import Dataset, load_dataset
from .runtime import TrialConfig, resolve_config
from .suites import execution_status
from .verifier import AgentResult, TrialReport

if TYPE_CHECKING:
    from mirage.config import WorkspaceConfig
    from mirage.workspace.workspace import Workspace


def status(release: str | Path | Dataset,
           *,
           task_ids: Iterable[str] | None = None,
           revision: str | None = None,
           config: TrialConfig | WorkspaceConfig | str | Path | None = None,
           local_files_only: bool = False) -> dict[str, tuple[str, str]]:
    """Map task IDs to their adapter status and service requirements."""
    dataset = load_dataset(release,
                           revision=revision,
                           local_files_only=local_files_only)
    runtime, _ = resolve_config(config)
    tasks = dataset if task_ids is None else (dataset[key] for key in task_ids)
    return {task.id: execution_status(task, runtime) for task in tasks}


async def run(release: str | Path | Dataset,
              *,
              task: str,
              action: Callable[[Workspace], Awaitable[object]] | None = None,
              command: str | None = None,
              final_answer: str | None = None,
              revision: str | None = None,
              config: TrialConfig | WorkspaceConfig | str | Path | None = None,
              workspace_yaml: str | Path | None = None,
              output: str | Path | None = None,
              local_files_only: bool = False) -> TrialReport:
    """Give an async action the native Mirage Workspace, then verify and close.

    Return an AgentResult from the action or pass final_answer to record
    evidence for the verifier. Omit the action to grade the initial state.
    The older command argument records a single shell line.
    """
    if action is not None and command is not None:
        raise ValueError("Specify either action or command")
    dataset = await asyncio.to_thread(load_dataset,
                                      release,
                                      revision=revision,
                                      local_files_only=local_files_only)
    trial = dataset[task].open(config=config, workspace=workspace_yaml)
    directory = Path(output) if output is not None else None
    if directory is not None:
        directory.mkdir(parents=True, exist_ok=False)
    try:
        async with trial:
            result = None
            async with asyncio.timeout(trial.config.timeout_sec):
                if action is not None:
                    result = await action(trial.workspace)
                elif command is not None:
                    await trial.exec(command)
            if isinstance(result, AgentResult):
                if final_answer is not None:
                    raise ValueError(
                        "Supply a final_answer or return an AgentResult")
                trial.record_result(result)
            elif final_answer is not None:
                trial.record_result(AgentResult(final_answer=final_answer))
            await trial.verify()
    finally:
        if directory is not None:
            (directory / "trial.json").write_text(
                json.dumps(trial.report.to_dict(), indent=2, allow_nan=False) +
                "\n")
    return trial.report
