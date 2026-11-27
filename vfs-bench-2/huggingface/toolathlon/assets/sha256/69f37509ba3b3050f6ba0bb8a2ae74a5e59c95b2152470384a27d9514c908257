import asyncio
import importlib
import json
import os
import random
import subprocess
import sys
from datetime import datetime
from pathlib import Path

TASK_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = TASK_DIR.parents[2]
TOOLATHLON = REPO_ROOT / "submodule" / "Toolathlon"
UPSTREAM = TOOLATHLON / "tasks" / "finalpool" / TASK_DIR.name
PACKAGE = f"tasks.finalpool.{TASK_DIR.name}"
sys.path.insert(0, str(REPO_ROOT / "task" / "toolathlon" / "shared"))
sys.path.insert(0, str(REPO_ROOT / "agent"))

import snowflake_mcp  # noqa: E402 - the path entry above has to come first
# Where the agent writes, defined once in agent/services.py.
from services import agent_workspace  # noqa: E402

DATABASE = "TRAVEL_EXPENSE_REIMBURSEMENT"
CONTACTS = f"{DATABASE}.PUBLIC.ENTERPRISE_CONTACTS"
# Quoted because it starts with a digit, which is also how the agent and the
# evaluator have to spell it.
EXPENSES = f'{DATABASE}.PUBLIC."2024Q4REIMBURSEMENT"'
# Eight employees, two claims each. Asserted rather than derived: the count
# is what tells a half-finished run from a finished one, and `execute_sql`
# upstream swallows its own exceptions.
CLAIMS = 16
# Those eight, plus the four managers `manager_mapping.json` names.
CONTACT_ROWS = 12
# Upstream passes this seed to claim generation, but its contact generator
# reads the module-level ``random`` object instead. Use the same seed there so
# both arms receive identical contacts without changing its ranges or order.
FIXED_SEED = 7


def truth(name: str):
    """Read one of the ground truth files this run just wrote.

    Args:
        name (str): its filename.

    Returns:
        The parsed JSON.
    """
    return json.loads((UPSTREAM / "groundtruth_workspace" /
                       name).read_text(encoding="utf-8"))


def verify(snowflake, workspace: str) -> None:
    """Fail loudly on what upstream's preprocess fails quietly on.

    Args:
        snowflake: the fake warehouse, `server/clients/snowflake.py`.
        workspace (str): the agent workspace the packages went to.

    Raises:
        SystemExit: if the fixture is not what the ground truth describes.
    """
    claims = truth("expense_claims.json")
    if len(claims) != CLAIMS:
        raise SystemExit(f"seed_db: generated {len(claims)} claims, "
                         f"expected {CLAIMS}")

    contacts = truth("enterprise_contacts.json")
    if len(contacts) != CONTACT_ROWS:
        raise SystemExit(f"seed_db: ground truth names {len(contacts)} "
                         f"contacts, expected {CONTACT_ROWS}")
    rows = snowflake.execute(f"SELECT COUNT(*) AS N FROM {CONTACTS}")
    if rows[0]["N"] != len(contacts):
        raise SystemExit(f"seed_db: ENTERPRISE_CONTACTS has {rows[0]['N']} "
                         f"rows, ground truth names {len(contacts)}")

    # Empty on purpose -- filling it is the task -- so this asserts the table
    # exists and starts clean, which is the half an arm running second would
    # otherwise inherit from the arm before it.
    rows = snowflake.execute(f"SELECT COUNT(*) AS N FROM {EXPENSES}")
    if rows[0]["N"] != 0:
        raise SystemExit(f"seed_db: 2024Q4REIMBURSEMENT starts with "
                         f"{rows[0]['N']} rows, expected none")

    files = Path(workspace, "files")
    packages = sorted(files.glob("expense_claim_*.tar.gz"))
    if len(packages) != CLAIMS:
        raise SystemExit(f"seed_db: {len(packages)} claim packages in "
                         f"{files}, expected {CLAIMS}")
    named = {claim["claim_id"] for claim in claims}
    built = {
        path.name[len("expense_claim_"):-len(".tar.gz")]
        for path in packages
    }
    if named != built:
        raise SystemExit(f"seed_db: ground truth and packages name different "
                         f"claims: {sorted(named ^ built)}")
    if not (files / "policy_en.pdf").is_file():
        raise SystemExit(f"seed_db: no policy_en.pdf in {files}; the caps "
                         f"cannot be checked without it")


def seed() -> int:
    """Run upstream's preprocess with its warehouse pointed at Postgres."""
    sys.path.insert(0, str(TOOLATHLON))
    sys.path.insert(0, str(REPO_ROOT))
    from server.clients import snowflake as snowflake

    build = importlib.import_module(
        f"{PACKAGE}.preprocess.create_snowflake_db")
    build.random = random.Random(FIXED_SEED)
    build.MCPServerManager = snowflake_mcp.Manager
    build.call_tool_with_retry = snowflake_mcp.tool_call(snowflake)
    # ...and claim the bare name too, before `main` is imported. Where
    # `payable-invoice-checker`'s preprocess writes `from . import
    # create_snowflake_db`, this one writes `from create_snowflake_db import
    # initialize_database` off a `sys.path` entry of its own directory, which
    # imports a *second* module object with its own globals -- so patching
    # the package-qualified one alone left the original in place and the run
    # went back to waiting 120 seconds for an MCP server that never starts.
    sys.modules.setdefault("create_snowflake_db", build)

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
    # Its own output is a per-claim listing of every injected error; one line
    # is enough for a batch log, and the failure path above prints all of it.
    print(f"{DATABASE}: seeded by upstream {PACKAGE}.preprocess.main "
          f"({CLAIMS} claim packages, {CONTACT_ROWS} contacts, "
          f"empty expense table)")
    return 0


if __name__ == "__main__":
    sys.exit(seed() if "--seed" in sys.argv else relaunch())
