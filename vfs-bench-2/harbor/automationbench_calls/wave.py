"""Wave calls: every operation tools/api/routes/wave.py dispatches, its
input from ``variables.input``, ``input``, the body itself, inline GraphQL
arguments (valid JSON, unquoted keys, and the regex fallback with items and
``to`` arrays), and the business sub-queries; with the task's seeded
customers, invoices and products, writes that later reads see, Decimal
totals, and error cases (non-POST, unknown operations, wrong shapes and
types, bad Decimals)."""
import json

KNOWN = {}

URL = "https://gql.waveapps.com/graphql/public"


def gql(body, method="POST", url=URL):
    args = {"method": method, "url": url}
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def op(name, inp=None, kind="mutation", **extra):
    body = {
        "query":
        f"{kind} ($input: Input!) {{ {name}(input: $input) {{ didSucceed }} }}"
    }
    if inp is not None:
        body["variables"] = {"input": inp}
    body.update(extra)
    return gql(body)


def node(reply, key, sub):
    try:
        return reply["data"][key][sub]["id"]
    except (KeyError, TypeError):
        return None


def calls(world, last):
    wv = world["wave"]
    customers = [c["id"] for c in wv.get("customers", [])]
    invoices = [i["id"] for i in wv.get("invoices", [])]
    products = [p["id"] for p in wv.get("products", [])]
    cid = customers[0] if customers else "nope"

    yield gql({"query": "query { user { id } }"})
    yield gql({"query": "query { businesses { edges { node { id } } } }"})
    yield gql({"query": "{ businesses { edges { node { id } } } }"})
    yield gql({
        "query":
        "query ($id: ID!) { business(id: $id) { customers { edges { node { id "
        "} } } } }"
    })
    yield gql({
        "query":
        "query { business(id: \"b\") { invoices { edges { node { id } } } } }"
    })
    yield gql({
        "query":
        "query { business(id: \"b\") { invoicesByCustomerByStatus { id } } }"
    })
    yield gql({
        "query":
        "query { business(id: \"b\") { products { edges { node { id } } } } }"
    })
    for c in customers[:2] + ["nope", 5]:
        yield gql({
            "query":
            "query { business(id: \"b\") { customer(id: $customerId) { id } } "
            "}",
            "variables": {
                "customerId": c
            }
        })
    for i in invoices[:2] + ["nope"]:
        yield gql({
            "query":
            "query { business(id: \"b\") { invoice(id: $invoiceId) { id } } }",
            "variables": {
                "invoiceId": i
            }
        })
    yield gql({
        "query": "query { business(id: \"b\") { customer { id } } }",
        "variables": {
            "x": "customerId"
        }
    })
    yield gql({
        "query": "query { business(id: \"b\") { customer { id } } }",
        "variables": {
            "customerId": None
        }
    })
    yield gql({"query": "query { business(id: \"b\") { invoice { id } } }"})
    yield gql({"query": "query { business(id: \"b\") { name } }"})
    yield gql({"query": "query { nothing }"})
    yield gql({"query": "no braces at all"})
    yield gql({"query": ""})
    yield gql({})
    yield gql({"query": 5})
    yield gql({"query": "query { user }", "variables": None})
    yield gql({"query": "query { user }", "variables": [1]})
    yield gql({"query": "query { user }"}, method="GET")
    yield gql({"query": "query { user }"},
              url="https://gql.waveapps.com/anything/else")
    yield gql("[1]")
    yield gql('"x"')

    # Customers.
    yield op(
        "customerCreate", {
            "businessId": "biz_001",
            "name": "New Customer",
            "email": "n@c.io",
            "firstName": "N",
            "lastName": "C"
        })
    new_customer = node(last(), "customerCreate", "customer")
    yield op("customerCreate", {"input": {"name": "Nested Input"}})
    yield op("customerCreate", {"name": 5})
    yield op("customerCreate", input={"name": "Body Input"}, kind="mutation")
    yield gql({
        "query":
        "mutation { customerCreate(input: {\"name\": \"Inline JSON\", "
        "\"email\": \"i@j.io\"}) { didSucceed } }"
    })
    yield gql({
        "query":
        "mutation { customerCreate(input: {name: \"Inline GQL\", email: "
        "\"g@q.io\"}) { didSucceed } }"
    })
    yield gql({
        "query":
        "mutation { customerCreate(input: {name: \"Fallback\", email: "
        "g@q.io}) { didSucceed } }"
    })
    yield gql({
        "query":
        "mutation { customerCreate(input: {name: \"Broken\" ) { didSucceed } }"
    })
    yield gql({"query": "mutation { customerCreate { didSucceed } }"})
    yield op("customerCreate", ["x"])
    yield op("customerCreate", "plain")
    for target in [cid, new_customer, "nope"]:
        yield op("customerPatch", {
            "id": target,
            "name": "Patched",
            "email": "p@x.io"
        })
        yield op("customerPatch", {"id": target, "email": None})
        yield op("customerPatch", {"id": target, "name": 3})
    yield op("customerPatch", {"input": {"id": cid, "name": "Nested Patch"}})
    yield op("customerPatch", {})
    yield gql({
        "query": "mutation { customers { x } }",
        "variables": {
            "input": {
                "id": cid
            }
        }
    })
    yield gql({
        "query":
        "query { business(id: \"b\") { customers { edges { node { id } } } } }"
    })
    yield op("customerDelete", {"id": new_customer})
    yield op("customerDelete", {"id": 5})
    yield op("customerDelete", "x")

    # Invoices.
    yield op(
        "invoiceCreate", {
            "customerId":
            cid,
            "businessId":
            "biz_001",
            "invoiceNumber":
            "W-1",
            "status":
            "DRAFT",
            "invoiceDate":
            "2026-03-01",
            "dueDate":
            "2026-04-01",
            "memo":
            "m",
            "footer":
            "f",
            "items": [{
                "quantity": 2,
                "unitPrice": "150.50"
            }, {
                "price": 10
            }, {
                "quantity": "0.5",
                "unitPrice": "1,000"
            }]
        })
    new_invoice = node(last(), "invoiceCreate", "invoice")
    yield op(
        "invoiceCreate", {
            "customerId": cid,
            "total": "999.99",
            "items": [{
                "quantity": 1,
                "unitPrice": 1
            }]
        })
    yield op("invoiceCreate", {"customerId": cid, "total": 0, "items": []})
    yield op("invoiceCreate", {"total": "abc"})
    yield op("invoiceCreate", {"total": "nan", "items": [{"unitPrice": 1}]})
    yield op("invoiceCreate", {"total": "snan", "items": [{"unitPrice": 1}]})
    yield op("invoiceCreate", {"items": ["x"]})
    yield op("invoiceCreate", {"items": 5})
    yield op("invoiceCreate", {"items": [{"quantity": "x"}]})
    yield op(
        "invoiceCreate", {
            "items": [{
                "quantity": "1E+2",
                "unitPrice": "0.1"
            }, {
                "quantity": "-1",
                "unitPrice": "10"
            }]
        })
    yield op("invoiceCreate", {"status": 4})
    yield op("invoiceCreate", {"invoiceDate": None})
    yield gql({
        "query":
        "mutation { invoiceCreate(input: {customerId: \"" + cid +
        "\", businessId: \"biz_001\", "
        "items: [{description: \"Consulting\", unitPrice: 95, quantity: 32}] "
        "}) { didSucceed } }"
    })
    yield gql({
        "query":
        "mutation { invoiceCreate(input: {customerId: \"" + cid +
        "\", total: 12.50, memo: \"x y\", "
        "items: [{description: \"a\", unitPrice: 5, quantity: 2}], bad: [}) { "
        "didSucceed } }"
    })
    yield gql({
        "query":
        "mutation { invoiceCreate(input: {customerId: \"c1\", count: 3.0, n: "
        "7, items: [{x: }]}) { ok } }"
    })
    yield gql({
        "customerId": cid,
        "total": 42,
        "query": "mutation { invoiceCreate { didSucceed } }"
    })
    yield gql({
        "invoiceId": "x",
        "query": "mutation { invoiceSend { didSucceed } }"
    })
    for target in invoices[:2] + [new_invoice, "nope"]:
        yield op("invoiceSend", {"invoiceId": target, "to": ["a@b.io"]})
        yield op("invoiceApprove", {"invoiceId": target})
    yield gql({
        "query":
        "mutation { invoiceSend(input: {invoiceId: \"" + (new_invoice or "x") +
        "\", to: [\"a@b.io\", \"c@d.io\"]}) { didSucceed } }"
    })
    yield gql({
        "query":
        "mutation { invoiceSend(input: {invoiceId: \"" + (new_invoice or "x") +
        "\", to: [\"a@b.io\" \"c@d.io\"]}) { didSucceed } }"
    })
    yield gql({
        "query":
        "query { business(id: \"b\") { invoices { edges { node { id } } } } }"
    })
    yield op("invoiceDelete", {"invoiceId": new_invoice})
    yield op("invoiceDelete", {})
    yield op("invoiceSend", 5)

    # Products.
    yield op(
        "productCreate", {
            "name": "Widget",
            "description": "w",
            "unitPrice": "19.99",
            "isSold": True,
            "isBought": True
        })
    new_product = node(last(), "productCreate", "product")
    yield op("productCreate", {"name": "Free", "unitPrice": None})
    yield op("productCreate", {"unitPrice": "bad"})
    yield op("productCreate", {"isSold": "maybe"})
    yield op("productCreate", {"name": ["x"]})
    for target in products[:2] + [new_product, "nope"]:
        yield op(
            "productPatch", {
                "id": target,
                "name": "Gadget",
                "unitPrice": "1,250.00",
                "description": "d"
            })
        yield op("productPatch", {"id": target, "unitPrice": "nan"})
        yield op("productPatch", {"id": target, "description": 3})
        yield op("productArchive", {"id": target})
    yield op("productArchive", {"id": None})
    yield gql({
        "query":
        "query { business(id: \"b\") { products { edges { node { id } } } } }"
    })
