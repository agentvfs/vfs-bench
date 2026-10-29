#!/usr/bin/env python3
"""Verify email-writing task: check email sent to mary.lee@work.mosi.inc

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the mailbox from
the gws fake's run SQLite, where upstream's imports the email app's Flask
and SQLAlchemy models, with every check and weight of upstream's verifier
kept.
"""

import sqlite3
import sys
from email.utils import getaddresses

GWS_DB_PATH = "/var/lib/mock-data/gws/gws.db"


def emails(conn):
    """Each email in the gws fake's run, as (recipients, subject, body).

    Upstream's email mock keeps an email as one row, in a folder, with its
    one recipient_email. The gws fake keeps a Gmail message with its labels
    and headers, its recipients the addresses in its To header. Upstream's
    query names no folder, so every message counts, whatever its labels.
    """
    found = []
    rows = conn.execute(
        "SELECT id, bodyText FROM Message ORDER BY seq").fetchall()
    for message_id, body in rows:
        headers = conn.execute(
            "SELECT name, value FROM MessageHeader WHERE messageId = ? "
            "ORDER BY seq", (message_id, )).fetchall()
        to = [v for n, v in headers if n.lower() == "to"]
        subject = next((v for n, v in headers if n.lower() == "subject"), "")
        found.append(([a for _, a in getaddresses(to)], subject, body))
    return found


def check():
    conn = sqlite3.connect(GWS_DB_PATH)
    try:
        email = next(
            (
                subject
                for to, subject, _ in emails(conn)
                if "mary.lee@work.mosi.inc" in to
            ),
            None,
        )
    finally:
        conn.close()
    if email is not None:
        print(
            f"PASS: Found email to mary.lee@work.mosi.inc (subject: {email})"
        )
        return 1.0
    print("FAIL: No email found to mary.lee@work.mosi.inc")
    return 0.0


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 1.0 else 1)
