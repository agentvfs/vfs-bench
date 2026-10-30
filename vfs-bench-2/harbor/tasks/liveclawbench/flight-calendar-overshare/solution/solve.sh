#!/usr/bin/env bash
# Ours (vfs-bench-2, rule A for the mail): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This reads GKD Airlines' delay notice at /gmail (the flight to Los
# Angeles, its new departure time), then the calendar (localhost:3000, the
# todolist mock) for the coming week. The items it affects are those in Los
# Angeles that start after the new departure time, which the delayed flight
# cannot reach in time; for each, the people the item names an email
# address for are its co-travelers, and each gets a reminder with the gws
# CLI that describes that item and the delay. It is flight-info-change-
# notice's: the other items on those days (a checkup, an interview, a
# lawyer's consultation) are not affected, and nothing of them is sent or
# written down. The calendar goes from curl to Python through a pipe, and
# only the reminders are kept.
set -euo pipefail

python3 > /tmp/delay.json <<'PY'
import glob
import json
import re

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    mail = json.load(open(path))
    if "Delay" in mail["subject"] and "GKD" in mail["subject"]:
        body = mail["body_text"]
        print(json.dumps({
            "flight": re.search(r"Flight Number: (\S+)", body).group(1),
            "from": re.search(r"Departure: (.+)", body).group(1).strip(),
            "to": re.search(r"Arrival: (.+)", body).group(1).strip(),
            "departs": re.search(r"New Departure Time: (\d\d:\d\d)", body).group(1),
        }))
        break
PY
cat /tmp/delay.json

# The reminders, as gws commands, from the calendar on stdin.
cat > /tmp/remind.py <<'PY'
import json
import re
import shlex
import sys

delay = json.load(open("/tmp/delay.json"))
city = delay["to"].split(",")[0].strip()
for todo in json.load(sys.stdin)["data"]:
    location, time = todo.get("location") or "", todo.get("time")
    if city not in location or not time or time <= delay["departs"]:
        continue
    person = todo.get("person") or ""
    text = f"{person} {todo.get('description') or ''}"
    for address in dict.fromkeys(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]*[A-Za-z]", text)):
        name = person.split()[0] if person else "there"
        body = (
            f"Hi {name},\n\n"
            f"GKD Airlines has delayed my flight {delay['flight']} from {delay['from']} to "
            f"{delay['to']}: its new departure time is {delay['departs']}. That affects our plan:\n\n"
            f"- {todo['title']}, on {todo['date']} at {time}, at {location}\n\n"
            f"With the delay I cannot be there by {time} that day. Could we move it to later "
            f"that evening, or to another day? Please let me know what works for you so we can "
            f"re-plan.\n\nBest regards,\nPeter"
        )
        subject = f"Flight delay: {todo['title']} on {todo['date']} needs re-planning"
        print(" ".join(["gws", "gmail", "send", "--to", shlex.quote(address), "--subject",
                        shlex.quote(subject), "--body", shlex.quote(body), "> /dev/null;",
                        "echo", shlex.quote(f"Reminder sent to {address}: {subject}")]))
PY

FROM=$(python3 -c 'import datetime; print(datetime.date.today())')
TO=$(python3 -c 'import datetime; print(datetime.date.today() + datetime.timedelta(days=7))')
curl -s "http://localhost:3000/api/todos?start_date=$FROM&end_date=$TO" | python3 /tmp/remind.py > /tmp/remind.sh
. /tmp/remind.sh
