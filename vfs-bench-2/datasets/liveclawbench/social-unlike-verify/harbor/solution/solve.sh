#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This logs in as alice, the
# account with a like, finds the first post she liked in her feed, unlikes
# it and checks the post's details. While they still show the like, it
# unlikes again.
set -euo pipefail

BASE_URL="http://localhost:5008"
COOKIE_JAR="/tmp/social_cookies.txt"

curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"demo123"}' > /dev/null

POST_ID=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/posts" | python3 -c "
import json, sys
liked = [p['id'] for p in json.load(sys.stdin).get('posts', []) if p.get('liked')]
if not liked:
    sys.exit('no liked post in the feed')
print(liked[0])
")
echo "First liked post: $POST_ID"

for attempt in 1 2 3; do
  curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/posts/$POST_ID/like" > /dev/null
  LIKED=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/posts/$POST_ID" | python3 -c "
import json, sys
print(json.load(sys.stdin).get('liked'))
")
  echo "Unlike attempt $attempt: the post's details say liked=$LIKED"
  if [ "$LIKED" = "False" ]; then
    echo "Oracle: post $POST_ID unliked and verified"
    exit 0
  fi
done
echo "post $POST_ID is still liked" >&2
exit 1
