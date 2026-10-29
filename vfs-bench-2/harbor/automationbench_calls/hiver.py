"""Hiver calls: every route of tools/api/routes/hiver.py, with the task's
seeded inboxes, users and conversations, updates that later reads see, and
error cases (unknown ids, odd status, assignee and tag shapes, wrong types,
clashing arguments)."""
import json

KNOWN = {}

BASE = "https://api2.hiverhq.com/v1/"


def fetch(method, path, params=None, body=None):
    args = {"method": method, "url": BASE + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    hv = world["hiver"]
    convs, inboxes = hv.get("conversations", []), hv.get("shared_mailboxes", [])
    inbox = inboxes[0]["id"] if inboxes else "inbox1"
    yield fetch("GET", "inboxes")
    for i in inboxes[:2]:
        yield fetch("GET", f"inboxes/{i['id']}")
        yield fetch("GET", f"inboxes/{i['id']}/conversations")
    yield fetch("GET", "inboxes/nope")
    yield fetch("GET", f"inboxes/{inbox}/users")
    yield fetch("GET", f"inboxes/{inbox}/conversations", {"limit": 5, "sort_by": "x", "extra": 1})
    yield fetch("GET", f"inboxes/{inbox}/conversations", {"inbox_id": "other"})
    yield fetch("GET", f"inboxes/{inbox}/conversations", "[1]")
    yield fetch("GET", "inboxes/zz/conversations")
    for c in convs[:3]:
        yield fetch("GET", f"inboxes/{inbox}/conversations/{c['id']}", {"ignored": 1})
    yield fetch("GET", f"inboxes/{inbox}/conversations/nope")
    for c in convs[:4]:
        cid = c["id"]
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={
            "status": {"name": "closed"}, "assignee": {"email": "agent@x.io"},
            "tags": {"to_apply": ["vip", "escalated", "vip"], "to_remove": []}})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"tags": {"to_apply": ["new"], "to_remove": ["vip"]}})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"status": "pending", "assignee": "plain@x.io"})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"status": {"x": 1}, "assignee": {}})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"tags": {"to_apply": "ab", "to_remove": "escalated"}})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"tags": {"to_apply": None}})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"tags": {"to_remove": 5}})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"tags": {"to_apply": [{"a": 1}]}})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"tags": ["not", "dict"]})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"status": "bogus"})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"assignee": 5})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={"conversation_id": "x"})
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body="[1]")
        yield fetch("PATCH", f"inboxes/{inbox}/conversations/{cid}", body={})
        yield fetch("GET", f"inboxes/{inbox}/conversations/{cid}")
    yield fetch("PATCH", f"inboxes/{inbox}/conversations/nope", body={"status": "closed"})
    yield fetch("GET", f"inboxes/{inbox}/conversations")
    yield fetch("POST", "inboxes")
    yield fetch("GET", "inboxes/a/b/c")
