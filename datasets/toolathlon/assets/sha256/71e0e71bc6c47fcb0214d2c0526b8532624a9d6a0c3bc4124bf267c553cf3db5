import json
import re
import sys
import tempfile
from datetime import date, datetime, timedelta
from email.utils import format_datetime, parsedate_to_datetime
from pathlib import Path

TASK_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = TASK_DIR.parents[2]
sys.path.insert(0, str(REPO_ROOT / "server" / "clients"))
sys.path.insert(0, str(REPO_ROOT / "server" / "seed"))

import gws  # noqa: E402
import seed_mail  # noqa: E402

FINALPOOL = REPO_ROOT / "submodule" / "Toolathlon" / "tasks" / "finalpool"
UPSTREAM = FINALPOOL / TASK_DIR.name
FIXTURE = UPSTREAM / "files" / "emails_backup.json"
# Read by the evaluator from its own task directory, whatever
# --groundtruth_workspace says, so it is rewritten in place.
TODAY_FILE = UPSTREAM / "groundtruth_workspace" / "today.txt"
MAILBOX = TASK_DIR / "shared" / "emails_config.json"
# The day upstream's fixture is written about: its `today.txt`, and the day
# its last message arrives.
ANCHOR = date(2025, 9, 15)
# Times are left alone, so a date on its own is the only thing that moves.
ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def moved(text: str, delta: timedelta) -> str:
    """Move every `yyyy-mm-dd` in a string by the same number of days.

    Args:
        text (str): a subject or a body.
        delta (timedelta): how far to move.

    Returns:
        str: the text with its dates moved and everything else identical.
    """

    def one(found: re.Match) -> str:
        """Move a single date."""
        return str(date.fromisoformat(found.group(0)) + delta)

    return ISO_DATE.sub(one, text)


def redate(entries: list[dict], delta: timedelta) -> list[dict]:
    """Move a whole fixture mailbox forward.

    Args:
        entries (list[dict]): the records from `emails_backup.json`.
        delta (timedelta): how far to move.

    Returns:
        list[dict]: the same records, re-dated.
    """
    moved_entries = []
    for entry in entries:
        copy = dict(entry)
        when = parsedate_to_datetime(entry["date"])
        # Reformatted rather than patched, so the weekday name stays true.
        copy["date"] = format_datetime(when + delta)
        for field in ("subject", "body_text", "body_html"):
            if isinstance(copy.get(field), str):
                copy[field] = moved(copy[field], delta)
        moved_entries.append(copy)
    return moved_entries


def calendar(when: date) -> None:
    """Empty the mock calendar and set its clock to the fixture's today.

    Args:
        when (date): the day the fixture is now written about.

    Raises:
        SystemExit: when the mock is not running.
    """
    epoch = datetime.combine(when, datetime.min.time()).isoformat() + "Z"
    gws.reset(epoch=epoch)


def mail(entries: list[dict]) -> int:
    """Reset GreenMail and append the re-dated inbox.

    Imported and called, not spawned. `seed_mail` is a sibling on this
    project's own dependencies, and the command this replaces spelled its
    path -- `task/toolathlon/script/seed_mail.py`, which stopped existing
    when the seeders moved to `server/seed/`. A string nothing resolves
    until a draw runs, and the draw it broke was the whole task's.

    Args:
        entries (list[dict]): the messages to append.

    Returns:
        int: how many messages were appended.
    """
    # A path, because that is what `fill` reads: the temporary file is the
    # re-dated mailbox, which exists nowhere on disk until here.
    with tempfile.NamedTemporaryFile("w", suffix=".json",
                                     delete=False) as handle:
        json.dump({"emails": entries}, handle)
        staged = Path(handle.name)
    try:
        return seed_mail.fill(MAILBOX, staged)
    finally:
        staged.unlink(missing_ok=True)


def main() -> int:
    """Build both halves of the fixture, dated onto today."""
    if not FIXTURE.is_file():
        raise SystemExit(f"no email fixture at {FIXTURE}")
    today = date.today()
    delta = today - ANCHOR
    entries = redate(json.loads(FIXTURE.read_text())["emails"], delta)

    TODAY_FILE.parent.mkdir(parents=True, exist_ok=True)
    TODAY_FILE.write_text(today.isoformat())
    calendar(today)
    print(f"calendar: emptied, clock at {today}; fixture moved "
          f"{delta.days} days, today.txt now {today}")
    mail(entries)
    return 0


if __name__ == "__main__":
    sys.exit(main())
