#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This logs in to the company
# account (the login page lists the demo accounts), publishes the three
# posts, each its title and content, and confirms each in the account's post
# list. A post the platform refuses as rate limited (429) is published again
# once `retry_after` has passed.
set -euo pipefail

BASE_URL="http://localhost:5008"
COOKIE_JAR="/tmp/social_cookies.txt"

curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"mosi_brand","password":"demo123"}' > /dev/null

publish() {
  local title="$1" content="$2" body status retry
  body=$(python3 -c "import json, sys; print(json.dumps({'content': sys.argv[1] + '\n\n' + sys.argv[2], 'visibility': 'public', 'status': 'published'}))" "$title" "$content")
  for attempt in 1 2 3; do
    status=$(curl -s -o /tmp/post.json -w "%{http_code}" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/posts" \
      -H "Content-Type: application/json" -d "$body")
    if [ "$status" = "201" ]; then
      echo "Published \"$title\""
      break
    fi
    if [ "$status" != "429" ]; then
      echo "Publishing \"$title\" failed: $status $(cat /tmp/post.json)" >&2
      exit 1
    fi
    retry=$(python3 -c "import json; print(json.load(open('/tmp/post.json')).get('retry_after', 1))")
    echo "Rate limited publishing \"$title\"; retrying in ${retry}s"
    sleep "$retry"
  done
  # Confirm it is in the account's post list.
  curl -s -b "$COOKIE_JAR" "$BASE_URL/api/posts?author_id=1&limit=100" | python3 -c "
import json, sys
title = sys.argv[1]
posts = json.load(sys.stdin).get('posts', [])
if not any(p.get('content', '').startswith(title + '\n') and p.get('status') == 'published' for p in posts):
    sys.exit('not in the post list: ' + title)
" "$title"
}

publish "Product Update v2.0" "We're excited to announce version 2.0 with improved performance and new features!"
publish "Customer Spotlight" "Meet our customer of the month and learn how they use our platform to grow their business."
publish "Weekend Reading" "Check out our latest blog post about industry trends and predictions for the coming year."
echo "Oracle: all three posts published and in the post list"
