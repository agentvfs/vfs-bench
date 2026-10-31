#!/usr/bin/env bash
# Ours, on Mirage's gws fake (vfs-bench-2, rule A): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This reads the interview slot from the email at /gmail, creates the event
# with the gws CLI, and reads it back, creating or moving it again until it
# is at the slot.
set -euo pipefail

# The slot, from the interview email: start, end, title and location, one
# per line, the times in UTC (the calendar's zone).
SLOT=$(python3 <<'PY'
import glob
import json
import re
from datetime import datetime

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    with open(path) as f:
        mail = json.load(f)
    if "interview" not in mail["subject"].lower():
        continue
    body = mail["body_text"]
    field = lambda name: re.search(rf"^{name}:\s*(.+)$", body, re.M).group(1).strip()
    day = datetime.strptime(field("Date"), "%A, %B %d, %Y")
    start, end = (datetime.strptime(t.strip(), "%I:%M %p") for t in field("Time").split("-"))
    at = lambda t: day.replace(hour=t.hour, minute=t.minute).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(at(start), at(end), f"Interview - {field('Candidate')} ({field('Position')})", field("Location"), sep="\n")
    break
PY
)
START=$(echo "$SLOT" | sed -n 1p)
END=$(echo "$SLOT" | sed -n 2p)
EVENT=$(python3 -c 'import json, sys; print(json.dumps({"summary": sys.argv[1], "location": sys.argv[2], "start": {"dateTime": sys.argv[3]}, "end": {"dateTime": sys.argv[4]}}))' \
  "$(echo "$SLOT" | sed -n 3p)" "$(echo "$SLOT" | sed -n 4p)" "$START" "$END")

# The event's start and end as the calendar keeps them, in UTC, or nothing.
times_of() {
  gws calendar events get --params "{\"calendarId\": \"primary\", \"eventId\": \"$1\"}" 2> /dev/null |
    jq -r '[.start.dateTime, .end.dateTime] | map(sub("\\+00:00$"; "Z")) | join(" ")' || true
}

ID=$(gws calendar events insert --params '{"calendarId": "primary"}' --json "$EVENT" | jq -r .id)
for attempt in 1 2 3; do
  STORED=$(times_of "$ID")
  if [ "$STORED" = "$START $END" ]; then
    echo "Oracle: the interview is on the calendar at $START-$END ($ID)"
    exit 0
  fi
  if [ -n "$STORED" ]; then
    echo "Oracle: the event is at $STORED, not $START $END; moving it"
    gws calendar events patch --params "{\"calendarId\": \"primary\", \"eventId\": \"$ID\"}" --json "$EVENT" > /dev/null
  else
    echo "Oracle: the event $ID is not on the calendar; creating it again"
    ID=$(gws calendar events insert --params '{"calendarId": "primary"}' --json "$EVENT" | jq -r .id)
  fi
done
echo "Oracle: the interview never reached its slot" >&2
exit 1
