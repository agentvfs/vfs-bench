"""Facebook Pages calls: every route of tools/api/routes/facebook_pages.py,
with the task's seeded pages, posts and photos that later reads see, and
error cases."""
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


def calls(world, last):
    pages = [p["id"] for p in world["facebook_pages"].get("pages", [])
             ] or ["page_none"]
    yield fetch("GET", "me/accounts")
    yield fetch("GET", "me/accounts", {"fields": "id,name"})
    yield fetch("GET", "me/accounts", "[1]")
    for page in pages[:2]:
        yield fetch("GET", f"{page}/feed")
        yield fetch("POST",
                    f"{page}/feed",
                    body={
                        "message": "Launch day!",
                        "link": "https://x.io",
                        "published": True
                    })
        yield fetch("POST",
                    f"{page}/feed",
                    body={
                        "message": "",
                        "tags": "a,b"
                    })
        yield fetch("POST", f"{page}/feed", body={})
        yield fetch("POST",
                    f"{page}/photos",
                    body={
                        "url": "https://img/1.png",
                        "caption": "Team photo"
                    })
        yield fetch("POST",
                    f"{page}/photos",
                    body={
                        "source": "https://img/2.png",
                        "caption": None,
                        "no_story": True
                    })
        yield fetch("POST", f"{page}/photos", body={"url": "", "source": ""})
        yield fetch("GET", f"{page}/feed")
        yield fetch("GET", f"{page}/feed", {"limit": 1})
        yield fetch("GET", f"{page}/feed", {"limit": 0})
        yield fetch("GET", f"{page}/feed", {"limit": -1})
        yield fetch("GET", f"{page}/feed", {"limit": True})
        yield fetch("GET", f"{page}/feed", {"limit": "2"})
        yield fetch("GET", f"{page}/feed", {"limit": 1.5})
    page = pages[0]
    yield fetch("POST", "unknown_page/feed", body={"message": "x"})
    yield fetch("POST", "unknown_page/photos", body={"url": "x"})
    yield fetch("GET", "unknown_page/feed")
    # Bad values the models refuse, and calls Python cannot bind.
    yield fetch("POST", f"{page}/feed", body={"message": 5})
    yield fetch("POST", f"{page}/feed", body={"message": "ok", "link": ["x"]})
    yield fetch("POST", f"{page}/photos", body={"caption": 3})
    yield fetch("POST", f"{page}/photos", body={"url": {"u": 1}})
    yield fetch("POST", f"{page}/feed", body={"pageId": "dup"})
    yield fetch("POST", f"{page}/feed", body={"world": 1})
    yield fetch("POST", f"{page}/feed", body="[1]")
    yield fetch("GET", f"{page}/feed", {"pageId": "dup"})
    yield fetch("POST", f"{page}/photos", body='"x"')
    yield fetch("DELETE", f"{page}/feed")
    yield fetch("GET", f"{page}/posts")
    yield fetch("GET",
                f"{page}/feed",
                base="https://graph.facebook.com/v17.0/")
    yield fetch("POST",
                f"{page}/feed",
                base="https://graph.facebook.com/",
                body={"message": "no version"})
    yield fetch("GET", f"{page}/feed")
