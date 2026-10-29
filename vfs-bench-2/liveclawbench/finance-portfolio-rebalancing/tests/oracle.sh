# Upstream's solution/solve.sh, through the CLI, with the orders worked out
# from the holdings: buy or sell each class's gap to its target share of the
# total, rounded to the dollar, skipping any under $1,000.
finance login --username admin --password admin123

for order in $(finance get-portfolio-holdings | python3 -c '
import json, sys
p = json.load(sys.stdin)
target = {"eq": 0.45, "fi": 0.30, "ca": 0.15, "al": 0.10}
for h in p["holdings"]:
    gap = round(target[h["asset_class_code"]] * p["total_value"] - h["current_value"])
    if abs(gap) >= 1000:
        print(json.dumps({"asset_class_code": h["asset_class_code"], "direction": "buy" if gap > 0 else "sell", "amount": abs(gap)}, separators=(",", ":")))
'); do finance create-portfolio-order --body "$order"; done

finance get-portfolio-holdings
