# The whole inbox and every contact.
emails list-emails --folder-name INBOX --offset 0 --limit 1000 > /workspace/inbox.json
jq .total_emails /workspace/inbox.json

total=$(contacts get-contacts --offset 0 | jq .metadata.total)
for o in $(seq 0 10 $((total - 1))); do contacts get-contacts --offset $o | jq -c '.contacts[]'; done > /workspace/contacts.jsonl

# Nine emails arrived between 2 and 4 AM, from senders averaging 39, and
# two contacts are 39.
python3 - <<'PY'
import datetime, json
contacts = {c['email']: c for c in map(json.loads, open('/workspace/contacts.jsonl'))}
hour = lambda e: datetime.datetime.fromtimestamp(e['timestamp'], datetime.timezone.utc).hour
senders = {e['sender'] for e in json.load(open('/workspace/inbox.json'))['emails'] if 2 <= hour(e) < 4}
ages = [contacts[s]['age'] for s in senders if s in contacts]
average = round(sum(ages) / len(ages))
print(len(senders), sorted(ages), average)
same = [f"{c['first_name']} {c['last_name']}" for c in contacts.values() if c['age'] == average and not c['is_user']]
open('/workspace/same.txt', 'w').write('\n'.join(same) + '\n')
print(same)
PY

# Their ids on each app, each conversation they are in, and the last
# message each sent: Krittaya Wongcharoen on Chats on 2024-10-07, after
# Warunee Srisuk on Messages on 2024-09-15.
while read -r name; do
  for app in messages chats; do
    id=$($app get-user-id --user-name "$name" | jq -r .)
    [ "$id" = null ] && continue
    for conv in $($app search --query "$id" | jq -r '.[]'); do
      $app read-conversation --conversation-id $conv --limit 1000 | jq -c --arg id "$id" --arg name "$name" --arg app $app '.messages[] | select(.sender_id == $id) | {name: $name, app: $app, timestamp}'
    done
  done
done < /workspace/same.txt | jq -s -c 'group_by(.name) | map(max_by(.timestamp))' | tee /workspace/latest.json

# Krittaya Wongcharoen lives in Thailand.
answer=$(python3 - <<'PY'
import json, sys
latest = max(json.load(open('/workspace/latest.json')), key=lambda m: m['timestamp'])
contact = next(c for c in map(json.loads, open('/workspace/contacts.jsonl')) if f"{c['first_name']} {c['last_name']}" == latest['name'])
print(latest, file=sys.stderr)
print(contact['country'])
PY
)
complete-task --answer "$answer"
