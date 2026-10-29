"""Jira calls: every route of tools/api/routes/jira.py, with the task's
seeded project records, the issue and comment writes, and error cases."""
import json

KNOWN = {}

BASE = "https://acme.atlassian.net/rest/api/3/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    projects = [r["params"] for r in world["jira"].get("actions", {}).get("project", [])]
    yield fetch("GET", "project/search")
    for p in projects[:3]:
        yield fetch("GET", "project/search", {"query": p.get("searchByParameter", "")})
    yield fetch("GET", "project/search", {"query": "nothing"})
    yield fetch("GET", "project/search", {"query": 3, "maxResults": 1})
    yield fetch("GET", "project/search", {"other": 1})
    yield fetch("GET", "project/search", "[]")
    key = projects[0].get("project", "OPS") if projects else "OPS"
    yield fetch("POST", "issue", body={"fields": {"project": {"key": key}, "issuetype": {"name": "Bug"},
                                                  "summary": "Printer jam", "priority": {"name": "High"},
                                                  "description": {"type": "doc", "content": []}}})
    issue = last().get("key") if isinstance(last(), dict) else "OPS-1"
    yield fetch("POST", "issue", body={"fields": {"project": key, "issuetype": "Task", "summary": "Flat",
                                                  "priority": "Low"}})
    yield fetch("POST", "issue", body={"project": "FLAT", "summary": "No fields", "priority": "Medium",
                                       "description": "plain"})
    yield fetch("POST", "issue", body={"fields": {}, "summary": "Empty fields"})
    yield fetch("POST", "issue", body={"fields": {"project": 5, "issuetype": {"id": "1"}, "summary": None}})
    yield fetch("POST", "issue", body={"fields": {"project": {"id": 1}, "description": None}, "description": "d"})
    yield fetch("POST", "issue", body={"fields": "x"})
    yield fetch("POST", "issue", body={"project": "", "summary": ""})
    yield fetch("POST", "issue", body={"project": 1.5, "summary": "float key"})
    yield fetch("POST", "issue", body={"bogus": 1})
    yield fetch("POST", "issue", body="[1]")
    yield fetch("POST", "issue", body={"world": 1})
    yield fetch("POST", f"issue/{issue}/comment", body={"body": "Looking into it"})
    yield fetch("POST", f"issue/{issue}/comment", body={"comment": "legacy"})
    yield fetch("POST", f"issue/{issue}/comment", body={"text": "text"})
    yield fetch("POST", f"issue/{issue}/comment", body={"body": {"type": "doc", "content": [{"text": "adf"}]}})
    yield fetch("POST", f"issue/{issue}/comment", body={})
    yield fetch("POST", f"issue/{issue}/comment", body="[1]")
    yield fetch("POST", "issue/X-1/comment", body={"body": ""})
    yield fetch("GET", "project/search")
    yield fetch("GET", "issue/X-1")
    yield fetch("POST", "project/search")
    yield fetch("GET", "rest/api/3/project/search", base="jira/")
    yield fetch("POST", "issue", body={"summary": "bare path"}, base="jira/rest/api/3/")
