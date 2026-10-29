"""Google Calendar calls: every route of tools/api/routes/google_calendar.py,
with the task's calendars and events, writes that later reads see, and
error cases (unknown ids, bad datetimes, wrong types, bad bodies)."""
import json

KNOWN = {}

BASE = "https://www.googleapis.com/calendar/v3/"
ALT = "https://calendar.googleapis.com/calendar/v3/"


def req(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    gc = world["google_calendar"]
    cals = gc.get("calendars", [])
    events = gc.get("events", [])
    cal_ids = [c["id"] for c in cals] + sorted({e["calendarid"] for e in events}) + ["primary", "nope"]
    cal = cal_ids[0]

    # Calendars.
    yield req("GET", "users/me/calendarList")
    yield req("GET", "users/me/calendarList", {"showHidden": True, "showDeleted": "true"})
    yield req("GET", "users/me/calendarList", {"minAccessRole": "writer"})
    yield req("GET", "users/me/calendarList", {"minAccessRole": "owner", "showHidden": 1})
    yield req("GET", "users/me/calendarList", {"minAccessRole": "bogus"})
    yield req("GET", "users/me/calendarList", {"maxResults": 3})
    yield req("GET", "users/me/calendarList", "[1]")
    for cid in cal_ids[:5]:
        yield req("GET", f"calendars/{cid}")
        yield req("GET", f"calendars/{cid}/events")
    yield req("GET", "calendars/nope")
    yield req("GET", "calendars/x", base=ALT)

    # Event lists: time windows, queries.
    for params in [
        {"timeMin": "2026-01-01T00:00:00Z"},
        {"timeMax": "2026-03-15T00:00:00Z"},
        {"timeMin": "2026-03-01T00:00:00Z", "timeMax": "2026-04-30T00:00:00Z"},
        {"timeMin": "2026-03-10", "timeMax": "2026-03-20T00:00:00+05:00"},
        {"timeMin": "2027-01-01T00:00:00Z"},
        {"q": "meeting"}, {"q": "MEETING", "singleEvents": True, "orderBy": "startTime"},
        {"q": "@"}, {"q": "zzzz"}, {"q": ""},
        {"timeMin": "not a date"}, {"timeMin": "2026-13-01"}, {"timeMax": 5}, {"q": 5},
        {"timeMin": "2026-02-30T10:00"}, {"timeMax": "2026-01-01T25:00"},
    ]:
        yield req("GET", f"calendars/{cal}/events", params)
    yield req("GET", "calendars/primary/events", {"q": "a"})
    yield req("GET", "calendars/nope/events")
    yield req("GET", f"calendars/{cal}/events", "[1]")
    yield req("GET", f"calendars/{cal}/events", {"calendarId": "x"})

    for e in events[:6]:
        yield req("GET", f"calendars/{e['calendarid']}/events/{e['id']}")
        yield req("GET", f"calendars/primary/events/{e['id']}")
    yield req("GET", f"calendars/{cal}/events/nope")
    yield req("GET", "calendars/nope/events/nope")

    # Creates.
    yield req("POST", "calendars", body={"summary": "Team Ops", "description": "ops"})
    new_cal = last().get("calendar", {}).get("id")
    yield req("POST", "calendars", body={})
    yield req("POST", "calendars", body={"summary": 5})
    yield req("POST", "calendars", body={"summary": "x", "timeZone": "UTC"})
    yield req("POST", "calendars", body="[1]")
    yield req("POST", "calendars", body={"world": 1})
    yield req("GET", "users/me/calendarList")
    if new_cal:
        yield req("GET", f"calendars/{new_cal}")
        yield req("GET", f"calendars/{new_cal}/events")

    bodies = [
        {"summary": "Sync", "start": {"dateTime": "2026-03-20T10:00:00Z"}, "end": {"dateTime": "2026-03-20T11:00:00Z"},
         "attendees": [{"email": "a@example.com"}, {"email": ""}, "b@example.com", 5], "location": "Room 1"},
        {"summary": "Offset", "start": {"dateTime": "2026-03-21T10:00:00+05:30"}, "end": {"dateTime": "2026-03-21T11:30:00+05:30"},
         "description": "d", "colorId": "4", "visibility": "private", "transparency": "transparent",
         "remindersUseDefault": False, "remindersMethods": ["email", "popup"], "remindersMinutes": "15",
         "recurrenceFrequency": "weekly", "recurrenceUntil": "2026-06-01T00:00:00Z", "recurrenceCount": "4",
         "guestsCanModify": "yes", "allDay": "true", "conferencing": True, "eventType": "outOfOffice"},
        {"summary": "Naive", "start": "2026-03-22T09:00:00", "end": "2026-03-22T09:30:00.250000", "attendees": "x@y.com, , z@y.com"},
        {"summary": "AllDay", "start": {"date": "2026-03-23"}, "end": {"date": "2026-03-24"}},
        {"summary": "Flat", "startDateTime": "2026-03-25T08:00:00Z", "endDateTime": "2026-03-25T09:00:00Z"},
        {"summary": "Flat2", "start__dateTime": "2026-03-26T08:00:00Z", "end__dateTime": "2026-03-26T09:00:00Z"},
        {"summary": "Reminders default", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z",
         "remindersUseDefault": "false", "remindersMethods": ["popup"]},
        {"summary": "BadVis", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "visibility": "secret"},
        {"summary": "BadFreq", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "recurrenceFrequency": "hourly"},
        {"summary": "BadCount", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "recurrenceCount": "x"},
        {"summary": "ZeroCount", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "recurrenceCount": 0, "remindersMinutes": 2.7},
        {"summary": "NoStart"},
        {"summary": "BadStart", "start": "tomorrow", "end": "2026-03-27T09:00:00Z"},
        {"summary": "BadMonth", "start": "2026-13-01T00:00:00Z", "end": "2026-03-27T09:00:00Z"},
        {"summary": "NumStart", "startDateTime": 5, "end": "2026-03-27T09:00:00Z"},
        {"summary": "DictNum", "start": {"dateTime": 20260301}, "end": "2026-03-27T09:00:00Z"},
        {"summary": 7, "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z"},
        {"summary": "ColorNum", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "colorId": 5},
        {"summary": "BadMethods", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "remindersMethods": ["sms"]},
        {"summary": "MethodsStr", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "remindersMethods": "email"},
        {"summary": "Until bad", "start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "recurrenceUntil": "soon"},
        {"summary": "Mixed", "start": "2026-03-27T08:00:00", "end": "2026-03-27T09:00:00Z"},
    ]
    created = []
    for body in bodies:
        yield req("POST", f"calendars/{cal}/events", body=body)
        r = last()
        if isinstance(r, dict) and r.get("event", {}).get("id"):
            created.append(r["event"]["id"])
    yield req("POST", "calendars/primary/events", body=bodies[0])
    yield req("POST", "calendars/nope/events", body=bodies[0])
    yield req("POST", f"calendars/{cal}/events", body="[1]")
    yield req("POST", f"calendars/{cal}/events", body={"calendarId": "x"})
    yield req("POST", f"calendars/{cal}/events", body={"start": "2026-03-27T08:00:00Z", "end": "2026-03-27T09:00:00Z", "extra": {"a": 1}})
    if new_cal:
        yield req("POST", f"calendars/{new_cal}/events", body=bodies[0])
        yield req("GET", f"calendars/{new_cal}/events")

    # Quick add.
    yield req("POST", f"calendars/{cal}/events/quickAdd", {"text": "Lunch with Ana"})
    yield req("POST", f"calendars/{cal}/events/quickAdd")
    yield req("POST", f"calendars/{cal}/events/quickAdd", {"text": 5})
    yield req("POST", "calendars/nope/events/quickAdd", {"text": "x"})
    yield req("POST", "calendars/primary/events/quickAdd", {"text": "y", "sendUpdates": "all", "z": 1})
    yield req("POST", f"calendars/{cal}/events/quickAdd", "[2]")

    yield req("GET", f"calendars/{cal}/events")
    yield req("GET", f"calendars/{cal}/events", {"timeMin": "2026-03-21T00:00:00Z", "timeMax": "2026-03-26T00:00:00Z"})

    # Updates.
    targets = created[:3] + [e["id"] for e in events[:3]]
    patches = [
        {"summary": "Renamed", "location": "Room 9", "attendees": ["n@x.com"]},
        {"start": {"dateTime": "2026-03-28T10:00:00-07:00"}, "end": {"dateTime": "2026-03-28T11:00:00-07:00"}},
        {"startDateTime": "2026-03-29T10:00:00Z", "description": "", "colorId": "2"},
        {"recurrenceFrequency": "monthly", "recurrenceUntil": "2026-12-01", "recurrenceCount": 3},
        {"allDay": "1", "visibility": "public", "remindersUseDefault": False, "remindersMethods": ["email"], "remindersMinutes": 30},
        {"transparency": "opaque", "guestsCanModify": True, "eventType": "default", "attendees": "q@x.com,r@x.com"},
        {"visibility": "nope"},
        {"recurrenceCount": "two"},
        {"remindersMethods": "email"},
        {"start": "garbage"},
        {"summary": 5},
        {"attendees": None, "summary": None},
        {"attendees": 5},
        {"remindersMinutes": 2.5},
        {"start": {"dateTime": "2026-03-28T10:00:00"}},
    ]
    for i, eid in enumerate(targets):
        for patch in patches[i % 3::2]:
            yield req("PATCH", f"calendars/{cal}/events/{eid}", body=patch)
        yield req("PUT", f"calendars/{cal}/events/{eid}", body=patches[0])
        yield req("GET", f"calendars/{cal}/events/{eid}")
    for e in events[:3]:
        yield req("PATCH", f"calendars/{e['calendarid']}/events/{e['id']}", body={"summary": "Moved", "end": "2026-05-01T00:00:00Z"})
    yield req("PATCH", f"calendars/{cal}/events/nope", body={"summary": "x"})
    yield req("PATCH", "calendars/nope/events/x", body={"summary": "x"})
    if targets:
        yield req("PATCH", f"calendars/{cal}/events/{targets[0]}", body="[1]")
        yield req("PATCH", f"calendars/{cal}/events/{targets[0]}", body={"eventId": "x"})
        yield req("PATCH", f"calendars/{cal}/events/{targets[0]}", body={"bogus": 1, "summary": "kw"})

    yield req("GET", f"calendars/{cal}/events")
    yield req("GET", f"calendars/{cal}/events", {"timeMin": "2026-03-01T00:00:00Z"})

    # Deletes.
    for eid in (created[:2] + [e["id"] for e in events[:1]]):
        yield req("DELETE", f"calendars/{cal}/events/{eid}", {"sendUpdates": "all"})
        yield req("DELETE", f"calendars/{cal}/events/{eid}")
    yield req("DELETE", "calendars/nope/events/x")
    yield req("DELETE", f"calendars/{cal}/events/x", "[1]")
    yield req("GET", f"calendars/{cal}/events")

    # Unrouted paths and the googleapis fallback.
    yield req("GET", "calendars/x/acl")
    yield req("DELETE", "calendars/x")
    yield "api_fetch", {"method": "GET", "url": "https://www.googleapis.com/calendar/v3/users/me/calendarList?x=1"}
    yield "api_fetch", {"method": "GET", "url": "https://www.googleapis.com/youtube/v3/videos"}
    yield "api_fetch", {"method": "GET", "url": "calendar/v3/users/me/calendarList"}
