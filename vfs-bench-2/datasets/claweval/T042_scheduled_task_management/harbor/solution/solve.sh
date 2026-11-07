#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: every job, the two
# failed ones (JOB-002, JOB-007) and the disabled one (JOB-003) in detail
# with their history, the KB's disk-space, scheduling-policy and
# certificate guides, then the fixes the KB allows: JOB-003 re-enabled,
# JOB-005 moved off JOB-004's half hours, and the ACME rate limit on
# JOB-007 mailed to ops with `gws gmail send` (upstream's
# gmail_send_message). No job is deleted or disabled.
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
scheduler get-job --job-id JOB-002
scheduler get-job --job-id JOB-003
scheduler get-job --job-id JOB-007
STEP
step <<'STEP'
scheduler job-history --job-id JOB-002
scheduler job-history --job-id JOB-007
STEP
step <<'STEP'
kb search --query 'disk space'
kb search --query 'scheduled task policy'
kb search --query certificate
STEP
step <<'STEP'
kb get-article --article-id KB-502
kb get-article --article-id KB-501
kb get-article --article-id KB-503
STEP
step <<'STEP'
scheduler update-job --job-id JOB-003 --enabled true
STEP
step <<'STEP'
scheduler update-job --job-id JOB-005 --cron-expression '15,45 * * * *'
STEP
step <<'STEP'
gws gmail send --to ops@company.com --subject 'Scheduled Task Alert: JOB-007 certificate renewal failed, manual intervention required' --body 'Hi Ops,

Scheduled job JOB-007 (certificate_renewal, auto-renews SSL/TLS certificates via ACME on the 1st of each month at 00:00) failed on March 1 with "ACME rate limit exceeded": the Let'"'"'s Encrypt rate limit has been reached. Per KB-503 (Certificate Renewal Failure Handling), rate limits cannot be resolved by automation and need manual intervention: please evaluate switching to an alternate CA or waiting for the limit to reset, cover with the existing wildcard certificate in the meantime, monitor the expiry dates of the current certificates, and avoid retrying the renewal until the limit clears.

For the record, two fixes were applied automatically: JOB-003 (log_cleanup) had been disabled by mistake during the Feb 16 maintenance and is re-enabled; its downtime filled the /data partition to 95%, which is why JOB-002 (weekly_report) failed. JOB-005 (data_sync_secondary) wrote the sync_target table at the same times as JOB-004, so per KB-501 it now runs at 15 and 45 minutes past the hour.

Please reply to confirm how you want to proceed on JOB-007.'
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
