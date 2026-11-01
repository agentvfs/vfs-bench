#!/usr/bin/env bash
# The pre-Harbor port's oracle for kindergarten-dog-breed (gaia2/kindergarten-dog-breed/tests/oracle.sh),
# through the apps' CLIs; the answer is the agent's reply (trajectory.py).
# The one contact whose job is Former Kindergarten Teacher: Helga Pichler.
total=$(contacts get-contacts --offset 0 | jq .metadata.total)
for o in $(seq 0 10 $((total - 1))); do contacts get-contacts --offset $o | jq -c '.contacts[]'; done > /workspace/contacts.jsonl
jq -c 'select(.job | test("kindergarten teacher"; "i")) | {first_name, last_name, job, email}' /workspace/contacts.jsonl | tee /workspace/teacher.json

# Her email is about her Labrador, Max.
emails search-emails --query "$(jq -r .email /workspace/teacher.json)" --folder-name INBOX > /workspace/hers.json
jq -r '.[] | "\(.sender): \(.subject)\n\(.content)"' /workspace/hers.json

# The drive's dog_breeds.txt lists Labrador Retriever first.
find /cloud-drive -name dog_breeds.txt | tee /workspace/breeds.txt

answer=$(python3 - <<'PY'
import json, re, sys
email = json.load(open('/workspace/teacher.json'))['email']
text = ' '.join(e['subject'] + ' ' + e['content'] for e in json.load(open('/workspace/hers.json')) if e['sender'] == email).lower()
path = open('/workspace/breeds.txt').read().strip()
breeds = [re.match(r'(\d+)\.\s*(.+)', line).groups() for line in open(path) if line.strip()]
named = [(n, b.strip()) for n, b in breeds if b.strip().lower() in text]
print(named, file=sys.stderr)
print(named[0][0])
PY
)
python3 /solution/trajectory.py "$answer"
