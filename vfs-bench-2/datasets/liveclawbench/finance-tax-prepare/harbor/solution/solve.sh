#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): its
# finance and policy steps are upstream's. It finds the tax authority's
# reminder at /gmail and replies to it with the gws CLI, where upstream's
# logs in to the email mock, reads the inbox and posts to its REST API.
set -euo pipefail

FINANCE_URL="http://localhost:1235"
FINANCE_COOKIE="/tmp/finance_cookies.txt"

# 1. Login to finance system
curl -s -c "$FINANCE_COOKIE" -b "$FINANCE_COOKIE" \
  -X POST "$FINANCE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' > /dev/null

# 2-3. Read inbox to get tax notification
NOTICE=$(grep -l "notifications@tax-authority.gov" /gmail/INBOX/*/*.gmail.json)
ID=$(basename "$NOTICE" .gmail.json | sed 's/.*__//')
echo "Inbox: $NOTICE"

# 4. Create invoice INV-2026-010 (vendor_id=1 for Acme Corp)
curl -s -b "$FINANCE_COOKIE" \
  -X POST "$FINANCE_URL/api/invoices" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_id": 1,
    "invoice_number": "INV-2026-010",
    "invoice_date": "2026-03-01",
    "items": [
      {"description": "Software License Renewal", "category_code": "5300", "amount": 15000.00},
      {"description": "Technical Support Package", "category_code": "5400", "amount": 5000.00}
    ]
  }' > /dev/null

echo "Invoice INV-2026-010 created."

# 5. Calculate VAT based on tax policy
# INV-2026-001: Software License (5300) $12,500.50 * 6% = $750.03 + Support (5400) $3,000.00 * 6% = $180.00 = $930.03
# INV-2026-002: Travel (5100) $52,000.00 * 0% = $0.00 (exempt)
# INV-2026-010: Software License (5300) $15,000.00 * 6% = $900.00 + Support (5400) $5,000.00 * 6% = $300.00 = $1,200.00
# Total: $930.03 + $0.00 + $1,200.00 = $2,130.03

# 6. Update tax policy
export FILING_DATE=$(date +%Y-%m-%d)
python3 << 'PYEOF'
import datetime, os
policy_path = '/workspace/policies/tax_policy.md'
with open(policy_path, 'r') as f:
    content = f.read()

old_section = """## Q1 2026 Filing Status: PENDING

*No filing data has been recorded yet for Q1 2026.*"""

filing_date = os.environ.get('FILING_DATE', 'unknown')

new_section = f"""## Q1 2026 Filing Status: FILED

### VAT Calculation Summary

| Invoice | Vendor | Line Items | VAT Amount |
|---------|--------|-----------|------------|
| INV-2026-001 | Acme Corp | Software License (5300) $12,500.50 + Support (5400) $3,000.00 | $930.03 |
| INV-2026-002 | Globex Systems | Travel Expenses (5100) $52,000.00 | $0.00 |
| INV-2026-010 | Acme Corp | Software License (5300) $15,000.00 + Support (5400) $5,000.00 | $1,200.00 |

**Total Q1 2026 VAT: $2,130.03**

Filed on: {filing_date}"""

content = content.replace(old_section, new_section)
with open(policy_path, 'w') as f:
    f.write(content)
PYEOF

echo "Tax policy updated."

# 7. Send reply email to tax authority: gws gives it the subject
# "Re: Q1 2026 VAT Filing Reminder - Action Required".
gws gmail reply --message-id "$ID" \
  --body 'Dear Tax Authority,

We have completed our Q1 2026 VAT calculation as requested.

VAT Breakdown by Invoice:

1. INV-2026-001 (Acme Corp, dated 2026-01-15):
   - Software License (5300): $12,500.50 x 6% = $750.03
   - Support (5400): $3,000.00 x 6% = $180.00
   - Invoice VAT: $930.03

2. INV-2026-002 (Globex Systems, dated 2026-02-01):
   - Travel Expenses (5100): $52,000.00 x 0% = $0.00 (VAT exempt)
   - Invoice VAT: $0.00

3. INV-2026-010 (Acme Corp, dated 2026-03-01):
   - Software License (5300): $15,000.00 x 6% = $900.00
   - Support (5400): $5,000.00 x 6% = $300.00
   - Invoice VAT: $1,200.00

Total Q1 2026 VAT Liability: $2,130.03

Please confirm receipt of this filing.

Best regards,
Finance Administrator' > /dev/null

echo "Reply email sent to tax authority."
echo "Q1 2026 VAT filing complete. Total VAT: \$2,130.03"
