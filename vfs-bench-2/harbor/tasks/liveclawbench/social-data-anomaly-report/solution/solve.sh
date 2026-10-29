#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it finds
# the data team's email at /gmail, checks the social database for the three
# anomalies its report names, and sends the report with the gws CLI, where
# upstream's logs in to the email mock and posts to its REST API. It reads
# the database with Python's sqlite3, where upstream's runs the sqlite3 CLI.
set -euo pipefail

SOCIAL_URL="http://127.0.0.1:5008"
SOCIAL_DB="/var/lib/mock-data/social/social.db"

# The data team's request. Upstream's looks for these words in subject and
# body.
python3 <<'PY'
import glob
import json
import sys

needles = ("data integrity", "data anomal", "data anomaly", "anomaly check",
           "anomaly report")
for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    with open(path) as f:
        mail = json.load(f)
    if any(n in (mail["subject"] + " " + mail["body_text"]).lower()
           for n in needles):
        sys.exit(0)
sys.exit("data integrity request email not found in inbox")
PY

# Social login (sanity check).
curl -s -X POST "$SOCIAL_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"mosi_brand","password":"demo123"}' | python3 -c "
import json, sys
if not json.load(sys.stdin).get('success'):
    sys.exit('social login failed')
"

# The three seeded anomalies.
python3 - "$SOCIAL_DB" <<'PY'
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
a = db.execute("SELECT status, published_at FROM post WHERE id = 101").fetchone()
if a != ("published", None):
    sys.exit(f"post 101 anomaly missing (got: {a})")
b = db.execute("SELECT impressions, likes FROM post_metric WHERE post_id = 101").fetchone()
if b != (0, 50000):
    sys.exit(f"post 101 metric anomaly missing (got: {b})")
c = db.execute("SELECT status FROM post WHERE id = 6").fetchone()
log = db.execute("SELECT action_type FROM post_action_log WHERE post_id = 6 "
                 "AND action_type LIKE '%publish%' LIMIT 1").fetchone()
if c != ("draft", ) or log is None:
    sys.exit(f"post 6 anomaly missing (got: {c}, {log})")
PY

gws gmail send --to data-team@mosi.inc \
  --subject "Social Media Data Anomaly Report" \
  --body "Social Media Data Anomaly Report

The following data anomalies were identified during the integrity check:

1. Post 101: status='published' but published_at is NULL (missing timestamp)
   - The record has status='published' yet the published_at column is NULL.
   - Every published post must have a non-null published_at; this row violates that invariant.

2. Post 101 metrics: 0 impressions but 50000 likes (likes without impressions)
   - post_metric for post_id=101 shows zero impressions while reporting 50000 likes.
   - Likes cannot exist without prior impressions — this is an impossible metric / implausible metric combination.

3. Post 6: status='draft' but action_log records a 'published' event (status mismatch / contradict log says published)
   - The post row reports status='draft', yet post_action_log records action_type='published' for post_id=6.
   - The current status contradicts the historical action_log entry; either the row was reverted out-of-band or the log is stale.

Please investigate and reconcile these anomalies at your earliest convenience." > /dev/null
echo "Oracle: anomaly report sent to data-team@mosi.inc"
