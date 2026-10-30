"""Reference gws writes() over JSON exported by the fake, with SQL ordering."""
import json
from datetime import datetime, timezone


def writes(trace, seed, tables):
    sent, created, deleted = [], [], []
    if not tables:
        return sent, created, deleted

    def ordered(name, *keys):
        # SQLite ASC puts NULL before other values. Stable table order
        # preserves ties; the fake exports its insertion order as __order.
        return sorted(tables.get(name, []),
                      key=lambda row: tuple(
                          (row.get(key) is not None, row.get(key))
                          for key in keys))

    seeded = {e["message_id"] for e in seed["gmail"]}
    labels, headers = {}, {}
    for row in tables["MessageLabel"]:
        labels.setdefault(row["messageId"], set()).add(row["labelId"])
    for row in ordered("MessageHeader", "seq", "pk"):
        headers.setdefault(row["messageId"],
                           {}).setdefault(row["name"].lower(), row["value"])
    for row in ordered("Message", "internalDate", "seq"):
        mine = labels.get(row["id"], set())
        if row["id"] in seeded or "SENT" not in mine or "DRAFT" in mine:
            continue
        head = headers.get(row["id"], {})
        request = {
            "to": head.get("to", ""),
            "subject": head.get("subject", ""),
            "body": row["bodyText"]
        }
        message = {
            **request, "timestamp":
            datetime.fromtimestamp(
                int(row["internalDate"]) / 1000, timezone.utc).isoformat()
        }
        sent.append(message)
        trace.add("gmail_send_message", request, {
            "status": "sent",
            "message": message
        })
    live = {row["id"]: row for row in ordered("Event", "created", "seq")}
    fixture = {e["event_id"]: e for e in seed["calendar"]}
    for event_id, row in live.items():
        if event_id in fixture or row["status"] == "cancelled":
            continue
        people = json.loads(row["attendees"]) if row["attendees"] else []
        request = {
            "title":
            row["summary"] or "",
            "start_time":
            row["startDateTime"] or row["startDate"] or "",
            "end_time":
            row["endDateTime"] or row["endDate"] or "",
            "attendees": [
                p.get("email") or p.get("displayName") or "" for p in people
                if isinstance(p, dict)
            ],
            "location":
            row["location"] or "",
        }
        event = {"event_id": event_id, **request, "recurring": False}
        created.append(event)
        trace.add("calendar_create_event", request, {
            "status": "created",
            "event": event
        })
    for event_id, event in fixture.items():
        row = live.get(event_id)
        if row is None or row["status"] == "cancelled":
            deleted.append(event)
            trace.add("calendar_delete_event", {"event_id": event_id}, {
                "status": "deleted",
                "event": event
            })
    return sent, created, deleted
