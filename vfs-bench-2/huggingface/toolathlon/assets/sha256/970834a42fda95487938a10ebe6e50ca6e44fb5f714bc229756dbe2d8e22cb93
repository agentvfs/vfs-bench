#!/usr/bin/env python
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3] / "server" / "clients"))

import gws  # noqa: E402
import notion as notion_client  # noqa: E402

TASK = HERE.parent
REPO = TASK.parents[2]
FINALPOOL = REPO / "submodule" / "Toolathlon" / "tasks" / "finalpool"
UPSTREAM = FINALPOOL / TASK.name / "files"

IDENTITY = HERE / "notion.json"
FOLDER_NAME = "quantitative-financial-analysis"
FOLDER_MIME = "application/vnd.google-apps.folder"
# What both arms are told the folder is. The mock numbers Drive items from
# f0001 after a reset and this is the first thing created, so the id is
# predictable -- `agent/run_agent.py` defaults DRIVE_FOLDER_ID to it for the
# MCP server and for the `gws` CLI's `folderId` scope alike. Asserted below
# rather than assumed, because a silent mismatch would put the agent's
# spreadsheet somewhere the evaluator's folder constraint does not look.
FOLDER_ID = "f0001"


def write_id(name: str, value: str) -> None:
    """Record an id where upstream's own code looks for it.

    Args:
        name (str): the file name under upstream's `files/`.
        value (str): the id.
    """
    if not UPSTREAM.parent.is_dir():
        raise SystemExit(f"no upstream task at {UPSTREAM.parent}; is the "
                         f"Toolathlon submodule checked out?")
    UPSTREAM.mkdir(parents=True, exist_ok=True)
    (UPSTREAM / name).write_text(value)


def drive() -> None:
    """Empty the mock Drive and put the task's folder back."""
    gws.reset()
    folder_id = gws.create_folder(FOLDER_NAME)
    if folder_id != FOLDER_ID:
        raise SystemExit(f"the mock gave the folder id {folder_id!r}, "
                         f"but both arms are configured for {FOLDER_ID!r}")
    write_id("folder_id.txt", FOLDER_ID)
    print(f"drive: reset, folder {FOLDER_NAME!r} is {FOLDER_ID}")


def notion() -> None:
    """Re-seed the task's Notion workspace from the committed fixture."""
    identity = json.loads(IDENTITY.read_text())
    # A fixture NAME, resolved under the fake's own fixtures/notion/, where
    # `server/fakes/stack.py` copies this task's rows in as `<task>.json`.
    reply = notion_client.reset(identity["workspace"], TASK.name)
    write_id("duplicated_page_id.txt", identity["page_id"])
    print(f"notion: seeded workspace {reply['tenants']!r}, page "
          f"{identity['page_title']!r} is {identity['page_id']}")


def main() -> int:
    """Seed both services."""
    drive()
    notion()
    return 0


if __name__ == "__main__":
    sys.exit(main())
