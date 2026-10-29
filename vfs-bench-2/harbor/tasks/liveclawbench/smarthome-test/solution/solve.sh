#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. Through the control panel's
# API, this sets the thermostat to comfort at 74°F, switches today's
# workout to walking, and adds the food expiring in the next few days to
# the shopping list; then writes the rundown of what it found, from what
# the API reports, to /workspace/output/response.txt, where the verifier
# reads a scripted answer.
set -euo pipefail

BASE_URL="http://localhost:5004"
get() { curl -s "$BASE_URL$1"; }

get /api/room-metrics > /tmp/room.json
get /api/thermostat > /tmp/thermostat.json
get /api/coffee-schedule > /tmp/coffee.json
get /api/inventory > /tmp/inventory.json
get /api/calendar > /tmp/calendar.json

curl -s -X POST "$BASE_URL/api/thermostat" -H "Content-Type: application/json" -d '{"mode": "comfort", "temperature": 74}'
echo

python3 > /tmp/plan.sh <<'PY'
import datetime
import json

def items(path, key):
    data = json.load(open(path))
    return data.get(key, data) if isinstance(data, dict) else data

today = datetime.date(2026, 5, 9)
for event in items("/tmp/calendar.json", "events"):
    if event.get("event_type") == "workout" and event["start_time"].startswith(str(today)):
        print(f"curl -s -X PUT \"$BASE_URL/api/calendar/{event['id']}\" -H 'Content-Type: application/json' -d '{{\"workout_type\": \"walking\"}}'; echo")
for i, item in enumerate(items("/tmp/inventory.json", "items")):
    expiry = item.get("expiry_date")
    if expiry and today <= datetime.date.fromisoformat(expiry[:10]) <= today + datetime.timedelta(days=3):
        body = json.dumps({"product_id": f"PROD1{i:02d}", "name": item["item_name"], "quantity": item["quantity"], "unit": item["unit"], "stock_status": "insufficient", "reference": f"expiring {expiry[:10]}"})
        print(f"curl -s -X POST \"$BASE_URL/api/grocery/products\" -H 'Content-Type: application/json' -d '{body}'; echo")
PY
. /tmp/plan.sh

mkdir -p /workspace/output
python3 > /workspace/output/response.txt <<'PY'
import datetime
import json

def items(path, key):
    data = json.load(open(path))
    return data.get(key, data) if isinstance(data, dict) else data

room = json.load(open("/tmp/room.json"))
thermostat = json.load(open("/tmp/thermostat.json"))
coffee = json.load(open("/tmp/coffee.json"))
inventory = items("/tmp/inventory.json", "items")
events = items("/tmp/calendar.json", "events")
today = datetime.date(2026, 5, 9)
fridge = [i for i in inventory if i["location"] == "fridge"]
pantry = [i for i in inventory if i["location"] == "pantry"]
expiring = [i for i in inventory if i.get("expiry_date") and today <= datetime.date.fromisoformat(i["expiry_date"][:10]) <= today + datetime.timedelta(days=3)]
print(f"Dashboard: the room is at {room.get('temperature')}°F with humidity at {room.get('humidity')}%. The thermostat was in {thermostat['mode']} mode; I set it to comfort mode at 74°F.")
print(f"Coffee: the coffee machine is scheduled to start at {coffee['start_time']} (status: {coffee['status']}).")
print(f"Inventory: {len(fridge)} items in the fridge and {len(pantry)} items in the pantry.")
print("Expiring soon: " + ", ".join(f"{i['item_name'].lower()} ({i['expiry_date'][:10]})" for i in expiring) + ".")
print(f"Calendar: {len(events)} events today: " + ", ".join(e["title"] for e in events) + ".")
print("Since you are not feeling great, I switched your Morning Workout to walking, which is easy on the body.")
print("Shopping list: I added the items that are expiring in the next few days, so you can restock them: " + ", ".join(i["item_name"].lower() for i in expiring) + ".")
PY
cat /workspace/output/response.txt
