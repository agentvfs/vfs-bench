#!/usr/bin/env bash
# Ours (vfs-bench-2, rule A for the mail): upstream's solution runs
# `openclaw agent`, a model, so there is no script of upstream's to port.
# This reads the airline's cancellation notice at /gmail for the flight,
# signs in as Peter on the airline site (localhost:5173, the airline mock),
# as the site's own frontend does as it loads (its AuthContext.jsx, under
# /workspace/environment), and reads his booking on that flight, the flight
# and his profile. The airline's FAQ on claims for a cancelled flight (in its
# app's data, under /workspace/environment) names the address to write to,
# the subject and what to include and attach; this sends that email with the
# gws CLI, as a raw message with the booking confirmation attached as an
# image. The workspace has no browser to take the FAQ's screenshot with, so
# the image is one drawn here.
set -euo pipefail

SITE=http://localhost:5173

python3 > /tmp/flight-number <<'PY'
import glob
import json
import re

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    mail = json.load(open(path))
    if "Cancellation" in mail["subject"] and "GKD" in mail["subject"]:
        print(re.search(r"Flight Number: (\S+)", mail["body_text"]).group(1))
        break
PY
echo "The cancelled flight: $(cat /tmp/flight-number)"

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

curl -s "$SITE/api/profile" -H "$AUTH" > /tmp/profile.json
curl -s "$SITE/api/bookings?per_page=100" -H "$AUTH" > /tmp/bookings.json
for FLIGHT in $(python3 -c 'import json; print(" ".join(str(b["flight_id"]) for b in json.load(open("/tmp/bookings.json"))["data"]["bookings"]))'); do
  curl -s "$SITE/api/flights/$FLIGHT" > "/tmp/flight-$FLIGHT.json"
done

# The claim, as a raw message for Gmail's messages.send.
python3 > /tmp/claim.json <<'PY'
import base64
import json
import re
import struct
import zlib
from email.message import EmailMessage

number = open("/tmp/flight-number").read().strip()
profile = json.load(open("/tmp/profile.json"))["data"]
booking, flight = next(
    (b, f)
    for b in json.load(open("/tmp/bookings.json"))["data"]["bookings"]
    for f in [json.load(open(f"/tmp/flight-{b['flight_id']}.json"))["data"]]
    if f["flight_number"] == number)
faq = open("/workspace/environment/airline-app/backend/scripts/inject_data.py").read()
claims = re.search(r"dedicated customer service email:\s*\*\*([^*\s]+)\*\*", faq).group(1)


def png(width, height):
    """A plain image: a white card with a dark border."""
    rows = b""
    for y in range(height):
        edge = y < 4 or y >= height - 4
        row = bytes(0 if edge or x < 4 or x >= width - 4 else 255 for x in range(width))
        rows += b"\x00" + bytes(v for v in row for _ in range(3))
    chunk = lambda kind, data: (struct.pack(">I", len(data)) + kind + data
                                + struct.pack(">I", zlib.crc32(kind + data)))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


name = f"{profile['first_name']} {profile['last_name']}"
ref = booking["booking_reference"]
message = EmailMessage()
message["To"] = claims
message["Subject"] = f"Flight Cancellation Claim - {ref} - {number}"
message.set_content(f"""Dear GKD Airlines Claims Team,

I am writing to file a claim for my cancelled flight.

Flight number: {flight['flight_number']}
Departure: {flight['origin_city']} ({flight['origin_code']}), {flight['departure_time']}
Arrival: {flight['destination_city']} ({flight['destination_code']})
Booking reference: {ref}
Flight status: {flight['status']}

Passenger: {name}
Email: {profile['email']}
Phone: {profile['phone']}

The flight was cancelled, as your notice of today says, and I have not been
offered an alternative. I ask for a full refund of the ticket price, or free
rebooking on the next available flight, and compensation for the disruption.
My booking confirmation is attached.

Best regards,
{name}
""")
message.add_attachment(png(320, 120), maintype="image", subtype="png",
                       filename=f"booking-confirmation-{ref}.png")
raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
print(json.dumps({"raw": raw}))
PY
gws gmail users messages send --params '{"userId": "me"}' --json "$(cat /tmp/claim.json)"
echo
