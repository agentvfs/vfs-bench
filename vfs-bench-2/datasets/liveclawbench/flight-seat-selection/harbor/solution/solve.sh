#!/usr/bin/env bash
# Ours (vfs-bench-2, rule A for the mail): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This reads the airline's booking notification at /gmail for the flight and
# the site (localhost:5173, the airline mock), signs in as Peter there, as
# the site's own frontend does as it loads (its AuthContext.jsx, under
# /workspace/environment), finds his booking on that flight, picks a free
# window seat in its cabin, checks him in, and reads back the boarding pass.
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
seat = next(s for row in chart.values() for s in row if s["is_window"] and s["is_available"])
print(json.dumps({"seat_assignments": [{"passenger_id": passenger, "seat_id": seat["id"]}]}))
PY
curl -s -X POST "$SITE/api/bookings/$REF/seats" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(cat /tmp/assign.json)"
echo
curl -s -X POST "$SITE/api/checkin/$REF" -H "$AUTH"
echo
curl -s "$SITE/api/checkin/$REF/boarding-pass" -H "$AUTH"
echo
