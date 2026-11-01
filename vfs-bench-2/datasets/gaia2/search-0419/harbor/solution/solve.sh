#!/usr/bin/env bash
# The pre-Harbor port's oracle for messages-most-words (gaia2/messages-most-words/tests/oracle.sh),
# through the apps' CLIs; the answer is the agent's reply (trajectory.py).
# The user's own Messages id is their phone number.
contacts get-current-user-details | tee /workspace/me.json

# Every Messages conversation, then each 1:1 one in full.
o=0; n=5
while [ "$n" -eq 5 ]; do
  messages list-recent-conversations --offset $o --limit 5 --limit-recent-messages-per-conversation 0 | jq -c '.[]' > /workspace/page.jsonl
  n=$(jq -s length /workspace/page.jsonl); cat /workspace/page.jsonl >> /workspace/conversations.jsonl; o=$((o + 5))
done
jq -s length /workspace/conversations.jsonl

for id in $(jq -r 'select(.participant_ids | length == 2) | .conversation_id' /workspace/conversations.jsonl); do
  messages read-conversation --conversation-id $id --limit 1000 | jq -c .
done > /workspace/direct.jsonl

# Words in each chat's first (oldest) 6 messages, for chats of 6 or more.
# Fatima Al-Khaja's chat has the most, 283. Upstream's answer counts per
# chat: summed over a contact's chats, Elian Toledano's two would lead.
top=$(python3 - <<'PY'
import json, sys
me = json.load(open('/workspace/me.json'))['phone']
convs = {c['conversation_id']: c for c in map(json.loads, open('/workspace/conversations.jsonl'))}
counts = []
for line in open('/workspace/direct.jsonl'):
    read = json.loads(line)
    messages = sorted(read['messages'], key=lambda m: m['timestamp'])
    if len(messages) < 6:
        continue
    other = next(p for p in convs[read['metadata']['conversation_id']]['participant_ids'] if p != me)
    counts.append((sum(len(m['content'].split()) for m in messages[:6]), other))
counts.sort(reverse=True)
print(counts[:3], file=sys.stderr)
print(counts[0][1])
PY
)
answer=$(messages get-user-name-from-id --user-id "$top" | jq -r .)
python3 /solution/trajectory.py "$answer"
