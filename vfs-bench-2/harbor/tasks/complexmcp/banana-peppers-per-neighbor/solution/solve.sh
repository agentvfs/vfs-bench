#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 22), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk list-all-tags
light-talk acc-network
light-talk list-all-tags
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_UnDVFvj4qyyFP4fQgaZ5mK
light-shop delete-item-in-cart --caid cart_7hvTf3JC3VGzGEqz6KgEc7
light-shop delete-item-in-cart --caid cart_Uoae8NjSaqws4cQFuWePWE
light-shop delete-item-in-cart --caid cart_dyFfJTSZasvzxU8vvJkMgj
light-shop delete-item-in-cart --caid cart_7AVTFpFmHCeqmShEDBmLS6
light-shop get-cart-summary
light-shop fuzzy-search-items --item-name banana
light-shop get-shop-id-by-name --shop-name 'Mustard Greens Mall'
light-shop add-to-cart --sid shop_TJjZXGe9MEmuPsY6DRUUHR --tid item_tFSriPQwhADm8NmsNCUSZx --cnt 12
light-shop wait-payment-password
light-shop wait-payment-password
light-shop checkout-all
