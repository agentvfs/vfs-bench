#!/usr/bin/env bash
# Ours, written by hand through the CLIs.
# Upstream's reference trajectory (data.parquet row 8), with its ids read
# from each response. A classmate goes when no message with them is from
# 2024 or later.
light-system now

# LightTalk's calls fail at random until its network is accelerated.
light-talk acc-network

light-talk list-all-tags

light-talk get-contacts-by-tag --tag classmates

for uid in $(light-talk get-contacts-by-tag --tag classmates | grep -o 'user_[A-Za-z0-9]*'); do light-talk get-chat-history --uid "$uid" | python3 -c "import json,sys; o=json.loads(sys.stdin.read())['output']; print('$uid') if not any(m['timestamp'] >= '2024' for m in o) else None"; done > /workspace/silent
cat /workspace/silent

light-talk ask-for-privilege
for uid in $(cat /workspace/silent); do light-talk delete-contact --uid "$uid"; done
