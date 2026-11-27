"""Application entry points used by the vfsbench CLI."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterable
from pathlib import Path

from .dataset import Dataset, load_dataset
from .runtime import TrialConfig
from .suites import execution_status
from .verifier import TrialReport


def _config(config: TrialConfig | str | Path | None) -> TrialConfig:
    if isinstance(config, (str, Path)):
        return TrialConfig.from_toml(config)
    return config if config is not None else TrialConfig()


def status(release: str | Path | Dataset,
           *,
           task_ids: Iterable[str] | None = None,
           revision: str | None = None,
           config: TrialConfig | str | Path | None = None,
           local_files_only: bool = False) -> dict[str, tuple[str, str]]:
    """Map task IDs to their adapter status and service requirements."""
    dataset = load_dataset(release,
                           revision=revision,
                           local_files_only=local_files_only)
    runtime = _config(config)
    tasks = dataset if task_ids is None else (dataset[key] for key in task_ids)
    return {task.id: execution_status(task, runtime) for task in tasks}


async def run(release: str | Path | Dataset,
              *,
              task: str,
              command: str | None = None,
              revision: str | None = None,
              config: TrialConfig | str | Path | None = None,
              output: str | Path | None = None,
              local_files_only: bool = False) -> TrialReport:
    """Run an optional command, verify the trial, and close it.

    An omitted command grades the initial state. If supplied, output is a new
    directory for the controller's trial.json, including verifier failures.
    """
    dataset = await asyncio.to_thread(load_dataset,
                                      release,
                                      revision=revision,
                                      local_files_only=local_files_only)
    trial = dataset[task].open(config=_config(config))
    directory = Path(output) if output is not None else None
    if directory is not None:
        directory.mkdir(parents=True, exist_ok=False)
    try:
        async with trial:
            if command is not None:
                await trial.exec(command)
            await trial.verify()
    finally:
        if directory is not None:
            (directory / "trial.json").write_text(
                json.dumps(trial.report.to_dict(), indent=2, allow_nan=False) +
                "\n")
    return trial.report
