#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: the three failing jobs and
# their dependencies, the supplier API integrations, the stale products, the
# tickets, and the KB's migration, dependency and resync articles. No ticket
# is updated or closed.
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
scheduler get-job --job-id JOB-1501
scheduler get-job --job-id JOB-1502
scheduler get-job --job-id JOB-1503
STEP
step <<'STEP'
config list-integrations
STEP
step <<'STEP'
config get-integration --integration-id INT-1501
config get-integration --integration-id INT-1502
STEP
step <<'STEP'
inventory list-products
STEP
step <<'STEP'
helpdesk list-tickets
STEP
step <<'STEP'
helpdesk get-ticket --ticket-id TK-1501
helpdesk get-ticket --ticket-id TK-1502
helpdesk get-ticket --ticket-id TK-1503
helpdesk get-ticket --ticket-id TK-1504
STEP
step <<'STEP'
kb search --query '供应商 API 迁移'
STEP
step <<'STEP'
kb get-article --article-id KB-1501
kb get-article --article-id KB-1502
STEP
step <<'STEP'
kb search --query '库存 同步 修复'
STEP
step <<'STEP'
kb get-article --article-id KB-1503
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
