"""Gorgias calls: every route of tools/api/routes/gorgias.py, with the
task's seeded tickets, writes that later reads see, and error cases
(unknown ids, bad status, odd tag and message shapes, wrong types)."""
import json

KNOWN = {}

BASE = "https://acme.gorgias.com/api/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    tickets = world["gorgias"].get("tickets", [])
    yield fetch("GET", "tickets")
    yield fetch("GET", "tickets", {"status": "open"})
    yield fetch("POST",
                "tickets",
                body={
                    "subject":
                    "Refund request",
                    "channel":
                    "chat",
                    "via":
                    "api",
                    "customer": {
                        "email": "buyer@example.com",
                        "name": "Buyer"
                    },
                    "messages": [{
                        "body_text": "Please refund",
                        "body_html": "<p>Please refund</p>"
                    }, {
                        "body_text": "Agent reply",
                        "from_agent": True,
                        "channel": "email"
                    }, "skip-me", 3],
                    "tags": [{
                        "name": "refund"
                    }, "vip", 7, {
                        "color": "red"
                    }]
                })
    new = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "Agent default",
                    "from_agent": True,
                    "customer": {
                        "email": "c@x.io"
                    },
                    "messages": [{
                        "body_text": "hi"
                    }]
                })
    yield fetch("POST",
                "tickets",
                body={
                    "subject": "No customer",
                    "messages": [{
                        "body_text": "hello"
                    }],
                    "tags": "ab"
                })
    yield fetch("POST",
                "tickets",
                body={
                    "customer": "not-a-dict",
                    "tags": {
                        "k": 1
                    }
                })
    yield fetch("POST",
                "tickets",
                body={
                    "customer": {},
                    "messages": [],
                    "tags": []
                })
    yield fetch("POST", "tickets", body={"subject": 5})
    yield fetch("POST", "tickets", body={"tags": [{"name": 3}]})
    yield fetch("POST", "tickets", body={"tags": 3})
    yield fetch("POST", "tickets", body={"messages": [{"body_text": 1}]})
    yield fetch("POST", "tickets", body={"customer": {"email": 1}})
    yield fetch("POST", "tickets", body={"channel": None})
    yield fetch("POST", "tickets", body={})
    yield fetch("POST", "tickets", body="[]")
    yield fetch("POST", "tickets", body="[1]")
    targets = [t["id"] for t in tickets[:3]] + [new]
    for tid in targets:
        yield fetch("PUT",
                    f"tickets/{tid}",
                    body={
                        "status": "closed",
                        "tags": [{
                            "name": "done"
                        }, " spaced ", "", 0, 2.5],
                        "subject": "Closed out",
                        "priority": "high"
                    })
        yield fetch("PUT", f"tickets/{tid}", body={"tags": "a, b ,, c"})
        yield fetch("PUT",
                    f"tickets/{tid}",
                    body={
                        "tags": {
                            "x": 1
                        },
                        "status": ""
                    })
        yield fetch("PUT", f"tickets/{tid}", body={"status": "pending"})
        yield fetch("PUT", f"tickets/{tid}", body={"subject": 3})
        yield fetch("PUT", f"tickets/{tid}", body={"tags": [{"name": None}]})
        yield fetch("PUT", f"tickets/{tid}", body={"ticket_id": 1})
        yield fetch("PUT", f"tickets/{tid}", body="[1]")
        yield fetch("POST",
                    f"tickets/{tid}/messages",
                    body={
                        "body_text": "We refunded you",
                        "body_html": "<b>x</b>",
                        "channel": "email",
                        "via": "api",
                        "public": True
                    })
        yield fetch("POST",
                    f"tickets/{tid}/messages",
                    body={
                        "body_text": "Customer says hi",
                        "from_agent": False
                    })
        yield fetch("POST",
                    f"tickets/{tid}/messages",
                    body={
                        "from_agent": "yes",
                        "channel": ""
                    })
        yield fetch("POST", f"tickets/{tid}/messages", body={"body_text": 3})
        yield fetch("POST", f"tickets/{tid}/messages", body={"channel": 5})
        yield fetch("POST", f"tickets/{tid}/messages", body={})
    yield fetch("PUT", "tickets/nope", body={"status": "closed"})
    yield fetch("POST", "tickets/nope/messages", body={"body_text": "x"})
    yield fetch("GET", "tickets")
    yield fetch("GET", f"tickets/{new}")
    yield fetch("DELETE", f"tickets/{new}")
    yield fetch("GET", "tickets", base="https://api.gorgias.com/api/")
    yield fetch("GET", "customers")
