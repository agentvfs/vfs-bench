#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it finds
# HR's email at /gmail, creates the event with the gws CLI and replies to
# HR with it, where upstream's logs in to the calendar and email mocks and
# posts to their REST APIs.
set -euo pipefail

# HR's interview confirmation: Alex Thompson, May 26, 2:00-3:00 PM.
CONFIRMATION=$(grep -l "hr@work.mosi.inc" /gmail/INBOX/*/*.gmail.json)
ID=$(basename "$CONFIRMATION" .gmail.json | sed 's/.*__//')

# Create interview event (upstream's event_type, appointment, has no field
# in a Google Calendar event)
gws calendar events insert --params '{"calendarId": "primary"}' --json '{
    "summary": "Interview - Alex Thompson (Senior Developer)",
    "description": "Senior Developer candidate interview in Conference Room A",
    "start": {"dateTime": "2026-05-26T14:00:00Z"},
    "end": {"dateTime": "2026-05-26T15:00:00Z"}
  }'

echo "Created interview calendar event"

# Reply to HR's email
gws gmail reply --message-id "$ID" --body "Hi HR Team,

I have added the interview for Alex Thompson (Senior Developer) to my calendar:
- Date: Tuesday, May 26, 2026
- Time: 2:00 PM - 3:00 PM
- Location: Conference Room A

Confirmed.

Best regards,
Peter Griffin"

echo "All tasks complete"
