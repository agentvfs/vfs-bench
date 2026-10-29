#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it finds
# the old meeting with the gws CLI, deletes it, creates the rescheduled one
# and replies to HR's email, where upstream's logs in to the calendar and
# email mocks and posts to their REST APIs.
set -euo pipefail

# HR's reschedule email.
RESCHEDULE=$(grep -l "Meeting Reschedule - Project Sync" /gmail/INBOX/*/*.gmail.json)
ID=$(basename "$RESCHEDULE" .gmail.json | sed 's/.*__//')

# Find the old meeting event (May 22 14:00-15:00)
OLD_EVENT_ID=$(gws calendar events list --params '{"calendarId": "primary"}' | python3 -c "
import sys, json
for e in json.load(sys.stdin).get('items', []):
    if e.get('start', {}).get('dateTime', '').startswith('2026-05-22T14:00'):
        print(e['id'])
        break
")

# Delete old event
if [ -n "$OLD_EVENT_ID" ]; then
    gws calendar events delete --params "{\"calendarId\": \"primary\", \"eventId\": \"${OLD_EVENT_ID}\"}"
    echo "Deleted old event ${OLD_EVENT_ID}"
fi

# Create new event at rescheduled time (upstream's event_type, appointment,
# has no field in a Google Calendar event)
gws calendar events insert --params '{"calendarId": "primary"}' --json '{
    "summary": "Project Sync (Rescheduled)",
    "description": "Weekly project sync - rescheduled from May 22",
    "start": {"dateTime": "2026-05-23T10:00:00Z"},
    "end": {"dateTime": "2026-05-23T11:00:00Z"}
  }'

echo "Created new meeting event"

# Reply to HR's email confirming the reschedule
gws gmail reply --message-id "$ID" --body "Hi HR Team,

I confirm the meeting has been rescheduled to Saturday, May 23, 2026, 10:00 AM - 11:00 AM in Conference Room B.

Best regards,
Peter Griffin"

echo "All tasks complete"
