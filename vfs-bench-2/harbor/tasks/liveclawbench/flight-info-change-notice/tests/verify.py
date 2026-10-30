#!/usr/bin/env python3
"""Verify flight-info-change-notice task: check if email sent to marytheshot@gmail.com.

PR-6 / B6.2 ③ — verifier-backend alignment
==========================================

PR-3 (commit ``3bd33dbd``) moved this task's email backend to the Bun
``mock-email`` binary, which writes to ``/var/lib/mock-data/email/email.db``
(Bun SQLite, schema in ``mock-platform/mocks/email/src/db.ts``). The
Flask email-app DB at ``/workspace/environment/email-app/backend/...``
was no longer reachable by the running app, so every email the agent
sent through the UI lived in the mock DB and this verifier saw an empty
emails table. Rewrite to query the mock DB directly via stdlib sqlite3.

Ported to Mirage's gws fake (vfs-bench-2, rule A): the sent mail is read
from the gws fake's run SQLite, where upstream's reads the email mock's,
with upstream's one check kept. Upstream's email mock keeps a sent email as
a row with folder='sent' and its one recipient_email; the gws fake keeps a
Gmail message labelled SENT and not TRASH, whose recipients are the
addresses in its To header.
"""

import sqlite3
import sys
from email.utils import getaddresses

EMAIL_DB_PATH = "/var/lib/mock-data/gws/gws.db"


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


def check() -> float:
    try:
        conn = sqlite3.connect(f"file:{EMAIL_DB_PATH}?mode=ro", uri=True)
    except sqlite3.OperationalError as exc:
        print(f"FAIL: gws DB not reachable at {EMAIL_DB_PATH}: {exc}")
        return 0.0
    try:
        subject = first_sent_to(conn, "marytheshot@gmail.com")
    finally:
        conn.close()

    if subject is None:
        print("FAIL: No sent email found to marytheshot@gmail.com")
        return 0.0

    print(
        f"PASS: Found sent email to marytheshot@gmail.com (subject: {subject})"
    )
    return 1.0


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 1.0 else 1)
