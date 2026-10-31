#!/usr/bin/env bash
# Ours, on Mirage's gws fake (vfs-bench-2, rule A). Upstream's reads the
# keywords from quoted list items in the moderation team's email, which the
# seed's email does not have, and so deletes nothing. This reads the email
# at /gmail, which asks for the leftover promotional posts (the giveaways)
# and the personal milestone announcements to go, and deletes the brand
# account's posts that mention either, as upstream's does: through the
# API, then checking that none is left.
set -euo pipefail

SOCIAL_URL="http://localhost:5008"
KEYWORDS="giveaway milestone"

python3 <<'PY'
import glob
import json
import sys

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    with open(path) as f:
        mail = json.load(f)
    if mail["subject"] == "Clean up old campaign content":
        print(mail["body_text"])
        sys.exit(0)
sys.exit("the moderation team's email is not in the inbox")
PY

TOKEN=$(curl -s -X POST "$SOCIAL_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"mosi_brand","password":"demo123"}' | python3 -c "
import json, sys
print(json.load(sys.stdin)['session_token'])
")

MATCHES=$(curl -s "$SOCIAL_URL/api/posts?author_id=1&limit=100" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
keywords = sys.argv[1].split()
for p in json.load(sys.stdin).get('posts', []):
    if any(kw in p['content'].lower() for kw in keywords):
        print(p['id'])
" "$KEYWORDS")

for POST_ID in $MATCHES; do
  curl -s -X DELETE "$SOCIAL_URL/api/posts/$POST_ID" -H "Authorization: Bearer $TOKEN" > /dev/null
  echo "Deleted post $POST_ID"
done

curl -s "$SOCIAL_URL/api/posts?author_id=1&limit=100" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
keywords = sys.argv[1].split()
left = [p['id'] for p in json.load(sys.stdin).get('posts', [])
        if any(kw in p['content'].lower() for kw in keywords)]
if left:
    sys.exit(f'keyword-matching posts remain: {left}')
" "$KEYWORDS"
echo "Oracle: every giveaway and milestone post deleted"
