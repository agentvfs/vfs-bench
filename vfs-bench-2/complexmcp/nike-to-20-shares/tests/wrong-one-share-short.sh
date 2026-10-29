# Must fail: oracle.sh buying 10 shares of NKE instead of 11, which leaves
# the position at 19.
light-stock search-stocks --query Nike

light-stock get-portfolio

light-stock get-account-summary

have=$(light-stock get-portfolio | python3 -c 'import json,sys; print(sum(p["quantity"] for p in json.loads(sys.stdin.read())["output"] if p["ticker"] == "NKE"))')
light-stock wait-trade-password
light-stock place-market-order --ticker NKE --side buy --quantity $((19 - have))
