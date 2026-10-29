#!/usr/bin/env python3
"""Verify newsletter-digest-forward.

Reward (sum = 1.0):
  0.4 digest: /workspace/notes/newsletter-digest.md contains the 3 target
       lead-update substrings (0.133 each, rounded).
  0.4 email: at least one sent email to research@work.mosi.inc body contains
       the same 3 target substrings (0.133 each).
  0.2 distractor: 'April mascot giveaway' substring NOT present in digest
       file or any matching sent email.

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the sent mail
from the gws fake's run SQLite in place of the email mock's, with every
check and weight of upstream's verifier kept.
"""

import json
import os
import sqlite3
import sys
from email.utils import getaddresses
from pathlib import Path

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

TARGETS = [
    "VectorDB Cloud row-level ACLs",
    "OpenBrowse persistent sessions",
    "NovaStack Series A",
]
DISTRACTOR = "April mascot giveaway"
DIGEST = Path("/workspace/notes/newsletter-digest.md")
PER_HIT = 0.4 / 3


def check():
    # 1. digest
    digest_score = 0.0
    digest_content = ""
    if DIGEST.exists():
        digest_content = DIGEST.read_text()
        hits = sum(1 for t in TARGETS if t in digest_content)
        digest_score = round(hits * PER_HIT, 3)

    # 2. email
    email_score = 0.0
    email_bodies = []
    if os.path.exists(GWS_DB_PATH):
        conn = sqlite3.connect(GWS_DB_PATH)
        try:
            rows = [(subject, body) for to, subject, body in sent_emails(conn)
                    if "research@work.mosi.inc" in to]
        finally:
            conn.close()

        best = 0
        for subject, body in rows:
            text = (subject or "") + "\n" + (body or "")
            email_bodies.append(text)
            hits = sum(1 for t in TARGETS if t in text)
            if hits > best:
                best = hits
        email_score = round(best * PER_HIT, 3)
    else:
        print(f"WARN: gws DB not found at {GWS_DB_PATH}")

    # 3. distractor
    distractor_score = 0.2
    if DISTRACTOR in digest_content or any(DISTRACTOR in b for b in email_bodies):
        distractor_score = 0.0

    reward = round(digest_score + email_score + distractor_score, 3)
    print(
        f"digest_score={digest_score}  email_score={email_score}  distractor_score={distractor_score}"
    )
    os.makedirs("/logs/verifier", exist_ok=True)
    with open("/logs/verifier/reward.json", "w") as f:
        json.dump(
            {
                "reward": reward,
                "digest_score": digest_score,
                "email_score": email_score,
                "distractor_score": distractor_score,
            },
            f,
        )
    return reward


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 0.5 else 1)
