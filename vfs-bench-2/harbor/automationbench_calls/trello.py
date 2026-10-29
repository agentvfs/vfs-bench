"""Trello calls: every route of tools/api/routes/trello.py, over the task's
seeded board lists and organization cards, card, label and comment writes,
and error cases (non-mapping params and bodies, duplicate arguments,
unhashable ids)."""
import json

KNOWN = {}

BASE = "https://api.trello.com/1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    actions = world["trello"].get("actions", {})
    boards = sorted({str(r["params"].get("board")) for v in actions.values() for r in v if r["params"].get("board")})
    cards = [r["params"].get("card") for r in actions.get("organization_card", []) if r["params"].get("card")]
    board = boards[0] if boards else "brd_new"
    card = cards[0] if cards else "card_new"
    yield fetch("GET", "members/me/boards")
    yield fetch("GET", "members/me/boards", {"filter": "open"})
    yield fetch("GET", "members/me/boards", {"memberId": "dup"})
    yield fetch("GET", "members/me/boards", "[1]")
    for b in boards[:3] + ["brd_unknown"]:
        yield fetch("GET", f"boards/{b}/lists")
        yield fetch("GET", f"boards/{b}/cards")
    yield fetch("GET", f"boards/{board}/lists", {"filter": "open", "extra": 1})
    yield fetch("GET", f"boards/{board}/lists", {"boardId": "dup"})
    yield fetch("GET", f"boards/{board}/cards", "[]")
    yield fetch("POST", "cards", body={"idList": "lst_hold", "name": "Vendor review", "desc": "Check", "due": "2026-03-01",
                                       "idBoard": board, "pos": "top"})
    yield fetch("POST", "cards", body={"idList": "lst_x", "name": "Bare card"})
    yield fetch("POST", "cards", body={"name": "", "idList": ""})
    yield fetch("POST", "cards", body={"idList": "l", "name": "listy", "idBoard": ["b1"]})
    yield fetch("POST", "cards", body={"idList": "l", "name": "numboard", "idBoard": 7})
    yield fetch("POST", "cards", body={"idList": "l", "name": "x", "extra": {"a": 1}})
    yield fetch("POST", "cards", body={"world": 1})
    yield fetch("POST", "cards", body="[1]")
    yield fetch("POST", "cards", body={})
    yield fetch("GET", f"boards/{board}/cards")
    yield fetch("GET", "members/me/boards")
    yield fetch("PUT", f"cards/{card}", body={"name": "Renamed", "idList": "lst_done", "dueComplete": True, "closed": False, "pos": 3})
    yield fetch("PUT", f"cards/{card}", {"desc": "from params"}, body={"due": "2026-04-01"})
    yield fetch("PUT", f"cards/{card}", body={"idBoard": "brd_other", "board": "brd_b"})
    yield fetch("PUT", f"cards/{card}", body={"idBoard": "", "board": None})
    yield fetch("PUT", "cards/card_unknown", body={"name": "No board"})
    yield fetch("PUT", f"cards/{card}", body={"cardId": "dup"})
    yield fetch("PUT", f"cards/{card}", "[1]", body={})
    yield fetch("PUT", f"cards/{card}", body="[1]")
    yield fetch("PUT", f"cards/{card}", {"a": 1}, body={"a": 2, "closed": True})
    yield fetch("POST", f"cards/{card}/idLabels", body={"value": "lbl_red"})
    yield fetch("POST", f"cards/{card}/idLabels", {"value": "lbl_p"}, body={"board": "brd_z"})
    yield fetch("POST", f"cards/{card}/idLabels", {"value": "x"}, body={"value": "y"})
    yield fetch("POST", f"cards/{card}/idLabels", {"cardId": "dup"})
    yield fetch("POST", f"cards/{card}/idLabels", "[1]")
    yield fetch("POST", f"cards/{card}/idLabels", body="[2]")
    yield fetch("POST", "cards/card_unknown/idLabels", body={"value": ""})
    yield fetch("POST", f"cards/{card}/actions/comments", body={"text": "On hold until W-9"})
    yield fetch("POST", f"cards/{card}/actions/comments", {"text": "via params", "board": board})
    yield fetch("POST", f"cards/{card}/actions/comments", body={"text": ""})
    yield fetch("POST", f"cards/{card}/actions/comments", body={"text": 5, "extra": 1})
    yield fetch("POST", f"cards/{card}/actions/comments", body={"cardId": "dup"})
    yield fetch("POST", f"cards/{card}/actions/comments", body='"s"')
    yield fetch("GET", "members/me/boards")
    yield fetch("GET", f"boards/{board}/cards")
    yield fetch("GET", "boards/brd_b/cards")
    yield fetch("GET", f"cards/{card}")
    yield fetch("DELETE", f"cards/{card}")
    yield fetch("GET", "trello/1/members/me/boards", base="")
