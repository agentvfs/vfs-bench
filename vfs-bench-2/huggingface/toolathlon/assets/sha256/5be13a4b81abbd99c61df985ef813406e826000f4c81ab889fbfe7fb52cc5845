import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

TASK_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = TASK_DIR.parents[2]
TOOLATHLON = REPO_ROOT / "submodule" / "Toolathlon"
MODULE = f"tasks.finalpool.{TASK_DIR.name}.preprocess.main"

sys.path.insert(0, str(REPO_ROOT / "agent"))

# Where the agent writes, defined once in agent/services.py.
from services import agent_workspace  # noqa: E402


def main() -> int:
    """Run the upstream preprocess against the fixture Postgres."""
    if not TOOLATHLON.is_dir():
        raise FileNotFoundError(f"no Toolathlon checkout at {TOOLATHLON}")
    workspace = str(agent_workspace(TASK_DIR))
    Path(workspace).mkdir(parents=True, exist_ok=True)

    environment = {
        **os.environ,
        # The one line that turns a paid warehouse into the fixture
        # cluster. Upstream's preprocess imports `snowflake.connector`,
        # so this is the redirect rather than the fake behind it.
        "PYTHONPATH":
        str(REPO_ROOT / "redirect" / "snowflake"),
    }
    # Required by its argument parser and then ignored -- it overwrites the
    # value with the warehouse's own clock. Passed so the parser is happy.
    done = subprocess.run(
        [
            "uv", "run", "--with", "psycopg2-binary", "-m", MODULE,
            "--agent_workspace", workspace, "--launch_time",
            datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ],
        cwd=str(TOOLATHLON),
        env=environment,
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        sys.stderr.write(done.stdout[-2000:] + done.stderr[-2000:])
        return done.returncode
    # Its own output is 200 lines of per-mailbox chatter; one line is enough
    # for a batch log, and the failure path above prints everything.
    print(f"LANDING_TASK_REMINDER: seeded by upstream {MODULE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
