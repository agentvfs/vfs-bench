#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 27), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-shop search-items --item-name lime
light-shop get-shop-id-by-name --shop-name 'Peach Paradise'
light-shop get-item-info --sid shop_NxgX7PQZatxVTdzMYpBLyq --tid item_rV3rXfstL2qu8GEixDMrUD
light-shop add-to-cart --sid shop_NxgX7PQZatxVTdzMYpBLyq --tid item_rV3rXfstL2qu8GEixDMrUD --cnt 60
light-shop get-shop-id-by-name --shop-name 'Date Depot'
light-shop get-item-info --sid shop_7yo44FwEgwevGA3m7yiCpB --tid item_nVCxqZBBnFGxBM7e9hVVi2
light-shop add-to-cart --sid shop_7yo44FwEgwevGA3m7yiCpB --tid item_nVCxqZBBnFGxBM7e9hVVi2 --cnt 30
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_A75LCUeJ8mPfp5avEwhbym
light-shop delete-item-in-cart --caid cart_X7M5Px84kFZatHvqMLJdcw
light-shop get-cart-summary
light-shop wait-payment-password
light-shop wait-payment-password
light-shop checkout-all
