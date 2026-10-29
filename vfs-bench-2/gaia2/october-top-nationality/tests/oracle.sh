# The user, every contact, and both email folders.
contacts get-current-user-details | tee /workspace/me.json

total=$(contacts get-contacts --offset 0 | jq .metadata.total)
for o in $(seq 0 10 $((total - 1))); do contacts get-contacts --offset $o | jq -c '.contacts[]'; done > /workspace/contacts.jsonl

emails list-emails --folder-name INBOX --offset 0 --limit 1000 > /workspace/inbox.json
emails list-emails --folder-name SENT --offset 0 --limit 1000 > /workspace/sent.json
jq .total_emails /workspace/inbox.json /workspace/sent.json

# The conversations on each app updated this month (since 2024-10-01),
# newest first, so paging stops at the first older one.
for app in messages chats; do
  o=0; last=1727740800
  while [ "$last" -ge 1727740800 ]; do
    $app list-recent-conversations --offset $o --limit 5 --limit-recent-messages-per-conversation 1 | jq -c '.[]' > /workspace/page.jsonl
    [ -s /workspace/page.jsonl ] || break
    jq -c --arg app $app 'select(.last_updated >= 1727740800) | {app: $app} + .' /workspace/page.jsonl >> /workspace/october.jsonl
    last=$(jq -s 'map(.last_updated) | min' /workspace/page.jsonl); o=$((o + 5))
  done
done
jq -s -c 'group_by(.app) | map({app: .[0].app, conversations: length})' /workspace/october.jsonl

# Chats ids are user ids, so name them.
for id in $(jq -r 'select(.app == "chats") | .participant_ids[]' /workspace/october.jsonl | sort -u); do
  echo "{\"id\": \"$id\", \"name\": $(chats get-user-name-from-id --user-id $id)}"
done > /workspace/chats-names.jsonl

# Everyone the user wrote to, heard from or shared an active conversation
# with this month, once each and only if a contact: Thai (23) leads
# Belgian (20).
python3 - <<'PY'
import collections, json
since = 1727740800
me = json.load(open('/workspace/me.json'))
contacts = list(map(json.loads, open('/workspace/contacts.jsonl')))
by = {key: {c[key]: c for c in contacts} for key in ('email', 'phone')}
by['name'] = {f"{c['first_name']} {c['last_name']}": c for c in contacts}
names = {r['id']: r['name'] for r in map(json.loads, open('/workspace/chats-names.jsonl'))}
people = set()
for e in json.load(open('/workspace/inbox.json'))['emails']:
    if e['timestamp'] >= since and e['sender'] in by['email']:
        people.add(e['sender'])
for e in json.load(open('/workspace/sent.json'))['emails']:
    if e['timestamp'] >= since:
        people |= {r for r in e['recipients'] + (e['cc'] or []) if r in by['email']}
for conv in map(json.loads, open('/workspace/october.jsonl')):
    for p in conv['participant_ids']:
        c = by['phone'].get(p) if conv['app'] == 'messages' else by['name'].get(names.get(p))
        if c:
            people.add(c['email'])
people.discard(me['email'])
print(len(people), collections.Counter(by['email'][p]['nationality'] for p in people).most_common(4))
PY

complete-task --answer Thai
