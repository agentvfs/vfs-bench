"""Buffer calls: every route of tools/api/routes/buffer.py, with the task's
seeded channels and posts, post writes (scheduling, drafts, share now,
auto-created channels), and error cases."""
import json

KNOWN = {}

BASE = "https://api.bufferapp.com/1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    state = world["buffer"]
    channels = [c["id"] for c in state.get("channels", [])] or ["ch_none"]
    posts = state.get("posts", [])
    orgs = sorted({p.get("organization_id") for p in posts if p.get("organization_id")})
    yield fetch("GET", "profiles.json")
    yield fetch("GET", "profiles.json", {"extra": 1})
    yield fetch("GET", "profiles.json", {"world": 1})
    yield fetch("GET", "profiles.json", "[1]")
    for c in channels[:3]:
        yield fetch("GET", f"profiles/{c}/updates/sent.json")
    for o in orgs[:2]:
        yield fetch("GET", f"profiles/{o}/updates/sent.json", {"count": 5, "page": 1})
    post_channels = sorted({p.get("channel_id") for p in posts})
    for c in post_channels[:2]:
        yield fetch("GET", f"profiles/{c}/updates/sent.json")
    yield fetch("GET", "profiles/unknown/updates/sent.json")
    yield fetch("GET", f"profiles/{channels[0]}/updates/sent.json", {"profile_id": "dup"})
    yield fetch("GET", f"profiles/{channels[0]}/updates/sent.json", '"x"')
    yield fetch("POST", "updates/create.json", body={"profile_ids": channels[:2], "text": "Launch day! #news"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Scheduled", "scheduled_at": "2026-03-10T15:00:00Z"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Scheduled naive", "scheduled_at": "2026-03-10 15:30:45.123"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Offset", "scheduled_at": "2026-03-10T15:00:00-05:00", "method": "schedule"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Bad date", "scheduled_at": "next tuesday"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Int date", "scheduled_at": 1773000000})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Now", "now": True})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Now str", "now": "true"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Top", "top": True})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Top draft", "top": True, "method": "draft"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Draft", "method": "schedule_draft"})
    yield fetch("POST", "updates/create.json", body={"channel_id": channels[-1], "text": "By channel id"})
    yield fetch("POST", "updates/create.json", body={"profile_id": "ch_new_one", "text": "Auto channel"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [], "text": "Empty ids"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": "ch_str", "text": "String ids"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": "Bad method", "method": "blast"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [5], "text": "Int channel"})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": 42})
    yield fetch("POST", "updates/create.json", body={"profile_ids": [channels[0]], "text": None, "media": {"link": "x"}, "shorten": True})
    yield fetch("POST", "updates/create.json", body={})
    yield fetch("POST", "updates/create.json", body={"world": 1})
    yield fetch("POST", "updates/create.json", body="[1]")
    for c in channels[:2]:
        yield fetch("GET", f"profiles/{c}/updates/sent.json")
    yield fetch("GET", "profiles/ch_new_one/updates/sent.json")
    yield fetch("GET", "profiles.json")
    yield fetch("POST", "profiles.json")
    yield fetch("GET", "updates/create.json")
    yield fetch("POST", "buffer/1/updates/create.json", body={"profile_ids": ["bare"], "text": "x"}, base="")
