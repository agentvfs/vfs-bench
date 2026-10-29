#!/usr/bin/env python3
"""Verify meeting-reschedule-response task:
1. Old meeting event (Friday May 22 2:00-3:00 PM) deleted from calendar.
2. New meeting event (Saturday May 23 10:00-11:00 AM) exists in calendar.
3. Confirmation email sent to hr.department.

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads Peter's calendar
events and his sent mail from the gws fake's run SQLite in place of the
calendar and email mocks', with every check and weight of upstream's
verifier kept.
"""

import sqlite3
import sys
from datetime import datetime, timezone
from email.utils import getaddresses

# Pyodide carries the time zone database as a package that zoneinfo finds
# only once it is imported; CPython reads the system's.
try:
    import tzdata  # noqa: F401
except ImportError:
    pass

GWS_DB_PATH = "/var/lib/mock-data/gws/gws.db"
# Peter's calendar: the primary one, which upstream's user_id = 1 was.
PRIMARY_CALENDAR = "integ@example.com"
UTC_ZONES = {"UTC", "Etc/UTC", "GMT", "Etc/GMT", "Z"}

# Wall-clock instants the agent must produce in the calendar (UTC).
OLD_START = datetime(2026, 5, 22, 14, 0, 0)
OLD_END = datetime(2026, 5, 22, 15, 0, 0)
NEW_START = datetime(2026, 5, 23, 10, 0, 0)
NEW_END = datetime(2026, 5, 23, 11, 0, 0)


def parse_iso(value: str | None, zone: str | None = None) -> datetime | None:
    """Parse an event's dateTime into a naive UTC datetime, or None on failure.

    Upstream's calendar mock stores each time in UTC. The gws fake keeps
    the dateTime as written, with its offset, or with a time zone of its
    own (`zone`) and none; an all-day event has none at all.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if parsed.tzinfo is None:
        if zone is not None and zone not in UTC_ZONES:
            try:
                from zoneinfo import ZoneInfo

                parsed = parsed.replace(tzinfo=ZoneInfo(zone))
            except Exception as e:
                print(f"WARN: cannot read time zone {zone}: {e}")
                return None
        else:
            parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def open_db(path: str) -> sqlite3.Connection | None:
    """Open a SQLite database with Row factory, or None on failure."""
    try:
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"FAIL: Could not open database {path}: {e}")
        return None


def calendar_events(conn):
    """Each event on Peter's calendar in the gws fake's run, as a dict.

    Upstream's calendar mock keeps an event as one calendar_event row. The
    gws fake keeps a Google Calendar Event: its title is its summary, and
    upstream's event_type has no field. A cancelled event is a deleted one.
    """
    rows = conn.execute(
        "SELECT id, summary, description, startDateTime, startTimeZone, "
        "endDateTime, endTimeZone FROM Event WHERE calendarId = ? AND "
        "status != 'cancelled' ORDER BY seq", (PRIMARY_CALENDAR, )).fetchall()
    return [{
        "id": row["id"],
        "title": row["summary"],
        "description": row["description"],
        "start_time": parse_iso(row["startDateTime"], row["startTimeZone"]),
        "end_time": parse_iso(row["endDateTime"], row["endTimeZone"]),
    } for row in rows]


def sent_emails(conn):
    """Each sent email in the gws fake's run, as (recipients, subject, body).

    Upstream's email mock keeps an email as one row, a sent one with
    folder='sent' and its one recipient_email. The gws fake keeps a Gmail
    message with its labels and headers: a sent one is labelled SENT and not
    TRASH, and its recipients are the addresses in its To header.
    """
    sent = []
    rows = conn.execute(
        "SELECT id, bodyText FROM Message m WHERE EXISTS (SELECT 1 FROM "
        "MessageLabel l WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'SENT') AND NOT EXISTS (SELECT 1 FROM MessageLabel l "
        "WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'TRASH') ORDER BY seq").fetchall()
    for message_id, body in rows:
        headers = conn.execute(
            "SELECT name, value FROM MessageHeader WHERE messageId = ? "
            "ORDER BY seq", (message_id, )).fetchall()
        to = [v for n, v in headers if n.lower() == "to"]
        subject = next((v for n, v in headers if n.lower() == "subject"), "")
        sent.append(([a for _, a in getaddresses(to)], subject, body))
    return sent


def find_event(conn, start: datetime, end: datetime):
    """Return the first of Peter's events whose UTC instants match (start, end), or None."""
    for row in calendar_events(conn):
        if row["start_time"] == start and row["end_time"] == end:
            return row
    return None


def check_old_event_deleted():
    """Old meeting event should no longer exist."""
    conn = open_db(GWS_DB_PATH)
    if not conn:
        return 0.0
    row = find_event(conn, OLD_START, OLD_END)
    conn.close()

    if row is None:
        print("PASS: Old meeting event has been deleted")
        return 0.33
    print(
        f"FAIL: Old meeting event still exists (id={row['id']}, title='{row['title']}')"
    )
    return 0.0


def check_new_event_created():
    """New rescheduled meeting event should exist."""
    conn = open_db(GWS_DB_PATH)
    if not conn:
        return 0.0
    row = find_event(conn, NEW_START, NEW_END)
    conn.close()

    if row:
        print(
            f"PASS: New meeting event exists (id={row['id']}, title='{row['title']}')"
        )
        return 0.34
    print("FAIL: New meeting event not found for the rescheduled time")
    return 0.0


def check_confirmation_email():
    """Confirmation email should be sent to HR."""
    conn = open_db(GWS_DB_PATH)
    if not conn:
        return 0.0
    # The last one sent to HR, as upstream's ORDER BY id DESC LIMIT 1.
    row = next(
        (
            {"subject": subject, "body": body}
            for to, subject, body in reversed(sent_emails(conn))
            if "hr@work.mosi.inc" in to
        ),
        None,
    )
    conn.close()

    if not row:
        print("FAIL: No confirmation email sent to hr@work.mosi.inc")
        return 0.0

    subject_lower = (row["subject"] or "").lower()
    body_lower = (row["body"] or "").lower()

    has_reschedule = (
        "reschedule" in subject_lower
        or "reschedule" in body_lower
        or "confirm" in subject_lower
    )
    has_new_time = (
        "may 23" in body_lower or "10:00" in body_lower or "saturday" in body_lower
    )

    if has_reschedule and has_new_time:
        print(f"PASS: Confirmation email sent (subject='{row['subject']}')")
        return 0.33

    if has_reschedule or has_new_time:
        print(
            f"PARTIAL: Email sent but missing some details (subject='{row['subject']}')"
        )
        return 0.15

    print(
        f"FAIL: Email sent but doesn't confirm reschedule (subject='{row['subject']}')"
    )
    return 0.0


def main():
    scores = [
        check_old_event_deleted(),
        check_new_event_created(),
        check_confirmation_email(),
    ]
    total = sum(scores)
    print(f"Score: {total:.2f}/1.0")
    sys.exit(0 if total >= 0.9 else 1)


if __name__ == "__main__":
    main()
