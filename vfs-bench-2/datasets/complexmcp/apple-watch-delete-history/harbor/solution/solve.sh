#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 18), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-shop search-items --item-name 'Apple Watch Series 9'
light-shop get-shop-id-by-name --shop-name 'Dynamic Motion'
light-shop add-to-cart --cnt 1 --sid shop_F9tbWPqzJayndNBa2SdQpE --tid item_FUEG2aENFEPakyBf7EyjVg
light-shop wait-payment-password
light-shop checkout-all
light-shop get-trans-history
light-shop delete-trans-history --trid trans_Eezd3HD8osr9kjAwwhbw3E
