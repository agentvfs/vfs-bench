#!/usr/bin/env bash
# Ours, written by hand through the CLIs.
# Upstream's reference trajectory (data.parquet row 12), with its ids read
# from each response since the apps mint new ones every session.
light-talk list-all-tags

# LightTalk's calls fail at random until its network is accelerated, and
# groups need the privilege.
light-talk acc-network
light-talk ask-for-privilege

light-talk get-contacts-by-tag --tag family

light-talk get-contacts-by-tag --tag classmates

uids=$(light-talk get-contacts-by-tag --tag family | grep -o 'user_[A-Za-z0-9]*' | sed 's/^/--uids /' | tr '\n' ' ')
gid=$(eval "light-talk create-group-chat $uids" | grep -o 'group_[A-Za-z0-9]*')
light-talk rename-group --gid "$gid" --name 'My family'

uids=$(light-talk get-contacts-by-tag --tag classmates | grep -o 'user_[A-Za-z0-9]*' | sed 's/^/--uids /' | tr '\n' ' ')
gid=$(eval "light-talk create-group-chat $uids" | grep -o 'group_[A-Za-z0-9]*')
light-talk rename-group --gid "$gid" --name 'Forever 404'
echo "$gid" > /workspace/gid

schmidt=$(light-talk get-contacts-by-tag --tag classmates | python3 -c 'import json,sys; print(next(c["uid"] for c in json.loads(sys.stdin.read())["output"] if "Schmidt" in c["name"]))')
light-talk change-owner-of-group --gid "$(cat /workspace/gid)" --uid "$schmidt"

light-talk send-message-to-group --gid "$(cat /workspace/gid)" --content 'How about having dinner at my house tonight?'
