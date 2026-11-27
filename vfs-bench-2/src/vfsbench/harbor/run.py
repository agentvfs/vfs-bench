"""Export and execute a Mirage job with the installed Harbor CLI."""

import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .export import export


def run(dataset, args):
    if args.agent_import_path:
        agent = {"import_path": args.agent_import_path}
    else:
        agent = {"name": args.agent or "nop"}
    if args.model:
        agent["model_name"] = args.model
    output = args.output
    if output is None:
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        output = Path("runs") / f"vfsbench-{stamp}-{uuid4().hex[:8]}"
    config = export(dataset,
                    output,
                    args.config,
                    task_ids=args.task,
                    local_files_only=args.offline,
                    available=args.available,
                    agent=agent,
                    concurrency=args.concurrency)
    print(f"Harbor job: {config}", flush=True)
    result = subprocess.run(
        [sys.executable, "-m", "harbor.cli.main", "run", "-c", config.name],
        cwd=config.parent)
    if result.returncode:
        return (result.returncode if result.returncode > 0 else 128 -
                result.returncode)

    # Harbor can exit successfully even when a trial had an exception.
    reports = list((config.parent / "jobs").glob("*/result.json"))
    if len(reports) != 1:
        raise RuntimeError(
            f"Expected a Harbor job result under {config.parent}")
    report = json.loads(reports[0].read_bytes())
    print(f"Harbor result: {reports[0]}", flush=True)
    stats = report["stats"]
    return int(
        bool(stats["n_errored_trials"] or stats["n_cancelled_trials"]
             or stats["n_completed_trials"] != report["n_total_trials"]))
