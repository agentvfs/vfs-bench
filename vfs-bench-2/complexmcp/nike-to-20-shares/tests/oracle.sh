# Upstream's reference trajectory (data.parquet row 43), with the number of
# shares to buy read from the portfolio.
light-stock search-stocks --query Nike

light-stock get-portfolio

light-stock get-account-summary

have=$(light-stock get-portfolio | python3 -c 'import json,sys; print(sum(p["quantity"] for p in json.loads(sys.stdin.read())["output"] if p["ticker"] == "NKE"))')
light-stock wait-trade-password
light-stock place-market-order --ticker NKE --side buy --quantity $((20 - have))
