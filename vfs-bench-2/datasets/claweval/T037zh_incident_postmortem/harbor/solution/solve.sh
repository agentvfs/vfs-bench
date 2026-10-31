#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs and read-only: every ticket
# of the incident (the list shows one status at a time), the integrations'
# state, the incident emails, the December incident in the KB, the release
# review notes and the CRM sync and monitoring jobs' history.
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
helpdesk list-tickets --status open
helpdesk list-tickets --status investigating
helpdesk list-tickets --status resolved
helpdesk list-tickets --status done
STEP
step <<'STEP'
helpdesk get-ticket --ticket-id TK-1901
helpdesk get-ticket --ticket-id TK-1902
helpdesk get-ticket --ticket-id TK-1903
helpdesk get-ticket --ticket-id TK-1904
helpdesk get-ticket --ticket-id TK-1905
helpdesk get-ticket --ticket-id TK-1906
helpdesk get-ticket --ticket-id TK-1907
helpdesk get-ticket --ticket-id TK-1908
helpdesk get-ticket --ticket-id TK-1909
helpdesk get-ticket --ticket-id TK-1910
helpdesk get-ticket --ticket-id TK-1911
helpdesk get-ticket --ticket-id TK-1912
STEP
step <<'STEP'
config list-integrations
STEP
step <<'STEP'
config get-integration --integration-id INT-201
config get-integration --integration-id INT-202
config get-integration --integration-id INT-203
config get-integration --integration-id INT-204
STEP
step <<'STEP'
ls -R /gmail/INBOX
STEP
step <<'STEP'
gws gmail read --id msg_1901
gws gmail read --id msg_1902
gws gmail read --id msg_1903
STEP
step <<'STEP'
kb search --query 事故
STEP
step <<'STEP'
kb search --query 连接池
STEP
step <<'STEP'
kb get-article --article-id KB-603
kb get-article --article-id KB-602
STEP
step <<'STEP'
notes list
STEP
step <<'STEP'
notes get --note-id NOTE-601
notes get --note-id NOTE-602
STEP
step <<'STEP'
scheduler list-jobs
STEP
step <<'STEP'
scheduler get-job --job-id JOB-301
scheduler get-job --job-id JOB-303
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
