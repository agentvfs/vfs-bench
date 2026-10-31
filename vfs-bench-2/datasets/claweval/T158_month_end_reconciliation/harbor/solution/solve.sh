#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: the failing reconciliation
# and invoice jobs, the integrations behind them, then every transaction,
# customer (the list leaves out what each owes) and product, reconciled in
# the reply.
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
scheduler list-jobs
STEP
step <<'STEP'
scheduler get-job --job-id JOB-1301
STEP
step <<'STEP'
scheduler get-job --job-id JOB-1302
STEP
step <<'STEP'
config list-integrations
STEP
step <<'STEP'
config get-integration --integration-id INT-1301
config get-integration --integration-id INT-1302
config get-integration --integration-id INT-1303
config get-integration --integration-id INT-1304
STEP
step <<'STEP'
finance list-transactions
STEP
step <<'STEP'
crm list-customers
STEP
step <<'STEP'
crm get-customer --customer-id CUS-1301
crm get-customer --customer-id CUS-1302
crm get-customer --customer-id CUS-1303
crm get-customer --customer-id CUS-1304
crm get-customer --customer-id CUS-1305
crm get-customer --customer-id CUS-1306
STEP
step <<'STEP'
inventory list-products
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
