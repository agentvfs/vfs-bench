#!/usr/bin/env bash
# Upstream's reference_solution, through the CLIs: the projects' meetings in
# the week up to today (2026-03-24), their minutes' action items, every todo,
# and each owner's contact details.
# Mail and events are read through the /gmail mount and the gws CLI, as
# the instruction gives them; drafts are upstream's tool (gmail save-draft).
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
gws calendar events list --params '{"calendarId": "primary", "timeMin": "2026-03-17T00:00:00+08:00", "timeMax": "2026-03-25T00:00:00+08:00", "orderBy": "startTime", "singleEvents": true}'
STEP
step <<'STEP'
gws calendar events get --params '{"calendarId": "primary", "eventId": "evt_601"}'
gws calendar events get --params '{"calendarId": "primary", "eventId": "evt_602"}'
gws calendar events get --params '{"calendarId": "primary", "eventId": "evt_603"}'
gws calendar events get --params '{"calendarId": "primary", "eventId": "evt_604"}'
gws calendar events get --params '{"calendarId": "primary", "eventId": "evt_605"}'
gws calendar events get --params '{"calendarId": "primary", "eventId": "evt_606"}'
STEP
step <<'STEP'
notes list
STEP
step <<'STEP'
notes get --note-id NOTE-601
notes get --note-id NOTE-602
notes get --note-id NOTE-603
notes get --note-id NOTE-604
notes get --note-id NOTE-605
STEP
step <<'STEP'
todo list-tasks
STEP
step <<'STEP'
contacts search --query 王明
contacts search --query 李华
contacts search --query 马强
contacts search --query 赵蕾
contacts search --query 张伟
contacts search --query 周明
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
