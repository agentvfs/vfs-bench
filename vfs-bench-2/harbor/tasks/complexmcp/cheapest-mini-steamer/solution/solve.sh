#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 28), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_A75LCUeJ8mPfp5avEwhbym
light-shop delete-item-in-cart --caid cart_X7M5Px84kFZatHvqMLJdcw
light-shop search-items --item-name 'mini steamer'
light-shop get-shop-id-by-name --shop-name 'Stand Mixer Spot'
light-shop add-to-cart --sid shop_jKm2DQc3dNHDGFc6qH2w6h --tid item_bw6sWTFzEEqAf2W4eWDDAy --cnt 1
light-shop get-cart-summary
light-shop wait-payment-password
light-shop checkout-all
