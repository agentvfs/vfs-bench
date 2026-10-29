#!/usr/bin/env python3
"""Verify candidate-interview-slot-confirm task:
1. Calendar event created for interview (May 26, 2:00-3:00 PM).
2. Confirmation email sent to hr.department.

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

EXPECTED_START = datetime(2026, 5, 26, 14, 0, 0)
EXPECTED_END = datetime(2026, 5, 26, 15, 0, 0)


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


def check_calendar_event():
    """Interview calendar event should exist."""
    conn = open_db(GWS_DB_PATH)
    if not conn:
        return 0.0
    matched = None
    for row in calendar_events(conn):
        if (
            row["start_time"] == EXPECTED_START
            and row["end_time"] == EXPECTED_END
        ):
            matched = row
            break
    conn.close()

    if matched:
        title_lower = (matched["title"] or "").lower()
        has_interview = (
            "interview" in title_lower
            or "candidate" in title_lower
            or "alex" in title_lower
            or "developer" in title_lower
        )
        print(
            f"Found event: id={matched['id']}, title='{matched['title']}'"
        )
        if has_interview:
            print("PASS: Interview calendar event created with relevant title")
            return 0.5
        print(
            "PARTIAL: Calendar event exists at correct time but title doesn't reference interview"
        )
        return 0.35
    print("FAIL: No calendar event found for the interview time slot")
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

    has_interview = (
        "interview" in subject_lower
        or "interview" in body_lower
        or "confirm" in subject_lower
    )
    has_date = (
        "may 26" in body_lower
        or "2:00" in body_lower
        or "tuesday" in body_lower
        or "3:00" in body_lower
    )

    if has_interview and has_date:
        print(f"PASS: Confirmation email sent (subject='{row['subject']}')")
        return 0.5

    if has_interview or has_date:
        print(
            f"PARTIAL: Email sent but missing some details (subject='{row['subject']}')"
        )
        return 0.25

    print(
        f"FAIL: Email sent but doesn't confirm interview (subject='{row['subject']}')"
    )
    return 0.0


def main():
    scores = [
        check_calendar_event(),
        check_confirmation_email(),
    ]
    total = sum(scores)
    print(f"Score: {total:.2f}/1.0")
    sys.exit(0 if total >= 0.9 else 1)


if __name__ == "__main__":
    main()
