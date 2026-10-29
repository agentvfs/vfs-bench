"""Confluence calls: the one route of tools/api/routes/confluence.py, with
every body shape, and error cases."""
import json

KNOWN = {}

URL = "https://acme.atlassian.net/wiki/api/v2/pages"


def post(body, url=URL):
    return "api_fetch", {
        "method": "POST",
        "url": url,
        "body": body if isinstance(body, str) else json.dumps(body)
    }


def calls(world, last):
    yield post({
        "spaceId": "SP1",
        "title": "Runbook",
        "body": {
            "representation": "storage",
            "value": "<p>Hi</p>"
        }
    })
    yield post({
        "spaceId": "SP1",
        "title": "Child",
        "parentId": last().get("id"),
        "body": "plain text",
        "status": "draft",
        "cloudId": "c1"
    })
    yield post({
        "space_id": "SP2",
        "title": "Snake",
        "parent_id": "p9",
        "cloud_id": "cx",
        "body": 42
    })
    yield post({"title": "No space", "body": {"value": "v"}})
    yield post({"title": "Empty", "body": ""})
    yield post({"title": "Dict body", "body": {}})
    yield post({"title": 3, "spaceId": 7, "body": ["a"]})
    yield post({"title": "t", "body": None})
    yield post({})
    yield post("[1]")
    yield post({"title": "x"},
               url="https://intranet.example.com/wiki/api/v2/pages")
    yield post({"title": "x"}, url="confluence/wiki/api/v2/pages")
    yield "api_fetch", {"method": "GET", "url": URL}
    yield "api_fetch", {
        "method": "POST",
        "url": "https://acme.atlassian.net/wiki/rest/api/content"
    }
