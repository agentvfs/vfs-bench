#!/usr/bin/env bash
# Ours, on Mirage's gws fake (vfs-bench-2, rule A): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This reads the meeting from the email at /gmail and creates it with the
# gws CLI. Refused, it asks free/busy whether the slot is still free and,
# if it is taken, moves to the first free slot that day; then it checks the
# event is on /calendar.
set -euo pipefail

# The meeting: start, end and title, one per line, the times in UTC (the
# calendar's zone). A rescheduled meeting's new time comes first.
MEETING=$(python3 <<'PY'
import glob
import json
import re
from datetime import datetime

def meeting(mail):
    body = mail["body_text"]
    new = re.search(r"^New Time:\s*\w+, (\w+ \d+, \d{4}), (.+)$", body, re.M)
    date = re.search(r"^Date:\s*(?:\w+, )?(\w+ \d+, \d{4})\s*$", body, re.M)
    time = re.search(r"^Time:\s*(.+)$", body, re.M)
    if new:
        return new.group(1), new.group(2)
    if date and time:
        return date.group(1), time.group(1)
    return None

mails = []
for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    with open(path) as f:
        mail = json.load(f)
    if "meeting" in mail["subject"].lower() and meeting(mail):
        mails.append(mail)
mail = max(mails, key=lambda m: "reschedul" in m["subject"].lower())
day, span = meeting(mail)
day = datetime.strptime(day, "%B %d, %Y")
start, end = (datetime.strptime(t.strip(), "%I:%M %p") for t in span.split("-"))
at = lambda t: day.replace(hour=t.hour, minute=t.minute).strftime("%Y-%m-%dT%H:%M:%SZ")
title = mail["subject"].split(":", 1)[-1].split(" - ")[-1].strip()
print(at(start), at(end), title, sep="\n")
PY
)
START=$(echo "$MEETING" | sed -n 1p)
END=$(echo "$MEETING" | sed -n 2p)
TITLE=$(echo "$MEETING" | sed -n 3p)
DAY=${START%%T*}

event() {
  python3 -c 'import json, sys; print(json.dumps({"summary": sys.argv[1], "start": {"dateTime": sys.argv[2]}, "end": {"dateTime": sys.argv[3]}}))' \
    "$TITLE" "$1" "$2"
}

if ! gws calendar events insert --params '{"calendarId": "primary"}' --json "$(event "$START" "$END")" > /dev/null; then
  echo "Oracle: $START-$END was refused; looking for a free slot"
  BUSY=$(gws calendar freebusy query --json "{\"timeMin\": \"${DAY}T00:00:00Z\", \"timeMax\": \"${DAY}T23:59:59Z\", \"items\": [{\"id\": \"primary\"}]}")
  SLOT=$(python3 - "$START" "$END" "$BUSY" <<'PY'
import json
import sys
from datetime import datetime, timedelta

parse = lambda t: datetime.fromisoformat(t.replace("Z", "+00:00"))
start, end = parse(sys.argv[1]), parse(sys.argv[2])
busy = [(parse(b["start"]), parse(b["end"])) for b in json.loads(sys.argv[3])["calendars"]["primary"]["busy"]]
# The slot as asked if it is free now, else the first free one later that day.
while any(s < end and start < e for s, e in busy):
    start, end = start + timedelta(minutes=30), end + timedelta(minutes=30)
print(start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)
  START=${SLOT% *}
  END=${SLOT#* }
  gws calendar events insert --params '{"calendarId": "primary"}' --json "$(event "$START" "$END")" > /dev/null
fi

# The event is on the calendar, under its day.
ls "/calendar/primary/$DAY/" | grep -F "$(echo "$TITLE" | tr ' ' _)" > /dev/null
echo "Oracle: $TITLE is on the calendar at $START-$END"
