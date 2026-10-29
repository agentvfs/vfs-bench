"""Help Scout calls: every route of tools/api/routes/helpscout.py, with the
task's seeded mailboxes, customers, conversations and users, writes that
later reads see, and error cases (unknown ids, bad status, odd tag, thread
and customer shapes, wrong types, clashing arguments)."""
import json

KNOWN = {}

BASE = "https://api.helpscout.net/v2/"


def fetch(method, path, params=None, body=None):
    args = {"method": method, "url": BASE + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    hs = world["helpscout"]
    convs, customers = hs.get("conversations", []), hs.get("customers", [])
    mailboxes, users = hs.get("mailboxes", []), hs.get("users", [])
    yield fetch("GET", "mailboxes")
    for m in mailboxes[:2]:
        yield fetch("GET", f"mailboxes/{m['id']}")
    yield fetch("GET", "mailboxes/nope")
    yield fetch("GET", "users")
    for u in users[:2]:
        yield fetch("GET", "users", {"email": (u.get("email") or "x").upper()})
    yield fetch("GET", "users", {"email": "nobody@x.io"})
    yield fetch("GET", "users", {"email": 3})
    yield fetch("GET", "customers")
    for c in customers[:2]:
        yield fetch("GET", f"customers/{c['id']}")
        yield fetch("GET", "customers", {"email": c.get("email") or "q@x.io"})
        if c.get("first_name"):
            yield fetch("GET", "customers", {"query": c["first_name"][:3].upper()})
    yield fetch("GET", "customers", {"query": "co"})
    yield fetch("GET", "customers", {"query": "zzzz"})
    yield fetch("GET", "customers", {"query": 5})
    yield fetch("GET", "customers", {"email": ""})
    yield fetch("GET", "customers/nope")
    yield fetch("GET", "customers", {"world": 1})
    yield fetch("GET", "customers", "[1]")
    yield fetch("POST", "customers", body={"email": "New.Person@example.com", "firstName": "New", "first_name": "Ignored",
                                           "last_name": "Person", "phone": "555", "jobTitle": "CTO", "extra": 1})
    new_cust = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("POST", "customers", body={"email": "new.person@example.com"})
    yield fetch("POST", "customers", body={"email": 5})
    yield fetch("POST", "customers", body={"email": None})
    yield fetch("POST", "customers", body={"email": "p@x.io", "phone": 5})
    yield fetch("POST", "customers", body={})
    yield fetch("POST", "customers:findOrCreate", body={"email": "NEW.person@example.com"})
    yield fetch("POST", "customers:findOrCreate", body={"email": "fresh@example.com", "first_name": "Fresh", "organization": "Org"})
    yield fetch("POST", "customers:findOrCreate", body={"email": "f2@example.com", "firstName": "x"})
    yield fetch("POST", "customers:findOrCreate", body={"email": []})
    for cid in [c["id"] for c in customers[:2]] + [new_cust]:
        yield fetch("PATCH", f"customers/{cid}", body={"firstName": "Renamed", "lastName": "", "job_title": "VP",
                                                       "background": "bg", "location": "NYC", "phone": None})
        yield fetch("GET", f"customers/{cid}")
        yield fetch("PATCH", f"customers/{cid}", body={"background": "", "location": ""})
        yield fetch("PATCH", f"customers/{cid}", body={"organization": 7})
        yield fetch("PATCH", f"customers/{cid}", body={"customer_id": "z"})
    yield fetch("PATCH", "customers/nope", body={"firstName": "A"})
    yield fetch("GET", "conversations")
    for status in ["active", "closed", "pending", "all", "spam", "", 3]:
        yield fetch("GET", "conversations", {"status": status})
    cust_email = customers[0]["email"] if customers and customers[0].get("email") else "known@example.com"
    mb = mailboxes[0]["id"] if mailboxes else "mb1"
    yield fetch("POST", "conversations", body={
        "subject": "Need help", "customer": {"email": "Brand.New@x.io", "firstName": "Brand", "phone": "1"},
        "mailboxId": 42, "type": "email", "status": "pending", "tags": ["billing", " vip ", "", 3],
        "threads": [{"type": "customer", "text": "Hello"}, {"body": "Second"}, "skip", {"type": "note", "text": "", "body": "b"}],
        "assignTo": 7})
    new_conv = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("POST", "conversations", body={"subject": "Known", "customer_email": cust_email, "mailbox_id": mb,
                                               "body": "Plain body", "tags": "a, b,,c"})
    yield fetch("POST", "conversations", body={"subject": "Json tags", "customer": {"id": 99, "email": "e@x.io"},
                                               "tags": '["x", " y ", 2]'})
    yield fetch("POST", "conversations", body={"subject": "Json obj tags", "tags": '{"a": 1}', "threads": {"x": 1}, "body": "fallback"})
    yield fetch("POST", "conversations", body={"subject": "Bad json tags", "tags": "[oops", "customer": "str"})
    yield fetch("POST", "conversations", body={"subject": "Int tags", "tags": 5, "threads": []})
    yield fetch("POST", "conversations", body={"subject": "Bad status", "status": "open"})
    yield fetch("POST", "conversations", body={"subject": "Bad thread", "threads": [{"type": "weird", "text": "x"}]})
    yield fetch("POST", "conversations", body={"subject": "Bad thread body", "threads": [{"text": 5}]})
    yield fetch("POST", "conversations", body={"subject": 3})
    yield fetch("POST", "conversations", body={"customer_email": 5})
    yield fetch("POST", "conversations", body={"customer_id": 5, "subject": "x"})
    yield fetch("POST", "conversations", body={"customer": {"id": 0, "email": "zero@x.io"}, "subject": "zero"})
    yield fetch("POST", "conversations", body={})
    yield fetch("POST", "conversations", body="[]")
    for cid in [c["id"] for c in convs[:3]] + [new_conv]:
        yield fetch("PATCH", f"conversations/{cid}", body={"status": "closed", "assignTo": "agent@x.io", "tags": ["done", " "],
                                                           "mailboxId": "mb9"})
        yield fetch("PATCH", f"conversations/{cid}", body={"tags": "t1, t2"})
        yield fetch("PATCH", f"conversations/{cid}", body={"tags": '["j1", 2]', "assigned_to": "z@x.io"})
        yield fetch("PATCH", f"conversations/{cid}", body={"tags": {"k": "v"}})
        yield fetch("PATCH", f"conversations/{cid}", body={"tags": 12})
        yield fetch("PATCH", f"conversations/{cid}", body={"status": "bogus"})
        yield fetch("PATCH", f"conversations/{cid}", body={"mailbox_id": 3})
        yield fetch("POST", f"conversations/{cid}/threads/reply", body={"text": "Thanks!", "customer": {"email": "c@x.io"},
                                                                         "status": "pending", "cc": ["a"], "draft": False})
        yield fetch("POST", f"conversations/{cid}/threads/reply", body={"body": "Body only", "author_email": "me@x.io"})
        yield fetch("POST", f"conversations/{cid}/threads/reply", body={"text": 5})
        yield fetch("POST", f"conversations/{cid}/threads/reply", body={"status": "nope", "text": "x"})
        uid = users[0]["id"] if users else "1"
        yield fetch("POST", f"conversations/{cid}/threads/note", body={"text": "Internal", "user": uid})
        yield fetch("POST", f"conversations/{cid}/threads/note", body={"body": "note2", "user": 123456})
        yield fetch("POST", f"conversations/{cid}/threads/note", body={"text": "n3", "author_email": "a@x.io", "status": "closed"})
        yield fetch("POST", f"conversations/{cid}/threads/note", body={"conversation_id": "x"})
    yield fetch("PATCH", "conversations/nope", body={"status": "closed"})
    yield fetch("POST", "conversations/nope/threads/reply", body={"text": "x"})
    yield fetch("POST", "conversations/nope/threads/note", body={"text": "x"})
    yield fetch("GET", "conversations")
    yield fetch("GET", "customers")
    yield fetch("DELETE", "conversations/x")
    yield fetch("GET", "nothing")
