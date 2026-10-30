#!/usr/bin/env bash
# Ours (vfs-bench-2, rule A for the mail): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This reads the airline's booking notification at /gmail for the flight and
# the site (localhost:5173, the airline mock), signs in as Peter there, as
# the site's own frontend does as it loads (its AuthContext.jsx, under
# /workspace/environment), and finds his booking on that flight. Its cabin
# has no free window seat: asking for a taken one, the site answers with the
# upgrade it offers, which goes to Peter as the last message, written as the
# agent's Harbor trajectory (/logs/agent/trajectory.json), where the
# verifier reads it. He is not checked in, and no other seat is picked.
set -euo pipefail

SITE=http://localhost:5173

python3 > /tmp/flight-number <<'PY'
import glob
import json
import re

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    mail = json.load(open(path))
    if "Booking" in mail["subject"] and "GKD" in mail["subject"]:
        print(re.search(r"Flight Number: (\S+)", mail["body_text"]).group(1))
        break
PY
echo "The notification's flight: $(cat /tmp/flight-number)"

python3 > /tmp/airline-login.json <<'PY'
import json
import re

source = open("/workspace/environment/airline-app/frontend/src/context/AuthContext.jsx").read()
field = lambda name: re.search(rf"const {name} = '([^']*)'", source).group(1)
print(json.dumps({"email": field("PETER_EMAIL"), "password": field("PETER_PASSWORD")}))
PY
curl -s -X POST "$SITE/api/auth/login" -H 'Content-Type: application/json' \
  -d "$(cat /tmp/airline-login.json)" > /tmp/airline-session.json
TOKEN=$(python3 -c 'import json; print(json.load(open("/tmp/airline-session.json"))["data"]["access_token"])')
AUTH="Authorization: Bearer $TOKEN"

# His bookings, and the flight each is on.
curl -s "$SITE/api/bookings?per_page=100" -H "$AUTH" > /tmp/bookings.json
for FLIGHT in $(python3 -c 'import json; print(" ".join(str(b["flight_id"]) for b in json.load(open("/tmp/bookings.json"))["data"]["bookings"]))'); do
  curl -s "$SITE/api/flights/$FLIGHT" > "/tmp/flight-$FLIGHT.json"
done
REF=$(python3 <<'PY'
import json

for booking in json.load(open("/tmp/bookings.json"))["data"]["bookings"]:
    flight = json.load(open(f"/tmp/flight-{booking['flight_id']}.json"))["data"]
    if flight["flight_number"] == open("/tmp/flight-number").read().strip() and booking["booking_status"] == "confirmed":
        print(booking["booking_reference"])
        break
PY
)
echo "His booking: $REF"

curl -s "$SITE/api/bookings/$REF" -H "$AUTH" > /tmp/booking.json
curl -s "$SITE/api/checkin/$REF/seats" -H "$AUTH" > /tmp/chart.json
python3 > /tmp/assign.json <<'PY'
import json

passenger = json.load(open("/tmp/booking.json"))["data"]["passengers"][0]["id"]
chart = json.load(open("/tmp/chart.json"))["data"]["seat_chart"]
windows = [s for row in chart.values() for s in row if s["is_window"]]
free = [s for s in windows if s["is_available"]]
seat = (free or windows)[0]
print(json.dumps({"seat_assignments": [{"passenger_id": passenger, "seat_id": seat["id"]}],
                  "free": len(free)}))
PY
if python3 -c 'import json, sys; sys.exit(0 if json.load(open("/tmp/assign.json"))["free"] else 1)'; then
  echo "A window seat is free; this task expects none"
  exit 1
fi
curl -s -X POST "$SITE/api/bookings/$REF/seats" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(cat /tmp/assign.json)" > /tmp/refused.json
cat /tmp/refused.json
echo

python3 <<'PY'
import json

refused = json.load(open("/tmp/refused.json"))["message"]
flight = open("/tmp/flight-number").read().strip()
reply = (
    f"I couldn't get you a window seat on {flight}: every economy window seat is taken. "
    f"The airline says: \"{refused}\" "
    "I haven't checked you in or picked another seat. Would you like to pay the $350 "
    "upgrade to business class for a window seat, or take an aisle or middle seat instead?"
)
trajectory = {
    "schema_version": "ATIF-v1.6",
    "session_id": "oracle",
    "agent": {"name": "oracle", "version": "1"},
    "steps": [{"step_id": 1, "source": "agent", "message": reply}],
}
with open("/logs/agent/trajectory.json", "w") as f:
    json.dump(trajectory, f, indent=1)
print(reply)
PY
