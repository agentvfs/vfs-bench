#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI and read-only: five
# searches (the outage, workarounds, alternatives, compliance, cost) and
# the six pages they turn up (the status page and engineering blog, the
# community workaround, AsiaPay's guide, the PCI DSS guidance and the cost
# analysis), then the report. No notification is sent.
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
web search --query 'CloudPay outage'
STEP
step <<'STEP'
web fetch --url https://status.cloudpay.com/incidents/INC-20260301-001
STEP
step <<'STEP'
web fetch --url https://blog.cloudpay.com/incident-update-20260301
STEP
step <<'STEP'
web search --query 'CloudPay outage workaround'
STEP
step <<'STEP'
web fetch --url https://dev.community.cloudpay.com/t/outage-workaround-queue-and-retry
STEP
step <<'STEP'
web search --query 'CloudPay alternative payment gateway'
STEP
step <<'STEP'
web fetch --url https://docs.asiapay.com/integration/quick-start
STEP
step <<'STEP'
web search --query 'PCI DSS compliance payment outage notification'
STEP
step <<'STEP'
web fetch --url https://pcissc.example.com/guidance/incident-response-2026
STEP
step <<'STEP'
web search --query 'payment gateway outage cost revenue loss'
STEP
step <<'STEP'
web fetch --url https://fintech-insights.example.com/payment-outage-cost-analysis
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
