import asyncio
import importlib
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

TASK_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = TASK_DIR.parents[2]
TOOLATHLON = REPO_ROOT / "submodule" / "Toolathlon"
PACKAGE = f"tasks.finalpool.{TASK_DIR.name}"
sys.path.insert(0, str(REPO_ROOT / "task" / "toolathlon" / "shared"))
sys.path.insert(0, str(REPO_ROOT / "agent"))

import snowflake_mcp  # noqa: E402 - the path entry above has to come first
# Where the agent writes, defined once in agent/services.py.
from services import agent_workspace  # noqa: E402

# What upstream's own verification queries count, and what this script
# re-counts afterwards -- `execute_sql` swallows its exceptions and returns
# False, so a failed insert is otherwise a line of red text and exit 0.
INTERFERENCE_ROWS = 1000
INVOICE_PDFS = 15


def verify(snowflake, workspace: str) -> None:
    """Fail loudly on what upstream's preprocess fails quietly on.

    Args:
        snowflake: the fake warehouse, `server/clients/snowflake.py`.
        workspace (str): the agent workspace the PDFs went to.

    Raises:
        SystemExit: if the fixture is not what the ground truth describes.
    """
    for table in ("INVOICES", "INVOICE_PAYMENTS"):
        rows = snowflake.execute(
            f"SELECT COUNT(*) AS N FROM PURCHASE_INVOICE.PUBLIC.{table}")
        if rows[0]["N"] != INTERFERENCE_ROWS:
            raise SystemExit(f"seed_db: {table} has {rows[0]['N']} rows, "
                             f"expected {INTERFERENCE_ROWS}")
    pdfs = sorted(Path(workspace, "files").glob("*.pdf"))
    if len(pdfs) != INVOICE_PDFS:
        raise SystemExit(f"seed_db: {len(pdfs)} invoice PDFs in {workspace}"
                         f"/files, expected {INVOICE_PDFS}")
    truth = TOOLATHLON / "tasks" / "finalpool" / TASK_DIR.name / \
        "groundtruth_workspace" / "invoice.jsonl"
    named = {
        json.loads(line)["invoice_id"]
        for line in truth.read_text().splitlines() if line.strip()
    }
    missing = named - {p.stem for p in pdfs}
    if missing:
        raise SystemExit(f"seed_db: ground truth names invoices with no PDF: "
                         f"{sorted(missing)}")


def seed() -> int:
    """Run upstream's preprocess with its warehouse pointed at Postgres."""
    sys.path.insert(0, str(TOOLATHLON))
    sys.path.insert(0, str(REPO_ROOT))
    from server.clients import snowflake as snowflake

    build = importlib.import_module(
        f"{PACKAGE}.preprocess.create_snowflake_db")
    build.MCPServerManager = snowflake_mcp.Manager
    build.call_tool_with_retry = snowflake_mcp.tool_call(snowflake)

    workspace = str(agent_workspace(TASK_DIR))
    Path(workspace).mkdir(parents=True, exist_ok=True)
    entry = importlib.import_module(f"{PACKAGE}.preprocess.main")
    # Required by its parser, and then only printed.
    sys.argv = [
        "main", "--agent_workspace", workspace, "--launch_time",
        datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ]
    asyncio.run(entry.main())
    verify(snowflake, workspace)
    return 0


def relaunch() -> int:
    """Re-run this script inside Toolathlon's virtualenv."""
    if not TOOLATHLON.is_dir():
        raise FileNotFoundError(f"no Toolathlon checkout at {TOOLATHLON}")
    done = subprocess.run(
        [
            "uv", "run", "--with", "psycopg2-binary", "python",
            str(Path(__file__).resolve()), "--seed"
        ],
        cwd=str(TOOLATHLON),
        env={**os.environ},
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        sys.stderr.write(done.stdout[-4000:] + done.stderr[-4000:])
        return done.returncode
    # Its own output is a thousand lines of per-row chatter; one line is
    # enough for a batch log, and the failure path above prints everything.
    print(f"PURCHASE_INVOICE: seeded by upstream {PACKAGE}.preprocess.main "
          f"({INTERFERENCE_ROWS} interference rows, {INVOICE_PDFS} invoices)")
    return 0


if __name__ == "__main__":
    sys.exit(seed() if "--seed" in sys.argv else relaunch())
