"""Canva calls: every route of tools/api/routes/canva.py, with the task's
seeded designs, designs, exports and uploads that later reads see, and
error cases."""
import json

KNOWN = {}

BASE = "https://api.canva.com/rest/v1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def jid(reply):
    return reply.get("job", {}).get("id") if isinstance(reply, dict) else None


def calls(world, last):
    designs = world["canva"].get("designs", [])
    yield fetch("GET", "designs")
    for q in ["q1", "Q1", "*", "", "zzz", "Banner"]:
        yield fetch("GET", "designs", {"query": q})
    yield fetch("GET", "designs", {"query": "q", "limit": 2})
    yield fetch("GET", "designs", {"limit": "1"})
    yield fetch("GET", "designs", {"limit": 0})
    yield fetch("GET", "designs", {"limit": -2})
    yield fetch("GET", "designs", {"limit": 1.9})
    yield fetch("GET", "designs", {"limit": "x"})
    yield fetch("GET", "designs", {"limit": None})
    yield fetch("GET", "designs", {"query": 5})
    yield fetch("GET", "designs", {"query": 0})
    yield fetch("GET", "designs", {
        "ownership": "owned",
        "sort_by": "title",
        "continuation": "c"
    })
    for d in designs[:3]:
        yield fetch("GET", f"designs/{d['id']}")
    yield fetch("GET", "designs/DAGnope")
    # Designs.
    yield fetch("POST",
                "designs",
                body={
                    "design_type": {
                        "type": "preset",
                        "name": "instagram_post"
                    },
                    "title": "Milestone"
                })
    new = last()
    new_id = new.get("design", {}).get("id") if isinstance(new, dict) else None
    yield fetch(
        "POST",
        "designs",
        body={"design_type": {
            "type": "custom",
            "name": "they're_1st"
        }})
    yield fetch("POST", "designs", body={"design_type": {"type": "preset"}})
    yield fetch("POST", "designs", body={})
    yield fetch("POST",
                "designs",
                body={
                    "design_type": {
                        "name": ""
                    },
                    "title": ""
                })
    yield fetch("POST", "designs", body={"design_type": {"type": "weird"}})
    yield fetch("POST", "designs", body={"design_type": "poster"})
    yield fetch("POST", "designs", body={"design_type": {"name": 5}})
    yield fetch("POST", "designs", body={"design_type": {"name": 0}})
    yield fetch("POST", "designs", body={"title": 7})
    yield fetch("POST",
                "designs",
                body={
                    "asset_id": "asset_x",
                    "title": "With asset",
                    "extra": True
                })
    if new_id:
        yield fetch("GET", f"designs/{new_id}")
    yield fetch("GET", "designs", {"query": "untitled"})
    # Exports.
    target = new_id or (designs[0]["id"] if designs else "DAGnone")
    for fmt in [{
            "type": "png"
    }, {
            "type": "pdf",
            "size": "a4"
    }, {}, None, "jpg", {
            "type": "mp4",
            "quality": "horizontal_1080p"
    }, {
            "type": "svg"
    }, {
            "type": 3
    }, {
            "type": None
    }, {
            "type": ["png"]
    }, {
            "type": {
                "a": 1
            }
    }]:
        yield fetch("POST",
                    "exports",
                    body={
                        "design_id": target,
                        "format": fmt
                    })
    exp = None
    yield fetch("POST",
                "exports",
                body={
                    "design_id": target,
                    "format": {
                        "type": "gif"
                    }
                })
    exp = jid(last())
    yield fetch("POST", "exports", body={})
    yield fetch("POST",
                "exports",
                body={
                    "design_id": 5,
                    "format": {
                        "type": "png"
                    }
                })
    if exp:
        yield fetch("GET", f"exports/{exp}")
    yield fetch("GET", "exports/000000000")
    # Uploads.
    yield fetch("POST",
                "asset-uploads",
                body={
                    "name": "Logo final",
                    "url": "https://x/logo.png",
                    "tags": ["a"]
                })
    up = jid(last())
    yield fetch("POST", "asset-uploads", body={})
    yield fetch("POST", "asset-uploads", body={"name": "x" * 80})
    yield fetch("POST",
                "url-asset-uploads",
                body={
                    "url": "https://x/hero.png",
                    "name": "Hero"
                })
    up2 = jid(last())
    yield fetch("POST", "url-asset-uploads", body={"url": "https://x/a.png"})
    for bad in [5, None, True, 1.5, {"a": 1}, ["a", "b"], ""]:
        yield fetch("POST", "asset-uploads", body={"name": bad})
    for j in [up, up2]:
        if j:
            yield fetch("GET", f"asset-uploads/{j}")
            yield fetch("GET", f"url-asset-uploads/{j}")
    yield fetch("GET", "asset-uploads/000")
    yield fetch("GET", "url-asset-uploads/000")
    # Calls Python cannot bind, and routes that are not there.
    yield fetch("POST", "designs", body={"world": 1})
    yield fetch("POST", "designs", body="[1]")
    yield fetch("GET", "designs", "[1]")
    yield fetch("POST", "exports", body='"x"')
    yield fetch("DELETE", "designs/x")
    yield fetch("GET", "folders")
    yield fetch("GET", "designs")
