"""Calendly calls: every route of tools/api/routes/calendly.py, with users,
event types, scheduled events and invitees from the task's world and the
replies before; cancellations, no-shows, one-off event types and scheduling
links (which create events and invitees); and error cases."""
import json

KNOWN = {}

BASE = "https://api.calendly.com/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    c = world["calendly"]
    users = c.get("users", [])
    ets = c.get("event_types", [])
    events = c.get("scheduled_events", [])
    invitees = c.get("invitees", [])
    yield fetch("GET", "users")
    yield fetch("GET", "users/me")
    for u in users[:3]:
        yield fetch("GET", f"users/{u['id']}")
        yield fetch("GET", "users", {"email": u["email"].upper()})
        yield fetch("GET", "users", {"q": u["name"].split()[0].lower()})
        yield fetch("GET", "events" if False else "scheduled_events", {"user": u["id"]})
        if u.get("email"):
            yield fetch("GET", f"users/{u['email']}")
        yield fetch("GET", f"users/{u['name'][:4]}")
    yield fetch("GET", "users/nobody")
    yield fetch("GET", "users", {"email": 5})
    yield fetch("GET", "users", {"q": 5})
    yield fetch("GET", "users", {"bogus": 1})
    yield fetch("GET", "users", "[1]")
    yield fetch("GET", "event_types")
    yield fetch("GET", "event_types", {"active": "false"})
    yield fetch("GET", "event_types", {"active": "true", "count": 1})
    yield fetch("GET", "event_types", {"active": 0})
    yield fetch("GET", "event_types", {"active": False})
    yield fetch("GET", "event_types", {"count": "x"})
    for et in ets[:2]:
        yield fetch("GET", "event_types", {"user": et.get("owner_id")})
    yield fetch("GET", "scheduled_events")
    yield fetch("GET", "scheduled_events", {"count": 3})
    yield fetch("GET", "scheduled_events", {"count": "2"})
    yield fetch("GET", "scheduled_events", {"count": 0})
    yield fetch("GET", "scheduled_events", {"count": -2})
    yield fetch("GET", "scheduled_events", {"status": "canceled"})
    yield fetch("GET", "scheduled_events", {"status": "active", "count": 4})
    yield fetch("GET", "scheduled_events", {"min_start_time": "2026-02-15T00:00:00Z"})
    yield fetch("GET", "scheduled_events", {"max_start_time": "2026-02-20T00:00:00+00:00", "min_start_time": "2026-01-01T00:00:00Z"})
    yield fetch("GET", "scheduled_events", {"min_start_time": "not a date"})
    yield fetch("GET", "scheduled_events", {"min_start_time": "2026-02-15"})
    yield fetch("GET", "scheduled_events", {"max_start_time": 5})
    yield fetch("GET", "scheduled_events", {"min_start_time": "2026-13-01T00:00:00Z"})
    yield fetch("GET", "scheduled_events", {"invitee_email": "nobody@example.com"})
    yield fetch("GET", "scheduled_events", {"invitee_email": 3})
    yield fetch("GET", "scheduled_events", {"user": ["x"]})
    yield fetch("GET", "scheduled_events", {"organization": "o", "sort": "start_time:asc", "group": "g", "x": 1})
    yield fetch("GET", "scheduled_events", "[1]")
    for inv in invitees[:3]:
        yield fetch("GET", "scheduled_events", {"invitee_email": inv["email"].upper()})
    for e in events[:4]:
        for key in ("id", "uuid", "uri"):
            if e.get(key):
                yield fetch("GET", f"scheduled_events/{str(e[key]).rsplit('/', 1)[-1]}")
        eid = str(e.get("uuid") or e.get("id") or e.get("uri", "")).rsplit("/", 1)[-1]
        yield fetch("GET", f"scheduled_events/{eid}/invitees")
        yield fetch("GET", f"scheduled_events/{eid}/invitees", {"status": "active", "count": 1})
        yield fetch("GET", f"scheduled_events/{eid}/invitees", {"email": "X@Y.Z"})
        yield fetch("GET", f"scheduled_events/{eid}/invitees", {"uuid": "dup"})
    yield fetch("GET", "scheduled_events/nope")
    yield fetch("GET", "scheduled_events/nope/invitees")
    yield fetch("GET", "scheduled_events/nope/invitees", {"email": 4})
    if events:
        e0 = str(events[0].get("uuid") or events[0].get("id")).rsplit("/", 1)[-1]
        yield fetch("GET", f"scheduled_events/{e0}/invitees", {"email": 4})
    for inv in invitees[:2]:
        yield fetch("POST", "invitee_no_shows", body={"invitee": inv.get("uri") or inv["id"]})
        yield fetch("POST", "invitee_no_shows", body={"invitee": inv["id"]})
        yield fetch("POST", "invitee_no_shows", body={"invitee": f"https://api.calendly.com/scheduled_events/x/invitees/{inv['id']}/"})
    yield fetch("POST", "invitee_no_shows", body={"invitee": "missing"})
    yield fetch("POST", "invitee_no_shows", body={})
    yield fetch("POST", "invitee_no_shows", body={"invitee": 5})
    yield fetch("POST", "invitee_no_shows", body="[1]")
    for e in events[:2]:
        eid = str(e.get("uuid") or e.get("id")).rsplit("/", 1)[-1]
        yield fetch("GET", f"scheduled_events/{eid}/invitees")
        yield fetch("POST", f"scheduled_events/{eid}/cancellation", body={"reason": "Host conflict"})
        yield fetch("POST", f"scheduled_events/{eid}/cancellation", body={"reason": "again"})
        yield fetch("GET", f"scheduled_events/{eid}")
    if len(events) > 2:
        eid = str(events[2].get("uuid") or events[2].get("id")).rsplit("/", 1)[-1]
        yield fetch("POST", f"scheduled_events/{eid}/cancellation", body={"reason": 7})
        yield fetch("GET", f"scheduled_events/{eid}")
        eid = str(events[-1].get("uuid") or events[-1].get("id")).rsplit("/", 1)[-1]
        yield fetch("POST", f"scheduled_events/{eid}/cancellation", body={})
        yield fetch("POST", f"scheduled_events/{eid}/cancellation", body={"uuid": "dup"})
    yield fetch("POST", "scheduled_events/nope/cancellation", body={"reason": "x"})
    yield fetch("POST", "scheduled_events/nope/cancellation", body="[]")
    yield fetch("GET", "scheduled_events", {"status": "canceled"})
    yield fetch("POST", "one_off_event_types", body={"name": "Exit Interview", "host": users[0]["uri"] if users else "u1",
                                                     "duration": 45, "location_kind": "zoom_conference"})
    yield fetch("POST", "one_off_event_types", body={"name": "Bare"})
    yield fetch("POST", "one_off_event_types", body={"name": "Strdur", "duration": "60"})
    yield fetch("POST", "one_off_event_types", body={"name": "Baddur", "duration": "x"})
    yield fetch("POST", "one_off_event_types", body={"name": "Badloc", "location_kind": "moon"})
    yield fetch("POST", "one_off_event_types", body={"name": 5, "host": 3})
    yield fetch("POST", "one_off_event_types", body={"name": "x", "co_hosts": ["a"], "start_date": "2026-01-01", "foo": 1})
    yield fetch("POST", "one_off_event_types", body="[1]")
    yield fetch("GET", "event_types")
    et = ets[0] if ets else None
    owner = (et.get("uri") or et.get("id")) if et else "et_missing"
    yield fetch("POST", "scheduling_links", body={"owner": owner, "max_event_count": 1})
    yield fetch("POST", "scheduling_links", body={"owner": owner.rsplit("/", 1)[-1], "owner_type": "EventType"})
    if et:
        yield fetch("POST", "scheduling_links", body={"event_type": et.get("name")})
        yield fetch("POST", "scheduling_links", body={"owner": et.get("name", "").upper(), "invitee_email": "pat@acme.example.com",
                                                      "start_time": "2026-03-02T15:00:00Z", "end_time": "2026-03-02T15:30:00Z",
                                                      "event_guests": "a@x.com, ,b@y.com"})
    yield fetch("POST", "scheduling_links", body={"owner": owner, "invitee_email": "lee@beta.example.com",
                                                  "host": "https://api.calendly.com/users/U_HOST", "name": "Custom Name",
                                                  "event_guests": [{"email": "g1@x.com"}, "g2@x.com", {"name": "no email"}, 5]})
    yield fetch("POST", "scheduling_links", body={"owner": owner, "invitee_email": "kim@gamma.example.com", "host_id": "U_ID",
                                                  "topic": "Topic Name", "event_guests": 7})
    yield fetch("POST", "scheduling_links", body={"owner": "Unknown Type", "invitee_email": "zed@delta.example.com"})
    yield fetch("POST", "scheduling_links", body={"owner": owner, "invitee_email": 5})
    yield fetch("POST", "scheduling_links", body={"owner": owner, "invitee_email": "a@b.c", "name": 9})
    yield fetch("POST", "scheduling_links", body={"owner": owner, "invitee_email": "a@b.c", "host": 12})
    yield fetch("POST", "scheduling_links", body={"owner": 5})
    yield fetch("POST", "scheduling_links", body={})
    yield fetch("POST", "scheduling_links", body="[1]")
    yield fetch("GET", "scheduled_events", {"invitee_email": "lee@beta.example.com"})
    yield fetch("GET", "scheduled_events", {"count": 50})
    yield fetch("GET", "scheduled_events/x/y/z")
    yield fetch("DELETE", "users/me")
    yield fetch("GET", "calendly/users/me", base="")
