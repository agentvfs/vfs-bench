#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This logs in as alice, posts the
# greeting publicly and checks that it shows in the public feed, as the
# instruction asks.
set -euo pipefail

BASE_URL="http://localhost:5008"
COOKIE_JAR="/tmp/social_cookies.txt"

curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"demo123"}' > /dev/null

curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/posts" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello from the test!","visibility":"public","status":"published"}' | python3 -c "
import json, sys
reply = json.load(sys.stdin)
if not reply.get('success'):
    sys.exit('the post was refused: ' + json.dumps(reply))
"

# The public feed, as anyone signed out sees it.
curl -s "$BASE_URL/api/posts" | python3 -c "
import json, sys
posts = json.load(sys.stdin).get('posts', [])
if not any(p.get('content') == 'Hello from the test!' and p.get('status') == 'published' for p in posts):
    sys.exit('the post is not in the public feed')
"
echo "Oracle: posted as alice, and the post is in the public feed"
