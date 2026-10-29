"""Xero calls: every route of tools/api/routes/xero.py, with the task's
seeded contacts, invoices, credit notes, purchase orders and quotes;
creates in every envelope shape (bare, wrapped, several), LineItems totals
in Decimal, ACCPAY bills, payments and allocations; and error cases
(unknown ids, wrong shapes, bad Decimals, invalid literals, wrong types)."""
import json

KNOWN = {}

BASE = "https://api.xero.com/api.xro/2.0/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def first(reply, key, field):
    if isinstance(reply, dict) and isinstance(reply.get(key), list) and reply[key]:
        return reply[key][0].get(field)
    return None


def calls(world, last):
    x = world["xero"]
    for path in ["Invoices", "Contacts", "Accounts", "Items", "Payments", "CreditNotes", "PurchaseOrders", "Quotes",
                 "BankTransactions", "BankTransfers", "Employees", "Organisation"]:
        yield fetch("GET", path)
    yield fetch("GET", "Quotes", params={"Status": "draft"})
    yield fetch("GET", "Quotes", params={"status": "ACCEPTED"})
    yield fetch("GET", "Quotes", params={"Status": 5})
    yield fetch("GET", "Quotes", params={"Status": ""})
    yield fetch("GET", "Quotes", params="[1]")
    yield fetch("GET", "Invoices", params={"Statuses": "PAID"})
    yield fetch("DELETE", "Invoices")
    yield fetch("GET", "Bills")

    contacts = x.get("contacts", [])
    for c in contacts[:3]:
        yield fetch("GET", f"Contacts/{c['contact_id']}")
    yield fetch("GET", "Contacts/nope")
    cid = contacts[0]["contact_id"] if contacts else "nope"

    # Contacts.
    yield fetch("PUT", "Contacts", body={"Name": "Bare Co", "FirstName": "B", "LastName": "C", "EmailAddress": "b@c.io",
                                         "IsSupplier": True})
    new_contact = first(last(), "Contacts", "ContactID")
    yield fetch("PUT", "Contacts", body={"Contacts": [{"Name": "One"}, {"Name": "Two", "IsCustomer": False}]})
    yield fetch("PUT", "Contacts", body={"Contacts": "ab"})
    yield fetch("PUT", "Contacts", body={"Name": 5})
    yield fetch("PUT", "Contacts", body={"IsCustomer": "maybe"})
    yield fetch("PUT", "Contacts", body='"Contacts here"')
    yield fetch("PUT", "Contacts", body=[1])
    yield fetch("PUT", "Contacts", body="5")
    yield fetch("PUT", "Contacts", body={})
    for target in [cid, new_contact, "nope"]:
        yield fetch("POST", f"Contacts/{target}", body={"Name": "Renamed", "EmailAddress": "r@x.io", "ContactStatus": "ARCHIVED"})
        yield fetch("POST", f"Contacts/{target}", body={"EmailAddress": None})
        yield fetch("POST", f"Contacts/{target}", body={"Name": 3})
        yield fetch("POST", f"Contacts/{target}", body='"Name here"')
        yield fetch("POST", f"Contacts/{target}", body=["Name"])
        yield fetch("POST", f"Contacts/{target}", body="3")
        yield fetch("GET", f"Contacts/{target}")

    # Invoices and bills.
    yield fetch("PUT", "Invoices", body={"Type": "ACCREC", "Contact": {"ContactID": cid}, "InvoiceNumber": "INV-9",
                                         "LineItems": [{"UnitAmount": "100.50", "Quantity": 2}, {"Amount": 10},
                                                       {"UnitAmount": "1,000", "Quantity": "0.5"}],
                                         "Date": "2026-03-01", "DueDate": "2026-04-01", "Reference": "ref", "CurrencyCode": "EUR"})
    new_invoice = first(last(), "Invoices", "InvoiceID")
    yield fetch("PUT", "Invoices", body={"Invoices": [{"Contact": {"Name": "Named"}, "Total": "250.00"},
                                                      {"Type": "ACCPAY", "Contact": {"ContactID": cid}, "Total": 99.5,
                                                       "InvoiceNumber": "BILL-1", "DueDate": "2026-05-01"}]})
    yield fetch("PUT", "Invoices", body={"Type": "ACCPAY", "LineItems": [{"UnitAmount": 3, "Quantity": 3}], "Status": "AUTHORISED"})
    yield fetch("PUT", "Invoices", body={"Type": "OTHER", "Total": 1})
    yield fetch("PUT", "Invoices", body={"Total": "abc"})
    yield fetch("PUT", "Invoices", body={"Total": 0, "LineItems": [{"UnitAmount": "x"}]})
    yield fetch("PUT", "Invoices", body={"LineItems": ["x"]})
    yield fetch("PUT", "Invoices", body={"LineItems": 5})
    yield fetch("PUT", "Invoices", body={"LineItems": [{"UnitAmount": "1E+2", "Quantity": "1e-1"}, {"Amount": "nan"}]})
    yield fetch("PUT", "Invoices", body={"LineItems": [{"UnitAmount": "0.1", "Quantity": "3"}, {"UnitAmount": "-0.3"}]})
    yield fetch("PUT", "Invoices", body={"LineItems": []})
    yield fetch("PUT", "Invoices", body={"Contact": "plain"})
    yield fetch("PUT", "Invoices", body={"Contact": {"ContactID": 5}})
    yield fetch("PUT", "Invoices", body={"Status": 4})
    yield fetch("PUT", "Invoices", body={"Invoices": 5})
    yield fetch("PUT", "Invoices", body=[])
    invoices = [i["invoice_id"] for i in x.get("invoices", [])[:3]] + [new_invoice, "nope"]
    for target in invoices:
        yield fetch("GET", f"Invoices/{target}")
        yield fetch("POST", f"Invoices/{target}", body={"Status": "AUTHORISED", "DueDate": "2026-06-01", "SentToContact": "true",
                                                        "Reference": "R-2"})
        yield fetch("POST", f"Invoices/{target}", body={"SentToContact": "sure"})
        yield fetch("POST", f"Invoices/{target}", body={"Status": None})
        yield fetch("POST", f"Invoices/{target}", body='"Status"')
        yield fetch("POST", f"Invoices/{target}/Email")
        yield fetch("POST", f"Invoices/{target}/Email", body={"x": 1})
    yield fetch("GET", "Invoices")

    # Payments.
    yield fetch("PUT", "Payments", body={"Invoice": {"InvoiceID": new_invoice, "InvoiceNumber": "INV-9"},
                                         "Account": {"Code": "090", "Name": "Bank"}, "Amount": "211.00", "Date": "2026-04-02",
                                         "Reference": "pay"})
    yield fetch("POST", "Payments", body={"Payments": [{"Invoice": {"InvoiceID": "x"}, "Account": {"AccountID": "acc"}, "Amount": 5},
                                                       {"Amount": "1,234.5"}]})
    yield fetch("PUT", "Payments", body={"Amount": "bad"})
    yield fetch("PUT", "Payments", body={"Invoice": "x", "Account": "y"})
    yield fetch("PUT", "Payments", body={"Invoice": {}, "Account": "y"})
    yield fetch("PUT", "Payments", body={"Date": 5})
    yield fetch("GET", "Payments")

    # Credit notes and allocations.
    yield fetch("PUT", "CreditNotes", body={"Contact": {"ContactID": cid}, "LineItems": [{"UnitAmount": "50", "Quantity": 2},
                                                                                      {"Amount": "25.25"}]})
    new_cn = first(last(), "CreditNotes", "CreditNoteID")
    yield fetch("PUT", "CreditNotes", body={"CreditNotes": [{"Type": "ACCPAYCREDIT", "Total": "300", "Status": "DRAFT",
                                                             "Contact": {"Name": "Vendor"}}, {"Total": 0}]})
    yield fetch("PUT", "CreditNotes", body={"Type": "BAD"})
    yield fetch("PUT", "CreditNotes", body={"Total": "x"})
    yield fetch("PUT", "CreditNotes", body={"LineItems": 3})
    yield fetch("PUT", "CreditNotes", body={"LineItems": {"a": 1}})
    yield fetch("PUT", "CreditNotes", body={"Contact": 1})
    cns = [c["credit_note_id"] for c in x.get("credit_notes", [])[:2]] + [new_cn, "nope"]
    for target in cns:
        yield fetch("PUT", f"CreditNotes/{target}/Allocations", body={"Allocations": [{"Amount": "60.50", "Invoice": {"InvoiceID": "i"}},
                                                                                      {"Amount": 10}]})
        yield fetch("PUT", f"CreditNotes/{target}/Allocations", body={"Allocations": []})
        yield fetch("PUT", f"CreditNotes/{target}/Allocations", body={"Allocations": [{"Amount": "99999"}]})
        yield fetch("PUT", f"CreditNotes/{target}/Allocations", body={})
    yield fetch("PUT", f"CreditNotes/{new_cn}/Allocations", body={"Allocations": [{"Amount": "x"}]})
    yield fetch("PUT", f"CreditNotes/{new_cn}/Allocations", body={"Allocations": ["x"]})
    yield fetch("PUT", f"CreditNotes/{new_cn}/Allocations", body="[1]")
    yield fetch("GET", "CreditNotes")

    # Purchase orders.
    pos = [p["purchase_order_id"] for p in x.get("purchase_orders", [])[:2]] + ["nope"]
    for target in pos:
        yield fetch("GET", f"PurchaseOrders/{target}")
        yield fetch("POST", f"PurchaseOrders/{target}", body={"Status": "AUTHORISED"})
        yield fetch("POST", f"PurchaseOrders/{target}", body={"Status": 1})
        yield fetch("POST", f"PurchaseOrders/{target}", body={"Reference": "r"})
        yield fetch("POST", f"PurchaseOrders/{target}", body='"Status"')
    yield fetch("GET", "PurchaseOrders")
