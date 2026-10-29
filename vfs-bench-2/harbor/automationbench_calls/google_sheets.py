"""Google Sheets calls: every route, with ids and titles from the task's
world and the replies before, writes of every value shape, and the errors."""
import json
from urllib.parse import quote

KNOWN = {}

BASE = "https://sheets.googleapis.com/v4/spreadsheets"


def fetch(method, url, params=None, body=None):
    args = {"method": method, "url": url}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    gs = world.get("google_sheets") or {}
    sheets = gs.get("spreadsheets", [])
    tabs = gs.get("worksheets", [])
    rows = gs.get("rows", [])
    ss_ids = [s["id"] for s in sheets][:3] or ["missing_ss"]
    alt = {
        "www": "https://www.googleapis.com/sheets/v4/spreadsheets",
        "hall": "https://www.sheets.googleapis.com/v4/spreadsheets",
    }

    # Spreadsheet reads, by id, by title, unknown, and the other hosts.
    for ss in ss_ids:
        yield fetch("GET", f"{BASE}/{ss}")
    if sheets:
        yield fetch("GET", f"{BASE}/{quote(sheets[0]['title'])}")
        yield fetch("GET", f"{alt['www']}/{sheets[0]['id']}")
        yield fetch("GET", f"{alt['hall']}/{sheets[0]['id']}")
    yield fetch("GET", f"{BASE}/nope")
    yield fetch("GET", f"{BASE}/{ss_ids[0]}", params={"includeGridData": True, "extra": 1})
    yield fetch("GET", f"{BASE}/{ss_ids[0]}", params=[1])
    yield fetch("GET", f"{BASE}/{ss_ids[0]}", params={"world": 1})

    # Values: every range shape on each worksheet.
    for ws in tabs[:4]:
        ss, title = ws["spreadsheet_id"], ws["title"]
        q = quote(title)
        for rng in [title, f"{title}!A1:Z100", f"'{title}'!A1:Z", f"{title}!A2:C10", f"{title}!B5",
                    f"{title}!A:C", f"{title}!A100:Z200", f"{ws['id']}!A1:D3", f"{title.upper()}!A1:B2",
                    "A1:C5", "B2", "A:C", "Sheet1", "NoSuchTab!A1:B2", f"{q}!A1:Z9", f"{title}!a1:z9"]:
            yield fetch("GET", f"{BASE}/{ss}/values/{quote(rng, safe='!:')}")
        yield fetch("GET", f"{BASE}/{ss}/values/{q}", params={"maxResults": 2})
        yield fetch("GET", f"{BASE}/{ss}/values/{q}", params={"rowCount": "3", "firstRow": 3})
        yield fetch("GET", f"{BASE}/{ss}/values/{q}", params={"firstRow": 0, "majorDimension": "COLUMNS"})
        yield fetch("GET", f"{BASE}/{ss}/values/{q}", params={"rowCount": -1})
        yield fetch("GET", f"{BASE}/{ss}/values/{q}", params={"rowCount": "x"})
        yield fetch("GET", f"{BASE}/{ss}/values/{q}", params={"rowCount": 2.7})
        yield fetch("GET", f"{BASE}/{ss}/values:batchGet",
                    params={"ranges": [title, f"{title}!A2:B4", "A1:B2"]})
        yield fetch("GET", f"{BASE}/{ss}/values:batchGet", params={"ranges": f"{title}, {title}!A3:C3 ,"})
        yield fetch("GET", f"{BASE}/{ss}/values:batchGet", params={"ranges": [title, "Nope!A1"]})
        yield fetch("GET", f"{BASE}/{ss}/values:batchGet", params={"ranges": [5]})
        yield fetch("GET", f"{BASE}/{ss}/values:batchGet", params={"ranges": [[1]]})
        yield fetch("GET", f"{BASE}/{ss}/values:batchGet")
        # By spreadsheet title in the path.
        title_of = next((s["title"] for s in sheets if s["id"] == ss), None)
        if title_of:
            yield fetch("GET", f"{BASE}/{quote(title_of)}/values/{q}!A1:C3")
            yield fetch("GET", f"{BASE}/{quote(title_of.lower().replace(' ', '_'))}/values/{q}")

    # Lookups on the columns each worksheet's rows hold.
    for ws in tabs[:3]:
        ss = ws["spreadsheet_id"]
        wrows = [r for r in rows if r["worksheet_id"] == ws["id"] and r["spreadsheet_id"] == ss]
        if not wrows:
            continue
        cells = wrows[0]["cells"]
        keys = list(cells)
        if not keys:
            continue
        k0, v0 = keys[0], cells[keys[0]]
        for params in [{"lookupKey": k0, "lookupValue": str(v0)},
                       {"lookup_key": k0, "lookup_value": str(v0).upper(), "rowCount": 1},
                       {"lookupKey": k0, "lookupValue": v0},
                       {"lookupKey": k0, "lookupValue": str(v0), "bottomUp": "true", "row_count": "2"},
                       {"lookupKey": k0, "lookupValue": str(v0), "lookupKeySupport": keys[-1],
                        "lookupValueSupport": str(cells[keys[-1]])},
                       {"lookupKey": 5, "lookupValue": "x"}, {"lookupKey": [1], "lookupValue": "x"},
                       {"lookupKey": k0, "lookupValue": "zz-none", "rowCount": 0}, {}]:
            yield fetch("GET", f"{BASE}/{ss}/values/{quote(ws['title'])}:lookup", params=params)
        yield fetch("GET", f"{BASE}/{ss}/values/{ws['id']}:lookup", body={"lookupKey": k0, "lookupValue": str(v0)})
        yield fetch("GET", f"{BASE}/{ss}/values/{ws['id']}:lookup", params={"rowCount": "x", "lookupKey": k0})

    # Writes: append in every shape.
    for ws in tabs[:3]:
        ss, q = ws["spreadsheet_id"], quote(ws["title"])
        yield fetch("POST", f"{BASE}/{ss}/values/{q}:append",
                    body={"values": [["a", 1, 2.5, True, None, 3.0], ["b"]], "valueInputOption": "RAW"})
        yield fetch("POST", f"{BASE}/{ss}/values/{q}!A1:C1:append", params={"valueInputOption": "USER_ENTERED"},
                    body={"values": [[f"x{i}" for i in range(30)]]})
        yield fetch("POST", f"{BASE}/{ss}/values/{q}:append", body={"values": ["flat", "row"]})
        yield fetch("POST", f"{BASE}/{ss}/values/{q}:append", body={"values": [[["nested"]]]})
        yield fetch("POST", f"{BASE}/{ss}/values/{q}:append", body={"values": []})
        yield fetch("POST", f"{BASE}/{ss}/values/{q}:append", body={"cells": {"A": 1}})
        yield fetch("POST", f"{BASE}/{ss}/values/Nope!A1:append", body={"values": [["x"]]})
        yield fetch("GET", f"{BASE}/{ss}/values/{q}")
        yield fetch("POST", f"{BASE}/{ss}/values/{q}:append", body="[1]")
        yield fetch("POST", f"{BASE}/{ss}/values/{q}:append", body={"values": [["y"]], "range_str": "X"})

    # Updates: A1 writes over existing rows, new rows, the row-by-id forms.
    for ws in tabs[:3]:
        ss, title = ws["spreadsheet_id"], ws["title"]
        q = quote(title)
        wrows = [r for r in rows if r["worksheet_id"] == ws["id"] and r["spreadsheet_id"] == ss]
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!A2:C3", params={"valueInputOption": "USER_ENTERED"},
                    body={"values": [["u1", 7, False], ["u2"]]})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!C4", body={"values": [[1.0]], "valueInputOption": "RAW"})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!A2:A2", body={"values": [["same"]], "range": f"{title}!D2"})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!B60", body={"values": [["far", "row"]]})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!AB2", body={"values": [["wide"]]})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}", body={"values": [["whole"]]})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!A2", body={"values": "nope"})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!A2", body={"values": [{"a": 1}]})
        yield fetch("PUT", f"{BASE}/{ss}/values/Nope!A2", body={"values": [["x"]]})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!A2", body={"values": [["x"]], "range": 5})
        if wrows:
            r = wrows[-1]
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/rows/{r['row_id']}",
                        body={"cells": {list(r['cells'])[0] if r['cells'] else 'A': "changed"},
                              "backgroundColor": "#ff0000", "textFormatBold": "yes"})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}!rows/{r['id']}",
                        body={"cells": json.dumps(r['cells']), "textColor": "#000"})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/rows/{r['row_id']}",
                        body={"cells": "{not json", "textFormatItalic": True, "textFormatStrikethrough": "1"})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/rows/{r['row_id']}", body={"cells": "[1, 2]"})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/rows/{r['row_id']}", body={"backgroundColor": 5})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/rows/{r['row_id']}", body={"rowId": 5})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/{r['id']}",
                        body={"values": [["p", "q"]], "range": f"{title}!B2"})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/{r['row_id']}x", body={"cells": {"Z": 1}, "drive": "d"})
            yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/row9", body={"cells": "[]", "values": [["v"]]})
        yield fetch("PUT", f"{BASE}/{ss}/values/{ws['id']}/rows/999999", body={"cells": {"A": 1}})
        yield fetch("PUT", f"{BASE}/{ss}/values/{q}!A1:Z2", body={"values": [["h"], ["again"]]})
        yield fetch("GET", f"{BASE}/{ss}/values/{q}")

    # Clears.
    for ws in tabs[:3]:
        ss, title = ws["spreadsheet_id"], ws["title"]
        q = quote(title)
        for rng in [f"{q}!B2:C3", f"{q}!A4", f"{q}!B2:B", f"{q}!AA1:AB9", f"{q}!1:2", "Nope!A1"]:
            yield fetch("POST", f"{BASE}/{ss}/values/{rng}:clear")
        yield fetch("GET", f"{BASE}/{ss}/values/{q}")
    if len(tabs) > 3:
        yield fetch("POST", f"{BASE}/{tabs[3]['spreadsheet_id']}/values/{quote(tabs[3]['title'])}:clear", body={})
        yield fetch("POST", f"{BASE}/{tabs[3]['spreadsheet_id']}/values/{quote(tabs[3]['title'])}:clear", body={"x": 1})

    # Spreadsheets: create in every shape.
    yield fetch("POST", BASE, body={"properties": {"title": "Report Q3"}, "sheets": [{"properties": {"title": "Data"}}, {}, "x"]})
    new = last()
    yield fetch("POST", BASE, body={"title": "With Headers", "headers": ["Name", "Email", "Score"]})
    with_headers = last()
    yield fetch("POST", BASE, body={"title": "Json Headers", "headers": '["A", "B"]', "spreadsheetToCopy": "x"})
    yield fetch("POST", BASE, body={"title": "Bad", "headers": "{oops"})
    yield fetch("POST", BASE, body={"title": 5})
    yield fetch("POST", BASE, body={"headers": [1, 2]})
    yield fetch("POST", BASE, body={"sheets": [{"properties": "x"}]})
    yield fetch("POST", BASE, body={"properties": {"title": 7}})
    yield fetch("POST", BASE, body={"properties": {}, "drive": "my"})
    yield fetch("POST", BASE, body=[1])
    for made in (new, with_headers):
        if isinstance(made, dict) and made.get("spreadsheetId"):
            sid = made["spreadsheetId"]
            yield fetch("GET", f"{BASE}/{sid}")
            yield fetch("POST", f"{BASE}/{sid}/values/Sheet1:append", body={"values": [["n", "e@x.com", 9]]})
            yield fetch("POST", f"{BASE}/{sid}/values/Data:append", body={"values": [["n", "e@x.com", 9]]})
            yield fetch("GET", f"{BASE}/{sid}/values/Sheet1")
            yield fetch("GET", f"{BASE}/{sid}/values/A1:C3")

    # batchUpdate: add, rename, delete.
    ss = ss_ids[0]
    yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": [
        {"addSheet": {"properties": {"title": "Added", "index": 3}}}, {"addSheet": {}}, "skip"]})
    added = last()
    sid = None
    if isinstance(added, dict) and added.get("replies"):
        sid = added["replies"][0]["addSheet"]["properties"]["sheetId"]
    yield fetch("GET", f"{BASE}/{ss}")
    if sid:
        yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": [
            {"updateSheetProperties": {"properties": {"sheetId": sid, "title": "Renamed"}, "fields": "title"}}]})
        yield fetch("POST", f"{BASE}/{ss}/sheets/{sid}:copyTo", body={"destinationSpreadsheetId": ss_ids[-1]})
        yield fetch("POST", f"{BASE}/{ss}/sheets/{sid}:copyTo", body={})
        yield fetch("POST", f"{BASE}/{ss}/sheets/{sid}:copyTo", body={"destinationSpreadsheetId": 3})
        yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": [
            {"updateSheetProperties": {"properties": {"sheetId": sid, "title": 9}}}]})
        yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": [{"deleteSheet": {"sheetId": sid}},
                                                                          {"deleteSheet": {}}]})
    if tabs:
        yield fetch("POST", f"{BASE}/{tabs[0]['spreadsheet_id']}/sheets/{tabs[0]['id']}:copyTo", body={})
    yield fetch("POST", f"{BASE}/{ss}/sheets/nope:copyTo", body={})
    yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": "x"})
    yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": [{"addSheet": {"properties": "x"}}]})
    yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": [{"updateSheetProperties": {"properties": []}}]})
    yield fetch("POST", f"{BASE}/{ss}:batchUpdate", body={"requests": [{"deleteSheet": {"sheetId": 1.0}}]})
    yield fetch("GET", f"{BASE}/{ss}")

    # Unrouted methods and paths.
    yield fetch("DELETE", f"{BASE}/{ss}")
    yield fetch("PATCH", f"{BASE}/{ss}/values/A1")
    yield fetch("GET", f"https://sheets.googleapis.com/v3/spreadsheets/{ss}")
    yield fetch("GET", f"{BASE}/{ss}/values/Sheet1?x=1")
