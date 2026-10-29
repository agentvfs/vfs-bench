#!/usr/bin/env bash
# Upstream's solution, through the smart home's API (vfs-bench-2):
# upstream's writes the mock's SQLite with the sqlite3 CLI, which here is a
# read-only copy of the run's. The same changes go through the control
# panel's API: the thermostat to comfort at 74°F, the coffee to start at
# 06:30, and the two coffees to the grocery list. Its rundown is upstream's.
set -euo pipefail

BASE_URL="http://localhost:5004"
post() {
  curl -s -X "$1" "$BASE_URL$2" -H "Content-Type: application/json" -d "$3"
  echo
}

post POST /api/thermostat '{"mode": "comfort", "temperature": 74}'
post POST /api/coffee-schedule '{"start_time": "06:30"}'
post POST /api/grocery/products '{"product_id": "PROD009", "name": "Blue Mountain Coffee Beans", "quantity": 20, "unit": "grams", "stock_status": "insufficient", "reference": "expired - all fridge entries expired before 2026-05-09"}'
post POST /api/grocery/products '{"product_id": "PROD010", "name": "Kenya AA", "quantity": 8, "unit": "grams", "stock_status": "insufficient", "reference": "shortage - only 12g available, need 20g for brew"}'

mkdir -p /workspace/output
cat > /workspace/output/response.txt << 'RESPONSE_EOF'
I've checked your smart home and found several issues that I've now fixed:

**Environmental Issues:**
- The humidity sensor is showing 999%, which is physically impossible and indicates a sensor malfunction that caused the thermostat to enter protection mode (set to "off" with temperature at 95°F); I've corrected the thermostat to "comfort" mode at 74°F, which should make the environment comfortable

**Coffee Machine:**
- The coffee was scheduled to start at 08:00, but since you need to leave by 7am and the brew takes 30 minutes, I've adjusted the start time to 06:30
- This ensures your coffee will be ready by 07:00 when you need to leave

**Inventory Check:**
- Blue Mountain Coffee Beans in the fridge: all entries are expired (expired on 2026-05-01 and 2026-05-05, before today's date 2026-05-09)
- Kenya AA in the pantry: only 12g available, but you need 20g for a full brew - this is a shortage of 8g
- I cross-referenced Kenya AA with the Coffee Machine page to confirm it's a coffee bean currently in use
- I've added both items to your grocery list: Blue Mountain (20g, reason: expired) and Kenya AA (8g, reason: insufficient)

Everything should now be ready for your 7am departure tomorrow.
RESPONSE_EOF
echo "Solution complete: thermostat fixed, coffee time adjusted, grocery entries added, response written"
