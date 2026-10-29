"""Freshdesk calls: every route of tools/api/routes/freshdesk.py, with the
task's seeded tickets, contacts and companies, writes that later reads see,
and error cases (unknown ids, bad status and priority, wrong types)."""
import json

KNOWN = {}

BASE = "https://acme.freshdesk.com/api/v2/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    fd = world["freshdesk"]
    tickets, contacts, companies = fd.get("tickets", []), fd.get(
        "contacts", []), fd.get("companies", [])
    yield fetch("GET", "tickets")
    yield fetch("GET", "contacts")
    yield fetch("GET", "companies")
    for t in tickets[:4]:
        yield fetch("GET", f"tickets/{t['id']}")
        yield fetch("GET", f"tickets/{t['id']}/conversations")
        words = (t.get("subject") or "x").split()
        yield fetch("GET", "search/tickets", {"query": words[0]})
        yield fetch("GET", "search/tickets", {"query": words[-1].upper()})
        yield fetch("GET", "search/tickets", {"ticket_id": t["id"]})
    for c in contacts[:4]:
        yield fetch("GET", f"contacts/{c['id']}")
        if c.get("email"):
            yield fetch("GET", "search/contacts",
                        {"email": c["email"].upper()})
            yield fetch("POST",
                        "contacts",
                        body={
                            "name": "Dup",
                            "email": c["email"]
                        })
        yield fetch("GET", "search/contacts",
                    {"query": (c.get("name") or "a")[:3]})
        yield fetch("GET", "search/contacts", {"contact_id": c["id"]})
    for co in companies[:3]:
        yield fetch("GET", f"companies/{co['id']}")
    yield fetch("GET", "search/tickets", {"query": "zzzz-none"})
    yield fetch("GET", "search/tickets")
    yield fetch("GET", "search/tickets", {"query": 5})
    yield fetch("GET", "search/tickets", {"ticket_id": 123})
    yield fetch("GET", "search/tickets", {"ticket_id": "nope", "extra": 1})
    yield fetch("GET", "search/tickets", "[1]")
    yield fetch("GET", "search/contacts", {"query": "@"})
    yield fetch("GET", "search/contacts", {"email": "nobody@nowhere.io"})
    yield fetch("GET", "search/contacts", {"email": 7})
    yield fetch("GET", "search/contacts")
    yield fetch("GET", "tickets/999")
    yield fetch("GET", "tickets/999/conversations")
    yield fetch("GET", "contacts/999")
    yield fetch("GET", "companies/999")

    # Writes.
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Printer on fire",
                    "description": "Smoke",
                    "status": 2,
                    "priority": 4,
                    "email": "new.person@example.com",
                    "tags": ["urgent", "hardware"],
                    "source": 3
                })
    new = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Again",
                    "email": "NEW.person@example.com",
                    "tags": "a, b,,c",
                    "type": "Incident",
                    "status": "3",
                    "priority": 2.0
                })
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Typed",
                    "ticket_type": "Question",
                    "requester_id": "r1"
                })
    if contacts and contacts[0].get("email"):
        yield fetch("POST",
                    "tickets",
                    body={
                        "subject": "Known",
                        "email": contacts[0]["email"]
                    })
    yield fetch("POST", "tickets", body={"subject": "Bad status", "status": 9})
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Bad priority",
                    "priority": 0,
                    "status": 7
                })
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Str status",
                    "status": "open"
                })
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Float status",
                    "status": "3.0"
                })
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "None status",
                    "status": None
                })
    yield fetch("POST", "tickets", body={"subject": None})
    yield fetch("POST", "tickets", body={"subject": 5, "tags": [1, 2]})
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Tags dict",
                    "tags": {
                        "k": 1
                    }
                })
    yield fetch("POST", "tickets", body={"subject": "Tags int", "tags": 3})
    yield fetch("POST", "tickets", body={"subject": "Email int", "email": 3})
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Source str",
                    "source": "x"
                })
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Bool status",
                    "status": True,
                    "priority": True
                })
    yield fetch("POST", "tickets", body={})
    yield fetch("POST", "tickets", body={"bogus": 1, "subject": "kw"})
    yield fetch("POST", "tickets", body="[1]")
    yield fetch("POST", "tickets", body={"world": 1})
    yield fetch("GET", f"tickets/{new}")

    targets = [t["id"] for t in tickets[:2]] + [new]
    for tid in targets:
        yield fetch("PUT",
                    f"tickets/{tid}",
                    body={
                        "status": 4,
                        "priority": "3",
                        "tags": ["closed-loop"],
                        "responder_id": "agent-7",
                        "group_id": "g1"
                    })
        yield fetch("PATCH",
                    f"tickets/{tid}",
                    body={
                        "subject": "Renamed",
                        "description": "Updated",
                        "type": "Problem",
                        "tags": "x, y"
                    })
        yield fetch("PATCH",
                    f"tickets/{tid}",
                    body={
                        "ticket_type": "Feature",
                        "status": 1
                    })
        yield fetch("PUT",
                    f"tickets/{tid}",
                    body={
                        "priority": 5,
                        "subject": "Partially applied"
                    })
        yield fetch("PUT", f"tickets/{tid}", body={"subject": 3})
        yield fetch("PUT",
                    f"tickets/{tid}",
                    body={
                        "tags": None,
                        "status": None
                    })
        yield fetch("PUT", f"tickets/{tid}", body={"tags": 1})
        yield fetch("PUT", f"tickets/{tid}", body={"ticket_id": "x"})
        yield fetch("PUT", f"tickets/{tid}", body={"extra": "ignored"})
        yield fetch("PUT", f"tickets/{tid}", body="[]")
        yield fetch("POST",
                    f"tickets/{tid}/notes",
                    body={
                        "body": "Internal note",
                        "private": True
                    })
        yield fetch("POST",
                    f"tickets/{tid}/conversations",
                    body={
                        "body": "Public reply",
                        "private": "false"
                    })
        yield fetch("POST", f"tickets/{tid}/notes", body={"body": None})
        yield fetch("POST",
                    f"tickets/{tid}/notes",
                    body={
                        "body": "x",
                        "private": "maybe"
                    })
        yield fetch("POST", f"tickets/{tid}/notes", body={})
        yield fetch("GET", f"tickets/{tid}/conversations")
        yield fetch("GET", f"tickets/{tid}")
    yield fetch("PUT", "tickets/999", body={"status": 4})
    yield fetch("PATCH", "tickets/999", body="[1]")
    yield fetch("POST", "tickets/999/notes", body={"body": "x"})

    yield fetch("POST",
                "contacts",
                body={
                    "name": "Ada Lovelace",
                    "email": "ada@example.com",
                    "phone": "1",
                    "mobile": "2",
                    "company_id": "c1",
                    "job_title": "Eng",
                    "description": "d",
                    "tags": "vip, beta"
                })
    cid = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("GET", f"contacts/{cid}")
    yield fetch("POST", "contacts", body={"name": "No email"})
    yield fetch("POST",
                "contacts",
                body={
                    "name": "List tags",
                    "tags": ["a"],
                    "email": ""
                })
    yield fetch("POST", "contacts", body={"name": None, "email": "x@y.z"})
    yield fetch("POST", "contacts", body={"name": "Bad tags", "tags": [1]})
    yield fetch("POST", "contacts", body={"name": "Phone int", "phone": 5})
    yield fetch("POST", "contacts", body={"email": 1})
    yield fetch("POST", "contacts", body="3")
    yield fetch("GET", "search/contacts", {"query": "ada"})

    yield fetch("POST",
                "companies",
                body={
                    "name": "Acme",
                    "description": "d",
                    "domains": "acme.com, acme.io",
                    "note": "n"
                })
    coid = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("GET", f"companies/{coid}")
    yield fetch("POST",
                "companies",
                body={
                    "name": "Globex",
                    "domains": ["globex.com"]
                })
    yield fetch("POST", "companies", body={"name": "Bad", "domains": [1]})
    yield fetch("POST", "companies", body={"name": None})
    yield fetch("POST", "companies", body={"domains": 3})
    yield fetch("POST", "companies", body={"domain": "x"})

    yield fetch("GET", "tickets")
    yield fetch("GET", "contacts")
    yield fetch("GET", "companies")
    yield fetch("DELETE", f"tickets/{new}")
    yield fetch("GET", "tickets/1/notes")
    yield fetch("POST", "search/tickets")
    yield fetch("GET", "tickets", base="https://other.freshdesk.com/api/v2/")
    yield fetch("GET", "tickets/", base=BASE)
