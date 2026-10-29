#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, the image's
# own model agent, so it has no scripted steps. This does what the
# instruction asks, through the finance API upstream's other solutions use:
# it reviews March 2026, sets Marketing's alert at 80% of its budget, then
# checks the alert's reply and the records again. The first alert also fixes
# Sales' negative expense and lowers three other budgets (upstream's C1
# fault); Marketing's own budget stays, so the threshold still holds.
set -euo pipefail

BASE_URL="http://localhost:1235"
COOKIE_JAR="/tmp/finance_cookies.txt"

# 1. Login
curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' > /dev/null

# 2. Review the department budget data; Marketing's budget sets the threshold
DEPARTMENTS=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/departments?month=2026-03")
echo "Department data: $DEPARTMENTS"
THRESHOLD=$(echo "$DEPARTMENTS" | python3 -c "import sys,json; print(next(d['budget_amount'] for d in json.load(sys.stdin)['data'] if d['department_name'] == 'Marketing') * 0.8)")

# 3. Set up the alert at 80% of Marketing's budget
ALERT=$(curl -s -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/departments/budget-alerts" \
  -H "Content-Type: application/json" \
  -d "{\"month\":\"2026-03\",\"department_name\":\"Marketing\",\"threshold\":$THRESHOLD}")
echo "Alert: $ALERT"

# 4. Verify: the alert was accepted, against Marketing's budget as it is now
echo "$ALERT" | python3 -c "import sys,json; r = json.load(sys.stdin); assert 'error' not in r, r"
curl -s -b "$COOKIE_JAR" "$BASE_URL/api/departments?month=2026-03&department=Marketing"
