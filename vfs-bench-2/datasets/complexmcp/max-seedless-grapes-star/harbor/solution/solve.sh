#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 16), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-shop search-items --item-name 'seedless grapes'
light-shop search-items --item-name grapes
light-shop list-all-shop-categories
light-shop list-all-shops-by-category --category fruit
light-shop get-shop-id-by-name --shop-name 'Pomegranate Pavilion'
light-shop list-items --sid shop_7EpQHsj32kNUr7nLXfCAAs
light-shop check-balance
light-shop get-item-info --sid shop_7EpQHsj32kNUr7nLXfCAAs --tid item_5BYBHiTLV3QRC8uXDcp33A
light-shop add-to-cart --cnt 92 --sid shop_7EpQHsj32kNUr7nLXfCAAs --tid item_5BYBHiTLV3QRC8uXDcp33A
light-shop star-item --sid shop_7EpQHsj32kNUr7nLXfCAAs --tid item_5BYBHiTLV3QRC8uXDcp33A
light-shop search-items --item-name seedless
light-shop wait-payment-password
light-shop checkout-all
