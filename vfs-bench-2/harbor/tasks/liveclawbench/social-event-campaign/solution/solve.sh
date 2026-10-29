#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): its
# social steps are upstream's (publish draft post 101 with PUT, then check
# it), and it reads the Events Team's email at /gmail and sends the
# confirmation with the gws CLI, where upstream's logs in to the email mock
# and posts to its REST API. Upstream's looks for an email whose subject
# says "publish event campaign post", which the seed's ("Event campaign
# ready to go live") does not; this one finds it by its sender.
set -euo pipefail

SOCIAL_URL="http://127.0.0.1:5008"
POST_ID=101

grep -l "events@mosi.inc" /gmail/INBOX/*/*.gmail.json > /dev/null

TOKEN=$(curl -s -X POST "$SOCIAL_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"mosi_brand","password":"demo123"}' | python3 -c "
import json, sys
print(json.load(sys.stdin)['session_token'])
")

STATUS=$(curl -s -H "Cookie: token=$TOKEN" "$SOCIAL_URL/api/posts/$POST_ID" | python3 -c "
import json, sys
print(json.load(sys.stdin).get('status'))
")
[ "$STATUS" = "draft" ] || { echo "expected post $POST_ID in draft, got: $STATUS" >&2; exit 1; }

curl -s -X PUT "$SOCIAL_URL/api/posts/$POST_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$TOKEN" \
  -d '{"status": "published", "tags": [], "assets": []}' | python3 -c "
import json, sys
reply = json.load(sys.stdin)
if not reply.get('success'):
    sys.exit('publish refused: ' + json.dumps(reply))
"

STATUS=$(curl -s -H "Cookie: token=$TOKEN" "$SOCIAL_URL/api/posts/$POST_ID" | python3 -c "
import json, sys
print(json.load(sys.stdin).get('status'))
")
[ "$STATUS" = "published" ] || { echo "post $POST_ID was not published: $STATUS" >&2; exit 1; }

gws gmail send --to events@mosi.inc \
  --subject "Event Campaign Published" \
  --body "Confirming that the Mosi Tech Innovation Summit 2026 event campaign post (post_id=$POST_ID) has been published on the social platform. Early bird registration links and event details are now live for community engagement." > /dev/null
echo "Oracle: post $POST_ID published, events@mosi.inc told"
