"""Intercom calls: every route of tools/api/routes/intercom.py, with the
task's seeded contacts, companies and conversations, writes that later reads
see, and error cases (unknown ids, bad literals, wrong types, duplicate
arguments)."""
import json

KNOWN = {}

BASE = "https://api.intercom.io/"


def fetch(method, path, params=None, body=None):
    args = {"method": method, "url": BASE + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    ic = world["intercom"]
    contacts, companies = ic.get("contacts", []), ic.get("companies", [])
    convs = ic.get("conversations", [])
    for path in ["contacts", "companies", "conversations"]:
        yield fetch("GET", path)
    for c in contacts[:4]:
        yield fetch("POST", "contacts/search", body={"contact_id": c["id"]})
        yield fetch("POST", "contacts/search", body={"query": {"field": "id", "operator": "=", "value": c["id"]}})
        if c.get("tags"):
            yield fetch("POST", "contacts/search", body={"contact_id": c["id"], "tag": c["tags"][0]})
            yield fetch("POST", "contacts/search", body={"tag": c["tags"][0]})
            yield fetch("POST", "contacts/search", body={"query": {"field": "tag", "value": c["tags"][0]}})
        yield fetch("POST", "contacts/search", body={"contact_id": c["id"], "tag": "nope"})
        if c.get("email"):
            yield fetch("POST", "contacts/search", body={"email": c["email"].upper()})
            yield fetch("POST", "contacts/search", body={"query": {"field": "email", "value": c["email"]}, "tag": "nope"})
            yield fetch("POST", "contacts", body={"email": c["email"]})
        if c.get("name"):
            yield fetch("POST", "contacts/search", body={"query": c["name"][:3]})
            yield fetch("POST", "contacts/search", body={"query": {"field": "name", "value": c["name"]}})
    for co in companies[:3]:
        yield fetch("POST", "companies/search", body={"company_id": co["id"]})
        yield fetch("POST", "companies/search", body={"query": {"field": "id", "value": co["id"]}})
        yield fetch("POST", "companies/search", body={"name": co["name"].upper()})
        yield fetch("POST", "companies/search", body={"query": {"field": "name", "value": co["name"]}})
        yield fetch("POST", "companies/search", body={"query": co["name"][:3].lower()})
        yield fetch("POST", "companies", body={"name": co["name"].lower()})
    for cv in convs[:3]:
        yield fetch("POST", "conversations/search", body={"conversation_id": cv["id"]})
        if cv.get("title"):
            yield fetch("POST", "conversations/search", body={"query": cv["title"].split()[0]})
    yield fetch("POST", "contacts/search", body={})
    yield fetch("POST", "contacts/search", body={"query": {"field": "custom", "value": 5}})
    yield fetch("POST", "contacts/search", body={"query": {"field": "x", "value": ""}})
    yield fetch("POST", "contacts/search", body={"query": ["a"]})
    yield fetch("POST", "contacts/search", body={"email": 4})
    yield fetch("POST", "contacts/search", body={"contact_id": 4, "extra": 1})
    yield fetch("POST", "contacts/search", body={"tag": ["x"]})
    yield fetch("POST", "contacts/search", body="[1]")
    yield fetch("POST", "companies/search", body={})
    yield fetch("POST", "companies/search", body={"query": {"field": "industry", "value": "Tech"}})
    yield fetch("POST", "companies/search", body={"name": 5})
    yield fetch("POST", "conversations/search", body={})
    yield fetch("POST", "conversations/search", body={"query": 9})
    yield fetch("POST", "conversations/search", body={"conversation_id": "nope"})

    # Writes.
    for c in contacts[:3]:
        cid = c["id"]
        yield fetch("PUT", f"contacts/{cid}", body={"name": "Renamed", "phone": "+1", "custom_attributes": {"tier": 2, "vip": True, "x": None, "l": [1]}})
        yield fetch("PUT", f"contacts/{cid}", body={"email": 5})
        yield fetch("PUT", f"contacts/{cid}", body={"contact_id": "dup"})
        yield fetch("POST", f"contacts/{cid}/tags", body={"id": "tag_high_adoption"})
        yield fetch("POST", f"contacts/{cid}/tags", body={"tag": "plain"})
        yield fetch("POST", f"contacts/{cid}/tags", body={"tag": "plain"})
        yield fetch("POST", f"contacts/{cid}/tags", body={"tag": 5})
        yield fetch("POST", f"contacts/{cid}/tags", body={"tag": ""})
        yield fetch("DELETE", f"contacts/{cid}/tags/tag_high_adoption")
        yield fetch("DELETE", f"contacts/{cid}/tags/plain")
        yield fetch("DELETE", f"contacts/{cid}/tags/absent")
        yield fetch("POST", f"contacts/{cid}/notes", body={"body": "Called them", "admin_id": "adm1"})
        yield fetch("POST", f"contacts/{cid}/notes", body={"body": None})
        yield fetch("POST", f"contacts/{cid}/notes", body={"contact_id": "x"})
    yield fetch("PUT", "contacts/999", body={"name": "x"})
    yield fetch("POST", "contacts/999/tags", body={"tag": "a"})
    yield fetch("DELETE", "contacts/999/tags/a")
    yield fetch("POST", "contacts/999/notes", body={"body": "a"})
    yield fetch("POST", "contacts", body={"email": "lead@example.com", "name": "Lead", "phone": "1"})
    yield fetch("POST", "contacts:findOrCreateLead", body={"email": "LEAD@example.com"})
    yield fetch("POST", "contacts", body={})
    yield fetch("POST", "contacts", body={"email": 3})
    yield fetch("POST", "contacts", body={"email": "n@x.io", "name": 5})
    yield fetch("POST", "companies", body={"name": "Brand New Co", "industry": "Tech", "website": "x.io", "company_id": "ext1"})
    new_co = last().get("id") if isinstance(last(), dict) else None
    yield fetch("POST", "companies", body={"name": 5})
    yield fetch("POST", "companies", body={})
    yield fetch("POST", "tags", body={"name": "vip", "companies": [{"id": new_co}, {"id": "nope"}, new_co, 5]})
    for co in companies[:2]:
        yield fetch("POST", "tags", body={"tag": "key-account", "company_id": co["id"]})
        yield fetch("POST", "tags", body={"name": "vip", "companies": [{"id": co["id"]}]})
    yield fetch("POST", "tags", body={"name": "x", "company_id": "nope"})
    yield fetch("POST", "tags", body={"name": "x"})
    yield fetch("POST", "tags", body={"name": "x", "companies": "notalist", "company_id": new_co})
    yield fetch("POST", "conversations", body={"contact_id": "c1", "body": "Hello", "title": "Need help"})
    conv = last().get("id") if isinstance(last(), dict) else None
    yield fetch("POST", "conversations", body={"title": "Empty"})
    yield fetch("POST", "conversations", body={"contact_id": 5, "body": "x"})
    yield fetch("POST", "conversations", body={"body": 5})
    for cid in ([conv] if conv else []) + [cv["id"] for cv in convs[:2]]:
        yield fetch("POST", f"conversations/{cid}/reply", body={"body": "Reply!", "author_id": "adm"})
        yield fetch("POST", f"conversations/{cid}/parts", body={"body": "Note", "message_type": "note", "admin_id": "adm"})
        yield fetch("POST", f"conversations/{cid}/reply", body={"body": "x", "author_type": "robot"})
        yield fetch("POST", f"conversations/{cid}/reply", body={"type": "admin", "message_type": "comment", "body": "y"})
        yield fetch("POST", f"conversations/{cid}/reply", body={"conversation_id": "z"})
        yield fetch("POST", f"conversations/{cid}/tags", body={"id": "tag_needs_review"})
        yield fetch("POST", f"conversations/{cid}/tags", body={"tag": "urgent"})
        yield fetch("POST", f"conversations/{cid}/tags", body={"tag": ["l"]})
    yield fetch("POST", "conversations/999/reply", body={"body": "x"})
    yield fetch("POST", "conversations/999/reply", body="[1]")
    yield fetch("POST", "conversations/999/tags", body={"tag": "x"})
    yield fetch("POST", "tickets", body={"title": "Broken", "description": "d", "state": "open", "contact_id": "c1",
                                         "assignee_id": "a", "ticket_type_id": "tt"})
    yield fetch("POST", "tickets", body={"title": "Bad", "state": "lost"})
    yield fetch("POST", "tickets", body={"title": None})
    yield fetch("POST", "tickets", body={"contact_id": 5})
    yield fetch("GET", "contacts")
    yield fetch("GET", "companies")
    yield fetch("GET", "conversations")
    yield fetch("GET", "tickets")
    yield fetch("PATCH", "contacts/1")
