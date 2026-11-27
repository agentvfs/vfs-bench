"""Inspect releases, prepare trials, and run benchmarks through Harbor."""

import argparse
import asyncio
import sys
from collections import Counter
from importlib.util import find_spec
from pathlib import Path

from .dataset import Dataset, MCPAtlas, Toolathlon
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
    launch = commands.add_parser("run", help="run tasks in Mirage with Harbor")
    agent = launch.add_mutually_exclusive_group()
    agent.add_argument("-a",
                       "--agent",
                       help="Harbor agent name (default: nop)")
    agent.add_argument("--agent-import-path",
                       metavar="MODULE:CLASS",
                       help="load a custom Harbor agent")
    launch.add_argument("-m",
                        "--model",
                        help="model name for the Harbor agent")
    launch.add_argument("-n",
                        "--n-concurrent",
                        dest="concurrency",
                        type=int,
                        help="maximum number of simultaneous trials")
    launch.add_argument("--output",
                        type=Path,
                        help="new job directory (default: runs/vfsbench-...)")
    for command in (inspect, warm, launch):
        command.add_argument(
            "release",
            help="suite name in a checkout, local release folder, "
            "or Hugging Face dataset repo ID")
        command.add_argument("--revision", help="Hub revision (default: main)")
        command.add_argument("--config", type=Path)
        selection = (command.add_mutually_exclusive_group()
                     if command is launch else command)
        selection.add_argument("--task",
                               action="append",
                               help="select a task ID (repeatable)")
        if command is launch:
            selection.add_argument("--available",
                                   action="store_true",
                                   help="select tasks with a suite adapter")
        command.add_argument("--offline", action="store_true")
    commands.add_parser(
        "harbor",
        help="generate a Harbor job (see vfsbench harbor export --help)")
    args = parser.parse_args(argv)
    if args.command == "snapshot":
        from .snapshot import SNAPSHOT, build

        print(build() if args.action == "build" else SNAPSHOT)
        return
    if args.command == "run":
        if find_spec("harbor") is None:
            parser.error("run requires the vfsbench[harbor] extra")
        if args.concurrency is not None and args.concurrency < 1:
            parser.error("--n-concurrent must be positive")
        if args.model and not (args.agent or args.agent_import_path):
            parser.error("--model requires --agent or --agent-import-path")

    named = {"toolathlon": Toolathlon, "mcpatlas": MCPAtlas}
    if Path(args.release).is_dir():
        if args.revision:
            parser.error("--revision requires a Hub repository ID")
        suite = Dataset(args.release, local_files_only=args.offline)
    elif args.release in named and not args.revision:
        suite = named[args.release](local_files_only=args.offline)
    else:
        suite = Dataset.from_hub(args.release,
                                 revision=args.revision or "main",
                                 local_files_only=args.offline)
    if args.command == "run":
        from .harbor.run import run

        try:
            return run(suite, args)
        except (FileExistsError, KeyError, ValueError) as exc:
            parser.error(str(exc))
    config = TrialConfig.from_toml(
        args.config) if args.config else TrialConfig()
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
    sys.exit(main())
