"""Airtable calls: every route of tools/api/routes/airtable.py, over the
task's seeded bases and find records, record and comment writes, and error
cases (unknown bases, non-dict bodies and params, odd field filters and
page sizes)."""
import json

KNOWN = {}

BASE = "https://api.airtable.com/v0/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    state = world["airtable"]
    bases = state.get("bases", [])
    pairs = []
    for b in bases:
        for t in b.get("tables", []):
            pairs.append((b.get("id"), t.get("id"), t.get("name"),
                          [r.get("id") for r in t.get("records", [])],
                          sorted({
                              k
                              for r in t.get("records", [])
                              for k in r.get("fields", {})
                          })))
    for key in ("findRecord", "findManyRecords"):
        for rec in state.get("actions", {}).get(key, []):
            p = rec["params"]
            pairs.append((p.get("applicationId"), p.get("tableName"),
                          p.get("tableName"), [], []))
    if not pairs:
        pairs = [("appNONE", "tblNONE", "None Table", [], [])]
    yield fetch("GET", "meta/bases")
    for base_id in sorted({str(p[0]) for p in pairs}) + ["appUNKNOWN"]:
        yield fetch("GET", f"meta/bases/{base_id}/tables")
    for base_id, table_id, name, recs, fields in pairs[:4]:
        yield fetch("GET", f"{base_id}/{table_id}")
        yield fetch("GET", f"{base_id}/{name}")
        yield fetch("GET", f"{base_id}/{table_id}", {"pageSize": 2})
        yield fetch("GET", f"{base_id}/{table_id}", {"pageSize": "1"})
        yield fetch("GET", f"{base_id}/{table_id}", {"pageSize": 0})
        yield fetch("GET", f"{base_id}/{table_id}", {"pageSize": -1})
        yield fetch("GET", f"{base_id}/{table_id}", {"pageSize": 2.7})
        yield fetch("GET", f"{base_id}/{table_id}", {"pageSize": "x"})
        yield fetch("GET", f"{base_id}/{table_id}", {"pageSize": [1]})
        yield fetch("GET", f"{base_id}/{table_id}", {"fields": fields[:2]})
        yield fetch("GET", f"{base_id}/{table_id}",
                    {"fields": ",".join(fields[:3])})
        yield fetch("GET", f"{base_id}/{table_id}", {"fields": 3})
        yield fetch("GET", f"{base_id}/{table_id}", {"fields": {"Status": 1}})
        yield fetch("GET", f"{base_id}/{table_id}", {
            "filterByFormula": "{Status}='Pending'",
            "view": "Grid"
        })
        yield fetch("GET", f"{base_id}/{table_id}", {
            "filterByFormula": "",
            "view": ""
        })
        yield fetch("GET", f"{base_id}/tblMISSING")
        yield fetch("GET", f"{base_id}/{table_id}", "[1]")
        yield fetch("GET", f"{base_id}/{table_id}", "7")
        rid = recs[0] if recs else "recNEW"
        yield fetch("PATCH",
                    f"{base_id}/{table_id}/{rid}",
                    body={"fields": {
                        "Status": "Approved",
                        "Amount": 1.5
                    }})
        yield fetch("PATCH",
                    f"{base_id}/{table_id}/{rid}",
                    body={
                        "Status": "Rejected",
                        "Reason": "No receipt"
                    })
        yield fetch("PATCH", f"{base_id}/{table_id}/{rid}", body={})
        yield fetch("PATCH",
                    f"{base_id}/{table_id}/{rid}",
                    body={"fields": {}})
        yield fetch("PATCH",
                    f"{base_id}/{table_id}/{rid}",
                    body={"fields": "text"})
        yield fetch("PATCH", f"{base_id}/{table_id}/{rid}", body="[1, 2]")
        yield fetch("PATCH", f"{base_id}/{table_id}/{rid}", body='"str"')
        yield fetch("POST",
                    f"{base_id}/{table_id}/{rid}/comments",
                    body={"text": "Approved per policy"})
        yield fetch("POST", f"{base_id}/{table_id}/{rid}/comments", body={})
        yield fetch("POST",
                    f"{base_id}/{table_id}/{rid}/comments",
                    body={"text": 5})
        yield fetch("POST",
                    f"{base_id}/{table_id}/{rid}/comments",
                    body={"text": {}})
        yield fetch("POST", f"{base_id}/{table_id}/{rid}/comments", body="[]")
        yield fetch("POST",
                    f"{base_id}/{table_id}",
                    body={
                        "fields": {
                            "Name": "New",
                            "Count": 2,
                            "Ok": True,
                            "N": None
                        }
                    })
        yield fetch("POST", f"{base_id}/{table_id}", body={"Name": "Flat"})
        yield fetch("POST", f"{base_id}/{table_id}", body={"fields": ["a"]})
        yield fetch("POST", f"{base_id}/{table_id}", body={"fields": None})
        yield fetch("POST", f"{base_id}/{table_id}", body={})
        yield fetch("POST", f"{base_id}/{table_id}", body="3")
        yield fetch("GET", f"{base_id}/{table_id}")
    yield fetch("POST", "appUNKNOWN/tblX", body={"fields": {"a": 1}})
    yield fetch("GET", "appUNKNOWN/tblX")
    yield fetch("PATCH", "appUNKNOWN/tblX/rec1", body={"fields": {"a": 1}})
    yield fetch("DELETE", "appX/tblX/rec1")
    yield fetch("GET", "meta/bases/x/y")
    yield fetch("GET", "meta/bases", base="https://api.airtable.com/v0/")
    yield fetch("GET", "airtable/v0/meta/bases", base="")
    yield fetch("GET", "meta/bases")
