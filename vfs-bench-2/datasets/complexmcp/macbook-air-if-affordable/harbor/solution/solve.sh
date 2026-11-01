#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 38), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-shop get-cart-summary
light-shop delete-item-in-cart --caid cart_kBZ33qYKv4hJxxJbiBPN4G
light-shop delete-item-in-cart --caid cart_FKQngb7D6vEgo4TNiHFhS2
light-shop search-items --item-name macbook
light-shop check-balance
light-shop get-shop-id-by-name --shop-name 'Watt Works'
light-shop add-to-cart --sid shop_xc3j39hRCTieNYmVFVmP2a --tid item_5CGS3BfR2sPrzi39xhSyYF --cnt 1
light-shop wait-payment-password
light-shop checkout-all
