import argparse
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

# Every install a fresh checkout needs, in the order it needs them. The
# README used to name three of the eleven and leave the rest to be
# discovered when a server failed to start, which is a fine error message
# and a poor first hour.
#
# Each entry is (what it is, argv or repository callable, cwd). Foreign
# installers run as processes; repository setup code is imported and called.
# Nothing here is idempotent by this file's doing -- every step already checks
# whether it ran, because each was written to run on its own and still is.
UV = ("uv", "run", "python")


def install_toolathlon_filesystem() -> int:
    """Install the derived server in-process, as repository code."""
    from server.mcp.setup_filesystem import main
    return main()


def install_linux_sandbox() -> int:
    """Install the checksum-pinned Linux boundary in-process."""
    from server.linux_sandbox import main
    return main()


def install_upstream_python() -> int:
    """Build the task's Pyodide environment from upstream's packages."""
    from task.toolathlon.script.setup_upstream_python import main
    return main([])


Action = tuple[str, ...] | Callable[[], int]
STEPS: tuple[tuple[str, Action, Path], ...] = (
    # First: it patches the submodule so everything after it can run against
    # the local fakes rather than against real Google.
    ("Toolathlon overrides", (*UV, "setup/toolathlon/setup_toolathlon.py"),
     REPO),
    # The evaluator's own virtualenv. Separate because Toolathlon pins
    # `openai-agents==0.0.15` and this repo needs `>=0.18`.
    ("the evaluator's virtualenv", ("uv", "sync"),
     REPO / "submodule" / "Toolathlon"),
    ("notion MCP server", (*UV, "server/mcp/setup_notion.py"), REPO),
    ("howtocook MCP server", (*UV, "server/mcp/setup_howtocook.py"), REPO),
    ("fetch MCP server", (*UV, "server/mcp/setup_fetch.py"), REPO),
    ("memory MCP server", (*UV, "server/mcp/setup_memory.py"), REPO),
    ("calendar MCP server", (*UV, "server/mcp/setup_calendar.py"), REPO),
    ("snowflake MCP server", (*UV, "server/mcp/setup_snowflake.py"), REPO),
    ("google-cloud MCP server", (*UV, "server/mcp/setup_google_cloud.py"),
     REPO),
    ("emails MCP server", ("uv", "sync", "--locked"),
     REPO / "vendor" / "emails-mcp"),
    ("PDF MCP server", ("uv", "sync", "--locked"),
     REPO / "vendor" / "pdf-tools-mcp"),
    ("W&B MCP server", ("uv", "sync", "--locked"),
     REPO / "vendor" / "wandb-mcp"),
    # Builds a binary: upstream ships Linux x86-64 only.
    ("github MCP server", (*UV, "server/mcp/setup_github.py"), REPO),
    # GYM's runner points at its own 0.6.3 source tree. Its committed dist is
    # executable, but it still needs that tree's locked runtime dependencies.
    # `prepare` cannot run because its tsconfig extends a file GYM does not
    # ship, so install the lock while retaining the committed dist.
    ("GYM filesystem MCP server", ("npm", "install", "--ignore-scripts"),
     REPO / "submodule" / "toolathlon_gym" / "local_servers" / "filesystem"),
    # Toolathlon's runner instead resolves the newer package through npx.
    # Extract and install the exact closure fixed by Toolathlon's root lock.
    ("Toolathlon filesystem MCP server", install_toolathlon_filesystem, REPO),
    ("Linux native sandbox", install_linux_sandbox, REPO),
    # GYM's own `howtocook`, which is not Toolathlon's: 0.1.1 vendored in
    # the checkout against npm's 0.2.2 above, a different corpus and a
    # different tool surface. Its `build/` is gitignored in that tree and
    # the one file committed there is a stale partial -- `build/index.js`
    # alone, importing four directories that are not beside it -- so the
    # server cannot start until this runs. GYM's own Dockerfile does the
    # same two commands over the same directory.
    ("GYM howtocook MCP server: install", ("npm", "install"),
     REPO / "submodule" / "toolathlon_gym" / "local_servers" / "HowToCook-mcp"
     ),
    ("GYM howtocook MCP server: build", ("npm", "run", "build"), REPO /
     "submodule" / "toolathlon_gym" / "local_servers" / "HowToCook-mcp"),
    # GYM's Word and PowerPoint servers start with `uv --project <server>
    # run` inside the confined launch, which cannot write into the
    # submodule: without an environment there, uv's attempt to create one
    # is refused and the server exits before `initialize`.
    ("GYM Word MCP server", ("uv", "sync", "--locked"), REPO / "submodule" /
     "toolathlon_gym" / "local_servers" / "Office-Word-MCP-Server"),
    ("GYM PowerPoint MCP server", ("uv", "sync",
                                   "--locked"), REPO / "submodule" /
     "toolathlon_gym" / "local_servers" / "Office-PowerPoint-MCP-Server"),
    ("the mounted wheels", (*UV, "task/toolathlon/script/setup_wheels.py"),
     REPO),
    # Package builders read the installed Pyodide lock, so install first.
    ("the mirage TypeScript packages", ("pnpm", "install",
                                        "--config.engine-strict=false"),
     REPO / "submodule" / "mirage" / "typescript"),
    ("pyodide's packages",
     (*UV, "task/toolathlon/script/setup_pyodide_packages.py"), REPO),
    ("upstream's python environment, for pyodide", install_upstream_python,
     REPO),
    # The mirage arm is this build; without it a run stops at
    # "packages/server/dist/bin/daemon.js missing".
    ("the mirage build", ("pnpm", "build"),
     REPO / "submodule" / "mirage" / "typescript"),
    # The Atlas fakes (`server/fakes/*_api.mjs`) import mirage's generated
    # Prisma clients, which are gitignored there. pnpm's pre-run check would
    # reinstall integ's dependencies first, and the install above has them.
    ("mirage's fake clients", ("pnpm", "--config.verify-deps-before-run=false",
                               "run", "prisma:clients"),
     REPO / "submodule" / "mirage" / "integ"),
    # MCP-Atlas's own harness, which drives both of its arms
    # (`agent/atlas/`): upstream's lock, installed into the
    # checkout's ignored `node_modules`.
    ("MCP-Atlas's agent harness", ("npm", "ci", "--no-audit", "--no-fund"),
     REPO / "submodule" / "mcp-atlas" / "services" / "agent-harness"),
)

# Checked before anything runs, so a missing one is reported now rather than
# eight minutes in.
TOOLS = ("uv", "node", "npm", "pnpm", "git", "go")


def missing_tools() -> list[str]:
    """Which required executables are not on PATH.

    Returns:
        list[str]: the names, in the order declared.
    """
    return [name for name in TOOLS if shutil.which(name) is None]


def main() -> int:
    """Run every install step, or list them.

    Returns:
        int: process exit status.
    """
    ap = argparse.ArgumentParser(
        description="Install everything a fresh checkout needs. Safe to "
        "re-run: every step checks whether it already ran.")
    ap.add_argument("--list",
                    action="store_true",
                    help="print the steps without running them")
    ap.add_argument("--from",
                    dest="start",
                    metavar="N",
                    type=int,
                    default=1,
                    help="skip to step N, to resume after a failure")
    args = ap.parse_args()

    if args.list:
        for n, (what, action, cwd) in enumerate(STEPS, 1):
            where = cwd.relative_to(REPO) if cwd != REPO else Path(".")
            command = (action.__name__ +
                       "()" if callable(action) else " ".join(action))
            print(f"{n:3}  {what:34} {command}  ({where})")
        return 0

    absent = missing_tools()
    if absent:
        print(f"not on PATH: {', '.join(absent)}", file=sys.stderr)
        return 1

    for n, (what, action, cwd) in enumerate(STEPS, 1):
        if n < args.start:
            continue
        print(f"\n=== [{n}/{len(STEPS)}] {what}", flush=True)
        returncode = (action() if callable(action) else subprocess.run(
            action, cwd=cwd).returncode)
        if returncode != 0:
            print(
                f"\nstep {n} failed ({what}). Fix it, then resume with\n"
                f"  uv run python setup/setup.py --from {n}",
                file=sys.stderr)
            return returncode
    print(f"\n=== all {len(STEPS)} steps done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
