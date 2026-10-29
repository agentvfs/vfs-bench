#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This adds the crab allergy and
# the Theraflu reminder (daily from today, 9:00 and 17:00, a packet each)
# through the health app's API, then finds this month's highest active
# energy and writes it to /workspace/output/max_energy.txt.
set -euo pipefail

BASE_URL="http://localhost:5007"
TODAY=$(date +%Y-%m-%d)
MONTH_START="${TODAY%-*}-01"

check() {
  python3 -c "
import json, sys
reply = json.load(sys.stdin)
if 'error' in reply:
    sys.exit('refused: ' + json.dumps(reply))
print(sys.argv[1], reply.get('id'))
" "$1"
}

curl -s -X POST "$BASE_URL/api/allergens" -H "Content-Type: application/json" \
  -d '{"name": "Crab", "severity": "mild"}' | check "Allergen"

curl -s -X POST "$BASE_URL/api/medications" -H "Content-Type: application/json" \
  -d "{\"name\": \"Theraflu\", \"frequency\": \"daily\", \"start_date\": \"$TODAY\", \"slots\": [{\"time_hhmm\": \"09:00\", \"dose_amount\": 1, \"dose_unit\": \"packet\"}, {\"time_hhmm\": \"17:00\", \"dose_amount\": 1, \"dose_unit\": \"packet\"}]}" | check "Medication"

mkdir -p /workspace/output
curl -s "$BASE_URL/api/health/metrics/active_energy_kcal?start_date=$MONTH_START&end_date=$TODAY" | python3 -c "
import json, sys
values = [p['value'] for p in json.load(sys.stdin)['data']]
print(max(values))
" > /workspace/output/max_energy.txt
echo "Highest active energy this month: $(cat /workspace/output/max_energy.txt)"
