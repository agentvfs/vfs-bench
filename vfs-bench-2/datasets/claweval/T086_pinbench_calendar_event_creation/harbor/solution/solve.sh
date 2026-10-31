#!/usr/bin/env bash
# Upstream's reference_solution, through the gws CLI: one event, "Project
# Sync", on 2026-03-10 at 15:00 (the calendar's zone, UTC, is local here),
# with john@example.com, then the confirmation with the Q1 roadmap note.
# Each step's command and output go to the trajectory (trajectory.py),
# which ends with reply.md.
S=/tmp/oracle
mkdir -p "$S"
n=0
step() {
  n=$((n + 1))
  cat > "$S/$n.cmd"
  sh "$S/$n.cmd" > "$S/$n.out" 2>&1
  cat "$S/$n.out"
}
step <<'STEP'
gws calendar events insert --params '{"calendarId": "primary"}' --json '{"summary": "Project Sync", "description": "Discuss the Q1 roadmap.", "start": {"dateTime": "2026-03-10T15:00:00", "timeZone": "UTC"}, "end": {"dateTime": "2026-03-10T16:00:00", "timeZone": "UTC"}, "attendees": [{"email": "john@example.com"}]}'
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
