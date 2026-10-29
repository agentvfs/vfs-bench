# The user's ids: their phone on Messages, a user id on Chats.
contacts get-current-user-details | tee /workspace/me.json

chats get-user-id --user-name 'Anastasiya Kuznetsova' > /workspace/me-chats.json

# The conversations that mention "propaganda" on either app, in full.
for id in $(messages search --query propaganda | jq -r '.[]'); do messages read-conversation --conversation-id $id --limit 1000 | jq -c '{app: "messages"} + .'; done > /workspace/found.jsonl
for id in $(chats search --query propaganda | jq -r '.[]'); do chats read-conversation --conversation-id $id --limit 1000 | jq -c '{app: "chats"} + .'; done >> /workspace/found.jsonl
jq -s length /workspace/found.jsonl

# Who sent the user a message with the word: ids, then names.
python3 - <<'PY'
import json
me = {'messages': json.load(open('/workspace/me.json'))['phone'], 'chats': json.load(open('/workspace/me-chats.json'))}
senders = set()
for line in open('/workspace/found.jsonl'):
    read = json.loads(line)
    for m in read['messages']:
        if m['sender_id'] != me[read['app']] and 'propaganda' in m['content'].lower():
            senders.add(f"{read['app']} {m['sender_id']}")
open('/workspace/senders.txt', 'w').write('\n'.join(sorted(senders)) + '\n')
print(sorted(senders))
PY

while read -r app id; do $app get-user-name-from-id --user-id "$id" | jq -r .; done < /workspace/senders.txt | sort -u > /workspace/names.txt
cat /workspace/names.txt

# Events with "Research" in the title, past and future: Kunto Wijayanto
# attends six, Aidan Ó Cuinn four, Saskia Krauss three.
calendar search-events --query Research > /workspace/research.json

python3 - <<'PY'
import collections, json
names = set(open('/workspace/names.txt').read().split('\n')) - {''}
events = [e for e in json.load(open('/workspace/research.json')) if 'Research' in e['title']]
print(len(events), collections.Counter(a for e in events for a in e['attendees'] if a in names).most_common())
PY

complete-task --answer 'Kunto Wijayanto'
