"""Google Drive calls: every route, with names and ids from the task's world
and the replies before, the ``q`` forms upstream reads, writes, and errors."""
import json
from urllib.parse import quote

KNOWN = {}

V3 = "https://www.googleapis.com/drive/v3/files"
V2 = "https://www.googleapis.com/drive/v2/files"


def fetch(method, url, params=None, body=None):
    args = {"method": method, "url": url}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def _names(world):
    drive = world.get("google_drive") or {}
    names = []
    for f in drive.get("files", []) + drive.get("folders", []):
        n = f.get("name") or f.get("title")
        if isinstance(n, str) and n:
            names.append(n)
    for records in (drive.get("actions") or {}).values():
        for r in records:
            n = r["params"].get("title") or r["params"].get("name")
            if isinstance(n, str) and n:
                names.append(n)
    for s in (world.get("google_sheets") or {}).get("spreadsheets", []):
        names.append(s["title"])
    return names


def _ids(world):
    drive = world.get("google_drive") or {}
    ids = []
    for records in (drive.get("actions") or {}).values():
        for r in records:
            for k in ("file", "id", "folder"):
                v = r["params"].get(k)
                if isinstance(v, str) and v:
                    ids.append(v)
    for f in drive.get("files", []) + drive.get("folders", []):
        for k in ("file", "id", "folder"):
            v = f.get(k)
            if isinstance(v, str) and v:
                ids.append(v)
    for s in (world.get("google_sheets") or {}).get("spreadsheets", []):
        ids.append(s["id"])
    return ids


def calls(world, last):
    names = _names(world)
    ids = _ids(world)

    yield fetch("GET", V3)
    yield fetch("GET", V2, params={"pageSize": 5})
    yield fetch("GET", "drive/v3/files")
    for n in names[:6]:
        word = n.split()[0] if n.split() else n
        for q in [f"name = '{n}'", f'name="{n.upper()}"', f"name contains '{word.lower()}'",
                  f"NAME CONTAINS \"{word}\" and trashed = false", n, n[:3], f"{n} and more text",
                  f"mimeType='application/vnd.google-apps.folder' and name contains '{word}'"]:
            yield fetch("GET", V3, params={"q": q})
    for q in ["", "zz-no-such-file", "name = ''", "trashed = false", 5, ["x"], 0]:
        yield fetch("GET", V3, params={"q": q})
    yield fetch("GET", V3, params={"q": "report"}, body={"pageSize": 3})
    yield fetch("GET", V3, body="[1]")
    yield fetch("GET", V3, params={"world": 1})

    for i in ids[:8]:
        yield fetch("GET", f"{V3}/{i}")
        yield fetch("GET", f"{V3}/{quote(i)}", params={"fields": "id,name"})
    yield fetch("GET", f"{V3}/no-such-file")
    yield fetch("GET", f"{V2}/no-such-file", params=[1])
    yield fetch("GET", f"{V3}/x", params={"fileId": "y"})

    # Writes: create, copy, rename and move, delete, then read them back.
    yield fetch("POST", V3, body={"name": "Q3 Plan", "mimeType": "application/vnd.google-apps.document",
                                   "parents": ["folder_1"]})
    made = last()
    yield fetch("POST", V3, params={"name": "From Params"}, body={"parents": "folder_x"})
    yield fetch("POST", V3, body={})
    yield fetch("POST", V3, body={"name": "Odd", "parents": [], "description": "extra"})
    yield fetch("POST", V3, body={"name": 5, "parents": [[1]]})
    yield fetch("POST", V3, body="[1]")
    new_id = made.get("id") if isinstance(made, dict) else None
    targets = ([new_id] if new_id else []) + ids[:3]
    for t in targets:
        yield fetch("POST", f"{V3}/{t}/copy", body={"name": f"Copy {t}", "parents": ["dest"]})
        yield fetch("POST", f"{V3}/{t}/copy", body={})
        yield fetch("PATCH", f"{V3}/{t}", params={"addParents": "p1, p2", "removeParents": "old"},
                    body={"name": "Renamed File"})
        yield fetch("GET", f"{V3}/{t}")
        yield fetch("GET", V3, params={"q": "name contains 'renamed'"})
        yield fetch("PATCH", f"{V3}/{t}", body={"addParents": "solo"})
    yield fetch("POST", f"{V3}/abc/copy", body={"parents": "one"})
    yield fetch("POST", f"{V3}/abc/copy", body={"parents": [["deep"]]})
    yield fetch("PATCH", f"{V3}/abc", body={"addParents": ","})
    yield fetch("PATCH", f"{V3}/abc", body={"addParents": 5})
    yield fetch("PATCH", f"{V3}/abc", body={"removeParents": ["a"]})
    yield fetch("PATCH", f"{V3}/abc", body={"fileId": "x"})
    yield fetch("PATCH", f"{V3}/abc", body={})
    yield fetch("GET", V3)
    for t in targets[:2]:
        yield fetch("DELETE", f"{V3}/{t}")
    yield fetch("DELETE", f"{V3}/nope", body={"anything": 1})
    yield fetch("GET", V3, params={"q": "copy"})
    yield fetch("PUT", f"{V3}/abc")
    yield fetch("GET", f"{V3}/abc/children")
