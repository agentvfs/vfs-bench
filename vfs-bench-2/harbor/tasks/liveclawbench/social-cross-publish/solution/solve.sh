#!/usr/bin/env bash
# Upstream's solution, on Mirage's gws fake (vfs-bench-2, rule A): it reads
# the campaign email at /gmail and the summit's date from the calendar with
# the gws CLI, where upstream's logs in to the email and calendar mocks and
# reads their REST APIs, then publishes the post as upstream's does. The
# seed's email is "Summer Tech Summit social push", where upstream's looks
# for a subject naming "Cross-Publish Content to Social Media"; this finds it
# by the summit, and takes its hashtags from it.
set -euo pipefail

SOCIAL_URL="http://127.0.0.1:5008"

# The campaign email's hashtags.
HASHTAGS=$(python3 <<'PY'
import glob
import json
import re
import sys

for path in sorted(glob.glob("/gmail/INBOX/*/*.gmail.json")):
    with open(path) as f:
        mail = json.load(f)
    if "summer tech summit" in mail["subject"].lower():
        line = next(l for l in mail["body_text"].splitlines() if l.startswith("Hashtags"))
        print(" ".join(re.findall(r"#\w+", line)))
        sys.exit(0)
sys.exit("campaign email not found in inbox")
PY
)

# The summit's date, from its calendar event.
CAL_DATE=$(gws calendar events list --params '{"calendarId": "primary"}' | python3 -c "
import json, sys
from datetime import datetime
for ev in json.load(sys.stdin).get('items', []):
    title = (ev.get('summary') or '').lower()
    if 'summer tech summit' in title or 'tech summit 2026' in title:
        start = ev['start']['dateTime']
        print(datetime.fromisoformat(start.replace('Z', '+00:00')).strftime('%B %d, %Y'))
        sys.exit(0)
sys.exit('Summer Tech Summit 2026 event not found in calendar')
")
[[ "$CAL_DATE" == *"June 15"* ]] || { echo "expected June 15, got: $CAL_DATE" >&2; exit 1; }

TOKEN=$(curl -s -X POST "$SOCIAL_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"mosi_brand","password":"demo123"}' | python3 -c "
import json, sys
print(json.load(sys.stdin)['session_token'])
")

CONTENT="Summer Tech Summit 2026 is coming up on ${CAL_DATE}! Join industry leaders for 50+ speaker sessions, hands-on workshops, startup pitches, and evening networking. Early bird pricing ends June 30 — register now to save 30%! ${HASHTAGS}"
BODY=$(python3 -c "
import json, sys
print(json.dumps({'content': sys.argv[1], 'visibility': 'public', 'status': 'published',
                  'tags': sys.argv[2].split(), 'assets': []}))
" "$CONTENT" "$HASHTAGS")

curl -s -X POST "$SOCIAL_URL/api/posts" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$TOKEN" \
  -d "$BODY" | python3 -c "
import json, sys
reply = json.load(sys.stdin)
if not reply.get('success'):
    sys.exit('publish refused: ' + json.dumps(reply))
print('Published post_id=' + str(reply['post_id']))
"
