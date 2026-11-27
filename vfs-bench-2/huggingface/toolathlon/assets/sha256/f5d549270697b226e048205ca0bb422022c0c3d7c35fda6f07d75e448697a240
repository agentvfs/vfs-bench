import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "task" / "toolathlon" / "shared"))

import notion_template as template  # noqa: E402

HR_PAGE = "27ad10a4-8436-8035-b3bc-e9de9db3dd82"
FIXTURE = Path(__file__).resolve().parent / "notion_fixture.json"

DEFAULTS = {
    "created_time": "2025-09-01T00:00:00.000Z",
    "last_edited_time": "2025-09-02T00:00:00.000Z",
    "created_by": "user-hr",
    "last_edited_by": "user-hr",
    "url_base": "https://www.notion.so/",
}


def main() -> int:
    """Write the fixture, or compare the committed one against the template."""
    parser = argparse.ArgumentParser(
        description="Re-derive notion_fixture.json from "
        "Toolathlon's own public Notion template.")
    parser.add_argument("--check",
                        action="store_true",
                        help="compare instead of writing")
    args = parser.parse_args()

    fixture = template.build(HR_PAGE, "HR Record", DEFAULTS)
    text = json.dumps(fixture, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not FIXTURE.exists():
            print(f"{FIXTURE} does not exist", file=sys.stderr)
            return 1
        if FIXTURE.read_text() != text:
            print(f"{FIXTURE} differs from the live template", file=sys.stderr)
            return 1
        print(f"{FIXTURE.name} matches the template")
        return 0
    FIXTURE.write_text(text)
    print(f"wrote {FIXTURE} "
          f"({len(fixture['databases'])} databases, "
          f"{len(fixture['pages'])} pages, {len(fixture['blocks'])} blocks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
