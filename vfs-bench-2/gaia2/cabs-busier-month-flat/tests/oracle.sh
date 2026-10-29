# The whole ride history, in one page.
cabs get-ride-history-length

cabs get-ride-history --offset 0 --limit 100 > /workspace/rides.json

# September (1115.8) beat August (1094.4), and six of its rides ended in
# Brno. Brno's flats that allow no pets: Brno Bliss is the only one at 2200.
city=$(python3 - <<'PY'
import collections, datetime, json, re, sys
rides = json.load(open('/workspace/rides.json'))['data']['rides'].values()
month = lambda r: datetime.datetime.fromtimestamp(r['time_stamp'], datetime.timezone.utc).strftime('%Y-%m')
spent = collections.Counter()
for r in rides:
    spent[month(r)] += r['price']
busier = max(('2024-08', '2024-09'), key=lambda m: spent[m])
city = lambda place: re.sub(r'[\d\s]+', ' ', place.split(',')[-1]).strip().split('-')[0]
ends = collections.Counter(city(r['end_location']) for r in rides if month(r) == busier)
top = max(ends.values())
print({m: round(spent[m], 2) for m in ('2024-08', '2024-09')}, busier, ends.most_common(), file=sys.stderr)
print(min(c for c, n in ends.items() if n == top))
PY
)
rent-a-flat search-apartments --location "$city" --pet-policy 'No pets' > /workspace/flats.json
jq -c '.data[] | [.name, .price, .square_footage]' /workspace/flats.json
answer=$(python3 - <<'PY'
import json
flats = json.load(open('/workspace/flats.json'))['data'].values()
print(max(flats, key=lambda f: (f['price'], f['square_footage']))['name'])
PY
)
complete-task --answer "$answer"
