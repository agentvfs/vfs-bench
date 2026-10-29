"""The shopping app's calls for gaia2_compare.py."""
import json

KNOWN: dict[str, str] = {}


def calls(state: dict, last):
    products = list((state.get("products") or {}).values())
    codes = state.get("discount_codes") or {}
    items = {
        iid: (p, it)
        for p in products
        for iid, it in (p.get("variants") or {}).items()
    }
    available = [
        iid for iid, (_, it) in items.items() if it.get("available", True)
    ]
    unavailable = next(
        (iid
         for iid, (_, it) in items.items() if not it.get("available", True)),
        None)
    coded = [iid for iid in available if codes.get(iid)]
    some = products[min(4, len(products) - 1)]
    a = coded[0] if coded else available[0]
    code = next(iter(codes.get(a, {"NONE": 0})))
    b = next(iid for iid in available
             if code not in codes.get(iid, {}) and iid != a)
    c2 = next((iid for iid in coded if iid != a and code in codes[iid]), None)
    yield "list-all-products", {}
    yield "list-all-products", {"offset": 5, "limit": 3}
    yield "list-all-products", {"offset": -3}
    yield "list-all-products", {"offset": len(products) - 2, "limit": 10}
    yield "list-all-products", {"offset": len(products) + 5, "limit": 0}
    yield "get-product-details", {"product_id": some["product_id"]}
    yield "get-product-details", {"product_id": "nope"}
    yield "search-products", {"product_name": some["name"][2:7].upper()}
    yield "search-products", {"product_name": "e", "offset": 3, "limit": 4}
    yield "search-products", {"product_name": "e", "offset": -2}
    yield "search-products", {"product_name": "zzzz-none"}
    yield "get-all-discount-codes", {}
    yield "get-discount-code-info", {"discount_code": code}
    yield "get-discount-code-info", {"discount_code": "NOPE"}
    yield "list-cart", {}
    yield "checkout", {}
    # The cart.
    yield "add-to-cart", {"item_id": a, "quantity": 0}
    yield "add-to-cart", {"item_id": a, "quantity": -1}
    yield "add-to-cart", {"item_id": "nope"}
    if unavailable:
        yield "add-to-cart", {"item_id": unavailable}
    yield "add-to-cart", {"item_id": a, "quantity": 3}
    yield "add-to-cart", {"item_id": a}
    yield "add-to-cart", {"item_id": b, "quantity": 2}
    yield "list-cart", {}
    yield "remove-from-cart", {"item_id": a, "quantity": -1}
    yield "remove-from-cart", {"item_id": "nope"}
    yield "remove-from-cart", {"item_id": b, "quantity": 5}
    yield "remove-from-cart", {"item_id": a, "quantity": 0}
    yield "remove-from-cart", {"item_id": a}
    yield "checkout", {"discount_code": code}
    yield "remove-from-cart", {"item_id": b, "quantity": 2}
    if c2:
        yield "add-to-cart", {"item_id": c2, "quantity": 7}
    yield "list-cart", {}
    yield "checkout", {"discount_code": code}
    first = last() and last()["order_id"]
    yield "list-cart", {}
    yield "add-to-cart", {"item_id": b, "quantity": 3}
    yield "checkout", {"discount_code": ""}
    second = last() and last()["order_id"]
    yield "add-to-cart", {"item_id": a, "quantity": 1}
    yield "checkout", {}
    third = last() and last()["order_id"]
    yield "list-orders", {}
    yield "get-order-details", {"order_id": first}
    yield "get-order-details", {"order_id": "nope"}
    yield "cancel-order", {"order_id": first}
    yield "cancel-order", {"order_id": first}
    yield "cancel-order", {"order_id": "nope"}
    yield "update-order-status", {"order_id": second}
    yield "update-order-status", {"order_id": second, "status": "lost"}
    yield "update-order-status", {"order_id": "nope", "status": "lost"}
    yield "cancel-order", {"order_id": second}
    yield "update-order-status", {"order_id": third, "status": "delivered"}
    yield "cancel-order", {"order_id": third}
    yield "get-order-details", {"order_id": third}
    # The ENV commands, and reads that see them.
    yield "add-product", {"name": "Zebra Mug — “ceramic”"}
    pid = last()["product_id"]
    yield "add-item-to-product", {
        "product_id": pid,
        "price": 12.5,
        "options": json.dumps({
            "color": "white",
            "size": 2
        })
    }
    item1 = last()["item_id"]
    yield "add-item-to-product", {
        "product_id": pid,
        "price": 10,
        "options": "{bad",
        "available": "False"
    }
    item2 = last()["item_id"]
    yield "add-item-to-product", {
        "product_id": pid,
        "price": 3,
        "options": "",
        "available": "NO"
    }
    yield "add-item-to-product", {
        "product_id": pid,
        "price": 4.25,
        "options": "[1, 2]",
        "available": "0"
    }
    yield "add-item-to-product", {"product_id": "nope", "price": 1}
    yield "get-product-details", {"product_id": pid}
    yield "search-products", {"product_name": "zebra mug"}
    yield "list-all-products", {"offset": len(products) - 3}
    yield "add-to-cart", {"item_id": item2}
    yield "update-item", {"item_id": item2}
    yield "update-item", {"item_id": "nope", "new_price": 2}
    yield "update-item", {"item_id": item2, "new_availability": "yes"}
    yield "update-item", {"item_id": item1, "new_price": 9.99}
    yield "update-item", {
        "item_id": item1,
        "new_price": 20,
        "new_availability": "false"
    }
    yield "update-item", {"item_id": item1, "new_availability": "true"}
    yield "add-discount-code", {"item_id": "nope", "discount_code": "{}"}
    yield "add-discount-code", {"item_id": item1, "discount_code": "{bad"}
    yield "add-discount-code", {
        "item_id": item1,
        "discount_code": json.dumps({
            "MUG10": 10,
            "HALF": 50.0
        })
    }
    yield "add-discount-code", {
        "item_id": item1,
        "discount_code": json.dumps([["THIRD", 33.3], "XY"])
    }
    yield "add-discount-code", {"item_id": item1, "discount_code": '""'}
    yield "add-discount-code", {"item_id": item1, "discount_code": "5"}
    yield "add-discount-code", {"item_id": item1, "discount_code": "null"}
    yield "add-discount-code", {"item_id": item1, "discount_code": '"ab"'}
    yield "add-discount-code", {
        "item_id": item1,
        "discount_code": "[[1, 2, 3]]"
    }
    yield "add-discount-code", {"item_id": item1, "discount_code": "[7]"}
    yield "add-discount-code", {
        "item_id": item2,
        "discount_code": json.dumps({"MUG10": 15})
    }
    yield "get-discount-code-info", {"discount_code": "MUG10"}
    yield "get-all-discount-codes", {}
    yield "add-to-cart", {"item_id": item1, "quantity": 3}
    yield "add-to-cart", {"item_id": item2, "quantity": 2}
    yield "checkout", {"discount_code": "THIRD"}
    yield "checkout", {"discount_code": "MUG10"}
    yield "add-to-cart", {"item_id": item1, "quantity": 1}
    yield "checkout", {"discount_code": "HALF"}
    yield "list-orders", {}
