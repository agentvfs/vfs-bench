#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: every job, the two
# failed ones (JOB-002, JOB-007) and the disabled one (JOB-003) in detail
# with JOB-002's history, the KB's disk-space, scheduling-policy and
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
kb search --query 磁盘空间
kb search --query 定时任务规范
kb search --query 证书
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
gws gmail send --to ops@company.com --subject '定时任务异常通知：JOB-007 证书续期失败，需人工处理' --body '运维团队：

定时任务 JOB-007（certificate_renewal，每月1日 00:00 自动续期 SSL/TLS 证书）3月1日执行失败，错误为 ACME rate limit exceeded：已达到 Let'"'"'s Encrypt 速率限制。按知识库 KB-503《证书续期故障处理》，速率限制无法由自动化工具解决，需要人工介入：请评估使用备用 CA 或等待限制重置，期间可用已有的通配符证书临时覆盖，并监控现有证书到期时间；在限制解除前请勿频繁重试续期。

另外说明已自动处理的两项：JOB-003（log_cleanup）2月16日被误禁用，已重新启用，它停摆导致 /data 分区使用率 95%，JOB-002（weekly_report）因此失败；JOB-005（data_sync_secondary）与 JOB-004 同时写 sync_target 表，已按 KB-501 错开为每小时 15、45 分运行。

请回复确认处理进展。'
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
