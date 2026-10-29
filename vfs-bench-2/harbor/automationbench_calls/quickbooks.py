"""QuickBooks calls: every route of tools/api/routes/quickbooks.py, with the
task's seeded records, QuickBooks queries (valid, invalid, paged, counted,
filtered on dates, Decimals and Active), writes that later reads and queries
see, Decimal edge cases (scientific, NaN, commas and dollar signs), and
error cases (unknown ids, wrong body shapes, wrong types)."""
import json

KNOWN = {}

BASE = "https://quickbooks.api.intuit.com/v3/company/123/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def query(q, method="POST", as_param=False):
    if as_param:
        return fetch(method, "query", params={"query": q})
    return fetch(method, "query", body={"query": q})


QUERIES = [
    "SELECT * FROM Customer",
    "select * from customer",
    "SELECT * FROM Customer WHERE Active = false",
    "SELECT * FROM Customer WHERE Active IN (true, false)",
    "SELECT * FROM Customer WHERE DisplayName LIKE '%a%'",
    "SELECT * FROM Customer WHERE DisplayName = 'Helix Systems'",
    "SELECT * FROM Customer ORDERBY DisplayName DESC",
    "SELECT * FROM Customer ORDER BY DisplayName",
    "SELECT * FROM Customer STARTPOSITION 2 MAXRESULTS 2",
    "SELECT COUNT(*) FROM Customer",
    "SELECT Id, DisplayName FROM Customer",
    "SELECT * FROM Customer WHERE Balance > '1000'",
    "SELECT * FROM Customer WHERE Balance >= 100.50",
    "SELECT * FROM Invoice",
    "SELECT * FROM Invoice WHERE TxnDate > '2026-01-01'",
    "SELECT * FROM Invoice WHERE TxnDate < '2025-12-31' AND Balance > '0'",
    "SELECT * FROM Invoice WHERE TotalAmt > '1000' ORDERBY TotalAmt DESC",
    "SELECT * FROM Invoice WHERE CustomerRef = 'qc_601'",
    "SELECT * FROM Invoice WHERE DueDate < '2026-03-01'",
    "SELECT * FROM Invoice WHERE MetaData.CreateTime > '2020-01-01'",
    "SELECT * FROM Vendor",
    "SELECT * FROM Vendor WHERE DisplayName LIKE 'Acme%'",
    "SELECT * FROM Bill",
    "SELECT * FROM Bill WHERE Balance > '0'",
    "SELECT * FROM Payment",
    "SELECT * FROM Payment WHERE TxnDate >= '2026-02-01' ORDERBY TxnDate",
    "SELECT * FROM Estimate",
    "SELECT * FROM Estimate WHERE TxnStatus = 'Accepted'",
    "SELECT * FROM SalesReceipt",
    "SELECT * FROM Item",
    "SELECT * FROM Account",
    "SELECT * FROM Employee",
    "SELECT * FROM CreditMemo",
    "SELECT * FROM Widget",
    "SELECT FROM Customer",
    "SELECT * FROM Customer WHERE",
    "SELECT * FROM Customer WHERE DisplayName = 'unterminated",
    "SELECT * FROM Customer LIMIT 2",
    "SELECT * FROM Customer WHERE Id IN ('qc_301', 'qc_401')",
    "SELECT * FROM Customer WHERE DisplayName != 'x' OR Active = true",
    "SELECT * FROM Customer WHERE NOT DisplayName = 'x'",
    "SELECT * FROM Customer WHERE TxnDate = TODAY",
    "SELECT * FROM Invoice WHERE TxnDate = LAST_N_DAYS:30",
    "SELECT * FROM Customer MAXRESULTS 1000",
    "SELECT * FROM Customer STARTPOSITION 0",
    "SELECT * FROM Customer GROUP BY DisplayName",
    "  ",
    "",
]


def calls(world, last):
    qb = world["quickbooks"]
    for q in QUERIES:
        yield query(q)
    yield query("SELECT * FROM Customer", method="GET", as_param=True)
    yield fetch("POST", "query", body='"SELECT * FROM Vendor"')
    yield fetch("POST", "query", body="SELECT * FROM Vendor")
    yield fetch("POST", "query", body='"bad json')
    yield fetch("POST", "query", body={"q": "SELECT * FROM Item"})
    yield fetch("POST", "query", body={"query": 5})
    yield fetch("POST", "query", body={"query": '"SELECT * FROM Bill"'})
    yield fetch("POST", "query", body={"query": '"\\x"'})
    yield fetch("POST", "query", body=[1, 2])
    yield fetch("GET", "query")
    yield fetch("POST", "query", params="[1]")

    for name, path in [("customers", "customer"), ("vendors", "vendor"),
                       ("invoices", "invoice"), ("items", "item"),
                       ("payments", "payment"), ("bills", "bill"),
                       ("estimates", "estimate")]:
        for r in qb.get(name, [])[:3]:
            yield fetch("GET", f"{path}/{r['id']}")
        yield fetch("GET", f"{path}/nope")
    yield fetch("GET", "companyinfo/123")
    yield fetch("GET", "preferences")
    yield fetch("DELETE", "customer/x")

    customers = qb.get("customers", [])
    cid = customers[0]["id"] if customers else "qc_none"

    # Customers.
    yield fetch("POST",
                "customer",
                body={
                    "DisplayName": "New Co",
                    "GivenName": "Ann",
                    "FamilyName": "Lee",
                    "CompanyName": "New Co LLC",
                    "PrimaryEmailAddr": {
                        "Address": "a@new.co"
                    },
                    "PrimaryPhone": {
                        "FreeFormNumber": "555-1000"
                    }
                })
    new_customer = last().get("Customer", {}).get("Id") if isinstance(
        last(), dict) else None
    yield fetch("POST",
                "customer",
                body={
                    "DisplayName": "Flat Co",
                    "email": "f@flat.co",
                    "phone": "1",
                    "Active": False
                })
    yield fetch("POST", "customer", body={"DisplayName": 5})
    yield fetch("POST", "customer", body={"Active": "maybe"})
    yield fetch("POST", "customer", body={"PrimaryEmailAddr": "plain@x.io"})
    yield fetch("POST", "customer", body={})
    yield fetch("POST", "customer", body=[1])
    yield fetch("POST", "customer", body="7")
    for target in [cid, new_customer, "nope"]:
        yield fetch("POST",
                    "customer",
                    body={
                        "Id": target,
                        "DisplayName": "Renamed",
                        "GivenName": "G",
                        "Notes": "n",
                        "Active": "false",
                        "PrimaryEmailAddr": {
                            "Address": "r@x.io"
                        }
                    })
        yield fetch("POST",
                    "customer",
                    body={
                        "Id": target,
                        "PrimaryEmailAddr": "plain@y.io",
                        "CompanyName": None
                    })
        yield fetch("POST",
                    "customer",
                    body={
                        "Id": target,
                        "PrimaryEmailAddr": {}
                    })
        yield fetch("POST", "customer", body={"Id": target, "FamilyName": 3})
        yield fetch("GET", f"customer/{target}")
    yield fetch("POST", "customer", body={"Id": 5, "DisplayName": "x"})
    yield query("SELECT * FROM Customer WHERE Active = false")

    # Vendors.
    vendors = qb.get("vendors", [])
    vid = vendors[0]["id"] if vendors else "qv_none"
    yield fetch("POST",
                "vendor",
                body={
                    "DisplayName": "Supply Co",
                    "CompanyName": "Supply",
                    "PrimaryEmailAddr": {
                        "Address": "s@s.io"
                    }
                })
    new_vendor = last().get("Vendor", {}).get("Id") if isinstance(
        last(), dict) else None
    yield fetch("POST",
                "vendor",
                body={
                    "DisplayName": "Flat Vendor",
                    "email": "v@v.io"
                })
    yield fetch("POST", "vendor", body={"DisplayName": ["x"]})
    for target in [vid, new_vendor, "nope"]:
        yield fetch("POST",
                    "vendor",
                    body={
                        "Id": target,
                        "DisplayName": "Vendor Renamed",
                        "Active": False
                    })
        yield fetch("POST", "vendor", body={"Id": target, "Active": "nope"})
    yield query("SELECT * FROM Vendor WHERE Active = false")

    # Invoices.
    yield fetch("POST",
                "invoice",
                body={
                    "CustomerRef": {
                        "value": cid
                    },
                    "Line": [{
                        "Amount": 100.5
                    }, {
                        "Amount": "1,200.25"
                    }, {
                        "Amount": "$3"
                    }, "x", {
                        "Amount": None
                    }],
                    "TxnDate":
                    "2026-03-01",
                    "DueDate":
                    "2026-04-01",
                    "BillEmail": {
                        "Address": "b@x.io"
                    },
                    "PrivateNote":
                    "note",
                    "CustomerMemo": {
                        "value": "memo"
                    },
                    "TotalAmt":
                    9
                })
    new_invoice = last().get("Invoice", {}).get("Id") if isinstance(
        last(), dict) else None
    yield fetch("POST",
                "invoice",
                body={
                    "CustomerRef": "Walk-in Customer",
                    "Line": [{
                        "Amount": 1e-7
                    }, {
                        "Amount": 2.0
                    }],
                    "BillEmail": "flat@x.io",
                    "CustomerMemo": "flat memo",
                    "DocNumber": "D-1"
                })
    yield fetch("POST",
                "invoice",
                body={
                    "CustomerRef": {
                        "value": "12345"
                    },
                    "Line": [{
                        "Amount": "1E+2"
                    }, {
                        "Amount": 0.1
                    }, {
                        "Amount": 0.2
                    }]
                })
    yield fetch("POST",
                "invoice",
                body={
                    "CustomerRef": {
                        "value": "Named Co",
                        "name": ""
                    },
                    "Line": []
                })
    yield fetch("POST", "invoice", body={"CustomerRef": {"value": 77}})
    yield fetch("POST",
                "invoice",
                body={
                    "CustomerRef": {
                        "value": "x"
                    },
                    "Line": [{
                        "Amount": "abc"
                    }]
                })
    yield fetch("POST", "invoice", body={"Line": [{"Amount": "nan"}]})
    yield fetch(
        "POST",
        "invoice",
        body={"Line": [{
            "Amount": "Infinity"
        }, {
            "Amount": "-Infinity"
        }]})
    yield fetch("POST", "invoice", body={"Line": [{"Amount": True}]})
    yield fetch("POST", "invoice", body={"Line": "ab"})
    yield fetch("POST", "invoice", body={"Line": 5})
    yield fetch("POST", "invoice", body={"Line": {"Amount": 1}})
    yield fetch("POST", "invoice", body={"DocNumber": 9})
    yield fetch("POST", "invoice", body={"TxnDate": None})
    yield fetch("POST",
                "invoice",
                body={
                    "Line": [{
                        "Amount": "99999999999999999999999999999"
                    }, {
                        "Amount": "0.5"
                    }]
                })
    yield fetch("POST",
                "invoice",
                body={"Line": [{
                    "Amount": "-5"
                }, {
                    "Amount": "5"
                }]})
    yield fetch("POST",
                "invoice",
                body={"Line": [{
                    "Amount": "-0"
                }, {
                    "Amount": "-0.00"
                }]})
    yield fetch("POST", "invoice", body=[])
    yield fetch("POST", "invoice", body={})
    invoices = qb.get("invoices", [])
    targets = [i["id"] for i in invoices[:2]] + [new_invoice, "nope"]
    for target in targets:
        yield fetch("POST",
                    "invoice",
                    body={
                        "Id": target,
                        "DueDate": "2026-05-01",
                        "PrivateNote": "updated",
                        "DocNumber": "U-1"
                    })
        yield fetch("POST", "invoice", body={"Id": target, "DueDate": 5})
        yield fetch("POST", f"invoice/{target}/send")
        yield fetch("GET", f"invoice/{target}/send")
        yield fetch("GET", f"invoice/{target}")
    if targets:
        yield fetch("POST",
                    "invoice",
                    params={"operation": "void"},
                    body={"Id": targets[0]})
        yield fetch("POST",
                    "invoice",
                    params={"operation": ["void"]},
                    body={"Id": new_invoice})
        yield fetch("POST",
                    "invoice",
                    params={"operation": "void"},
                    body={"Id": "nope"})
        yield fetch("POST", "invoice", params={"operation": "void"}, body={})
        yield query("SELECT * FROM Invoice WHERE Balance = '0'")
        yield fetch("POST",
                    "invoice",
                    params={"operation": "delete"},
                    body={"Id": targets[-2]})
        yield fetch("POST",
                    "invoice",
                    params={"operation": "delete"},
                    body={"Id": 3})
        yield fetch("POST",
                    "invoice",
                    params={"operation": []},
                    body={"Id": "x"})
        yield fetch("POST",
                    "invoice",
                    params={"operation": "other"},
                    body={"Id": targets[0]})
        yield fetch("POST", "invoice", params="[1]", body={"Id": "x"})
        yield fetch("POST",
                    "invoice",
                    params={"operation": "delete"},
                    body="[1]")
    yield query("SELECT * FROM Invoice ORDERBY DocNumber")

    # Items.
    yield fetch("POST",
                "item",
                body={
                    "Name": "Consulting",
                    "Type": "Service",
                    "Description": "hours",
                    "UnitPrice": "150.00"
                })
    yield fetch("POST",
                "item",
                body={
                    "Name": "Widget",
                    "Type": "Inventory",
                    "UnitPrice": 12,
                    "Active": False
                })
    yield fetch("POST", "item", body={"Name": "Bad", "Type": "Gadget"})
    yield fetch("POST", "item", body={"UnitPrice": "x"})
    yield fetch("POST", "item", body={"UnitPrice": "NaN"})
    yield fetch("POST", "item", body={"UnitPrice": None})
    yield query("SELECT * FROM Item")
    yield query("SELECT * FROM Item WHERE UnitPrice > '100'")

    # Payments.
    yield fetch("POST",
                "payment",
                body={
                    "CustomerRef": {
                        "value": cid
                    },
                    "TotalAmt": "5,200.00",
                    "TxnDate": "2026-04-03",
                    "PaymentRefNum": "PMT-1",
                    "PrivateNote": "pay"
                })
    new_payment = last().get("Payment", {}).get("Id") if isinstance(
        last(), dict) else None
    yield fetch("POST",
                "payment",
                body={
                    "CustomerRef": "Cash Buyer",
                    "TotalAmt": 10
                })
    yield fetch("POST",
                "payment",
                body={
                    "CustomerRef": {
                        "value": "999"
                    },
                    "TotalAmt": 1.25
                })
    yield fetch("POST", "payment", body={"TotalAmt": "bad"})
    yield fetch("POST", "payment", body={"PaymentRefNum": 5})
    yield fetch("GET", f"payment/{new_payment}")

    # Bills and bill payments.
    yield fetch("POST",
                "bill",
                body={
                    "VendorRef": {
                        "value": vid
                    },
                    "Line": [{
                        "Amount": 300
                    }, {
                        "Amount": "200.50"
                    }],
                    "TxnDate": "2026-03-01",
                    "DueDate": "2026-04-01",
                    "PrivateNote": "bill"
                })
    new_bill = last().get("Bill", {}).get("Id") if isinstance(last(),
                                                              dict) else None
    yield fetch("POST",
                "bill",
                body={
                    "VendorRef": "Some Vendor",
                    "Line": [{
                        "Amount": 5
                    }]
                })
    yield fetch("POST", "bill", body={"VendorRef": {"value": "nope"}})
    yield fetch("POST", "bill", body={"DueDate": 3})
    bills = [b["id"] for b in qb.get("bills", [])[:2]] + [new_bill]
    for b in bills:
        yield fetch("POST",
                    "billpayment",
                    body={
                        "VendorRef": {
                            "value": vid
                        },
                        "TotalAmt":
                        100,
                        "Line": [{
                            "Amount": 100,
                            "LinkedTxn": [{
                                "TxnId": b,
                                "TxnType": "Bill"
                            }]
                        }],
                        "DocNumber":
                        "BP-1",
                        "PrivateNote":
                        "paid"
                    })
        yield fetch("POST",
                    "billpayment",
                    body={
                        "VendorRef":
                        "Acme",
                        "Line": [{
                            "Amount":
                            0,
                            "LinkedTxn": [{
                                "TxnId": b,
                                "TxnType": "Bill"
                            }, {
                                "TxnId": b,
                                "TxnType": "Invoice"
                            }, "x"]
                        }, {
                            "Amount": 50
                        }, "y"]
                    })
        yield fetch("POST",
                    "billpayment",
                    body={
                        "VendorRef": {
                            "value": "12"
                        },
                        "Line": [{
                            "Amount": "99999",
                            "LinkedTxn": [{
                                "TxnId": b,
                                "TxnType": "Bill"
                            }]
                        }]
                    })
        yield fetch("GET", f"bill/{b}")
    yield fetch("POST",
                "billpayment",
                body={
                    "VendorRef": {
                        "value": "vendor-x",
                        "name": "Named"
                    },
                    "TotalAmt": 0
                })
    yield fetch("POST", "billpayment", body={"VendorRef": {"value": 12}})
    yield fetch("POST", "billpayment", body={})
    yield fetch("POST",
                "billpayment",
                body={
                    "Line": [{
                        "Amount":
                        "nan",
                        "LinkedTxn": [{
                            "TxnId": new_bill,
                            "TxnType": "Bill"
                        }]
                    }]
                })
    yield fetch("POST", "billpayment", body={"Line": [{"LinkedTxn": 5}]})
    yield query("SELECT * FROM Bill ORDERBY Balance")
    yield query("SELECT * FROM Payment")

    # Sales and refund receipts.
    yield fetch("POST",
                "salesreceipt",
                body={
                    "CustomerRef": {
                        "value": cid
                    },
                    "Line": [{
                        "Amount": 49.99
                    }, {
                        "Amount": 0.01
                    }],
                    "CustomerMemo": {
                        "value": "thanks"
                    }
                })
    yield fetch("POST",
                "salesreceipt",
                body={
                    "CustomerRef": "Walk In",
                    "memo": "flat",
                    "DocNumber": "SR-X"
                })
    yield fetch("POST", "salesreceipt", body={"CustomerRef": {"value": "555"}})
    yield fetch("POST", "salesreceipt", body={"memo": 4})
    yield query("SELECT * FROM SalesReceipt")
    yield fetch("POST",
                "refundreceipt",
                body={
                    "CustomerRef": {
                        "value": cid
                    },
                    "Line": [{
                        "Amount": 25
                    }],
                    "TxnDate": "2026-04-01",
                    "DocNumber": "RF-1",
                    "PrivateNote": "refund"
                })
    yield fetch("POST",
                "refundreceipt",
                body={
                    "CustomerRef": "Refund Person",
                    "TotalAmt": "75.00"
                })
    yield fetch("POST",
                "refundreceipt",
                body={
                    "CustomerRef": {
                        "value": "4242"
                    },
                    "TotalAmt": 0
                })
    yield fetch("POST", "refundreceipt", body={"CustomerRef": {"value": 4}})
    yield fetch("POST", "refundreceipt", body={})
    yield query("SELECT * FROM Payment ORDERBY TotalAmt DESC")
    yield query("SELECT COUNT(*) FROM Payment WHERE TotalAmt > '0'")
