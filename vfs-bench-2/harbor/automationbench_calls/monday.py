"""Monday calls: every route of tools/api/routes/monday.py, with the task's
seeded item records, item and column writes (each column type and value
shape), and error cases."""
import json

KNOWN = {}

BASE = "https://api.monday.com/v2/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    actions = world["monday"].get("actions", {})
    seeded = [r["params"] for records in actions.values() for r in records]
    boards = sorted({str(p.get("board_id")) for p in seeded if p.get("board_id")}) or ["b1"]
    names = [p.get("name") or p.get("item_name") for p in seeded if p.get("name") or p.get("item_name")]
    yield fetch("POST", "items:find", body={})
    for b in boards[:2]:
        yield fetch("POST", "items:find", body={"board_id": b})
    for n in names[:2]:
        yield fetch("POST", "items:find", body={"board_id": boards[0], "name": n})
    yield fetch("POST", "items:find", body={"name": "nothing"})
    yield fetch("POST", "items:find", body={"board_id": 123})
    yield fetch("POST", "items:find", body={"extra": 1})
    yield fetch("POST", "items:find", body="[1]")
    yield fetch("POST", "items:create", body={"board_id": boards[0], "item_name": "Fire drill", "group_id": "topics"})
    item = (last() or {}).get("id") if isinstance(last(), dict) else None
    yield fetch("POST", "items:create", body={"board_id": boards[0], "name": "Named via name"})
    yield fetch("POST", "items:create", body={"board_id": "", "item_name": ""})
    yield fetch("POST", "items:create", body={"board_id": 7, "item_name": 3.0, "group_id": None})
    yield fetch("POST", "items:create", body={"world": 1})
    yield fetch("POST", "items:find", body={"board_id": boards[0]})
    yield fetch("POST", "items:find", body={"board_id": boards[0], "name": "Fire drill"})
    item = item or "123"
    for col, value, ctype in [
        ("status", {"label": "Done"}, ""), ("due", {"date": "2026-03-01"}, ""), ("notes", {"text": "hi"}, ""),
        ("qty", {"number": 5}, ""), ("qty", {"number": 2.5}, ""), ("deadline", "2026-04-01", ""),
        ("start_date", "x", ""), ("text0", "plain", "TEXT"), ("num", 3, "Number"), ("x", None, ""),
        ("x", {"other": 1}, ""), ("x", [1, "a"], ""), ("x", True, "status"), ("x", {"label": "L"}, "date"),
        ("End_Date", "2026", ""), ("x", 1.0, "number"),
    ]:
        yield fetch("POST", f"items/{item}/columns:update",
                    body={"board_id": boards[0], "column_id": col, "value": value, "column_type": ctype})
    yield fetch("POST", "items/999/columns:update", body={})
    yield fetch("POST", "items/999/columns:update", body={"column_type": 5})
    yield fetch("POST", "items/999/columns:update", body={"column_id": 5})
    yield fetch("POST", "items/999/columns:update", body={"column_id": 5, "column_type": "text"})
    yield fetch("POST", "items/999/columns:update", body={"item_id": "dup"})
    yield fetch("POST", "items/999/columns:update", body="[1]")
    yield fetch("POST", "items/a:b/columns:update", body={})
    yield fetch("GET", "items:find")
    yield fetch("POST", "items:find", body={"board_id": boards[0]}, base="monday/v2/")
