"""Re:amaze calls: every route of tools/api/routes/reamaze.py, with the
task's seeded conversations and contacts, writes that later reads see, and
error cases (unknown ids, int and bad statuses, odd tag, assignee and
message shapes, wrong types, clashing arguments)."""
import json

KNOWN = {}

BASE = "https://acme.reamaze.io/api/v1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    rz = world["reamaze"]
    convs, contacts = rz.get("conversations", []), rz.get("contacts", [])
    yield fetch("GET", "conversations")
    yield fetch("GET", "contacts")
    for params in [{"filter": "unresolved"}, {"filter": "RESOLVED"}, {"filter": "all"}, {"tag": "VIP"}, {"tag": "billing"},
                   {"category": "bill"}, {"for": "a@x.io"}, {"sort": "x", "page": 2}, {"filter": 3}, {"tag": 3},
                   {"category": 5}, {"for": 5}, {"filter": ""}]:
        yield fetch("GET", "conversations", params)
    if contacts and contacts[0].get("email"):
        yield fetch("GET", "conversations", {"for": contacts[0]["email"].upper()})
    yield fetch("GET", "conversations", "[1]")
    yield fetch("GET", "conversations", base="https://acme.reamaze.io/")
    yield fetch("POST", "conversations", body={"conversation": {
        "subject": "Order late", "category": "Shipping", "tag_list": ["vip", "billing"], "status": 1,
        "user": {"email": "Buyer@x.io", "name": "Buyer"}, "assignee": "agent@x.io",
        "message": {"body": "Where is my order?"}}})
    new = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("POST", "conversations", body={"conversation": {"subject": "Str status", "status": "resolved", "user": "x",
                                                                "message": {"body": ""}}})
    yield fetch("POST", "conversations", body={"conversation": {"subject": "Bool status", "status": True}})
    yield fetch("POST", "conversations", body={"conversation": {"status": 42, "tag_list": None}})
    yield fetch("POST", "conversations", body={"conversation": {"status": "open"}})
    yield fetch("POST", "conversations", body={"conversation": {"status": 2.0}})
    yield fetch("POST", "conversations", body={"conversation": {"tag_list": "a"}})
    yield fetch("POST", "conversations", body={"conversation": {"message": {"body": 5}}})
    yield fetch("POST", "conversations", body={"conversation": "str"})
    yield fetch("POST", "conversations", body={"conversation": []})
    yield fetch("POST", "conversations", body={})
    yield fetch("POST", "conversations", body={"subject": "flat"})
    targets = [c["id"] for c in convs[:3]] + [new]
    for cid in targets:
        yield fetch("PUT", f"conversations/{cid}", body={"conversation": {"status": 2, "category": "Returns",
                                                                          "tag_list": ["done"], "assignee": {"email": "x@y.io"},
                                                                          "brand": "Acme"}})
        yield fetch("PATCH", f"conversations/{cid}", body={"status": "archived", "tags": "single", "assignee_email": "a@b.c"})
        yield fetch("PUT", f"conversations/{cid}", body={"conversation": {"status": 0, "tags": ["t"]}, "status": "pending",
                                                         "assignee": "", "assignee_email": ""})
        yield fetch("PUT", f"conversations/{cid}", body={"conversation": {"status": False}, "category": 5})
        yield fetch("PUT", f"conversations/{cid}", body={"status": "bogus"})
        yield fetch("PUT", f"conversations/{cid}", body={"status": 3.5})
        yield fetch("PUT", f"conversations/{cid}", body={"tag_list": 5})
        yield fetch("PUT", f"conversations/{cid}", body={"assignee": {"name": "no email"}, "brand": 3})
        yield fetch("PUT", f"conversations/{cid}", body={"conversation": "bad"})
        yield fetch("PUT", f"conversations/{cid}", body={"conversation_id": "x"})
        yield fetch("PUT", f"conversations/{cid}", body={})
        yield fetch("POST", f"conversations/{cid}/messages", body={"message": {"body": "Staff reply", "visibility": 1,
                                                                                "user": {"email": "s@x.io", "name": "S"}}})
        yield fetch("POST", f"conversations/{cid}/messages", body={"body": "flat body", "message": {"visibility": True}})
        yield fetch("POST", f"conversations/{cid}/messages", body={"message": {"body": "", "visibility": 0}, "body": ""})
        yield fetch("POST", f"conversations/{cid}/messages", body={"message": {"body": 5}})
        yield fetch("POST", f"conversations/{cid}/messages", body={"message": "str"})
        yield fetch("POST", f"conversations/{cid}/messages", body={"conversation_id": "x"})
    yield fetch("PUT", "conversations/nope", body={"status": 1})
    yield fetch("POST", "conversations/nope/messages", body={"body": "x"})
    yield fetch("POST", "contacts", body={"contact": {"email": "New@Contact.io", "name": "New", "phone": "1", "external_id": "e1"}})
    yield fetch("POST", "contacts", body={"email": "new@contact.io"})
    yield fetch("POST", "contacts", body={"email": "flat@x.io", "name": "Flat", "notes": "n"})
    yield fetch("POST", "contacts", body={"contact": {"name": "No email"}, "email": "fallback@x.io"})
    yield fetch("POST", "contacts", body={"contact": {"email": None}})
    yield fetch("POST", "contacts", body={"contact": "str", "email": 5})
    yield fetch("POST", "contacts", body={"email": "p@x.io", "phone": 5})
    if contacts and contacts[0].get("email"):
        yield fetch("POST", "contacts", body={"email": contacts[0]["email"].upper()})
    yield fetch("POST", "contacts", body={})
    yield fetch("GET", "contacts")
    yield fetch("GET", "conversations")
    # The filters again, over the conversations made above.
    for params in [{"filter": "pending"}, {"filter": "Archived"}, {"tag": "DONE"}, {"tag": "single"}, {"category": "RET"},
                   {"category": "ship"}, {"for": "buyer@x.io"}, {"category": 5}, {"for": 5}, {"tag": "vip", "filter": "resolved"}]:
        yield fetch("GET", "conversations", params)
    yield fetch("DELETE", "contacts")
