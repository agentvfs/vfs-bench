#!/usr/bin/env python
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3] / "server" / "clients"))

import gws  # noqa: E402

TASK = HERE.parent
REPO = TASK.parents[2]
FINALPOOL = REPO / "submodule" / "Toolathlon" / "tasks" / "finalpool"
UPSTREAM = FINALPOOL / TASK.name / "files"

FOLDER_NAME = "InvestmentAnalysisWorkspace"
# What both arms are told the folder is. The mock numbers Drive items from
# f0001 after a reset and this is the first thing created, so the id is
# predictable -- `agent/run_agent.py` defaults DRIVE_FOLDER_ID to it for the
# MCP server and for the `gws` CLI's `folderId` scope alike. Asserted below
# rather than assumed: the evaluator only looks inside this folder, so a
# silent mismatch would read as an agent that created nothing.
FOLDER_ID = "f0001"


def main() -> int:
    """Empty the mock Drive and put the task's folder back."""
    gws.reset()
    folder_id = gws.create_folder(FOLDER_NAME)
    if folder_id != FOLDER_ID:
        raise SystemExit(f"the mock gave the folder id {folder_id!r}, "
                         f"but both arms are configured for {FOLDER_ID!r}")
    if not UPSTREAM.parent.is_dir():
        raise SystemExit(f"no upstream task at {UPSTREAM.parent}; is the "
                         f"Toolathlon submodule checked out?")
    UPSTREAM.mkdir(parents=True, exist_ok=True)
    (UPSTREAM / "folder_id.txt").write_text(FOLDER_ID)
    print(f"drive: reset, folder {FOLDER_NAME!r} is {FOLDER_ID}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
