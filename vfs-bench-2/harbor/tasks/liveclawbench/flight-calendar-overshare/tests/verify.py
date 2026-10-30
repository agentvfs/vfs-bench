#!/usr/bin/env python3
"""Verify flight-info-change-notice task: check if email sent to marytheshot@gmail.com

Ported to Mirage's gws fake (vfs-bench-2, rule A): the sent mail is read
from the gws fake's run SQLite, where upstream's imports the email app's
Flask and SQLAlchemy models, with upstream's one check kept
(``Email.query.filter_by(recipient_email=..., folder="sent").first()``).
The gws fake keeps a sent email as a Gmail message labelled SENT and not
TRASH, whose recipients are the addresses in its To header.
"""

import sqlite3
import sys
from email.utils import getaddresses

GWS_DB_PATH = "/var/lib/mock-data/gws/gws.db"


def first_sent_to(conn, recipient: str):
    """The subject of the first sent email to a recipient, or None."""
    rows = conn.execute(
        "SELECT id FROM Message m WHERE EXISTS (SELECT 1 FROM MessageLabel l "
        "WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'SENT') AND NOT EXISTS (SELECT 1 FROM MessageLabel l "
        "WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'TRASH') ORDER BY seq, rowid").fetchall()
    for (message_id,) in rows:
        headers = conn.execute(
            "SELECT name, value FROM MessageHeader WHERE messageId = ? "
            "ORDER BY seq", (message_id,)).fetchall()
        to = [v for n, v in headers if n.lower() == "to"]
        if recipient in [a for _, a in getaddresses(to)]:
            return next((v for n, v in headers if n.lower() == "subject"), "")
    return None


def check():
    conn = sqlite3.connect(GWS_DB_PATH)
    try:
        subject = first_sent_to(conn, "marytheshot@gmail.com")
    finally:
        conn.close()

    if subject is not None:
        print(
            f"PASS: Found sent email to marytheshot@gmail.com (subject: {subject})"
        )
        return 1.0
    else:
        print("FAIL: No sent email found to marytheshot@gmail.com")
        return 0.0


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 1.0 else 1)
