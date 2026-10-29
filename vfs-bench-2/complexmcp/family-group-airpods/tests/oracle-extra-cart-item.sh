# Must pass: oracle.sh with one more AirPods added to the cart and removed
# again before checkout. That draws from the app's random generator once
# more, so the transaction gets another trid, which the judge skips.
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
light-shop add-to-cart --sid "$sid" --tid "$tid" --cnt 1
extra=$(light-shop get-cart-summary | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['output'][-1]['caid'])")
light-shop delete-item-in-cart --caid "$extra"
light-shop wait-payment-password
light-shop checkout-all

light-talk acc-network

light-talk send-message-to-group --gid "$(cat /workspace/gid)" --content 'I spent $222.04 to buy one AirPods'
