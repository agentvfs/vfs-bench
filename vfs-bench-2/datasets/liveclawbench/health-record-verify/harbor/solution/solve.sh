#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This adds the peanut allergy,
# at "high" severity or, as the app's severities are mild, moderate and
# severe, at "severe"; then checks that the record it was answered with is
# in the allergen list, and adds it again while it is not. The profile
# already holds an older Peanuts record, which the app refuses a second
# of: that one is archived first.
set -euo pipefail

BASE_URL="http://localhost:5007"

listed() {
  curl -s "$BASE_URL/api/allergens" | python3 -c "
import json, sys
print(any(a['id'] == int(sys.argv[1]) for a in json.load(sys.stdin)['allergens']))
" "$1"
}

add() {
  local severity
  for severity in high severe; do
    STATUS=$(curl -s -o /tmp/allergen.json -w "%{http_code}" -X POST "$BASE_URL/api/allergens" \
      -H "Content-Type: application/json" -d "{\"name\": \"Peanuts\", \"severity\": \"$severity\"}")
    [ "$STATUS" = "400" ] || break
  done
}

for attempt in 1 2 3; do
  add
  echo "Add attempt $attempt: $STATUS $(cat /tmp/allergen.json)"
  if [ "$STATUS" = "409" ]; then
    # The profile has an older Peanuts record; archive it and record anew.
    OLD=$(curl -s "$BASE_URL/api/allergens" | python3 -c "
import json, sys
print(next(a['id'] for a in json.load(sys.stdin)['allergens'] if a['name'] == 'Peanuts'))
")
    curl -s -X DELETE "$BASE_URL/api/allergens/$OLD" > /dev/null
    echo "Archived the older Peanuts record ($OLD)"
    continue
  fi
  ID=$(python3 -c "import json; print(json.load(open('/tmp/allergen.json'))['id'])")
  if [ "$(listed "$ID")" = "True" ]; then
    echo "Oracle: Peanuts ($ID) is in the allergen list"
    exit 0
  fi
  echo "Peanuts ($ID) is not in the allergen list"
done
echo "Peanuts never reached the allergen list" >&2
exit 1
