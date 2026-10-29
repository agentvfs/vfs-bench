#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This buys the cheapest portable
# washer rated 4.6 or higher.
set -euo pipefail

BASE_URL="http://localhost:1234"

# The cheapest product the search finds whose title has every word given,
# at the rating given or higher, as "<id> <title>".
find_product() {
  local query="$1" rating="$2" words="$3"
  curl -s "$BASE_URL/api/products?q=$query&min_rating=$rating&sort=price_asc" | python3 -c "
import json, sys
words = sys.argv[1].lower().split()
for p in json.load(sys.stdin)[\"data\"][\"products\"]:
    if all(w in p[\"title\"].lower() for w in words):
        print(p[\"id\"], p[\"title\"][:60])
        break
" "$words"
}

# Put one product in the cart, alone, and check out; the order placed.
buy() {
  curl -s -X POST "$BASE_URL/api/cart/clear" > /dev/null
  curl -s -X POST "$BASE_URL/api/cart/add" -H "Content-Type: application/json" -d "{\"product_id\": \"$1\"}" > /dev/null
  curl -s -o /tmp/checkout.json -w "%{http_code}" -X POST "$BASE_URL/api/checkout"
}

# Whether an order of the product is in the order history.
ordered() {
  curl -s "$BASE_URL/api/orders" | python3 -c "
import json, sys
orders = json.load(sys.stdin)[\"data\"][\"orders\"]
print(any(any(i.get(\"product_id\", i.get(\"id\")) == sys.argv[1] for i in o[\"items\"]) and o[\"status\"] == \"Pending Shipment\" for o in orders))
" "$1"
}

# Return the order of a product whose title has the word given.
return_order() {
  local id
  id=$(curl -s "$BASE_URL/api/orders" | python3 -c "
import json, sys
orders = json.load(sys.stdin)[\"data\"][\"orders\"]
print(next(o[\"order_id\"] for o in orders if any(sys.argv[1].lower() in i[\"title\"].lower() for i in o[\"items\"])))
" "$1")
  curl -s -X POST "$BASE_URL/api/orders/$id/return" > /dev/null
  echo "Returned $id"
}

WASHER=$(find_product "portable%20washer" 4.6 "portable wash")
echo "Buying $WASHER"
STATUS=$(buy "${WASHER%% *}")
echo "Checkout: $STATUS $(cat /tmp/checkout.json)"
