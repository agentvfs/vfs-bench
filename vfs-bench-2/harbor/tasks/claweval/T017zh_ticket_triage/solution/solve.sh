#!/usr/bin/env bash
# Upstream's reference_solution, through the helpdesk CLI: list the open
# tickets, read each, set priority and tags (the CRM faults TK-1001, TK-1003
# and TK-1006 related; TK-1009 a survey, not a fault), close none.
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
helpdesk list-tickets
STEP
step <<'STEP'
helpdesk get-ticket --ticket-id TK-1001
helpdesk get-ticket --ticket-id TK-1002
helpdesk get-ticket --ticket-id TK-1003
helpdesk get-ticket --ticket-id TK-1004
helpdesk get-ticket --ticket-id TK-1005
helpdesk get-ticket --ticket-id TK-1006
helpdesk get-ticket --ticket-id TK-1007
helpdesk get-ticket --ticket-id TK-1008
helpdesk get-ticket --ticket-id TK-1009
helpdesk get-ticket --ticket-id TK-1010
helpdesk update-ticket --ticket-id TK-1001 --priority urgent --category CRM --tags crm-outage --tags related:TK-1003 --tags related:TK-1006
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1003 --priority urgent --category CRM --tags crm-outage --tags related:TK-1001 --tags related:TK-1006
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1006 --priority urgent --category CRM --tags crm-outage --tags related:TK-1001 --tags related:TK-1003
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1005 --priority high --category network --tags vpn
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1002 --priority medium --category hardware --tags printer
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1008 --priority medium --category hardware --tags projector
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1004 --priority low --category service-request --tags software-install
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1007 --priority medium --category service-request --tags onboarding
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1009 --priority low --category training --tags survey --tags not-a-fault
STEP
step <<'STEP'
helpdesk update-ticket --ticket-id TK-1010 --priority low --category email --tags resolved-by-user
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
