# Upstream's solution/solve.sh hands the instruction to its own agent, so
# this is the task's path through the CLI: buy the cheapest smart watch rated
# 4.6 or higher, find that the first checkout's order is not in the history
# (the mock drops it, as upstream's does), and check out again.
shop list-products --q 'smart watch' --min-rating 4.6 --sort price_asc

product=$(shop list-products --q 'smart watch' --min-rating 4.6 --sort price_asc | python3 -c 'import json,sys; print(next(p["id"] for p in json.load(sys.stdin)["data"]["products"] if "watch" in p["title"].lower()))')
shop add-item-to-cart --product-id "$product"
shop checkout

shop list-orders

shop get-cart-contents

shop checkout

shop list-orders
