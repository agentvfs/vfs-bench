# Must fail: oracle.sh, then one cent moved from savings to trading. Both
# balances end a cent off, which rounding floats to 6 places keeps.
light-stock search-stocks --query Nike

light-stock get-portfolio

light-stock get-account-summary

have=$(light-stock get-portfolio | python3 -c 'import json,sys; print(sum(p["quantity"] for p in json.loads(sys.stdin.read())["output"] if p["ticker"] == "NKE"))')
light-stock wait-trade-password
light-stock place-market-order --ticker NKE --side buy --quantity $((20 - have))

light-stock transfer-funds --amount 0.01 --direction s2t
