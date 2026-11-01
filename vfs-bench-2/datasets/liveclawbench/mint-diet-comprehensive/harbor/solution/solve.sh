#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's posts to the mock's form routes
# (`POST /log/<date>/entries`, `POST /plans`), which it registers with
# `app.page`, GET only, so upstream's own mock answers them 404. This does
# the three things through the mock's JSON API: today's meals from the food
# catalog, the "Clean Eating Week" plan for next Monday through Sunday at
# 1800 kcal, Monday's and Tuesday's dishes, and the plan's notes.
set -euo pipefail

BASE_URL="http://localhost:5003"
TODAY=$(date +%Y-%m-%d)
DATES=$(python3 -c "
import datetime
today = datetime.date.today()
monday = today + datetime.timedelta(days=(7 - today.weekday()) % 7 or 7)
print(monday, monday + datetime.timedelta(days=6), monday + datetime.timedelta(days=1))
")
MONDAY=$(echo "$DATES" | cut -d' ' -f1)
SUNDAY=$(echo "$DATES" | cut -d' ' -f2)
TUESDAY=$(echo "$DATES" | cut -d' ' -f3)

post() {
  curl -s -X "$1" "$BASE_URL$2" -H "Content-Type: application/json" -d "$3" | python3 -c "
import json, sys
reply = json.load(sys.stdin)
if not reply.get('success'):
    sys.exit('refused: ' + json.dumps(reply))
print(reply['data'].get('id', ''))
"
}

# (1) Today's meals, each from the catalog.
log() {
  local slot="$1" name="$2" qty="$3" unit="$4" id q
  q=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$name")
  id=$(curl -s "$BASE_URL/api/food-catalog/search?q=$q" | python3 -c "
import json, sys
print(next(f['id'] for f in json.load(sys.stdin)['data'] if f['food_name'] == sys.argv[1]))
" "$name")
  post POST "/api/log/$TODAY/entries" "{\"slot\": \"$slot\", \"food_catalog_id\": $id, \"food_name\": \"$name\", \"quantity_value\": $qty, \"quantity_unit\": \"$unit\"}" > /dev/null
  echo "Logged $slot: $name $qty $unit"
}
log breakfast oatmeal 250 g
log breakfast banana 120 g
log lunch "chicken breast" 200 g
log lunch 白米饭 300 g
log dinner salmon 150 g
log dinner broccoli 100 g
log snacks milk 240 ml

# (2) The plan, and Monday's dishes.
PLAN=$(post POST /api/meal-plans "{\"title\": \"Clean Eating Week\", \"start_date\": \"$MONDAY\", \"end_date\": \"$SUNDAY\", \"status\": \"active\", \"target_calories_kcal\": 1800}")
echo "Plan $PLAN: $MONDAY to $SUNDAY"
dish() {
  post POST "/api/meal-plans/$PLAN/items" "{\"plan_date\": \"$1\", \"meal_slot\": \"$2\", \"dish_name\": \"$3\"}" > /dev/null
  echo "Planned $1 $2: $3"
}
dish "$MONDAY" breakfast "Oatmeal with banana"
dish "$MONDAY" lunch "Chicken breast with rice"
dish "$MONDAY" dinner "Salmon with broccoli"

# (3) Tuesday's dishes, then the notes.
dish "$TUESDAY" breakfast "Scrambled eggs with whole wheat toast"
dish "$TUESDAY" lunch "Tuna salad"
dish "$TUESDAY" dinner "Stir-fried tofu with vegetables"
post PUT "/api/meal-plans/$PLAN" "{\"title\": \"Clean Eating Week\", \"start_date\": \"$MONDAY\", \"end_date\": \"$SUNDAY\", \"status\": \"active\", \"target_calories_kcal\": 1800, \"notes\": \"Focus on lean protein and vegetables — no fried foods.\"}" > /dev/null
echo "Notes set"
