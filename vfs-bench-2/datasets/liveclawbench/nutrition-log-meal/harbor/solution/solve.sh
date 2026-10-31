#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's posts to the form route
# `POST /log/<date>/entries`, which the mint-diet mock registers with
# `app.page`, GET only, so upstream's own mock answers it 404. This logs
# lunch through the mock's JSON API (`POST /api/log/<date>/entries`):
# milk from the food catalog, a glass (240 ml), and a chicken salad, which
# the catalog lacks, by hand.
set -euo pipefail

BASE_URL="http://localhost:5003"
TODAY=$(date +%Y-%m-%d)

MILK_ID=$(curl -s "$BASE_URL/api/food-catalog/search?q=milk" | python3 -c "
import json, sys
foods = json.load(sys.stdin)['data']
print(next(f['id'] for f in foods if f['food_name'] == 'milk'))
")

log() {
  curl -s -X POST "$BASE_URL/api/log/$TODAY/entries" -H "Content-Type: application/json" -d "$1" | python3 -c "
import json, sys
entry = json.load(sys.stdin)
if not entry.get('success'):
    sys.exit('the entry was refused: ' + json.dumps(entry))
print('Logged', entry['data']['food_name'])
"
}
log "{\"slot\": \"lunch\", \"food_catalog_id\": $MILK_ID, \"food_name\": \"milk\", \"quantity_value\": 240, \"quantity_unit\": \"ml\"}"
log '{"slot": "lunch", "food_name": "chicken salad", "quantity_value": 300, "quantity_unit": "g", "calories_kcal": 420, "protein_g": 35, "carbs_g": 12, "fat_g": 25}'
