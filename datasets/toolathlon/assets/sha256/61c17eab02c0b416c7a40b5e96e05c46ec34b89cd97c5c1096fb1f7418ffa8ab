#!/usr/bin/env python
import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "task" / "toolathlon" / "shared"))

import notion_template as template  # noqa: E402

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "notion_fixture.json"
IDENTITY = HERE / "notion.json"

DEFAULTS = {
    "created_time": "2025-09-01T00:00:00.000Z",
    "last_edited_time": "2025-09-02T00:00:00.000Z",
    "created_by": "user-web",
    "last_edited_by": "user-web",
    "url_base": "https://www.notion.so/",
}


def main() -> int:
    """Rewrite the fixture, or compare the committed one against the source."""
    parser = argparse.ArgumentParser(
        description="Re-derive notion_fixture.json from "
        "Toolathlon's own public Notion template.")
    parser.add_argument("--check",
                        action="store_true",
                        help="compare instead of rewriting")
    args = parser.parse_args()

    identity = json.loads(IDENTITY.read_text())
    fixture = template.build(identity["page_id"], identity["page_title"],
                             DEFAULTS)
    rendered = json.dumps(fixture, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not FIXTURE.exists():
            print(f"{FIXTURE} does not exist", file=sys.stderr)
            return 1
        if FIXTURE.read_text() != rendered:
            print(f"{FIXTURE.name} differs from the live template",
                  file=sys.stderr)
            return 1
        print(f"{FIXTURE.name} matches the live template "
              f"({len(fixture['blocks'])} blocks)")
        return 0

    FIXTURE.write_text(rendered)
    print(f"wrote {FIXTURE.name}: {len(fixture['pages'])} page, "
          f"{len(fixture['blocks'])} blocks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
