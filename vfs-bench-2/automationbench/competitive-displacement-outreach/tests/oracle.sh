# Find the campaign's guidelines in the inbox: the VP's 2026-02-08 email
# supersedes the older ops note and outranks a colleague's hearsay.
api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages --params '{"q": "displacement"}'

for id in msg_ops_old msg_vp_policy msg_colleague; do api fetch --method GET --url "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id"; done

# It points to the policy (ss_outreach_policy) and the intel list (ss_comp_001).
api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_outreach_policy/values/Campaign%20Rules

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_comp_001/values/LegacyTech%20Customers

api fetch --method GET --url https://yourinstance.salesforce.com/services/data/v61.0/query --params "{\"q\": \"SELECT Id, Name, Type FROM Account WHERE Type = 'Customer'\"}"

# Only Target Corp and Another Target pass: Already Customer is a Customer
# account, MedTech Corp is Healthcare, CloudFirst runs LegacyTech
# Enterprise, and DataVault's notes say DO NOT CONTACT.
api fetch --method GET --url https://api.linkedin.com/v2/people --params '{"company": "Target Corp"}'
api fetch --method GET --url https://api.linkedin.com/v2/people --params '{"company": "Another Target"}'

send() { raw=$(api base64-encode --text "$(printf 'To: %s\r\nSubject: %s\r\n\r\n%s' "$1" "$2" "$3")"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\"}"; }
send qtarget@targetcorp.example.com 'Before your LegacyTech renewal' 'Hi Quinn, Target Corp is on LegacyTech with a contract ending 2026-06-30. We would like to show you what switching could look like before that renewal. Campaign: COMP-DISP-2026-Q1'
send ranother@anothertarget.example.com 'Before your LegacyTech renewal' 'Hi Ryan, Another Target is on LegacyTech with a contract ending 2026-09-01. We would like to show you what switching could look like before that renewal. Campaign: COMP-DISP-2026-Q1'

api fetch --method POST --url https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Lead --body '{"FirstName": "Quinn", "LastName": "Target", "Company": "Target Corp", "Email": "qtarget@targetcorp.example.com", "Title": "VP of IT", "Industry": "Technology", "LeadSource": "Outbound", "Description": "COMP-DISP-2026-Q1: competitive displacement of LegacyTech, contract ends 2026-06-30."}'
api fetch --method POST --url https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Lead --body '{"FirstName": "Ryan", "LastName": "Another", "Company": "Another Target", "Email": "ranother@anothertarget.example.com", "Title": "Director of Engineering", "Industry": "Finance", "LeadSource": "Outbound", "Description": "COMP-DISP-2026-Q1: competitive displacement of LegacyTech, contract ends 2026-09-01."}'
