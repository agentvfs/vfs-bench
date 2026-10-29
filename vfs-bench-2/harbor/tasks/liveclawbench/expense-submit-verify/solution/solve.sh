#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This logs in as alice (the
# login page's demo account), submits her draft, and checks the draft's
# details; while they still say "draft", it submits again.
set -euo pipefail

BASE_URL="http://localhost:5005"

TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/token" -H "Content-Type: application/json" \
  -d '{"email": "alice@mosi.inc", "password": "password123"}' | python3 -c "
import json, sys
print(json.load(sys.stdin)['token'])
")

DRAFT_ID=$(curl -s "$BASE_URL/api/drafts?status=draft" -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
print(json.load(sys.stdin)['drafts'][0]['id'])
")
echo "Draft to submit: $DRAFT_ID"

for attempt in 1 2 3; do
  curl -s -X POST "$BASE_URL/api/drafts/$DRAFT_ID/submit" -H "Authorization: Bearer $TOKEN" > /tmp/submit.json
  STATUS=$(curl -s "$BASE_URL/api/drafts/$DRAFT_ID" -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
reply = json.load(sys.stdin)
print((reply.get('draft') or reply).get('status'))
")
  echo "Submit attempt $attempt: $(cat /tmp/submit.json); the draft now says $STATUS"
  if [ "$STATUS" = "submitted" ]; then
    echo "Oracle: draft $DRAFT_ID submitted and verified"
    exit 0
  fi
done
echo "draft $DRAFT_ID was never submitted" >&2
exit 1
