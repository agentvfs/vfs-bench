#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): its
# finance steps are upstream's, and it finds the two invoice emails at
# /gmail, where upstream's logs in to the email mock and reads its inbox.
set -euo pipefail

FINANCE_URL="http://localhost:1235"
FINANCE_COOKIES="/tmp/finance_cookies.txt"

# --- Finance login ---
curl -s -c "$FINANCE_COOKIES" -b "$FINANCE_COOKIES" \
  -X POST "$FINANCE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' > /dev/null

# --- Read emails ---
grep -l "INV-2026-010" /gmail/INBOX/*/*.gmail.json > /dev/null
grep -l "INV-2026-011" /gmail/INBOX/*/*.gmail.json > /dev/null

# --- Create invoice INV-2026-010 from Acme Corp email ---
# Vendor Acme Corp = vendor_id 1
curl -s -b "$FINANCE_COOKIES" \
  -X POST "$FINANCE_URL/api/invoices" \
  -H "Content-Type: application/json" \
  -d '{"vendor_id":1,"invoice_number":"INV-2026-010","invoice_date":"2026-03-01","items":[{"description":"Software License Renewal","category_code":"5300","amount":15000},{"description":"Technical Support","category_code":"5400","amount":5000}]}' > /dev/null

# --- Create invoice INV-2026-011 from Initech Solutions email ---
# Vendor Initech Solutions = vendor_id 3
curl -s -b "$FINANCE_COOKIES" \
  -X POST "$FINANCE_URL/api/invoices" \
  -H "Content-Type: application/json" \
  -d '{"vendor_id":3,"invoice_number":"INV-2026-011","invoice_date":"2026-03-05","items":[{"description":"System Integration","category_code":"5400","amount":8000},{"description":"Training Services","category_code":"5400","amount":3500}]}' > /dev/null

echo "Done: created invoices INV-2026-010 and INV-2026-011"
