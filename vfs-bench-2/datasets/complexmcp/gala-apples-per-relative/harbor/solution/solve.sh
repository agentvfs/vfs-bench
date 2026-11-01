#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 30), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk list-all-tags
light-shop search-items --item-name 'gala apple'
light-shop get-shop-id-by-name --shop-name 'Peach Paradise'
light-shop add-to-cart --sid shop_NxgX7PQZatxVTdzMYpBLyq --tid item_xyzxUBv5oDejpAfqoRzmfn --cnt 6
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_A75LCUeJ8mPfp5avEwhbym
light-shop delete-item-in-cart --caid cart_X7M5Px84kFZatHvqMLJdcw
light-shop get-cart-summary
light-shop wait-payment-password
light-shop checkout-all
