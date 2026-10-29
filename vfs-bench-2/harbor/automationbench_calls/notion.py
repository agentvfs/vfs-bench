"""Notion calls: every route of tools/api/routes/notion.py, page creates in
each parent, title and content shape, page updates, and error cases."""
import json

KNOWN = {}

BASE = "https://api.notion.com/v1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def title(text):
    return {"title": {"title": [{"text": {"content": text}}]}}


def calls(world, last):
    blocks = [{"object": "block", "type": "paragraph",
               "paragraph": {"rich_text": [{"type": "text", "text": {"content": "Line é"}}]}}]
    for body in [
        {"parent": {"type": "page_id", "page_id": "p1"}, "properties": title("Drill notes"), "children": blocks},
        {"parent": {"type": "database_id", "database_id": "db1"}, "properties": title("Row"), "icon": {"emoji": "x"},
         "cover": "https://c"},
        {"parent": {"database_id": "db2"}, "properties": {"title": [{"text": {"content": "List title"}}]}},
        {"parent": "p-string", "properties": {"title": "Plain"}, "content": "Some markdown"},
        {"parent": {}, "parent_page": "legacy", "title": "Legacy", "markdown": "# md"},
        {"parent_id": "via-kwargs", "title": "K", "content": blocks},
        {"properties": {"title": {"title": []}}, "children": [], "content": []},
        {"properties": {"title": {"title": ["x"]}}, "children": "notalist"},
        {"properties": {"title": {"title": [{"text": "nodict"}]}}, "icon": 5, "cover": None},
        {"properties": {"title": {"title": [{"text": {"content": 7}}]}}, "position": {"type": "x"}},
        {"properties": {"Name": {"title": []}}},
        {"properties": "x", "title": ""},
        {"parent": {"type": "database_id"}, "title": None},
        {"parent": 3},
        {},
        {"bogus": True, "title": "with extras"},
        {"world": 1},
    ]:
        yield fetch("POST", "pages", body=body)
    page = last() if isinstance(last(), dict) else {}
    pid = page.get("id") or "page-1"
    for body in [
        {"properties": title("Renamed")},
        {"properties": {"title": "Plain rename"}, "archived": True},
        {"properties": {"title": [{"text": {"content": "list not read"}}]}, "in_trash": False},
        {"title": "Direct", "icon": "x", "cover": {"external": {"url": "u"}}, "is_locked": True, "erase_content": False},
        {"properties": {"title": {"title": [{"text": {"content": ""}}]}}},
        {"archived": "yes"},
        {},
        {"page_id": "dup"},
        {"extra": [1, 2]},
    ]:
        yield fetch("PATCH", f"pages/{pid}", body=body)
    yield fetch("PATCH", "pages/other-page", body={"properties": title("Other")})
    yield fetch("POST", "pages", body="[1]")
    yield fetch("PATCH", "pages/x", body='"s"')
    yield fetch("GET", "pages/x")
    yield fetch("POST", "pages", body={"title": "bare"}, base="notion/v1/")
