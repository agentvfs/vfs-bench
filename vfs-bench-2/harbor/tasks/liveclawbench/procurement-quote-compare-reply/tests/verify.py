#!/usr/bin/env python3
"""Verify procurement-quote-compare-reply.

Reward (sum = 1.0):
  0.8  acceptance email to sales@asterbyte.io with an acceptance phrase
  0.2  no acceptance email to either losing vendor
       (quotes@northpeak.tech, desk@latticepro.ai)
       — only awarded once the winner has been correctly addressed,
         so a no-op agent that sends nothing scores 0.

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the sent mail
from the gws fake's run SQLite in place of the email mock's, with every
check and weight of upstream's verifier kept.
"""

import json
import os
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

ACCEPTANCE_TERMS = [
    "proceed",
    "accept",
    "accepted",
    "go ahead",
    "we'll move forward",
    "we will move forward",
    "confirm the order",
    "place the order",
]


def contains_acceptance(text: str) -> bool:
    t = text.lower()
    return any(term in t for term in ACCEPTANCE_TERMS)


def check():
    if not os.path.exists(GWS_DB_PATH):
        print(f"FAIL: gws DB not found at {GWS_DB_PATH}")
        return 0.0

    conn = sqlite3.connect(GWS_DB_PATH)
    try:
        # One row per recipient, as upstream's one recipient_email per row.
        sent = [(recipient, subject, body)
                for to, subject, body in sent_emails(conn)
                for recipient in to]
    finally:
        conn.close()

    winner_hits = [
        (recipient, subject, body)
        for (recipient, subject, body) in sent
        if recipient == "sales@asterbyte.io"
        and contains_acceptance((subject or "") + "\n" + (body or ""))
    ]
    loser_hits = [
        (recipient, subject, body)
        for (recipient, subject, body) in sent
        if recipient in ("quotes@northpeak.tech", "desk@latticepro.ai")
        and contains_acceptance((subject or "") + "\n" + (body or ""))
    ]

    acceptance_score = 0.8 if winner_hits else 0.0
    # Gate distractor credit on having actually sent the winning email.
    # Otherwise a no-op agent (zero sent emails) trivially earns 0.2.
    if winner_hits:
        distractor_score = 0.0 if loser_hits else 0.2
    else:
        distractor_score = 0.0

    if winner_hits:
        print(
            f"PASS acceptance: {len(winner_hits)} sent email(s) to sales@asterbyte.io with acceptance phrase"
        )
    else:
        print("FAIL acceptance: no acceptance email to sales@asterbyte.io")
    if loser_hits:
        print(
            f"FAIL distractor: acceptance went to a losing vendor: {[r for r, _, _ in loser_hits]}"
        )
    else:
        print("PASS distractor: no acceptance to losing vendors")

    reward = round(acceptance_score + distractor_score, 3)
    print(f"acceptance_score={acceptance_score}  distractor_score={distractor_score}")

    os.makedirs("/logs/verifier", exist_ok=True)
    with open("/logs/verifier/reward.json", "w") as f:
        json.dump(
            {
                "reward": reward,
                "acceptance_score": acceptance_score,
                "distractor_score": distractor_score,
            },
            f,
        )
    return reward


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 0.5 else 1)
