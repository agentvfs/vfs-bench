"""Zoho Desk calls: every route of tools/api/routes/zoho_desk.py, with the
task's seeded tickets, contacts and accounts, writes that later reads see,
and error cases (unknown ids, bad status and priority, wrong types)."""
import json

KNOWN = {}

BASE = "https://desk.zoho.com/api/v1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    z = world["zoho_desk"]
    tickets, contacts, accounts = z.get("tickets", []), z.get("contacts", []), z.get("accounts", [])
    yield fetch("GET", "tickets")
    yield fetch("GET", "contacts")
    yield fetch("GET", "accounts")
    for t in tickets[:4]:
        yield fetch("GET", "tickets", {"ticketId": t["id"]})
        words = (t.get("subject") or "x").split()
        yield fetch("GET", "tickets", {"query": words[0].lower()})
        yield fetch("GET", "tickets", {"query": words[-1]})
    for c in contacts[:4]:
        yield fetch("GET", "contacts", {"contactId": c["id"]})
        if c.get("email"):
            yield fetch("GET", "contacts", {"email": c["email"].upper()})
            yield fetch("POST", "contacts", body={"email": c["email"], "firstName": "Dup"})
        yield fetch("GET", "contacts", {"query": (c.get("last_name") or c.get("first_name") or "a")[:4]})
    for a in accounts[:4]:
        yield fetch("GET", f"accounts/{a['id']}")
        yield fetch("GET", "accounts", {"accountName": (a.get("account_name") or "x")[:5].upper()})
        yield fetch("GET", "accounts", {"accountId": a["id"], "accountName": "zz"})
    yield fetch("GET", "accounts")
    yield fetch("GET", "accounts", {"accountName": 5})
    yield fetch("GET", "accounts/nope")
    yield fetch("GET", "tickets", {"ticketId": "nope"})
    yield fetch("GET", "tickets", {"query": 3})
    yield fetch("GET", "tickets", {"query": "zzzz"})
    yield fetch("GET", "tickets", "[1]")
    yield fetch("GET", "contacts", {"email": 4})
    yield fetch("GET", "contacts", {"query": "@"})
    yield fetch("GET", "contacts", {"contactId": "nope", "x": 1})

    yield fetch("POST", "tickets", body={"subject": "Login broken", "description": "Cannot sign in", "status": "Escalated",
                                         "priority": "High", "channel": "Phone", "contactId": "c1", "accountId": "a1",
                                         "departmentId": "d1", "assigneeId": "u1", "classification": "Problem",
                                         "category": "Auth"})
    new = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("POST", "tickets", body={"subject": "Defaults"})
    yield fetch("POST", "tickets", body={"subject": "Bad status", "status": "Pending"})
    yield fetch("POST", "tickets", body={"subject": "Bad priority", "priority": "Urgent"})
    yield fetch("POST", "tickets", body={"subject": None, "channel": None})
    yield fetch("POST", "tickets", body={"subject": 5})
    yield fetch("POST", "tickets", body={"tags": ["x"]})
    yield fetch("POST", "tickets", body="[1]")
    yield fetch("POST", "tickets", body={})
    targets = [t["id"] for t in tickets[:2]] + [new]
    for tid in targets:
        yield fetch("PATCH", f"tickets/{tid}", body={"status": "Closed", "priority": "Low", "assigneeId": "u9",
                                                     "classification": "Request", "departmentId": "d2", "team_id": "t1"})
        yield fetch("PUT", f"tickets/{tid}", body={"subject": "Renamed", "description": "New"})
        yield fetch("PUT", f"tickets/{tid}", body={"status": "Resolved", "subject": "Partial"})
        yield fetch("PUT", f"tickets/{tid}", body={"priority": None, "status": None})
        yield fetch("PUT", f"tickets/{tid}", body={"subject": 1})
        yield fetch("PUT", f"tickets/{tid}", body={"ticketId": "other"})
        yield fetch("PUT", f"tickets/{tid}", body="[1]")
        yield fetch("PUT", f"tickets/{tid}", body={"unknown": 1})
        yield fetch("POST", f"tickets/{tid}/comments", body={"content": "Looking", "isPublic": False,
                                                             "commenterId": "u1", "contentType": "plainText"})
        yield fetch("POST", f"tickets/{tid}/comments", body={"content": "Public"})
        yield fetch("POST", f"tickets/{tid}/comments", body={"content": None})
        yield fetch("POST", f"tickets/{tid}/comments", body={"content": "x", "isPublic": "no"})
        yield fetch("POST", f"tickets/{tid}/comments", body={"content": "x", "isPublic": "maybe"})
        yield fetch("POST", f"tickets/{tid}/comments", body={"ticketId": "y"})
        yield fetch("GET", "tickets", {"ticketId": tid})
    yield fetch("PATCH", "tickets/nope", body={"status": "Closed"})
    yield fetch("POST", "tickets/nope/comments", body={"content": "x"})

    yield fetch("POST", "contacts", body={"email": "grace@example.com", "firstName": "Grace", "lastName": "Hopper",
                                          "phone": "1", "mobile": "2", "accountId": "a1", "description": "d"})
    yield fetch("POST", "contacts", body={"email": "GRACE@example.com"})
    yield fetch("POST", "contacts", body={})
    yield fetch("POST", "contacts", body={})
    yield fetch("POST", "contacts", body={"email": None})
    yield fetch("POST", "contacts", body={"email": "n@x.io", "firstName": 3})
    yield fetch("POST", "contacts", body={"email": "m@x.io", "firstName": None, "phone": 1})
    yield fetch("GET", "contacts", {"query": "grace"})

    yield fetch("POST", "accounts", body={"accountName": "Initech", "website": "initech.com", "industry": "Tech",
                                          "description": "d"})
    yield fetch("POST", "accounts", body={"name": "Name only"})
    yield fetch("POST", "accounts", body={"accountName": "", "name": ""})
    yield fetch("POST", "accounts", body={"accountName": 5})
    yield fetch("POST", "accounts", body={"website": 3, "accountName": "W"})
    yield fetch("POST", "accounts", body={"seats": 3, "accountName": "S"})
    yield fetch("GET", "accounts", {"accountName": "initech"})

    yield fetch("GET", "tickets")
    yield fetch("GET", "contacts")
    yield fetch("DELETE", f"tickets/{new}")
    yield fetch("GET", f"tickets/{new}")
    yield fetch("GET", "departments")
