import csv
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3] / "server" / "clients"))

import gws  # noqa: E402

TASK = HERE.parent
UPSTREAM = (TASK.parents[2] / "submodule" / "Toolathlon" / "tasks" /
            "finalpool" / TASK.name)

FOLDER_NAME = "NHL-B2B-Analysis"
SOURCE_SHEET = "NHL 2425 Schedule"
# What both arms are told the folder is. The mock numbers Drive items from
# f0001 after a reset and this is the first thing created, so the id is
# predictable -- `agent/run_agent.py` defaults DRIVE_FOLDER_ID to it for the
# MCP server and for the `gws` CLI's `folderId` scope alike. Asserted below
# rather than assumed: the evaluator only lists this one folder, so a
# silent mismatch would read as an agent that created nothing.
FOLDER_ID = "f0001"


def main() -> None:
    """Reset the fake server and seed it as Toolathlon's preprocess does."""
    gws.reset()
    folder_id = gws.create_folder(FOLDER_NAME)
    if folder_id != FOLDER_ID:
        raise SystemExit(f"the mock gave the folder id {folder_id!r}, "
                         f"but both arms are configured for {FOLDER_ID!r}")
    sheet_id = gws.create_sheet(SOURCE_SHEET, folder_id)

    with open(HERE / "nhl.csv", newline="") as fh:
        rows = list(csv.reader(fh))
    gws.write_values(sheet_id, "Sheet1!A1", rows)

    # Where upstream's own evaluation/main.py reads the folder from. It is
    # relative to that file, so it has to be written into the checkout and
    # not next to this script.
    if not UPSTREAM.is_dir():
        raise SystemExit(f"no upstream task at {UPSTREAM}; is the "
                         f"Toolathlon submodule checked out?")
    (UPSTREAM / "files").mkdir(parents=True, exist_ok=True)
    (UPSTREAM / "files" / "folder_id.txt").write_text(folder_id)

    print(f"GWS_URL={gws.base()}")
    print(f"folder_id={folder_id}")
    print(f"source_spreadsheet_id={sheet_id}")
    print(f"seeded_rows={len(rows)}")


if __name__ == "__main__":
    sys.exit(main())
