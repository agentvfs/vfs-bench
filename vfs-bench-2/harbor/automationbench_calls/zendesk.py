"""Zendesk calls: every route of tools/api/routes/zendesk.py, with the task's
seeded tickets, users, organizations and groups, writes that later reads see,
and error cases (unknown ids, bad literals, wrong types, non-dict bodies)."""
import json

KNOWN = {}

BASE = "https://acme.zendesk.com/api/v2/"


def fetch(method, path, params=None, body=None):
    args = {"method": method, "url": BASE + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    zd = world["zendesk"]
    tickets, users = zd.get("tickets", []), zd.get("users", [])
    orgs, groups = zd.get("organizations", []), zd.get("groups", [])
    for path in ["tickets", "users", "organizations", "groups"]:
        yield fetch("GET", path)
    for t in tickets[:4]:
        yield fetch("GET", f"tickets/{t['id']}")
        yield fetch("GET", f"tickets/{t['id']}/comments")
        words = (t.get("subject") or "x").split()
        yield fetch("GET", "search", {"query": words[0]})
        yield fetch("GET", "search", {"query": f"status:{t.get('status')} {words[-1].upper()}"})
        yield fetch("GET", "search", {"query": f"type:ticket priority:{t.get('priority') or 'none'}"})
        if t.get("tags"):
            yield fetch("GET", "search", {"query": f"tags:{t['tags'][0].upper()}"})
        if t.get("group_id"):
            yield fetch("GET", "search", {"query": f"group_id:{t['group_id']}"})
        if t.get("assignee_id"):
            yield fetch("GET", "search", {"query": f"assignee_id:{t['assignee_id']} status:open"})
        yield fetch("GET", "search", {"ticket_id": t["id"]})
    for u in users[:4]:
        yield fetch("GET", f"users/{u['id']}")
        yield fetch("GET", "users/search", {"query": (u.get("name") or "a")[:4]})
        yield fetch("GET", "users/search", {"query": f"name:{u.get('name') or 'a'}"})
        yield fetch("GET", "users/search", {"user_id": u["id"]})
        if u.get("email"):
            yield fetch("GET", "users/search", {"email": u["email"].upper()})
            yield fetch("GET", "users/search", {"query": f"email:{u['email']}"})
            yield fetch("POST", "users", body={"user": {"name": "Dup", "email": u["email"]}})
    for o in orgs[:3]:
        yield fetch("GET", f"organizations/{o['id']}")
        yield fetch("GET", "organizations/search", {"query": o["name"][:4].lower()})
        yield fetch("GET", "organizations/search", {"organization_id": o["id"]})
        yield fetch("POST", "organizations", body={"organization": {"name": o["name"].upper()}})
    for g in groups[:3]:
        yield fetch("GET", f"groups/{g['id']}")
    yield fetch("GET", "search", {"query": "zzzz-none"})
    yield fetch("GET", "search")
    yield fetch("GET", "search", {"query": "status:new"})
    yield fetch("GET", "search", {"query": "nonsense:yes billing"})
    yield fetch("GET", "search", {"query": 5})
    yield fetch("GET", "search", {"ticket_id": 123})
    yield fetch("GET", "search", "[1]")
    yield fetch("GET", "search", {"world": 1})
    yield fetch("GET", "users/search")
    yield fetch("GET", "users/search", {"email": 7})
    yield fetch("GET", "users/search", {"query": ["a"]})
    yield fetch("GET", "users/search", {"query": "  email:Nobody@x.io"})
    yield fetch("GET", "organizations/search")
    yield fetch("GET", "organizations/search", {"query": 3})
    for path in ["tickets/999", "tickets/999/comments", "users/999", "organizations/999", "groups/999"]:
        yield fetch("GET", path)

    # Writes.
    yield fetch("POST", "tickets", body={"ticket": {"subject": "Printer on fire", "description": "Smoke",
                                                    "priority": "urgent", "type": "incident",
                                                    "requester_email": "new.person@example.com",
                                                    "tags": ["urgent", " hardware ", ""]}})
    new = last().get("ticket", {}).get("id")
    yield fetch("POST", "tickets", body={"subject": "Flat", "tags": "a, b,,c", "requester_name": "Named",
                                         "requester_email": "named@example.com", "status": "open"})
    yield fetch("POST", "tickets", body={"ticket": {"subject": "No desc", "tags": {"x": 1, "y": 2}}})
    yield fetch("POST", "tickets", body={"ticket": {"subject": "Bad", "status": "weird"}})
    yield fetch("POST", "tickets", body={"ticket": {"subject": "Bad", "priority": "urgentish"}})
    yield fetch("POST", "tickets", body={"ticket": {"subject": None}})
    yield fetch("POST", "tickets", body={"ticket": {"subject": "Tags", "tags": [1, 2]}})
    yield fetch("POST", "tickets", body={"ticket": {"subject": "Tags", "tags": 7}})
    yield fetch("POST", "tickets", body={"ticket": {"subject": "Req", "requester_email": 5}})
    yield fetch("POST", "tickets", body={"ticket": {"subject": "Desc", "description": 5}})
    yield fetch("POST", "tickets", body=[1, 2])
    yield fetch("POST", "tickets", body={"ticket": "x"})
    yield fetch("GET", "tickets")
    if new:
        yield fetch("GET", f"tickets/{new}/comments")
        yield fetch("PUT", f"tickets/{new}", body={"ticket": {"status": "pending", "comment": {"body": "On it", "public": False}}})
        yield fetch("PATCH", f"tickets/{new}", body={"comment": "Plain comment", "comment_public": False, "tags": ["p", "q"]})
        yield fetch("PUT", f"tickets/{new}/tags", body={"tags": ["extra", "p"]})
        yield fetch("PUT", f"tickets/{new}/tags", body={"tags": "more, extra"})
        yield fetch("DELETE", f"tickets/{new}/tags", body={"tags": ["p"]})
        yield fetch("DELETE", f"tickets/{new}/tags", body={"tags": 5})
        yield fetch("GET", f"tickets/{new}/comments")
    for t in tickets[:3]:
        yield fetch("PUT", f"tickets/{t['id']}", body={"ticket": {"status": "solved", "priority": "low", "type": "question",
                                                                  "assignee_id": "agent_1", "group_id": "g1",
                                                                  "organization_id": "o1", "subject": t["subject"] + "!"}})
        yield fetch("PUT", f"tickets/{t['id']}", body={"status": "nope"})
        yield fetch("PUT", f"tickets/{t['id']}", body={"ticket": {"tags": ""}})
        yield fetch("PUT", f"tickets/{t['id']}", body={"ticket": {"tags": 3}})
        yield fetch("PUT", f"tickets/{t['id']}", body={"ticket": {"comment": ["x"]}})
        yield fetch("PUT", f"tickets/{t['id']}/tags", body={"tags": ["vip"]})
        yield fetch("PUT", f"tickets/{t['id']}/tags", body="[1]")
        yield fetch("GET", f"tickets/{t['id']}")
    yield fetch("PUT", "tickets/999", body={"status": "open"})
    yield fetch("PUT", "tickets/999/tags", body={"tags": ["a"]})
    yield fetch("DELETE", "tickets/999/tags", body={"tags": ["a"]})
    yield fetch("GET", "search", {"query": "tags:vip status:solved"})

    yield fetch("POST", "users", body={"user": {"name": "Ann Lee", "email": "ann@example.com", "role": "agent",
                                                "tags": ["a", "b"], "verified": True, "phone": "123"}})
    uid = last().get("user", {}).get("id")
    yield fetch("POST", "users", body={"name": "Flat User", "tags": "x,y"})
    yield fetch("POST", "users", body={"user": {"name": "Bad", "role": "boss"}})
    yield fetch("POST", "users", body={"user": {"name": "Bad", "tags": {"a": 1}}})
    yield fetch("POST", "users", body={"user": {"email": 5}})
    yield fetch("POST", "users", body={"user": {"name": 5}})
    yield fetch("POST", "users/create_or_update", body={"user": {"email": "ann@example.com", "name": "Ann B", "phone": "9",
                                                                 "role": "admin", "organization_id": "o9"}})
    yield fetch("POST", "users/create_or_update", body={"user": {"email": "fresh@example.com"}})
    yield fetch("POST", "users/create_or_update", body={"user": {"email": "fresh2@example.com", "role": None}})
    yield fetch("POST", "users/create_or_update", body={"name": "x"})
    yield fetch("POST", "users/create_or_update", body={"email": None})
    if uid:
        yield fetch("PUT", f"users/{uid}", body={"user": {"name": "Ann C", "notes": "n", "details": "d", "tags": ["z"],
                                                          "verified": False, "organization_id": "o2"}})
        yield fetch("PATCH", f"users/{uid}", body={"role": "nope"})
        yield fetch("PATCH", f"users/{uid}", body={"tags": "q, r"})
        yield fetch("DELETE", f"users/{uid}")
        yield fetch("GET", f"users/{uid}")
    for u in users[:2]:
        yield fetch("PUT", f"users/{u['id']}", body={"user": {"phone": "555", "email": "changed@example.com"}})
    yield fetch("PUT", "users/999", body={"name": "x"})
    yield fetch("DELETE", "users/999")

    yield fetch("POST", "organizations", body={"organization": {"name": "NewCo", "domain_names": ["newco.com", "nc.io"],
                                                                "tags": ["t1"], "shared_tickets": True,
                                                                "details": "d", "group_id": "g", "external_id": "e"}})
    oid = last().get("organization", {}).get("id")
    yield fetch("POST", "organizations", body={"name": "FlatCo", "domain_names": "a.com, b.com", "tags": "x"})
    yield fetch("POST", "organizations", body={"organization": {"name": None}})
    yield fetch("POST", "organizations", body={"organization": {"name": "BadDom", "domain_names": 5}})
    yield fetch("POST", "organizations/create_or_update", body={"organization": {"name": "newco", "domain_names": ["z.com"],
                                                                                 "notes": "n", "details": "dd"}})
    yield fetch("POST", "organizations/create_or_update", body={"organization": {"name": "Brand New", "domain_names": "q.com"}})
    yield fetch("POST", "organizations/create_or_update", body={"organization": {"name": 7}})
    if oid:
        yield fetch("PUT", f"organizations/{oid}", body={"organization": {"name": "NewCo 2", "domain_names": "", "tags": ["u"],
                                                                         "shared_comments": True, "notes": "x"}})
        yield fetch("PATCH", f"organizations/{oid}", body={"domain_names": ["d.com"], "shared_tickets": "maybe"})
        yield fetch("GET", f"organizations/{oid}")
    for o in orgs[:2]:
        yield fetch("PATCH", f"organizations/{o['id']}", body={"details": "upd", "tags": "a,b"})
    yield fetch("PUT", "organizations/999", body={"name": "x"})
    yield fetch("GET", "organizations")
    yield fetch("GET", "users")
    yield fetch("GET", "tickets")
    yield fetch("POST", "groups")
    yield fetch("DELETE", "tickets/1")
