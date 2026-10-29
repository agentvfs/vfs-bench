#!/usr/bin/env python3
"""Verify stale-client-escalation.

Reward (sum = 1.0):
  0.4 escalation email to ops@work.mosi.inc, subject+body contains both
       'BlueHarbor' and 'contract redline' (case-insensitive).
       Partial: 0.2 if only one substring matches.
  0.4 client-escalation-log.md gains a new line (not in the seed) that
       contains 'BlueHarbor Labs', 'contract redline', and '2026-04-03'.
       Partial: 0.2 if BlueHarbor+redline present but date missing.
  0.2 preservation: prior log lines remain present AND no sent email to ops
       mentions any distractor client.

Ported to Mirage's gws fake (vfs-bench-2, rule A): reads the sent mail
from the gws fake's run SQLite in place of the email mock's, with every
check and weight of upstream's verifier kept.
"""

import json
import os
import re
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

LOG = Path("/workspace/notes/client-escalation-log.md")
SNAPSHOT = Path("/tests/_seed_snapshots/client-escalation-log.md")

DISTRACTOR_PATTERNS = [
    re.compile(r"nimbus data", re.IGNORECASE),
    re.compile(r"stratoscape", re.IGNORECASE),
    re.compile(r"market[- ]pulse", re.IGNORECASE),
    re.compile(r"colin@work\.mosi\.inc", re.IGNORECASE),
]


def check():
    # 1. escalation email
    escalation_score = 0.0
    ops_rows: list[tuple[str | None, str | None]] = []
    if os.path.exists(GWS_DB_PATH):
        conn = sqlite3.connect(GWS_DB_PATH)
        try:
            ops_rows = [(subject, body)
                        for to, subject, body in sent_emails(conn)
                        if "ops@work.mosi.inc" in to]
        finally:
            conn.close()

        for subject, body in ops_rows:
            t = ((subject or "") + "\n" + (body or "")).lower()
            has_bh = "blueharbor" in t
            has_redline = "contract redline" in t
            if has_bh and has_redline:
                escalation_score = 0.4
                break
            if has_bh or has_redline:
                escalation_score = max(escalation_score, 0.2)
    else:
        print(f"WARN: gws DB not found at {GWS_DB_PATH}")

    # 2. log
    log_score = 0.0
    seed_lines = set()
    if SNAPSHOT.exists():
        seed_lines = set(SNAPSHOT.read_text().splitlines())
    current_lines = []
    if LOG.exists():
        current_lines = LOG.read_text().splitlines()
    new_lines = [ln for ln in current_lines if ln not in seed_lines]
    for ln in new_lines:
        t = ln.lower()
        has_bh = "blueharbor" in t
        has_redline = "contract redline" in t
        has_date = "2026-04-03" in t
        if has_bh and has_redline and has_date:
            log_score = 0.4
            break
        if has_bh and has_redline:
            log_score = max(log_score, 0.2)

    # 3. preservation
    preserved_lines_ok = bool(seed_lines) and seed_lines.issubset(set(current_lines))
    distractor_hit = False
    for subject, body in ops_rows:
        t = (subject or "") + "\n" + (body or "")
        if any(p.search(t) for p in DISTRACTOR_PATTERNS):
            distractor_hit = True
            break
    preservation_score = 0.2 if (preserved_lines_ok and not distractor_hit) else 0.0

    reward = round(escalation_score + log_score + preservation_score, 3)
    print(
        f"escalation_score={escalation_score}  log_score={log_score}  preservation_score={preservation_score}"
    )
    os.makedirs("/logs/verifier", exist_ok=True)
    with open("/logs/verifier/reward.json", "w") as f:
        json.dump(
            {
                "reward": reward,
                "escalation_score": escalation_score,
                "log_score": log_score,
                "preservation_score": preservation_score,
            },
            f,
        )
    return reward


score = check()
print(f"Score: {score}/1.0")
sys.exit(0 if score >= 0.5 else 1)
