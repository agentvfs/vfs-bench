#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 26), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_A75LCUeJ8mPfp5avEwhbym
light-shop delete-item-in-cart --caid cart_X7M5Px84kFZatHvqMLJdcw
light-shop get-shop-id-by-name --shop-name 'Date Depot'
light-shop search-items-in-shop --sid shop_7yo44FwEgwevGA3m7yiCpB --item-name date
light-shop add-to-cart --sid shop_7yo44FwEgwevGA3m7yiCpB --tid item_PMP3Da5CiHLFq7erDSodP4 --cnt 4
light-shop wait-payment-password
light-shop checkout-all
