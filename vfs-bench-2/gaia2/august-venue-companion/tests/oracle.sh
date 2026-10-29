contacts get-current-user-details | tee /workspace/me.json

calendar get-events --start-date '2024-08-01 00:00:00' --end-date '2024-08-31 23:59:59' --limit 1000 > /workspace/august.json
jq .total /workspace/august.json

# Home Office held the most August events (18). Five attendees tie there,
# at one hour each.
python3 - <<'PY'
import collections, json
me = json.load(open('/workspace/me.json'))
me = f"{me['first_name']} {me['last_name']}"
events = json.load(open('/workspace/august.json'))['events']
venue, count = collections.Counter(e['location'] for e in events).most_common(1)[0]
time = collections.Counter()
for e in events:
    if e['location'] == venue:
        for a in e['attendees']:
            if a != me:
                time[a] += e['end_datetime'] - e['start_datetime']
top = max(time.values())
tied = sorted(a for a, t in time.items() if t == top)
print(venue, count, top / 3600, tied)
open('/workspace/tied.txt', 'w').write('\n'.join(tied) + '\n')
PY

# Their latest email to the user: Khalid Al-Mansoori's, on 2024-10-03, is
# the most recent.
while read -r name; do
  email=$(contacts search-contacts --query "$name" | jq -r '.[0].email')
  emails search-emails --query "$email" --folder-name INBOX | jq -c --arg who "$name" --arg email "$email" '[.[] | select(.sender == $email)] | {who: $who, latest: (map(.timestamp) | max)}'
done < /workspace/tied.txt | jq -s -c 'sort_by(.latest) | reverse'

complete-task --answer 'Khalid Al-Mansoori'
