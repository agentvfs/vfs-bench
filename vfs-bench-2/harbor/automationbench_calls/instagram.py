"""Instagram calls: every route of tools/api/routes/instagram.py (media
containers of every kind, publish, reads by id with and without
``status_code``), and error cases."""
import json

KNOWN = {}

BASE = "https://graph.facebook.com/v25.0/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def mid(reply):
    return reply.get("id") if isinstance(reply, dict) else None


def calls(world, last):
    acct = "17841400000000001"
    made = []
    bodies = [
        {
            "image_url": "https://cdn/x.jpg",
            "caption": "Approved asset #launch",
            "user_tags": [{
                "username": "alice"
            }, {}]
        },
        {
            "video_url": "https://cdn/v.mp4",
            "caption": "Reel",
            "media_type": "REELS"
        },
        {
            "media_type": "VIDEO"
        },
        {
            "media_type": "STORIES",
            "video_url": None,
            "image_url": "https://cdn/s.jpg"
        },
        {
            "media_type": "STORIES"
        },
        {
            "media_type": "CAROUSEL",
            "children": ["1", "2", "3"],
            "caption": "Carousel"
        },
        {
            "media_type": "CAROUSEL",
            "children": []
        },
        {
            "media_type": "CAROUSEL",
            "children": "abc"
        },
        {
            "media": ["https://cdn/a.jpg", "https://cdn/b.jpg"]
        },
        {
            "media": ["https://cdn/only.jpg"],
            "location_id": "loc1"
        },
        {
            "media": "xy"
        },
        {
            "photo": "https://cdn/p.jpg",
            "alt_text": "alt",
            "share_to_feed": True
        },
        {},
        {
            "caption": None,
            "image_url": ""
        },
    ]
    for body in bodies:
        yield fetch("POST", f"{acct}/media", body=body)
        made.append(mid(last()))
    # Values Python or the model refuses.
    for body in [{
            "user_tags": "alice"
    }, {
            "user_tags": {
                "username": "a"
            }
    }, {
            "user_tags": 5
    }, {
            "user_tags": [{
                "username": 3
            }]
    }, {
            "user_tags": ["x"]
    }, {
            "media_type": "CAROUSEL",
            "children": 4
    }, {
            "media": 7
    }, {
            "media": {
                "a": 1
            }
    }, {
            "media": {
                "0": "https://cdn/k.jpg"
            }
    }, {
            "media": [5]
    }, {
            "caption": 9
    }, {
            "video_url": 3
    }, {
            "image_url": ["x"]
    }, {
            "location_id": 1
    }, {
            "media_type": "CAROUSEL",
            "children": True
    }, {
            "user_tags": [],
            "media": True
    }]:
        yield fetch("POST", f"{acct}/media", body=body)
    for m in made:
        if m:
            yield fetch("POST",
                        f"{acct}/media_publish",
                        body={"creation_id": m})
            yield fetch("GET", m)
            yield fetch("GET", m, {"fields": "id,status_code"})
            yield fetch("GET", m, {"fields": " status_code , ,"})
    yield fetch("POST", f"{acct}/media_publish", body={"creation_id": "nope"})
    yield fetch("POST", f"{acct}/media_publish", body={})
    yield fetch("POST", f"{acct}/media_publish", body={"creation_id": 5})
    yield fetch("GET", "nope", {"fields": "status_code"})
    yield fetch("GET", "nope")
    yield fetch("GET", "nope", {"fields": 5})
    yield fetch("GET", "nope", {"fields": None})
    yield fetch("GET", "nope", "[1]")
    yield fetch("GET", "nope", {"obj_id": "x", "other": 1})
    # Calls Python cannot bind, and routes that are not there.
    yield fetch("POST", f"{acct}/media", body={"account_id": "dup"})
    yield fetch("POST", f"{acct}/media", body={"world": 1})
    yield fetch("POST", f"{acct}/media", body="[1]")
    yield fetch("POST", f"{acct}/media_publish", body={"account_id": "dup"})
    yield fetch("DELETE", "nope")
    yield fetch("POST", "nope")
    yield fetch("GET", "nope", base="https://graph.facebook.com/v17.0/")
    yield fetch("GET", "nope", base="https://graph.facebook.com/")
