#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 40), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_SPWZ5mxZ55p2UrTHXdHu58
light-shop delete-item-in-cart --caid cart_FKQngb7D6vEgo4TNiHFhS2
light-shop delete-item-in-cart --caid cart_aTpEfQHbrfAtfpKZ2hcTSd
light-shop delete-item-in-cart --caid cart_m3Dwd7twgVM6NzdLTZByMv
light-shop delete-item-in-cart --caid cart_qArgMV2pewUN45wpi7i9qF
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_Yo86N7hTVwcuDhDdYZUApf
light-shop get-cart-summary
light-shop search-items --item-name arugula
light-shop get-shop-id-by-name --shop-name 'Veggie Village'
light-shop add-to-cart --sid shop_Xr4uDAZ9Zaiq8QFPyc7dRR --tid item_P62bidnSkceZgZ7giSyVBX --cnt 2
light-shop get-shop-id-by-name --shop-name 'Zucchini Zone'
light-shop add-to-cart --sid shop_M8vA98ewPquBfby5z5DybV --tid item_P62bidnSkceZgZ7giSyVBX --cnt 2
light-shop get-cart-summary
light-shop wait-payment-password
light-shop checkout-all
