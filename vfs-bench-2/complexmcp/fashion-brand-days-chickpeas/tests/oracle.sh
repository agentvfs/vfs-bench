# Upstream's reference trajectory (data.parquet row 32), with its ids and
# figures read from each response.
light-news list-all-sections

# The reference found the article with get_last_k_news, which gave it the
# section's oldest 3; at the pinned commit it gives the newest, so search.
light-news search --section 'Local Business' --query fashion --maxn 10

light-system now

launched=$(light-news search --section 'Local Business' --query fashion --maxn 10 | python3 -c 'import json,sys; print(next(n["timestamp"][:10] for n in json.loads(sys.stdin.read())["output"] if "Fashion Brand" in n["title"]))')
today=$(light-system now | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["output"][:10])')
time-server days-diff --t1 "$launched" --t2 "$today" | tee /workspace/days

# More than 365 days, so buy 2 kg: four 500 g packs.
light-shop search-items --item-name chickpeas

item=$(light-shop search-items --item-name chickpeas | python3 -c 'import json,sys; i=json.loads(sys.stdin.read())["output"][0]; print(i["tid"], i["shop"])')
tid=${item%% *}
sid=$(light-shop get-shop-id-by-name --shop-name "${item#* }" | grep -o 'shop_[A-Za-z0-9]*')
light-shop add-to-cart --sid "$sid" --tid "$tid" --cnt 4
light-shop get-cart-summary
echo "$tid" > /workspace/tid

for caid in $(light-shop get-cart-summary | python3 -c "import json,sys; print(' '.join(c['caid'] for c in json.loads(sys.stdin.read())['output'] if c['tid'] != '$(cat /workspace/tid)'))"); do light-shop delete-item-in-cart --caid "$caid"; done
light-shop get-cart-summary
light-shop wait-payment-password
light-shop checkout-all | tee /workspace/checkout

light-shop get-trans-info --trid "$(grep -o 'trans_[A-Za-z0-9]*' /workspace/checkout)" | tee /workspace/trans

# LightTalk's calls fail at random until its network is accelerated.
light-talk acc-network
light-talk fuzzy-search-uids-from-name --name Martin

uid=$(light-talk fuzzy-search-uids-from-name --name Martin | grep -o 'user_[A-Za-z0-9]*')
days=$(grep -o '[0-9]* days' /workspace/days | grep -o '[0-9]*')
price=$(python3 -c 'import json; print(round(json.load(open("/workspace/trans"))["output"]["total"], 2))')
light-talk send-message --uid "$uid" --content "$days,$price"
