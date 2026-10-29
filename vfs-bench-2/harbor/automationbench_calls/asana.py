"""Asana calls: every route of tools/api/routes/asana.py, with the task's
seeded section records, task, tag and section writes, and error cases."""
import json

KNOWN = {}

BASE = "https://app.asana.com/api/1.0/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    actions = world["asana"].get("actions", {})
    sections = [r["params"] for r in actions.get("find_section", [])]
    projects = sorted({s.get("project")
                       for s in sections
                       if s.get("project")}) or ["proj_none"]
    for p in projects[:3]:
        yield fetch("GET", f"projects/{p}/sections")
    yield fetch("GET", "projects/unknown/sections")
    yield fetch("GET", f"projects/{projects[0]}/sections", {
        "limit": 5,
        "offset": "x"
    })
    yield fetch("GET", f"projects/{projects[0]}/sections",
                {"project_gid": "dup"})
    yield fetch("GET", f"projects/{projects[0]}/sections", "[1]")
    yield fetch("POST",
                "tasks",
                body={
                    "data": {
                        "name": "Order supplies",
                        "notes": "Paper",
                        "due_on": "2026-03-10",
                        "assignee": "me",
                        "projects": [projects[0]],
                        "tags": ["t1"]
                    }
                })
    yield fetch("POST",
                "tasks",
                body={
                    "name": "Flat task",
                    "workspace": "ws_flat",
                    "completed": True,
                    "parent": "123"
                })
    yield fetch("POST",
                "tasks",
                body={
                    "name": "By project",
                    "projects": projects[0]
                })
    yield fetch("POST",
                "tasks",
                body={
                    "name": "Unknown project",
                    "projects": ["nope"]
                })
    yield fetch("POST",
                "tasks",
                body={"data": {
                    "completed": None,
                    "workspace": ""
                }})
    yield fetch("POST", "tasks", body={"data": "x", "name": "data not dict"})
    yield fetch("POST", "tasks", body={"data": {}, "name": "empty data"})
    yield fetch("POST", "tasks", body={"name": "", "notes": ""})
    yield fetch("POST", "tasks", body={})
    yield fetch("POST", "tasks", body={"bogus": 1})
    yield fetch("POST", "tasks", body="[1]")
    yield fetch("POST", "tasks/123/addTag", body={"tag": "urgent"})
    yield fetch("POST", "tasks/123/addTag", body={"data": {"tag": "via-data"}})
    yield fetch("POST",
                "tasks/123/addTag",
                body={
                    "data": {
                        "other": 1
                    },
                    "tag": "kept"
                })
    yield fetch("POST", "tasks/123/addTag", body={})
    yield fetch("POST", "tasks/123/addTag", body={"task_gid": "dup"})
    yield fetch("POST", "tasks/123/addTag", body={"world": 1})
    for s in sections[:2]:
        yield fetch("POST",
                    f"sections/{s.get('section') or s.get('id')}/addTask",
                    body={"task": "t1"})
    yield fetch("POST",
                "sections/sec_none/addTask",
                body={
                    "data": {
                        "task": "t2",
                        "insert_before": "t1",
                        "insert_after": None
                    }
                })
    yield fetch("POST",
                "sections/sec_none/addTask",
                body={
                    "task": "",
                    "insert_after": "x"
                })
    yield fetch("POST",
                "sections/sec_none/addTask",
                body={"section_gid": "dup"})
    yield fetch("POST", "sections/sec_none/addTask", body="[2]")
    for p in projects[:1]:
        yield fetch("GET", f"projects/{p}/sections")
    yield fetch("GET", "tasks")
    yield fetch("POST", "projects/x/sections")
    yield fetch("POST", "tasks", body={"name": "bare"}, base="asana/1.0/")
