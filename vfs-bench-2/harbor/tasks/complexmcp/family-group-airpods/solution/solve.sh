#!/usr/bin/env bash
# The pre-Harbor port's oracle (complexmcp/family-group-airpods/tests/oracle.sh).
# Upstream's reference trajectory (data.parquet row 2), with its ids read
# from each response since the apps mint new ones every session.
light-talk get-contacts-by-tag --tag family

light-talk ask-for-privilege

uids=$(light-talk get-contacts-by-tag --tag family | grep -o 'user_[A-Za-z0-9]*' | sed 's/^/--uids /' | tr '\n' ' ')
gid=$(eval "light-talk create-group-chat $uids" | grep -o 'group_[A-Za-z0-9]*')
light-talk rename-group --gid "$gid" --name 'My Family'
echo "$gid" > /workspace/gid

light-shop search-items --item-name AirPods

sid=$(light-shop get-shop-id-by-name --shop-name 'Memory Market' | grep -o 'shop_[A-Za-z0-9]*')
tid=$(light-shop search-items --item-name AirPods | python3 -c 'import json,sys; o=json.loads(sys.stdin.read())["output"]; print(min(o, key=lambda i: i["price"])["tid"])')
light-shop add-to-cart --sid "$sid" --tid "$tid" --cnt 1
light-shop get-cart-summary

for caid in $(light-shop get-cart-summary | python3 -c "import json,sys; print(' '.join(c['caid'] for c in json.loads(sys.stdin.read())['output'] if c['tid'] != '$tid'))"); do light-shop delete-item-in-cart --caid "$caid"; done
light-shop wait-payment-password
light-shop checkout-all

light-talk acc-network

light-talk send-message-to-group --gid "$(cat /workspace/gid)" --content 'I spent $222.04 to buy one AirPods'
