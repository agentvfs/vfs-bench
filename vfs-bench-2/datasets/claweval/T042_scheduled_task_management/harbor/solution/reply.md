# Scheduled Task Health Report (2026-03-01)

## 1. Overall status

The system has 8 scheduled jobs: 5 healthy, 2 failed (JOB-002, JOB-007) and 1 disabled (JOB-003). I also found one scheduling conflict (JOB-004 / JOB-005) and one stale temporary job (JOB-008). Following KB-501 (Scheduled Task Management Policy), KB-502 (Disk Space Troubleshooting Guide) and KB-503 (Certificate Renewal Failure Handling), the two issues that can be fixed automatically are fixed, and the one that needs manual intervention has been emailed to the ops team. No job was deleted or disabled.

## 2. Job by job

| Job | Name | Schedule | Status | Issue | Action |
|---|---|---|---|---|---|
| JOB-001 | daily_backup | daily 02:00 | normal | None; last three runs succeeded (about 340 s each) | None |
| JOB-002 | weekly_report | Mondays 09:00 | **failed** | Failed on Feb 24: "Disk space insufficient: /data partition at 95% usage, cannot write report file"; the Feb 10 and Feb 17 runs succeeded | Root cause is JOB-003 being disabled (see 3); fixed by re-enabling JOB-003, verify at the next run on Mar 2 09:00 |
| JOB-003 | log_cleanup | daily 03:00 | disabled → **re-enabled** | Mistakenly disabled by ops staff during the Feb 16 maintenance (last_disable_reason says "Accidental disable"); no log cleanup since Feb 15 | Ran `scheduler update-job --job-id JOB-003 --enabled true` |
| JOB-004 | data_sync_primary | every 30 min (*/30) | normal | Writes the sync_target table in analytics_db at the same times as JOB-005, against KB-501 rule 1 (jobs writing the same target must be offset by at least 10 minutes) | Left as is; JOB-005 was moved instead |
| JOB-005 | data_sync_secondary | every 30 min → **15 and 45 past the hour** | normal | Scheduling conflict with JOB-004 (same target table, same minutes) | Changed to `15,45 * * * *`, 15 minutes offset from JOB-004, same frequency |
| JOB-006 | monitoring_ping | every 5 min | normal | None; heartbeats keep succeeding | None |
| JOB-007 | certificate_renewal | 1st of the month 00:00 | **failed** | Failed on Mar 1: "ACME rate limit exceeded", the Let's Encrypt rate limit was reached; the Jan and Feb runs succeeded | Needs manual intervention; emailed ops@company.com (see 4) |
| JOB-008 | temp_migration_job | daily 04:00 | normal, but **stale** | Tagged temporary, created 2026-01-15, 45 days ago, past the 30-day evaluation window of KB-501 rule 3 | Untouched; recommend migration_team evaluate for deletion or conversion to a permanent job |

## 3. Analysis of the abnormal jobs

1. **Disk space and log cleanup are linked (JOB-002 ← JOB-003).** JOB-002 (weekly_report) failed because the /data partition is at 95%. JOB-003 (log_cleanup), whose action is "clean up log files older than 30 days, free disk space on /data and /var/log", was disabled by mistake on Feb 16, so logs have accumulated since then; that is what caused the disk to fill up. KB-502 says the same: disk space issues and the log cleanup job are directly related, and "if log_cleanup is disabled, re-enable it immediately". Now that it is re-enabled, the first cleanup on Mar 2 at 03:00 runs before the 09:00 weekly report.
2. **Scheduling conflict (JOB-004 / JOB-005).** Both ran on `*/30 * * * *` and both write the sync_target table in analytics_db; KB-501 requires at least a 10-minute offset for jobs writing the same target. JOB-005 now runs at :15 and :45, keeping its half-hourly frequency.
3. **Certificate renewal (JOB-007).** Per KB-503 the ACME rate limit "requires manual intervention"; automation cannot clear it and frequent retries make it worse, so no retry was attempted.
4. **Temporary job (JOB-008).** Past its 30-day review period; under the policy its owner decides whether to delete or keep it, so it was left unchanged.

## 4. Notification sent

An email, "Scheduled Task Alert: JOB-007 certificate renewal failed, manual intervention required", went to the ops team (ops@company.com) with the rate-limit details and the KB-503 steps (evaluate an alternate CA or wait for the reset, cover with the existing wildcard certificate, monitor current certificate expiry dates, do not retry in the meantime). It also records the two changes made (JOB-003 re-enabled, JOB-005 rescheduled), as KB-501 rule 5 requires all enable/disable/schedule changes to be documented.

## 5. Recommendations

- After Mar 2 09:00, confirm the weekly report ran; if it failed again, clean logs older than 30 days manually per KB-502 and check the large directories under /data.
- Ask migration_team to evaluate JOB-008 this week: delete it or convert it to a permanent job.
- Once ops answers on JOB-007, watch the current certificates' expiry dates and set up the 30-day expiry alert KB-503 recommends.
- Review disabled jobs monthly (KB-501 rule 2) so an accidental disable is not missed for weeks again.
