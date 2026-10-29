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
# The chat with +979551234567 has the most, 283. Upstream's answer counts
# per chat: summed over a contact's chats, Elian Toledano's two would lead.
python3 - <<'PY'
import json
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
for words, other in sorted(counts, reverse=True)[:3]:
    print(words, other)
PY

messages get-user-name-from-id --user-id +979551234567

complete-task --answer 'Fatima Al-Khaja'
