#!/usr/bin/env bash
# Upstream's solution, through the apps' APIs (vfs-bench-2): upstream's
# writes the smart home's SQLite with the sqlite3 CLI and appends the order
# to the shop's orders file itself; here both are read-only copies of the
# run's. The same steps go through the smart home's and the shop's APIs:
# 36 eggs (3 dozen, as eggs are sold by the dozen) on the shopping list,
# an order of 3 dozen in the shop, and the list entry's reference set to
# that order. Its explanation is upstream's.
set -euo pipefail

HOME_URL="http://localhost:5004"
SHOP_URL="http://localhost:1234"

# The app names the entry itself.
EGGS=$(curl -s -X POST "$HOME_URL/api/grocery/products" -H "Content-Type: application/json" \
  -d '{"name": "Eggs", "quantity": 36, "unit": "pieces", "stock_status": "insufficient"}' | python3 -c "
import json, sys
print(json.load(sys.stdin)['product_id'])
")
echo "Listed $EGGS"

curl -s -X POST "$SHOP_URL/api/cart/clear" > /dev/null
curl -s -X POST "$SHOP_URL/api/cart/add" -H "Content-Type: application/json" -d '{"product_id": "prod_eggs"}' > /dev/null
curl -s -X PUT "$SHOP_URL/api/cart/update" -H "Content-Type: application/json" -d '{"product_id": "prod_eggs", "quantity": 3}' > /dev/null
NEW_ORDER_ID=$(curl -s -X POST "$SHOP_URL/api/checkout" | python3 -c "
import json, sys
print(json.load(sys.stdin)['data']['order_id'])
")
echo "Placed order $NEW_ORDER_ID"

curl -s -X PUT "$HOME_URL/api/grocery/products/$EGGS" -H "Content-Type: application/json" \
  -d "{\"reference\": \"$NEW_ORDER_ID\"}"
echo

mkdir -p /workspace/output
cat > /workspace/output/response.txt << EOF
I've completed the egg ordering task. Here's what I did:
1. Checked egg inventory in the smart-home app:
   - Fridge: 11 pieces
   - Pantry: 7 pieces
   - Total: 18 pieces
2. Calculated shortage against target of 4 dozen (48 pieces):
   - Missing: 48 - 18 = 30 pieces
3. Converted to dozens and rounded:
   - 30 pieces / 12 pieces per dozen = 2.5 dozen
   - Since eggs are sold by the dozen, I rounded up to 3 dozen (36 pieces)
   - This ensures we have enough eggs (36 + 18 = 54 pieces, exceeding the 48-piece target)
4. Added 36 pieces (3 dozen) to the Shopping List
5. Placed order $NEW_ORDER_ID for 3 dozen eggs in the shop
6. Updated the Shopping List entry with order reference $NEW_ORDER_ID
The rounding up from 2.5 to 3 dozen ensures we don't fall short of the target quantity.
EOF
echo "Reference solution completed"
