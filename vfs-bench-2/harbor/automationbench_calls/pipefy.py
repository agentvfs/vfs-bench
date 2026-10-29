"""Pipefy calls: every route of tools/api/routes/pipefy.py, with the task's
seeded database records, card writes, and error cases."""
import json

KNOWN = {}

BASE = "https://api.pipefy.com/graphql/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    actions = world["pipefy"].get("actions", {})
    records = [r["params"] for r in actions.get("find_database_records", [])]
    tables = sorted({r.get("table_id") for r in records if r.get("table_id")}) or ["tbl_none"]
    for t in tables[:3]:
        yield fetch("GET", f"tables/{t}/records:find")
    for r in records[:2]:
        yield fetch("GET", f"tables/{r.get('table_id')}/records:find", {"title": r.get("title")})
    yield fetch("GET", f"tables/{tables[0]}/records:find", {"title": "nothing like it"})
    yield fetch("GET", f"tables/{tables[0]}/records:find", {"title": ""})
    yield fetch("GET", f"tables/{tables[0]}/records:find", {"title": None, "extra": 1})
    yield fetch("GET", f"tables/{tables[0]}/records:find", {"tableId": "dup"})
    yield fetch("GET", f"tables/{tables[0]}/records:find", "[1]")
    yield fetch("GET", "tables/unknown/records:find")
    yield fetch("POST", "cards", body={"pipe_id": "pipe_1", "fields_attributes": [
        {"field_id": "vendor_name", "field_value": "ACME"}, {"field_id": "amount", "field_value": 1200.0}, {"other": 1}]})
    yield fetch("POST", "cards", body={"pipe_id": "pipe_1"})
    yield fetch("POST", "cards", body={"fields_attributes": []})
    yield fetch("POST", "cards", body={"pipe_id": "", "fields_attributes": None, "title": "extra"})
    yield fetch("POST", "cards", body={"pipe_id": "p", "fields_attributes": ["x"]})
    yield fetch("POST", "cards", body={"pipe_id": "p", "fields_attributes": {"field_id": "a"}})
    yield fetch("POST", "cards", body={"pipe_id": "p", "fields_attributes": 5})
    yield fetch("POST", "cards", body={"pipe_id": 7, "fields_attributes": "ab"})
    yield fetch("POST", "cards", body={})
    yield fetch("POST", "cards", body="[1]")
    yield fetch("POST", "cards/card_55/move", body={"destination_phase_id": "ph_done"})
    yield fetch("POST", "cards/card_55/move", body={"phase_id": "ph_review", "pipe_id": "pipe_1"})
    yield fetch("POST", "cards/card_55/move", body={"destination_phase_id": "", "phase_id": ""})
    yield fetch("POST", "cards/card_55/move", body={"destination_phase_id": 3, "pipe_id": 0})
    yield fetch("POST", "cards/card_55/move", body={"cardId": "dup"})
    yield fetch("POST", "cards/card_55/move", body='"x"')
    yield fetch("POST", "cards/card_56/fields:update", body={"field_id": "status", "value": "Approved"})
    yield fetch("POST", "cards/card_56/fields:update", body={"field_id": "amount", "value": 99.5, "pipe_id": "p1", "type": "number"})
    yield fetch("POST", "cards/card_56/fields:update", body={"field_id": "", "value": "", "type": ""})
    yield fetch("POST", "cards/card_56/fields:update", body={"value": None, "new_value": "x"})
    yield fetch("POST", "cards/card_56/fields:update", body={"cardId": "dup"})
    yield fetch("POST", "cards/card_56/fields:update", body="[]")
    yield fetch("POST", "cards/a:b/move", body={"phase_id": "x"})
    yield fetch("GET", "cards")
    yield fetch("POST", "pipefy/v1/cards", body={"pipe_id": "bare"}, base="")
    for t in tables[:1]:
        yield fetch("GET", f"tables/{t}/records:find")
