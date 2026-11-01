#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: Q1's transactions, each
# customer's CRM record, the quarter's emails (the list's default window is
# 7 days), both RSS feeds, and the two account managers' contacts.
# Mail and events are read through the /gmail mount and the gws CLI, as
# the instruction gives them; drafts are upstream's tool (gmail save-draft).
# Each step's command and output go to the trajectory (trajectory.py),
# which ends with reply.md.
S=/tmp/oracle
mkdir -p "$S"
n=0
step() {
  n=$((n + 1))
  cat > "$S/$n.cmd"
  sh "$S/$n.cmd" > "$S/$n.out" 2>&1
  cat "$S/$n.out"
}
step <<'STEP'
finance list-transactions
STEP
step <<'STEP'
crm list-customers
STEP
step <<'STEP'
crm get-customer --customer-id CUS-1601
crm get-customer --customer-id CUS-1602
crm get-customer --customer-id CUS-1603
crm get-customer --customer-id CUS-1604
crm get-customer --customer-id CUS-1605
crm get-customer --customer-id CUS-1606
STEP
step <<'STEP'
ls -R /gmail/INBOX
STEP
step <<'STEP'
gws gmail read --id msg_1601
gws gmail read --id msg_1602
gws gmail read --id msg_1603
gws gmail read --id msg_1604
gws gmail read --id msg_1605
gws gmail read --id msg_1606
gws gmail read --id msg_1607
gws gmail read --id msg_1608
gws gmail read --id msg_1609
STEP
step <<'STEP'
rss list-feeds
STEP
step <<'STEP'
rss get-feed --feed-id feed_01
rss get-feed --feed-id feed_02
STEP
step <<'STEP'
contacts search --query 赵蕾
contacts search --query 张伟
contacts search --query 王明
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
