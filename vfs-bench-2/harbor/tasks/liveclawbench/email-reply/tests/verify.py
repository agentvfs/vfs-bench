#!/usr/bin/env python3
"""Verify email-reply task: check reply sent to lau@coop-division.parrot-ai.org

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the sent mail from
the gws fake's run SQLite, where upstream's imports the email app's Flask
and SQLAlchemy models, with every check and weight of upstream's verifier
kept.
"""

import sqlite3
import sys
from email.utils import getaddresses

GWS_DB_PATH = "/var/lib/mock-data/gws/gws.db"


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


def check():
    conn = sqlite3.connect(GWS_DB_PATH)
    try:
        # email = Email.query.filter_by(recipient_email="lau@coop-division.parrot-ai.org").first()
        email = next(
            (
                subject
                for to, subject, _ in sent_emails(conn)
                if "lau@coop-division.parrot-ai.org" in to
            ),
            None,
        )
    finally:
        conn.close()
    if email is not None:
        print(
            f"PASS: Found reply to lau@coop-division.parrot-ai.org (subject: {email})"
        )
        return 1.0
    print("FAIL: No reply found to lau@coop-division.parrot-ai.org")
    return 0.0


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 1.0 else 1)
