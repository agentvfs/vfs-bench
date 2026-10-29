"""The calendar app's calls for gaia2_compare.py."""
import json

KNOWN: dict[str, str] = {}


def calls(state: dict, last):
    events = list((state.get("events") or {}).values())
    some = events[len(events) // 2] if events else None
    yield "today-events", {}
    yield "get-all-tags", {}
    yield "get-events", {
        "start_date": "2024-01-01 00:00:00",
        "end_date": "2026-01-01 00:00:00"
    }
    yield "get-events", {
        "start_date": "2024-01-01 00:00:00",
        "end_date": "2026-01-01 00:00:00",
        "offset": 5,
        "limit": 3
    }
    yield "get-events", {
        "start_date": "2024-01-01 00:00:00",
        "end_date": "2026-01-01 00:00:00",
        "offset": -4,
        "limit": 10
    }
    yield "get-events", {
        "start_date": "2024-01-01 00:00:00",
        "end_date": "2026-01-01 00:00:00",
        "offset": 100000
    }
    yield "get-events", {
        "start_date": "2024-01-01 00:00:00",
        "end_date": "2026-01-01 00:00:00",
        "limit": -2
    }
    yield "get-events", {
        "start_date": "2024-1-5 3:4:5",
        "end_date": "2024-12-31\t23:59:59"
    }
    # Python's \d is any Unicode digit and its \s any Unicode space; %d
    # takes " 5".
    yield "get-events", {
        "start_date": "\uff12\uff10\uff12\uff14-01-01 00:00:00",
        "end_date": "2024-10-01\x1c00:00:00"
    }
    yield "get-events", {
        "start_date": "2024-09- 5 00:00:00",
        "end_date": "2024-10-01\u3000\u00a000:00:00"
    }
    yield "get-events", {
        "start_date": "2024-09-05\ufeff00:00:00",
        "end_date": "2024-10-01 00:00:00"
    }
    yield "get-events", {
        "start_date": "2024-02-30 00:00:00",
        "end_date": "2024-03-01 00:00:00"
    }
    yield "get-events", {
        "start_date": "2024-01-01 00:00:60",
        "end_date": "2024-03-01 00:00:00"
    }
    yield "get-events", {
        "start_date": "2024-01-01",
        "end_date": "2024-03-01 00:00:00"
    }
    yield "get-events", {
        "start_date": "2024-01-01 00:00:00 ",
        "end_date": "2024-03-01 00:00:00"
    }
    yield "get-events", {
        "start_date": "0000-01-01 00:00:00",
        "end_date": "2024-03-01 00:00:00"
    }
    yield "get-events", {
        "start_date": "2024-03-01 00:00:00",
        "end_date": "bad"
    }
    yield "get-events", {
        "start_date": "2024-03-01 00:00:00",
        "end_date": "2024-02-01 00:00:00"
    }
    yield "get-events", {"start_date": "2024-03-01 00:00:00"}
    if some is not None:
        s = some["start_strftime"].split(", ")[1]
        e = some["end_strftime"].split(", ")[1]
        # Touching at the boundaries only: excluded.
        yield "get-events", {
            "start_date": e,
            "end_date": "2099-01-01 00:00:00"
        }
        yield "get-events", {
            "start_date": "1990-01-01 00:00:00",
            "end_date": s
        }
        yield "get-events", {"start_date": s, "end_date": s}
        yield "get-event", {"event_id": some["event_id"]}
        yield "search-events", {"query": some["title"][:5].upper()}
        if some.get("location"):
            yield "search-events", {"query": some["location"][-4:]}
        if some.get("description"):
            yield "search-events", {"query": some["description"][3:9]}
        if some.get("attendees"):
            yield "search-events", {"query": some["attendees"][0].lower()}
            yield "delete-calendar-event-by-attendee", {
                "event_id": some["event_id"],
                "who_delete": "Nobody Here"
            }
        if some.get("tag"):
            yield "get-events-by-tag", {"tag": some["tag"]}
    yield "get-event", {"event_id": "nope"}
    yield "get-event", {}
    yield "get-events-by-tag", {"tag": ""}
    yield "get-events-by-tag", {"tag": "no-such-tag"}
    yield "search-events", {"query": "zzzz-none"}
    yield "search-events", {"query": ""}
    # Writes: defaults from the frozen clock, then reads that see them.
    yield "add-event", {}
    first = last()["event_id"]
    yield "get-event", {"event_id": first}
    yield "today-events", {}
    yield "add-event", {
        "title": "Dentist — “check” ✓",
        "start_datetime": "2024-10-15 09:00:00",
        "end_datetime": "2024-10-15 10:30:00",
        "tag": "Health",
        "description": "Annual cleaning",
        "location": "Main St 5",
        "attendees": json.dumps(["Dr. Ödön", "Pat"])
    }
    dentist = last()["event_id"]
    yield "add-event", {
        "title": "Bad attendees",
        "start_datetime": "2024-10-16 09:00:00",
        "attendees": "[not json"
    }
    yield "add-event", {
        "title": "Bad attendees",
        "start_datetime": "2024-10-16 09:00:00",
        "end_datetime": "2024-10-16 10:00:00",
        "attendees": "[not json"
    }
    yield "add-event", {
        "title": "Str attendees",
        "start_datetime": "2024-10-16 08:00:00",
        "end_datetime": "2024-10-16 08:30:00",
        "attendees": json.dumps("Quentin")
    }
    yield "add-event", {
        "title": "Int attendees",
        "start_datetime": "2024-10-17 08:00:00",
        "end_datetime": "2024-10-17 08:30:00",
        "attendees": "7",
        "tag": "Odd"
    }
    odd = last()["event_id"]
    yield "add-event", {
        "title": "Backwards",
        "start_datetime": "2024-10-16 09:00:00",
        "end_datetime": "2024-10-16 08:00:00"
    }
    yield "add-event", {"start_datetime": "2024-10-16 25:00:00"}
    yield "add-event", {
        "start_datetime": "2024-10-15 07:00:00",
        "end_datetime": "2024-10-15 07:00:00",
        "tag": "Health",
        "description": ""
    }
    yield "add-event", {"end_datetime": "2030-01-01 00:00:00"}
    yield "get-event", {"event_id": dentist}
    yield "get-events-by-tag", {"tag": "Health"}
    yield "search-events", {"query": "ödön"}
    yield "search-events", {"query": "QUEN"}
    # An int's attendees break the search's iteration (a TypeError upstream
    # leaves uncaught).
    yield "search-events", {"query": "zzzz-none"}
    yield "get-events", {
        "start_date": "2024-10-17 00:00:00",
        "end_date": "2024-10-18 00:00:00"
    }
    yield "delete-calendar-event-by-attendee", {
        "event_id": odd,
        "who_delete": "Pat"
    }
    yield "delete-event", {"event_id": odd}
    yield "search-events", {"query": "quen"}
    yield "get-all-tags", {}
    yield "delete-calendar-event-by-attendee", {
        "event_id": dentist,
        "who_delete": "Nobody"
    }
    yield "delete-calendar-event-by-attendee", {
        "event_id": "nope",
        "who_delete": "Pat"
    }
    yield "delete-calendar-event-by-attendee", {"event_id": dentist}
    yield "delete-calendar-event-by-attendee", {
        "event_id": dentist,
        "who_delete": "Pat"
    }
    yield "get-event", {"event_id": dentist}
    yield "delete-event", {"event_id": dentist}
    yield "delete-event", {"event_id": first}
    yield "delete-event", {}
    # Hidden ENV commands.
    yield "add-calendar-event-by-attendee", {"who_add": "Zed Ray"}
    zed = last()["event_id"]
    yield "get-event", {"event_id": zed}
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "title": "Lunch",
        "start_datetime": "2024-10-15 12:00:00",
        "end_datetime": "2024-10-15 13:00:00",
        "description": "Tacos",
        "location": "Cafe",
        "tag": "Social",
        "attendees": json.dumps(["Pat", "Quinn"])
    }
    lunch = last()["event_id"]
    yield "get-event", {"event_id": lunch}
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "attendees": "{broken"
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "attendees": json.dumps("Patricia")
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "attendees": json.dumps("Quinn")
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "attendees": json.dumps({"Pat": 1})
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "attendees": json.dumps({"Quinn": 1})
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "attendees": "null"
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "attendees": "3.5"
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "start_datetime": "2024-13-01 00:00:00"
    }
    yield "add-calendar-event-by-attendee", {
        "who_add": "Pat",
        "start_datetime": "2024-10-15 12:00:00",
        "end_datetime": "2024-10-15 11:00:00"
    }
    yield "add-calendar-event-by-attendee", {"title": "No who"}
    yield "today-events", {}
    yield "get-events-by-tag", {"tag": "Social"}
    yield "search-events", {"query": "created by pat"}
    yield "delete-calendar-event-by-attendee", {
        "event_id": lunch,
        "who_delete": "Quinn"
    }
    yield "delete-calendar-event-by-attendee", {
        "event_id": lunch,
        "who_delete": "Quinn"
    }
    yield "delete-calendar-event-by-attendee", {
        "event_id": zed,
        "who_delete": "Zed Ray"
    }
    yield "get-all-tags", {}
    yield "get-events", {
        "start_date": "2024-10-15 00:00:00",
        "end_date": "2024-10-16 00:00:00"
    }
