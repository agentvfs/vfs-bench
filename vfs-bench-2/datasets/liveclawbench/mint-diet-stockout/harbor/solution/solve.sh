#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This searches the catalog for
# "chips", logs a serving of the first result to today's snacks, and, if
# the food has gone from the catalog meanwhile (the log is refused), logs
# a serving of another snack the catalog still has; then checks the log.
set -euo pipefail

BASE_URL="http://localhost:5003"
TODAY=$(date +%Y-%m-%d)

search() {
  curl -s "$BASE_URL/api/food-catalog/search?q=$1" | python3 -c "
import json, sys
foods = json.load(sys.stdin)['data']
if foods:
    f = foods[0]
    print(f['id'], f['serving_size_value'], f['serving_size_unit'], f['food_name'], sep='\t')
"
}

log() {
  local id="$1" qty="$2" unit="$3" name="$4"
  curl -s -o /tmp/entry.json -w "%{http_code}" -X POST "$BASE_URL/api/log/$TODAY/entries" \
    -H "Content-Type: application/json" \
    -d "{\"slot\": \"snacks\", \"food_catalog_id\": $id, \"food_name\": \"$name\", \"quantity_value\": $qty, \"quantity_unit\": \"$unit\"}"
}

field() { echo "$FOUND" | cut -f"$1"; }
FOUND=$(search chips)
STATUS=$(log "$(field 1)" "$(field 2)" "$(field 3)" "$(field 4)")
NAME=$(field 4)
echo "Logging $NAME: $STATUS"
if [ "$STATUS" != "201" ]; then
  # The chips are gone; another snack the catalog has.
  for Q in chips almonds apple; do
    FOUND=$(search "$Q")
    [ -n "$FOUND" ] || continue
    STATUS=$(log "$(field 1)" "$(field 2)" "$(field 3)" "$(field 4)")
    NAME=$(field 4)
    echo "Logging $NAME instead: $STATUS"
    [ "$STATUS" = "201" ] && break
  done
fi
[ "$STATUS" = "201" ] || { echo "nothing could be logged" >&2; exit 1; }

curl -s "$BASE_URL/api/log/$TODAY" | python3 -c "
import json, sys
log = json.load(sys.stdin)['data']
names = [e['food_name'] for e in log.get('entries', [])]
print('Today\'s log:', names)
"
