"""Basecamp3 calls: its one route (todos create), its writes, and error
cases."""
import json

KNOWN = {}

BASE = "https://3.basecampapi.com/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


TODOS = "999/buckets/proj1/todosets/ts1/todolists/tl1/todos"


def calls(world, last):
    yield fetch("POST",
                TODOS,
                body={
                    "content": "Review compliance checklist",
                    "due_on": "2026-03-15"
                })
    yield fetch("POST", TODOS, body={"content": "No due date"})
    yield fetch("POST", TODOS, body={"content": "", "due_on": ""})
    yield fetch("POST", TODOS, body={"content": None, "due_on": 0})
    yield fetch("POST",
                TODOS,
                body={
                    "content": 5,
                    "due_on": ["x"],
                    "assignee_ids": [1, 2],
                    "notes": "extra"
                })
    yield fetch("POST", TODOS, body={})
    yield fetch("POST", TODOS, body={"account_id": "dup"})
    yield fetch("POST", TODOS, body={"world": 1})
    yield fetch("POST", TODOS, body="[1]")
    yield fetch("POST", TODOS, body='"text"')
    yield fetch("POST",
                "999/buckets/p/todosets/t/todolists/l/todos",
                body={"content": "alias host"},
                base="https://3.basecamp.com/")
    yield fetch("POST",
                "basecamp3/1/buckets/2/todosets/3/todolists/4/todos",
                body={"content": "bare"},
                base="")
    yield fetch("GET", TODOS)
    yield fetch("POST",
                "999/buckets/proj1/todolists/tl1/todos",
                body={"content": "wrong path"})
    yield fetch("POST", TODOS + "/", body={"content": "trailing"})
    yield fetch("POST",
                "999/buckets/a%2Fb/todosets/ts/todolists/tl/todos",
                body={"content": "encoded"})
