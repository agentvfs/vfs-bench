#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: read every ticket, find the
# stock-outs and their supplier, the cancelled purchases and the paid orders,
# then the suppliers' and customers' records. Nothing is updated or closed.
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
helpdesk get-ticket --ticket-id TK-1101
helpdesk get-ticket --ticket-id TK-1102
helpdesk get-ticket --ticket-id TK-1103
helpdesk get-ticket --ticket-id TK-1104
helpdesk get-ticket --ticket-id TK-1105
STEP
step <<'STEP'
inventory list-items
STEP
step <<'STEP'
finance list-transactions
STEP
step <<'STEP'
crm list-customers
STEP
step <<'STEP'
crm get-customer --customer-id SUP-1001
crm get-customer --customer-id SUP-1002
crm get-customer --customer-id SUP-1003
STEP
step <<'STEP'
crm get-customer --customer-id CUS-1101
crm get-customer --customer-id CUS-1102
crm get-customer --customer-id CUS-1103
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
