#!/usr/bin/env python
import argparse
import imaplib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FIXTURE = HERE / "notion_fixture.json"
MAILBOXES = HERE / "mailboxes.json"
IDENTITY = HERE / "notion.json"
DEFAULT_NOTION = "http://127.0.0.1:5091"
# Upstream's preprocess writes the id of the page it duplicated here, and both
# the task's token_key_session and its evaluator read it back. Our fixture's
# page id is the same fact, so it goes to the same file.
PAGE_ID_FILE = (REPO / "submodule" / "Toolathlon" / "tasks" / "finalpool" /
                "notion-hr" / "files" / "duplicated_page_id.txt")
STANDARD_FOLDERS = ("INBOX", "Sent", "Drafts", "Trash", "Junk")


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
          f"{len(fixture['pages'])} pages")

    if PAGE_ID_FILE.parent.is_dir():
        PAGE_ID_FILE.write_text(identity["page_id"])
        print(f"notion: wrote {PAGE_ID_FILE.name} "
              f"({identity['page_id']})")


def clear_mailbox(account: dict) -> int:
    """Delete every message in one mailbox, creating it if it is new.

    GreenMail runs with authentication disabled, so a login is also what
    brings an account into existence; the evaluator logs into all eleven, and
    an account it cannot open reads as a failure rather than an empty inbox.

    Args:
        account (dict): {"email", "password"} plus the imap host and port.

    Returns:
        int: how many messages were deleted.
    """
    imap = imaplib.IMAP4(account.get("imap_server", "localhost"),
                         int(account.get("imap_port", 1143)))
    imap.login(account["email"], account["password"])
    removed = 0
    for folder in STANDARD_FOLDERS:
        imap.create(folder)
        status, _ = imap.select(folder)
        if status != "OK":
            continue
        _, data = imap.search(None, "ALL")
        ids = data[0].split()
        for message_id in ids:
            imap.store(message_id, "+FLAGS", "\\Deleted")
        if ids:
            imap.expunge()
        removed += len(ids)
    imap.logout()
    return removed


def seed_mail() -> None:
    """Empty every mailbox the task sends from or grades on."""
    accounts = json.loads(MAILBOXES.read_text())
    total = 0
    for account in accounts:
        total += clear_mailbox(account)
    print(f"mail: cleared {len(accounts)} mailboxes ({total} messages)")


def main() -> int:
    """Seed Notion and clear the mailboxes."""
    parser = argparse.ArgumentParser(
        description='Seed the fake Notion workspace, and reset '
        'the mailboxes the task grades on.')
    parser.add_argument("--notion-url",
                        default=os.environ.get("NOTION_URL", DEFAULT_NOTION),
                        help="base URL of the fake Notion server")
    parser.add_argument("--skip-mail",
                        action="store_true",
                        help="seed Notion only")
    args = parser.parse_args()

    seed_notion(args.notion_url.rstrip("/"))
    if not args.skip_mail:
        seed_mail()
    return 0


if __name__ == "__main__":
    sys.exit(main())
