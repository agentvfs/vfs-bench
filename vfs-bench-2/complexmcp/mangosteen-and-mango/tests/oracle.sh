# Upstream's reference trajectory (data.parquet row 35), with its ids read
# from each response. Mangosteen comes in 500 g packs, mango in 1 kg ones.
light-shop search-items --item-name mango

sid=$(light-shop get-shop-id-by-name --shop-name 'Lychee Loft' | grep -o 'shop_[A-Za-z0-9]*')
light-shop search-items --item-name mango | python3 -c 'import json,sys; o={i["name"]: i["tid"] for i in json.loads(sys.stdin.read())["output"]}; print(o["mangosteen (500g)"], o["mango (1kg)"])' > /workspace/tids
light-shop add-to-cart --sid "$sid" --tid "$(cut -d' ' -f1 /workspace/tids)" --cnt 2
light-shop add-to-cart --sid "$sid" --tid "$(cut -d' ' -f2 /workspace/tids)" --cnt 1
light-shop get-cart-summary

for caid in $(light-shop get-cart-summary | python3 -c "import json,sys; print(' '.join(c['caid'] for c in json.loads(sys.stdin.read())['output'] if c['tid'] not in '$(cat /workspace/tids)'.split()))"); do light-shop delete-item-in-cart --caid "$caid"; done
light-shop wait-payment-password
light-shop checkout-all
