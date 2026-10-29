#!/usr/bin/env bash
# The pre-Harbor port's oracle (complexmcp/homecoming-play-endive/tests/oracle.sh).
# Upstream's reference trajectory (data.parquet row 37), with its ids read
# from each response.
light-news list-all-sections

light-news search --section Sports --query football --maxn 10

nid=$(light-news search --section Sports --query football --maxn 10 | python3 -c 'import json,sys; print(next(n["nid"] for n in json.loads(sys.stdin.read())["output"] if "Homecoming" in n["title"]))')
light-news get-details --nid "$nid"

# The crucial play is the fourth-down touchdown catch, by Liam Chen.
# LightTalk's calls fail at random until its network is accelerated.
light-talk acc-network
uid=$(light-talk get-uid-from-name --name 'Judy Bailey' | grep -o 'user_[A-Za-z0-9]*')
light-talk send-message --uid "$uid" --content 'Liam Chen'

# Endive comes in 100 g packs: five make 0.5 kg.
light-shop search-items --item-name endive

item=$(light-shop search-items --item-name endive | python3 -c 'import json,sys; i=json.loads(sys.stdin.read())["output"][0]; print(i["tid"], i["shop"])')
tid=${item%% *}
sid=$(light-shop get-shop-id-by-name --shop-name "${item#* }" | grep -o 'shop_[A-Za-z0-9]*')
light-shop add-to-cart --sid "$sid" --tid "$tid" --cnt 5
light-shop get-cart-summary
echo "$tid" > /workspace/tid

for caid in $(light-shop get-cart-summary | python3 -c "import json,sys; print(' '.join(c['caid'] for c in json.loads(sys.stdin.read())['output'] if c['tid'] != '$(cat /workspace/tid)'))"); do light-shop delete-item-in-cart --caid "$caid"; done
light-shop get-cart-summary
light-shop wait-payment-password
light-shop checkout-all
