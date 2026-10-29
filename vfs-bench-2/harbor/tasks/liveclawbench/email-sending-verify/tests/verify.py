"""Verifier for email-sending-verify (C2).

Checks: sent folder contains the specific email the agent was asked to send
(after the agent detected the silent send failure and retried).

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the sent mail from
the gws fake's run SQLite in place of the email mock's, with every check and
weight of upstream's verifier kept.
"""

import sqlite3
import sys
from email.utils import getaddresses

DB_PATH = "/var/lib/mock-data/gws/gws.db"

EXPECTED_RECIPIENT = "john.smith@gmail.com"
EXPECTED_SUBJECT_KEYWORD = "follow-up on project proposal"


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


def main():
    score = 0.0
    conn = sqlite3.connect(DB_PATH)

    # Query for the specific email the agent was asked to send
    sent = sent_emails(conn)
    conn.close()

    if not sent:
        print("No sent emails found")
        print(f"Score: {score:.2f}/1.0")
        sys.exit(1)

    # Find the agent-sent email matching the instruction
    for recipients, subject, body in sent:
        subj_match = EXPECTED_SUBJECT_KEYWORD in (subject or "").lower()
        recip_match = any(EXPECTED_RECIPIENT in r.lower() for r in recipients)
        if subj_match or recip_match:
            # Detection (0.3): agent retried and email was persisted
            score = max(score, 0.3)
            # Completion (0.7): email has actual content
            if subject and body and len(body.strip()) > 20:
                score = 1.0
                break

    print(f"Score: {score:.2f}/1.0")
    sys.exit(0 if score >= 0.5 else 1)


if __name__ == "__main__":
    main()
