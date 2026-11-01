#!/usr/bin/env bash
# The pre-Harbor port's oracle for bronwen-safest-zip-price (gaia2/bronwen-safest-zip-price/tests/oracle.sh),
# through the apps' CLIs; the answer is the agent's reply (trajectory.py).
# Bronwen Pritchard lives in Cardiff.
contacts search-contacts --query Bronwen | tee /workspace/bronwen.json

rent-a-flat search-apartments --location "$(jq -r '.[0].city_living' /workspace/bronwen.json)" > /workspace/flats.json
jq -c '.data[] | [.name, .zip_code, .price]' /workspace/flats.json

# Each listed zip code's crime rates: CF10 2AH has the lowest violent crime
# (3.32), and its one listing costs 1000.
jq -r '.data[].zip_code' /workspace/flats.json | sort -u | while read -r zip; do
  city get-crime-rate --zip-code "$zip" | jq -c --arg zip "$zip" '{zip: $zip} + .data'
done | tee /workspace/crime.jsonl

answer=$(python3 - <<'PY'
import json, sys
crime = list(map(json.loads, open('/workspace/crime.jsonl')))
safest = min(crime, key=lambda c: (c['violent_crime'], c['property_crime']))['zip']
prices = [f['price'] for f in json.load(open('/workspace/flats.json'))['data'].values() if f['zip_code'] == safest]
print(safest, prices, file=sys.stderr)
average = sum(prices) / len(prices)
print(int(average) if average == int(average) else round(average, 2))
PY
)
python3 /solution/trajectory.py "$answer"
