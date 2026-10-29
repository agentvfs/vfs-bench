# Upstream's solution/solve.sh hands the instruction to its own agent, so
# this is the task's path through the CLI: return the Kenmore washer's order
# first, then buy the portable washer rated 4.6 or higher.
shop list-orders

order=$(shop list-orders | python3 -c 'import json,sys; print(next(o["order_id"] for o in json.load(sys.stdin)["data"]["orders"] if "Kenmore" in o["items"][0]["title"]))')
shop request-order-return --order-id "$order"

shop list-products --q 'portable washer' --min-rating 4.6

product=$(shop list-products --q 'portable washer' --min-rating 4.6 | python3 -c 'import json,sys; print(next(p["id"] for p in json.load(sys.stdin)["data"]["products"] if "portable" in p["title"].lower()))')
shop add-item-to-cart --product-id "$product"
shop checkout

shop list-orders
