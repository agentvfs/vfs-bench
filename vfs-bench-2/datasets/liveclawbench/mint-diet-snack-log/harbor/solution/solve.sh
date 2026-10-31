#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's posts the entry to the form route
# `POST /log/<date>/entries`, which the mint-diet mock registers with
# `app.page`, GET only, so upstream's own mock answers it 404. This logs
# the banana through the mock's JSON API (`POST /api/log/<date>/entries`),
# from the food catalog's banana at its standard serving, 120 g.
set -euo pipefail

BASE_URL="http://localhost:5003"
DATE="2026-05-06"

BANANA_ID=$(curl -s "$BASE_URL/api/food-catalog/search?q=banana" | python3 -c "
import json, sys
foods = json.load(sys.stdin)['data']
print(next(f['id'] for f in foods if f['food_name'] == 'banana'))
")

curl -s -X POST "$BASE_URL/api/log/$DATE/entries" \
  -H "Content-Type: application/json" \
  -d "{\"slot\": \"snacks\", \"food_catalog_id\": $BANANA_ID, \"food_name\": \"banana\", \"quantity_value\": 120, \"quantity_unit\": \"g\"}" | python3 -c "
import json, sys
entry = json.load(sys.stdin)
if not entry.get('success'):
    sys.exit('the entry was refused: ' + json.dumps(entry))
print('Logged', entry['data']['food_name'], entry['data']['calories_kcal'], 'kcal')
"
