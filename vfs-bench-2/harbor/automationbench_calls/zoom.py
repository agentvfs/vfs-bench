"""Zoom calls: every route of tools/api/routes/zoom.py, with the task's
meetings, webinars, registrants, participants and recordings (int and str
ids alike), writes that later reads see, and error cases."""
import json

KNOWN = {}

BASE = "https://api.zoom.us/v2/"


def req(method, path, params=None, body=None):
    args = {"method": method, "url": BASE + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    z = world["zoom"]
    meetings = z.get("meetings", [])
    webinars = z.get("webinars", [])
    regs = z.get("registrants", [])
    parts = z.get("participants", [])
    recs = z.get("recordings", [])
    ids = [m["id"] for m in meetings[:4]] + [m["id"] for m in webinars[:2]]
    ids += [r["meeting_id"] for r in regs[:2]] + [p["meeting_id"] for p in parts[:2]]
    ids += [m["uuid"] for m in meetings[:1]] + ["999", "nope", "0" + str(ids[0]) if ids else "0"]

    yield req("GET", "users/me/meetings")
    yield req("GET", "users/me/meetings", {"page_size": 3})
    yield req("GET", "users/x/meetings", {"page_size": "2", "type": "scheduled"})
    yield req("GET", "users/me/meetings", {"page_size": -1})
    yield req("GET", "users/me/meetings", {"page_size": "x"})
    yield req("GET", "users/me/meetings", {"page_size": None})
    yield req("GET", "users/me/meetings", {"page_size": 2.9})
    yield req("GET", "users/me/meetings", "[1]")
    yield req("GET", "users/me/recordings")
    yield req("GET", "users/me/recordings", {"topic": "demo", "page_size": 1})
    yield req("GET", "users/me/recordings", {"topic": 5})
    yield req("GET", "users/me/recordings", {"page_size": "0"})
    for i in ids:
        yield req("GET", f"meetings/{i}")
        yield req("GET", f"meetings/{i}/registrants")
        yield req("GET", f"meetings/{i}/registrants", {"status": "approved"})
        yield req("GET", f"meetings/{i}/recordings")
        yield req("GET", f"meetings/{i}/meeting_summary")
    for r in recs[:2]:
        yield req("GET", f"meetings/{r['id']}/recordings")
    yield req("GET", "meetings/None/recordings")
    yield req("GET", "meetings/x/registrants", "[1]")

    # Creates.
    bodies = [
        {"topic": "Kickoff", "type": 2, "start_time": "2026-03-20T15:00:00Z", "duration": 45, "timezone": "UTC",
         "agenda": "plan", "password": "pw1", "settings": {"approval_type": 1, "waiting_room": True}},
        {"topic": "Bare"},
        {},
        {"topic": "Offset", "start_time": "2026-03-21T09:00:00-05:00", "host_email": "h@x.com", "passcode": "pc", "registration_required": True},
        {"topic": "Naive", "start_time": "2026-03-22T09:00:00", "type": "2", "duration": "30", "approval_type": 2},
        {"topic": "BadType", "type": "x"},
        {"topic": "BadDur", "duration": None},
        {"topic": "BadStart", "start_time": "soon"},
        {"topic": "NumStart", "start_time": 5},
        {"topic": "BadApproval", "approval_type": 5},
        {"topic": "BadSettings", "settings": None},
        {"topic": "SettingsList", "settings": [1]},
        {"topic": 5},
        {"topic": "TzNull", "timezone": None},
        {"topic": "RegStr", "registration_required": "maybe"},
        {"topic": "FloatDur", "duration": 30.7, "type": 1.0},
    ]
    created = []
    for body in bodies:
        yield req("POST", "users/me/meetings", body=body)
        r = last()
        if isinstance(r, dict) and r.get("id"):
            created.append(r["id"])
    yield req("POST", "users/me/meetings", body="[1]")
    yield req("POST", "users/me/meetings", body='"x"')
    for i in created[:3]:
        yield req("GET", f"meetings/{i}")
    yield req("GET", "users/me/meetings", {"page_size": 100})

    # Updates.
    targets = created[:2] + ids[:4]
    patches = [
        {"topic": "Renamed", "duration": 50, "agenda": "new"},
        {"start_time": "2026-04-01T10:00:00+02:00", "type": "8", "timezone": "Europe/Berlin", "password": "zz"},
        {"duration": "x"},
        {"type": "y"},
        {"start_time": "bad"},
        {"topic": None, "timezone": 5},
        {"duration": 45.0},
        {"duration": 45.5},
    ]
    for i, t in enumerate(targets):
        for patch in patches[i % 2::2]:
            yield req("PATCH", f"meetings/{t}", body=patch)
        yield req("GET", f"meetings/{t}")
    yield req("PATCH", "meetings/nope", body={"topic": "x"})
    yield req("PATCH", "meetings/12345", body={"topic": "x"})
    yield req("PATCH", "meetings/x", body="[1]")

    # Registrants.
    for t in (created[:2] + ids[:3] + ["nope", "123"]):
        yield req("POST", f"meetings/{t}/registrants", body={"email": "r@x.com", "first_name": "R", "last_name": "S", "language": "en-US"})
        yield req("POST", f"meetings/{t}/registrants", body={})
        yield req("GET", f"meetings/{t}/registrants")
    yield req("POST", "meetings/1/registrants", body={"email": 5})
    yield req("POST", "meetings/1/registrants", body="[1]")
    webinar_ids = [m["id"] for m in meetings if m.get("type") == 2][:2] + [m["id"] for m in webinars[:2]] + created[:1] + ["nope", "1"]
    for t in webinar_ids:
        yield req("POST", f"webinars/{t}/registrants", body={"email": "w@x.com", "first_name": "W", "registrants_confirmation_email": False})
        yield req("POST", f"webinars/{t}/registrants", body={"email": None})
    yield req("POST", "webinars/1/registrants", body="[1]")
    for t in webinar_ids[:2]:
        yield req("GET", f"meetings/{t}/registrants")

    # Unrouted.
    yield req("DELETE", "meetings/1")
    yield req("GET", "webinars/1")
    yield req("GET", "users/me/meetings/extra")
