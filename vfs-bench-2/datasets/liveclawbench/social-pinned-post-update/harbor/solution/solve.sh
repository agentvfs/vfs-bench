#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it reads
# the social team's email at /gmail and the verification code from the Q2
# content plan's calendar event with the gws CLI, swaps the pinned post as
# upstream's does, and confirms with the gws CLI, where upstream's logs in
# to the email and calendar mocks and uses their REST APIs. The event's
# note, upstream's `source_ref`, is its description here. The seed's email
# is "Refresh featured content", where upstream's looks for a subject that
# says "pin"; this finds it by its sender.
set -euo pipefail

SOCIAL_URL="http://127.0.0.1:5008"
OLD_POST_ID=1
NEW_POST_ID=9

grep -l "social-team@mosi.inc" /gmail/INBOX/*/*.gmail.json > /dev/null

CODE=$(gws calendar events list --params '{"calendarId": "primary"}' | python3 -c "
import json, re, sys
for ev in json.load(sys.stdin).get('items', []):
    if 'Social Media Q2 Content Plan' in (ev.get('summary') or ''):
        found = re.search(r'SM-Q2-\d+', ev.get('description') or '')
        if found:
            print(found.group(0))
            sys.exit(0)
sys.exit('no verification code on the Social Media Q2 Content Plan event')
")

TOKEN=$(curl -s -X POST "$SOCIAL_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"mosi_brand","password":"demo123"}' | python3 -c "
import json, sys
print(json.load(sys.stdin)['session_token'])
")

pin() {
  curl -s -X POST "$SOCIAL_URL/api/posts/$1/pin" -H "Cookie: token=$TOKEN" | python3 -c "
import json, sys
reply = json.load(sys.stdin)
if reply.get('pinned') is not (sys.argv[1] == 'true'):
    sys.exit('pin reply: ' + json.dumps(reply))
" "$2"
}
pin "$OLD_POST_ID" false
pin "$NEW_POST_ID" true

gws gmail send --to social-team@mosi.inc \
  --subject "Pinned Post Update Confirmed ($CODE)" \
  --body "Pinned post update confirmed.

The launch announcement post (post_id=$OLD_POST_ID) has been unpinned.
The 10K followers giveaway post (post_id=$NEW_POST_ID) is now pinned.

Verification code from the Social Media Q2 Content Plan calendar event: $CODE" > /dev/null
echo "Oracle: pinned post swapped, social-team@mosi.inc told ($CODE)"
