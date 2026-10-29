#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): its
# finance steps are upstream's, and it sends the alerts with the gws CLI,
# where upstream's logs in to the email mock and posts to its REST API.
set -euo pipefail

FINANCE_URL="http://localhost:1235"
FINANCE_COOKIE="/tmp/finance_cookies.txt"

# 1. Login to finance system
curl -s -c "$FINANCE_COOKIE" -b "$FINANCE_COOKIE" \
  -X POST "$FINANCE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' > /dev/null

# 2. Get department records for March 2026
DEPARTMENTS=$(curl -s -b "$FINANCE_COOKIE" "$FINANCE_URL/api/departments?month=2026-03")
echo "Department data: $DEPARTMENTS"

# 3. Identify violating departments and send alerts
# Engineering: actual 180000 > budget 150000 (over budget)
gws gmail send --to eng.manager@example.com \
  --subject "Budget Alert: Engineering Department Over Budget - March 2026" \
  --body 'Dear Engineering Department Manager,

This is an automated budget alert for March 2026.

Your department has exceeded its budget allocation:
- Budget: $150,000.00
- Actual Expense: $180,000.00
- Overrun: $30,000.00 (120.0% utilization)

Please review your department expenses and provide an explanation for the overrun.

Best regards,
Financial Controller' > /dev/null

# Sales: actual -5000 (negative expense)
gws gmail send --to sales.manager@example.com \
  --subject "Budget Alert: Sales Department Negative Expense - March 2026" \
  --body 'Dear Sales Department Manager,

This is an automated budget alert for March 2026.

Your department has a data integrity issue:
- Budget: $150,000.00
- Actual Expense: -$5,000.00 (NEGATIVE)

A negative actual expense amount indicates a data error that needs immediate correction.

Please review and correct your department expense records.

Best regards,
Financial Controller' > /dev/null

# Marketing: actual 200000 > budget 150000 (over budget)
gws gmail send --to marketing.manager@example.com \
  --subject "Budget Alert: Marketing Department Over Budget - March 2026" \
  --body 'Dear Marketing Department Manager,

This is an automated budget alert for March 2026.

Your department has exceeded its budget allocation:
- Budget: $150,000.00
- Actual Expense: $200,000.00
- Overrun: $50,000.00 (133.3% utilization)

Please review your department expenses and provide an explanation for the overrun.

Best regards,
Financial Controller' > /dev/null

echo "Budget alert emails sent successfully."
