#!/usr/bin/env python3
"""Verify schedule-change-request task: check if emails sent to all contacts

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the sent mail
from the gws fake's run SQLite, where upstream's imports the email app's
Flask and SQLAlchemy models, with every check and weight of upstream's
verifier kept. A sent message counts for each address in its To header,
as upstream's one recipient_email.
"""

import sqlite3
import sys
from email.utils import getaddresses

GWS_DB_PATH = "/var/lib/mock-data/gws/gws.db"


def sent_emails(conn):
    """Each sent email in the gws fake's run, as (recipients, subject).

    A sent one is labelled SENT and not TRASH, and its recipients are the
    addresses in its To header.
    """
    sent = []
    rows = conn.execute(
        "SELECT id FROM Message m WHERE EXISTS (SELECT 1 FROM MessageLabel l "
        "WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'SENT') AND NOT EXISTS (SELECT 1 FROM MessageLabel l "
        "WHERE l.tenant = m.tenant AND l.messageId = m.id AND "
        "l.labelId = 'TRASH') ORDER BY seq").fetchall()
    for (message_id, ) in rows:
        headers = conn.execute(
            "SELECT name, value FROM MessageHeader WHERE messageId = ? "
            "ORDER BY seq", (message_id, )).fetchall()
        to = [v for n, v in headers if n.lower() == "to"]
        subject = next((v for n, v in headers if n.lower() == "subject"), "")
        sent.append(([a for _, a in getaddresses(to)], subject))
    return sent


def check():
    # Required recipient emails
    required_emails = [
        "marytheshot@gmail.com",
        "jason.wang97@mail.ucsd.edu",
        "karre8523@outlook.com",
        "gaeuala@outlook.com",
    ]

    total_points = 0
    max_points = len(required_emails)

    print("Checking sent emails to required contacts:\n")

    conn = sqlite3.connect(GWS_DB_PATH)
    try:
        sent = sent_emails(conn)
    finally:
        conn.close()

    for email_addr in required_emails:
        email = next((subject for to, subject in sent if email_addr in to),
                     None)

        if email is not None:
            print(f"  [OK] Email sent to: {email_addr}")
            print(f"    Subject: {email}")
            total_points += 1
        else:
            print(f"  [FAIL] No email sent to: {email_addr}")

    # Normalize score
    score = total_points / max_points if max_points > 0 else 0.0

    print(f"\nTotal points: {total_points}/{max_points}")
    print(f"Normalized score: {score:.2f}")

    return score


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 1.0 else 1)
