#!/usr/bin/env bash
# The pre-Harbor port's oracle (complexmcp/butternut-new-year-messages/tests/oracle.sh).
# Upstream's reference trajectory (data.parquet row 46), with its ids read
# from each response. The cart starts with items in it, which go first.
light-shop get-cart-summary

for caid in $(light-shop get-cart-summary | grep -o 'cart_[A-Za-z0-9]*'); do light-shop delete-item-in-cart --caid "$caid"; done

light-shop search-items --item-name 'butternut squash'

# The cheaper of the two 1 kg offers, twice.
item=$(light-shop search-items --item-name 'butternut squash' | python3 -c 'import json,sys; i=min(json.loads(sys.stdin.read())["output"], key=lambda i: i["price"]); print(i["tid"], i["shop"])')
tid=${item%% *}
sid=$(light-shop get-shop-id-by-name --shop-name "${item#* }" | grep -o 'shop_[A-Za-z0-9]*')
light-shop add-to-cart --sid "$sid" --tid "$tid" --cnt 2
light-shop get-cart-summary

# The payment password is sometimes refused; enter it until it is taken.
for try in 1 2 3 4 5; do light-shop wait-payment-password | tee /workspace/password; grep -q '"status":"ok"' /workspace/password && break; done
light-shop checkout-all

# LightTalk's calls fail at random until its network is accelerated.
light-talk acc-network
light-talk get-all-contacts

# Every contact but the blocked ones and yourself (listed as "(Me)", with
# no blocked field), by first name.
for uid in $(light-talk get-all-contacts | grep -o 'user_[A-Za-z0-9]*'); do
  info=$(light-talk get-contact-info --uid "$uid")
  echo "$info"
  if echo "$info" | grep -q '"blocked":"False"'; then
    name=$(echo "$info" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
    light-talk send-message --uid "$uid" --content "Happy New Year, ${name%% *}"
  fi
done
