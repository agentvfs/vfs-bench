#!/usr/bin/env python
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FIXTURE = HERE / "notion_fixture.json"
IDENTITY = HERE / "notion.json"
DEFAULT_NOTION = "http://127.0.0.1:5091"
# Upstream's preprocess writes the id of the page it duplicated here, and both
# the task's token_key_session and its evaluator read it back. Our fixture's
# page id is the same fact, so it goes to the same file.
PAGE_ID_FILE = (REPO / "submodule" / "Toolathlon" / "tasks" / "finalpool" /
                "oil-price" / "files" / "duplicated_page_id.txt")


def seed_notion(base: str) -> None:
    """Re-seed the task's Notion workspace from the committed fixture.

    Args:
        base (str): the fake server's base URL.

    Raises:
        SystemExit: if the server is not reachable or refuses the fixture.
    """
    identity = json.loads(IDENTITY.read_text())
    body = json.dumps({
        # The kit takes a list of TENANTS and a fixture NAME. It refuses a
        # `workspace` field and it refuses a path -- mirage closed the hole
        # where a /reset body chose which file on the host was read, so the
        # name is resolved under the fake's own fixtures/notion/ and this
        # task's rows are bind-mounted onto it by docker/compose.yml.
        "tenants": [identity["workspace"]],
        "fixture": HERE.parent.name,
    }).encode()
    req = urllib.request.Request(f"{base}/reset",
                                 data=body,
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            reply = json.loads(resp.read())
    except urllib.error.URLError as err:
        raise SystemExit(f"cannot reach the fake Notion server at {base} "
                         f"({err}); start it with bin/start.sh up")
    if not reply.get("ok"):
        raise SystemExit(f"reset refused: {reply}")

    fixture = json.loads(FIXTURE.read_text())
    print(f"notion: seeded workspace {reply['tenants']!r} with "
          f"{len(fixture['databases'])} databases and "
          f"{len(fixture['blocks'])} blocks")

    if PAGE_ID_FILE.parent.is_dir():
        PAGE_ID_FILE.write_text(identity["page_id"])
        print(f"notion: wrote {PAGE_ID_FILE.name} ({identity['page_id']})")


def main() -> int:
    """Seed the Notion workspace."""
    parser = argparse.ArgumentParser(
        description='Seed the fake Notion workspace this task grades on.')
    parser.add_argument("--notion-url",
                        default=os.environ.get("NOTION_URL", DEFAULT_NOTION),
                        help="base URL of the fake Notion server")
    args = parser.parse_args()

    seed_notion(args.notion_url.rstrip("/"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
