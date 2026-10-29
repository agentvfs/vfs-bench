"""HelpCrunch calls: every route of tools/api/routes/helpcrunch.py, with the
task's seeded customers, writes that later reads see, filter and legacy
searches, and error cases (unknown ids, duplicates, odd shapes and types)."""
import json

KNOWN = {}

BASE = "https://api.helpcrunch.com/v1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    customers = world["helpcrunch"].get("customers", [])
    yield fetch("GET", "customers")
    for c in customers[:4]:
        if c.get("email"):
            yield fetch("POST",
                        "customers/search",
                        body={
                            "filter": [{
                                "field": "email",
                                "operator": "=",
                                "value": c["email"].upper()
                            }]
                        })
            yield fetch("POST", "customers/search", body={"email": c["email"]})
            yield fetch("POST",
                        "customers",
                        body={
                            "email": c["email"],
                            "name": "Dup"
                        })
        if c.get("name"):
            yield fetch("POST",
                        "customers/search",
                        body={
                            "filter": [{
                                "field": "name",
                                "operator": "contains",
                                "value": c["name"][:3]
                            }]
                        })
            yield fetch("POST",
                        "customers/search",
                        body={"query": c["name"].split()[0]})
        if c.get("user_id"):
            yield fetch("POST",
                        "customers/search",
                        body={"userId": c["user_id"]})
            yield fetch("POST", "customers", body={"user_id": c["user_id"]})
        if c.get("company"):
            yield fetch("POST",
                        "customers/search",
                        body={
                            "filter": [{
                                "field": "company",
                                "operator": "is",
                                "value": c["company"]
                            }, {
                                "field": "phone",
                                "operator": "!=",
                                "value": "0"
                            }],
                            "comparison":
                            "OR"
                        })
    yield fetch("POST",
                "customers/search",
                body={
                    "filter": [{
                        "field": "email",
                        "operator": "like",
                        "value": "@"
                    }],
                    "limit":
                    2,
                    "offset":
                    1
                })
    yield fetch("POST",
                "customers/search",
                body={
                    "filter": [{
                        "field": "email",
                        "operator": "like",
                        "value": "@"
                    }],
                    "limit":
                    "-1"
                })
    yield fetch("POST",
                "customers/search",
                body={
                    "filter": [{
                        "field": "email",
                        "operator": "weird",
                        "value": 5
                    }, "x", {
                        "field": "unknown"
                    }]
                })
    yield fetch("POST", "customers/search", body={"filter": [], "query": "a"})
    yield fetch("POST",
                "customers/search",
                body={
                    "filter": "email",
                    "query": "com"
                })
    yield fetch("POST",
                "customers/search",
                body={
                    "filter": [{
                        "field": "name",
                        "value": ["x"]
                    }],
                    "comparison": "OR"
                })
    yield fetch("POST",
                "customers/search",
                body={
                    "query": "com",
                    "offset": "1"
                })
    yield fetch("POST",
                "customers/search",
                body={
                    "query": "com",
                    "offset": True,
                    "limit": 1.0
                })
    yield fetch("POST",
                "customers/search",
                body={
                    "query": "com",
                    "offset": None
                })
    yield fetch("POST", "customers/search", body={"query": 5})
    yield fetch("POST",
                "customers/search",
                body={
                    "query": "com",
                    "limit": "x"
                })
    yield fetch("POST",
                "customers/search",
                body={
                    "sort": "name",
                    "order": "desc"
                })
    yield fetch("POST", "customers/search", body={})
    yield fetch("POST", "customers/search", body="[1]")

    yield fetch("POST",
                "customers",
                body={
                    "email": "kim@example.com",
                    "name": "Kim",
                    "userId": "ext-1",
                    "phone": "1",
                    "company": "Acme",
                    "tags": "trial, vip ,"
                })
    new = last().get("id") if isinstance(last(), dict) else "x"
    yield fetch("POST", "customers", body={"name": "No email", "tags": ""})
    yield fetch("POST", "customers", body={"email": "kim@example.com"})
    yield fetch("POST", "customers", body={"userId": "ext-1"})
    yield fetch("POST", "customers", body={"tags": ["a"]})
    yield fetch("POST", "customers", body={"name": 5})
    yield fetch("POST", "customers", body={"custom_data": {"a": 1}})
    yield fetch("POST", "customers", body={})
    targets = [c["id"] for c in customers[:2]] + [new]
    for cid in targets:
        yield fetch("PATCH",
                    f"customers/{cid}",
                    body={
                        "name": "Renamed",
                        "phone": "555",
                        "company": "NewCo"
                    })
        yield fetch("PATCH",
                    f"customers/{cid}",
                    body={"email": "fresh-" + cid[:6] + "@example.com"})
        yield fetch("PATCH",
                    f"customers/{cid}",
                    body={"email": "kim@example.com"})
        yield fetch("PATCH", f"customers/{cid}", body={"email": ""})
        yield fetch("PATCH", f"customers/{cid}", body={"email": 3})
        yield fetch("PATCH", f"customers/{cid}", body={"name": 3})
        yield fetch("PATCH", f"customers/{cid}", body={"customer_id": "x"})
        yield fetch("PUT",
                    f"customers/{cid}/tags",
                    body={
                        "tags": [{
                            "name": "churn-risk",
                            "color": "red"
                        }, "beta", 3, {
                            "color": "x"
                        }]
                    })
        yield fetch("PUT", f"customers/{cid}/tags", body={"tag": "legacy"})
        yield fetch("PUT",
                    f"customers/{cid}/tags",
                    body={
                        "tags": "notalist",
                        "tag": "via-tag"
                    })
        yield fetch("PUT",
                    f"customers/{cid}/tags",
                    body={"tags": [{
                        "name": 7
                    }]})
        yield fetch("PUT", f"customers/{cid}/tags", body={"tags": "notalist"})
        yield fetch("DELETE",
                    f"customers/{cid}/tags",
                    body={"tags": [{
                        "name": "beta"
                    }, "missing"]})
        yield fetch("DELETE", f"customers/{cid}/tags", body={"tag": "legacy"})
        yield fetch("DELETE",
                    f"customers/{cid}/tags",
                    body={"tags": [{
                        "name": 7
                    }]})
        yield fetch("DELETE", f"customers/{cid}/tags", body={})
        yield fetch("POST",
                    "events",
                    body={
                        "customer_id": cid,
                        "event_name": "login",
                        "data": {
                            "plan": "pro",
                            "n": 1.0
                        }
                    })
        yield fetch("POST",
                    "events",
                    body={
                        "customer": cid,
                        "name": "usage",
                        "data": '{"seats": 4}'
                    })
        yield fetch("POST",
                    "events",
                    body={
                        "customer_id": cid,
                        "data": "{bad"
                    })
        yield fetch("POST",
                    "events",
                    body={
                        "customer_id": cid,
                        "data": "[1, 2]"
                    })
        yield fetch("POST", "events", body={"customer_id": cid, "data": [1]})
        yield fetch("POST",
                    "events",
                    body={
                        "customer_id": cid,
                        "event_name": 5
                    })
        yield fetch("POST", "events", body={"customer_id": cid})
    yield fetch("PATCH", "customers/nope", body={"name": "x"})
    yield fetch("PUT", "customers/nope/tags", body={"tag": "x"})
    yield fetch("DELETE", "customers/nope/tags", body={"tag": "x"})
    yield fetch("POST",
                "events",
                body={
                    "customer_id": "nope",
                    "event_name": "x"
                })
    yield fetch("POST", "events", body={})
    yield fetch("POST", "events", body="[1]")
    yield fetch("GET", "customers")
    yield fetch("GET", f"customers/{new}")
    yield fetch("GET", "chats")
