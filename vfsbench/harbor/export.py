from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

from vfsbench.dataset import Dataset, load_dataset
from vfsbench.suites import execution_status


def manifest_hash(manifest: dict) -> str:
    data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()


def export(dataset: Dataset | str | Path,
           output: str | Path,
           config: str | Path | None = None,
           *,
           workspace_yaml: str | Path | None = None,
           task_ids=None,
           local_files_only: bool = False,
           available: bool = False,
           revision: str | None = None,
           concurrency: int | None = None) -> Path:
    """Write a new job directory. Run Harbor from this directory."""
    dataset = load_dataset(dataset,
                           revision=revision,
                           local_files_only=local_files_only)
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError(
            f"Choose a new directory for the Harbor export: {output}")
    from vfsbench.runtime import TrialConfig

    options = {"local_files_only": True} if dataset.local_files_only else {}
    if config is None:
        runtime = TrialConfig()
    else:
        config = Path(config).resolve(strict=True)
        runtime = TrialConfig.from_toml(config)
        options["trial_config"] = os.path.relpath(config, output)
    if workspace_yaml is not None:
        options["workspace_yaml"] = os.path.relpath(
            Path(workspace_yaml).expanduser().resolve(strict=True), output)
    if dataset.repo_id:
        options.update(repo_id=dataset.repo_id, revision=dataset.revision)
    else:
        options["release_path"] = os.path.relpath(dataset.root, output)
    selected = dataset if task_ids is None else [
        dataset[key] for key in task_ids
    ]
    if available:
        if task_ids is not None or runtime.environment != "suite":
            raise ValueError(
                "--available selects tasks using the built-in suite "
                "environment")
        selected = [
            task for task in dataset
            if execution_status(task, runtime)[0] == "available"
        ]
    if not selected:
        raise ValueError("Select at least one task")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary) / "job"
        tasks = stage / "tasks"
        tasks.mkdir(parents=True)
        for task in selected:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", task.id):
                raise ValueError(f"Invalid Harbor directory name: {task.id!r}")
            folder = tasks / task.id
            folder.mkdir()
            environment = folder / "environment"
            environment.mkdir()
            manifest = task.manifest
            instruction = task.instruction + (
                "\n\nRead /vfsbench/INSTRUCTIONS.md for the workspace and "
                "tool instructions.")
            suite_verifier = runtime.verifier.name == "suite"
            if manifest["dataset"] == "mcpatlas" and suite_verifier:
                instruction += (
                    " Put your answer in your final message or write it to "
                    "/logs/agent/final-answer.txt.")
            (folder / "instruction.md").write_bytes(instruction.encode())
            (folder / "task.toml").write_text(
                'schema_version = "1.4"\n\n[environment]\nnetwork_mode = '
                '"no-network"\n')
            (environment / "vfsbench.json").write_text(
                json.dumps(
                    {
                        "id": task.id,
                        "manifest_sha256": manifest_hash(manifest),
                    },
                    indent=2) + "\n")
            # Harbor discovers custom-verifier tasks using the same layout
            # as shell-verified tasks. The latter must not yield a spurious
            # score.
            (folder / "tests").mkdir()
            (folder / "tests/test.sh").write_text(
                "#!/bin/sh\necho 'Use the vfsbench.harbor:MirageVerifier in "
                "job.json' >&2\nexit 1\n")
        job = {
            "datasets": [{
                "path": "tasks"
            }],
            "environment": {
                "import_path": "vfsbench.harbor:MirageEnvironment",
                "kwargs": options
            },
            "verifier": {
                "import_path": "vfsbench.harbor:MirageVerifier"
            },
            "agents": [{
                "name": "nop"
            }],
        }
        if concurrency is not None:
            if concurrency < 1:
                raise ValueError("concurrency must be positive")
            job["n_concurrent_trials"] = concurrency
        (stage / "job.json").write_text(json.dumps(job, indent=2) + "\n")
        stage.rename(output)
    return output / "job.json"


def main(argv=None):
    description = ('Generate Harbor task directories from a release without '
                   'copying its fixtures.')
    parser = argparse.ArgumentParser(description=description)
    command = parser.add_subparsers(dest="command", required=True)
    create = command.add_parser(
        "export", help="write Harbor tasks and a job configuration")
    source = create.add_mutually_exclusive_group(required=True)
    source.add_argument("release",
                        nargs="?",
                        help="suite, release directory, or Hub dataset ID")
    source.add_argument("--dataset",
                        type=Path,
                        help="local release directory containing index.jsonl")
    source.add_argument("--repo-id", help="Hugging Face dataset repository ID")
    create.add_argument("--revision", help="Hub revision to resolve and pin")
    tasks = create.add_mutually_exclusive_group()
    tasks.add_argument("--task",
                       action="append",
                       help="task ID, repeatable (default: whole suite)")
    tasks.add_argument("--available",
                       action="store_true",
                       help="select all tasks with configured suite adapters")
    create.add_argument("--workspace-yaml",
                        type=Path,
                        help="Mirage workspace configuration file")
    create.add_argument("--config",
                        type=Path,
                        help="operator trial TOML (defaults to TrialConfig)")
    create.add_argument("--output",
                        type=Path,
                        required=True,
                        help="new export directory")
    create.add_argument("--concurrency",
                        type=int,
                        help="maximum simultaneous Harbor trials")
    create.add_argument("--local-files-only",
                        "--offline",
                        action="store_true",
                        help="use local/cached release sources only")
    args = parser.parse_args(argv)
    try:
        job = export(args.release or args.dataset or args.repo_id,
                     args.output,
                     args.config,
                     workspace_yaml=args.workspace_yaml,
                     task_ids=args.task,
                     revision=args.revision,
                     local_files_only=args.local_files_only,
                     available=args.available,
                     concurrency=args.concurrency)
    except (KeyError, FileExistsError, ValueError) as exc:
        parser.error(str(exc))
    print(f"Exported {job}. From {job.parent}, run harbor run -c job.json")


if __name__ == "__main__":
    main()
