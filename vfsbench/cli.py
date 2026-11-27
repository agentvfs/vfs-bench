"""Run and inspect Mirage benchmark trials."""

import argparse
import asyncio
import json
import sys
from collections import Counter

from . import api


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["harbor"]:
        from .harbor.export import main as harbor

        return harbor(argv[1:])
    parser = argparse.ArgumentParser(prog="vfsbench", description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    launch = commands.add_parser(
        "run", help="open a trial, verify it, and return its report")
    launch.add_argument("--task", required=True, help="task ID")
    launch.add_argument("--command", help=argparse.SUPPRESS)
    launch.add_argument("--output", help="new directory for trial.json")
    inspect = commands.add_parser(
        "status", help="list task availability and service requirements")
    inspect.add_argument("--task",
                         dest="task_ids",
                         action="append",
                         help="task ID (repeatable)")
    for cmd in (launch, inspect):
        cmd.add_argument(
            "release",
            help="checkout suite name, release directory, or Hub dataset ID")
        cmd.add_argument("--revision", help="Hub revision to resolve and pin")
        cmd.add_argument("--config", help="trial configuration TOML")
        cmd.add_argument("--local-files-only",
                         "--offline",
                         action="store_true",
                         help="require cached dependencies")
    surfaces = launch.add_subparsers(dest="surface")
    for name, description in (("shell", "run a Mirage shell line"),
                              ("workspace",
                               "use Mirage workspace shell or vfs")):
        surface = surfaces.add_parser(name,
                                      help=description,
                                      add_help=False,
                                      prefix_chars="+")
        surface.add_argument("arguments", nargs=argparse.REMAINDER)
    snapshot = commands.add_parser("snapshot",
                                   help="manage the default microsandbox disk")
    snapshot.add_argument("operation", choices=("build", "name"))
    commands.add_parser("harbor", help="export a Harbor job")
    options = vars(parser.parse_args(argv))
    action = options.pop("action")
    if action == "snapshot":
        from .snapshot import SNAPSHOT, build

        print(build() if options["operation"] == "build" else SNAPSHOT)
        return
    try:
        if action == "run":
            surface = options.pop("surface")
            if surface:
                from .mirage_cli import invoke

                return invoke(surface, options.pop("arguments"), options)
            report = asyncio.run(api.run(**options))
            print(json.dumps(report.to_dict(), indent=2, allow_nan=False))
            return
        tasks = api.status(**options)
    except (FileExistsError, KeyError, ValueError) as exc:
        parser.error(str(exc))
    counts = Counter()
    for key, (state, reason) in tasks.items():
        counts[state] += 1
        print("\t".join(part for part in (key, state, reason) if part))
    print(", ".join(f"{count} {state}"
                    for state, count in sorted(counts.items())))


if __name__ == "__main__":
    sys.exit(main())
