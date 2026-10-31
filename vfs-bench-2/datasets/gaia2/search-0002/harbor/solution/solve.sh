#!/usr/bin/env bash
# The pre-Harbor port's oracle for chats-cultures-oldest (gaia2/chats-cultures-oldest/tests/oracle.sh),
# through the apps' CLIs; the answer is the agent's reply (trajectory.py).
# The conversations mentioning "cultures", then the ages of the oldest
# participants: Lianying Wang and Aurélia Silva are both 79, and the tie
# goes to the first name last alphabetically, Lianying.
chats search --query cultures | tee /workspace/found.json

# Every conversation's participants, the user's own id, and every contact.
o=0; n=5
while [ "$n" -eq 5 ]; do
  chats list-recent-conversations --offset $o --limit 5 --limit-recent-messages-per-conversation 0 | jq -c '.[]' > /workspace/page.jsonl
  n=$(jq -s length /workspace/page.jsonl); cat /workspace/page.jsonl >> /workspace/conversations.jsonl; o=$((o + 5))
done
jq -s length /workspace/conversations.jsonl

me=$(contacts get-current-user-details | jq -r '"\(.first_name) \(.last_name)"')
chats get-user-id --user-name "$me" | jq -r . > /workspace/me.txt
total=$(contacts get-contacts --offset 0 | jq .metadata.total)
for o in $(seq 0 10 $((total - 1))); do contacts get-contacts --offset $o | jq -c '.contacts[]'; done > /workspace/contacts.jsonl

# The found conversations' other participants, by name.
for id in $(jq -r --slurpfile found /workspace/found.json --arg me "$(cat /workspace/me.txt)" 'select(.conversation_id | IN($found[0][])) | .participant_ids[] | select(. != $me)' /workspace/conversations.jsonl | sort -u); do
  chats get-user-name-from-id --user-id $id | jq -r .
done | tee /workspace/names.txt

answer=$(python3 - <<'PY'
import json, sys
names = set(open('/workspace/names.txt').read().split('\n')) - {''}
contacts = [c for c in map(json.loads, open('/workspace/contacts.jsonl')) if f"{c['first_name']} {c['last_name']}" in names]
oldest = max(c['age'] for c in contacts)
tied = sorted((c['first_name'] for c in contacts if c['age'] == oldest), reverse=True)
print(len(names), oldest, tied, file=sys.stderr)
print(tied[0])
PY
)
python3 /solution/trajectory.py "$answer"
