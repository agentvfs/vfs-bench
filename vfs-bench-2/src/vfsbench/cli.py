"""Inspect releases, prepare the Python guest, or export Harbor jobs."""

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path

from .dataset import Dataset
from .runtime import TrialConfig
from .suites import execution_status


async def prepare(tasks, config):
    """Populate the dependencies used by an empty trial and its verifier."""
    for task in tasks:
        print(f"Preparing {task.id}", flush=True)
        await asyncio.to_thread(lambda: task.instruction)
        async with task.open(config=config) as trial:
            await trial.verify()
        print(f"Prepared {task.id}", flush=True)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["harbor"]:
        from .harbor.export import main as harbor

        return harbor(argv[1:])
    parser = argparse.ArgumentParser(prog="vfsbench", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    snapshot = commands.add_parser(
        "snapshot", help="build or identify the benchmark Python snapshot")
    snapshot.add_argument("action", choices=("build", "name"))
    inspect = commands.add_parser(
        "status",
        help="inspect which suite adapters and service providers are "
        "configured")
    warm = commands.add_parser(
        "prepare",
        help="warm the Toolathlon cache by starting and grading empty trials")
    for command in (inspect, warm):
        command.add_argument(
            "release", help="local folder or Hugging Face dataset repo ID")
        command.add_argument("--revision", default="main")
        command.add_argument("--config", type=Path)
        command.add_argument("--task",
                             action="append",
                             help="select a task ID (repeatable)")
        command.add_argument("--offline", action="store_true")
    commands.add_parser(
        "harbor",
        help="generate a Harbor job (see vfsbench harbor export --help)")
    args = parser.parse_args(argv)
    if args.command == "snapshot":
        from .snapshot import SNAPSHOT, build

        print(build() if args.action == "build" else SNAPSHOT)
        return
    config = TrialConfig.from_toml(
        args.config) if args.config else TrialConfig()
    if Path(args.release).is_dir():
        suite = Dataset(args.release, local_files_only=args.offline)
    else:
        suite = Dataset.from_hub(args.release,
                                 revision=args.revision,
                                 local_files_only=args.offline)
    tasks = [suite[key] for key in args.task] if args.task else suite
    if args.command == "prepare":
        if (config.environment != "suite" or config.verifier.name != "suite"
                or any(task.manifest["dataset"] != "toolathlon"
                       for task in tasks)):
            parser.error("prepare requires the built-in Toolathlon "
                         "environment and verifier")
        asyncio.run(prepare(tasks, config))
        return
    counts = Counter()
    for task in tasks:
        state, reason = execution_status(task, config)
        counts[state] += 1
        print("\t".join(part for part in (task.id, state, reason) if part))
    print(", ".join(f"{count} {state}"
                    for state, count in sorted(counts.items())))


if __name__ == "__main__":
    main()
