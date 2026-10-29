#!/usr/bin/env python3
"""Verify vendor-requirement-followup.

Reward (sum = 1.0):
  0.4 reply: sent email to ops@orchid-systems.com (folder=sent)
  0.4 tracker: /workspace/notes/requirements-tracker.md has a line
       containing 'Phoenix Analytics pilot API scope' AND '2026-04-03'
  0.2 preservation: prior non-target tracker lines remain byte-identical
       to the seed snapshot, AND no sent rows to either distractor recipient

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

TRACKER = Path("/workspace/notes/requirements-tracker.md")

TARGET_TOPIC = "Phoenix Analytics pilot API scope"
TARGET_DATE = "2026-04-03"
PRESERVED_TOPICS = [
    "Atlas Logistics rate card — received 2026-03-22",
    "Nimbus Storage SLA addendum — received 2026-03-29",
]


def sent_to(conn: sqlite3.Connection, recipient_email: str) -> bool:
    return any(recipient_email in to for to, _, _ in sent_emails(conn))


def check():
    if not os.path.exists(GWS_DB_PATH):
        print(f"FAIL: gws DB not found at {GWS_DB_PATH}")
        return 0.0

    conn = sqlite3.connect(GWS_DB_PATH)
    try:
        # 1. reply
        reply_score = 0.4 if sent_to(conn, "ops@orchid-systems.com") else 0.0
        distractor_email_hit = sent_to(conn, "partners@orchid-partners.com") or sent_to(
            conn, "finance@work.mosi.inc"
        )
    finally:
        conn.close()

    # 2. tracker
    tracker_score = 0.0
    if TRACKER.exists():
        content = TRACKER.read_text()
        for line in content.splitlines():
            if TARGET_TOPIC in line and TARGET_DATE in line:
                tracker_score = 0.4
                break
            if TARGET_TOPIC in line:
                tracker_score = max(tracker_score, 0.2)

    # 3. preservation
    preserved_lines_present = True
    if TRACKER.exists():
        content = TRACKER.read_text()
        for line in PRESERVED_TOPICS:
            if line not in content:
                preserved_lines_present = False
    else:
        preserved_lines_present = False
    preservation_score = (
        0.2 if (preserved_lines_present and not distractor_email_hit) else 0.0
    )

    reward = round(reply_score + tracker_score + preservation_score, 3)
    print(
        f"reply_score={reply_score}  tracker_score={tracker_score}  preservation_score={preservation_score}"
    )
    if distractor_email_hit:
        print("  preservation penalty: distractor recipient(s) received a reply")
    if not preserved_lines_present:
        print("  preservation penalty: prior tracker entries missing or mutated")
    os.makedirs("/logs/verifier", exist_ok=True)
    with open("/logs/verifier/reward.json", "w") as f:
        json.dump(
            {
                "reward": reward,
                "reply_score": reply_score,
                "tracker_score": tracker_score,
                "preservation_score": preservation_score,
            },
            f,
        )
    return reward


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 0.5 else 1)
