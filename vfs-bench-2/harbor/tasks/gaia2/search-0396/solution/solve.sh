#!/usr/bin/env bash
# The pre-Harbor port's oracle for oslo-lego-budget (gaia2/oslo-lego-budget/tests/oracle.sh),
# through the apps' CLIs; the answer is the agent's reply (trajectory.py).
# The user lives in Oslo, as do nine other contacts.
contacts get-current-user-details | tee /workspace/me.json

total=$(contacts get-contacts --offset 0 | jq .metadata.total)
for o in $(seq 0 10 $((total - 1))); do contacts get-contacts --offset $o | jq -c '.contacts[]'; done > /workspace/contacts.jsonl
jq -r --arg city "$(jq -r .city_living /workspace/me.json)" 'select(.city_living == $city and (.is_user | not)) | "\(.first_name) \(.last_name)"' /workspace/contacts.jsonl > /workspace/oslo.txt
cat /workspace/oslo.txt

# Which of them each app knows.
while read -r name; do
  echo "$name|$(messages get-user-id --user-name "$name" | jq -r .)|$(chats get-user-id --user-name "$name" | jq -r .)"
done < /workspace/oslo.txt | tee /workspace/apps.txt

shopping search-products --product-name LEGO --limit 100 > /workspace/lego.json

# Four are only on Messages ($15 each) and five only on Chats ($10 each),
# $110 in all; the dearest available LEGO variant is $44.99, so 2.
answer=$(python3 - <<'PY'
import json, math, sys
budget = 0
for line in open('/workspace/apps.txt'):
    name, on_messages, on_chats = line.rstrip('\n').split('|')
    on_messages, on_chats = on_messages != 'null', on_chats != 'null'
    budget += 15 if on_messages and not on_chats else 10 if on_chats and not on_messages else 0
variants = [(v['price'], p['name']) for p in json.load(open('/workspace/lego.json'))['products']
            if 'LEGO' in p['name'] for v in p['variants'].values() if v['available']]
price, item = max(variants)
print(budget, price, item, file=sys.stderr)
print(math.floor(budget / price))
PY
)
python3 /solution/trajectory.py "$answer"
