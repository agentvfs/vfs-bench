#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 23), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk list-all-tags
light-talk get-contacts-by-tag --tag teammates
light-shop search-items --item-name 'Stieg Larsson'
light-shop get-shop-id-by-name --shop-name 'Inkwell Emporium'
light-shop add-to-cart --cnt 4 --sid shop_Yy24FpTChogTeTWx4F3Sjv --tid item_nGnCSHCa68q7ouDvtj5Kzj
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_A75LCUeJ8mPfp5avEwhbym
light-shop delete-item-in-cart --caid cart_X7M5Px84kFZatHvqMLJdcw
light-shop check-balance
light-shop wait-payment-password
light-shop checkout-all
