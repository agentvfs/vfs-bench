"""Mailchimp calls: every route of tools/api/routes/mailchimp.py, with the
task's seeded audiences and subscribers (by address, URL-encoded address and
member hash), writes, and error cases.

A subscriber's tags are a Python set, whose order upstream follows the
process's string hashes: no call here leaves a subscriber with two or more
tags, whose order no port could match (the fake keeps insertion order)."""
import hashlib
import json
from urllib.parse import quote

KNOWN = {}

BASE = "https://us21.api.mailchimp.com/3.0/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    mc = world["mailchimp"]
    lists = [a["id"] for a in mc.get("audiences", [])] or ["list_none"]
    subs = mc.get("subscribers", [])
    lid = lists[0]
    yield fetch("GET", "lists")
    for list_id in lists[:3] + ["nope"]:
        yield fetch("GET", f"lists/{list_id}/members")
    yield fetch("GET", f"lists/{lid}/members", {
        "status": "subscribed",
        "count": 5
    })
    yield fetch("GET", f"lists/{lid}/members", {"status": "archived"})
    yield fetch("GET", f"lists/{lid}/members", {"list_id": "dup"})
    yield fetch("GET", f"lists/{lid}/members", "[1]")
    for s in subs[:4]:
        h = hashlib.md5(s["email"].lower().encode()).hexdigest()
        yield fetch("GET", f"lists/{s['list_id']}/members/{s['email']}")
        yield fetch(
            "GET", f"lists/{s['list_id']}/members/"
            f"{quote(s['email'].upper(), safe='')}")
        yield fetch("GET", f"lists/{s['list_id']}/members/{h}")
    yield fetch("GET", f"lists/{lid}/members/nobody@example.com")
    yield fetch("GET", f"lists/{lid}/members/%E2%9C%93%zz")
    # Creates: new, existing (update path), tag shapes, validation failures.
    for body in [
        {
            "email_address": "new.one@example.com",
            "merge_fields": {
                "FNAME": "New"
            },
            "tags": ["vip"]
        },
        {
            "email": "via.email@example.com",
            "first_name": "Via",
            "last_name": "Email",
            "tags": [{
                "name": "t1"
            }, "t1"]
        },
        {
            "email_address": "Status.Bad@example.com",
            "status": "bogus"
        },
        {
            "email_address": "type.bad@example.com",
            "email_type": "pdf"
        },
        {
            "email_address": "vip.str@example.com",
            "vip": "yes",
            "tags": "a"
        },
        {
            "email_address": "vip.bad@example.com",
            "vip": "maybe"
        },
        {
            "email_address": "tags.dict@example.com",
            "tags": {
                "k": 1
            }
        },
        {
            "email_address": "tags.int@example.com",
            "tags": 5
        },
        {
            "email_address": "tags.unhash@example.com",
            "tags": [{
                "name": ["x"]
            }]
        },
        {
            "email_address": "",
            "status": "pending"
        },
        {
            "email_address": 12
        },
        {
            "email_address": "kw@example.com",
            "language": "fr",
            "location": {
                "x": 1
            },
            "bogus": 1
        },
        {
            "list_id": "dup"
        },
    ]:
        yield fetch("POST", f"lists/{lid}/members", body=body)
    for s in subs[:3]:
        tagged = len(s.get("tags") or [])
        body = {
            "email_address": s["email"].upper(),
            "status": "pending",
            "merge_fields": {
                "LNAME": "Changed"
            },
            "vip": True
        }
        if not tagged:
            body["tags"] = ["added"]
        yield fetch("POST", f"lists/{s['list_id']}/members", body=body)
    yield fetch("POST",
                f"lists/{lid}/members",
                body={
                    "email_address": "new.one@example.com",
                    "status": "archived"
                })
    yield fetch("POST",
                f"lists/{lid}/members",
                body={
                    "email_address": "new.one@example.com",
                    "status": "nope"
                })
    yield fetch("POST", f"lists/{lid}/members", body="[1]")
    # Updates
    for s in subs[:2]:
        yield fetch("PATCH",
                    f"lists/{s['list_id']}/members/{s['email']}",
                    body={
                        "status": "unsubscribed",
                        "merge_fields": {
                            "FNAME": "Up"
                        },
                        "vip": False
                    })
    yield fetch("PUT",
                f"lists/{lid}/members/new.one@example.com",
                body={"email_address": "Renamed.One@example.com"})
    yield fetch("GET", f"lists/{lid}/members/renamed.one@example.com")
    yield fetch("PATCH",
                f"lists/{lid}/members/renamed.one@example.com",
                body={"email_address": 5})
    yield fetch("PATCH",
                f"lists/{lid}/members/renamed.one@example.com",
                body={
                    "status": "cleaned",
                    "vip": "no"
                })
    yield fetch("PATCH",
                f"lists/{lid}/members/renamed.one@example.com",
                body={"status": 3})
    yield fetch("PATCH",
                f"lists/{lid}/members/renamed.one@example.com",
                body={"merge_fields": "x"})
    yield fetch("PATCH",
                f"lists/{lid}/members/nobody@example.com",
                body={"status": "subscribed"})
    yield fetch("PATCH",
                f"lists/{lid}/members/x",
                body={"subscriber_hash": "dup"})
    # Tags (a tagless subscriber gets one, a one-tag subscriber loses its own)
    tagless = [s for s in subs[3:] if not s.get("tags")]
    one = [s for s in subs[3:] if len(s.get("tags") or []) == 1]
    if tagless:
        s = tagless[0]
        yield fetch("POST",
                    f"lists/{s['list_id']}/members/{s['email']}/tags",
                    body={"tags": [{
                        "name": "Hot",
                        "status": "active"
                    }]})
        yield fetch("POST",
                    f"lists/{s['list_id']}/members/{s['email']}/tags",
                    body={
                        "tags": [{
                            "name": "Hot",
                            "status": "inactive"
                        }, {
                            "name": "never",
                            "status": "inactive"
                        }]
                    })
    if one:
        s = one[0]
        yield fetch(
            "POST",
            f"lists/{s['list_id']}/members/{s['email']}/tags",
            body={"tags": [{
                "name": s["tags"][0],
                "status": "inactive"
            }]})
        yield fetch("POST",
                    f"lists/{s['list_id']}/members/{s['email']}/tags",
                    body={"tags": [{
                        "name": s["tags"][0]
                    }]})
    yield fetch("POST",
                f"lists/{lid}/members/vip.str@example.com/tags",
                body={"tags": [{
                    "name": "a"
                }]})
    yield fetch("POST",
                f"lists/{lid}/members/nobody@example.com/tags",
                body={"tags": [{
                    "name": "x"
                }]})
    yield fetch("POST",
                f"lists/{lid}/members/nobody@example.com/tags",
                body={"tags": ["x"]})
    yield fetch("POST",
                f"lists/{lid}/members/nobody@example.com/tags",
                body={"tags": 3})
    yield fetch("POST",
                f"lists/{lid}/members/nobody@example.com/tags",
                body={})
    yield fetch("POST",
                f"lists/{lid}/members/nobody@example.com/tags",
                body="[1]")
    # Notes
    yield fetch("POST",
                f"lists/{lid}/members/vip.str@example.com/notes",
                body={"note": "Called"})
    yield fetch("POST",
                f"lists/{lid}/members/vip.str@example.com/notes",
                body={"body": "Second"})
    yield fetch("POST",
                f"lists/{lid}/members/vip.str@example.com/notes",
                body={})
    yield fetch("POST",
                f"lists/{lid}/members/nobody@example.com/notes",
                body={"note": "x"})
    yield fetch("POST", f"lists/{lid}/members/x/notes", body="[1]")
    yield fetch("GET", f"lists/{lid}/members/vip.str@example.com")
    # Delete
    if subs:
        yield fetch("DELETE",
                    f"lists/{subs[0]['list_id']}/members/{subs[0]['email']}")
    yield fetch("DELETE", f"lists/{lid}/members/nobody@example.com")
    # Lists
    for body in [
        {
            "name": "Spring Promo",
            "contact": {
                "company": "Acme",
                "address1": "1 Way",
                "city": "X",
                "state": "CA",
                "zip": "9",
                "country": "CA"
            },
            "permission_reminder": "You asked."
        },
        {
            "name": "No contact"
        },
        {
            "name": "Null country",
            "contact": {
                "country": None
            }
        },
        {
            "contact": "x"
        },
        {
            "name": 5
        },
        {},
        {
            "world": 1
        },
    ]:
        yield fetch("POST", "lists", body=body)
    yield fetch("GET", "lists")
    # Campaigns
    for body in [
        {
            "recipients": {
                "list_id": lid
            },
            "settings": {
                "subject_line": "Hi",
                "from_name": "Ops",
                "reply_to": "o@x.com",
                "title": "T"
            },
            "content": {
                "html": "<p>x</p>",
                "text": "x"
            }
        },
        {
            "list_id": lid,
            "subject_line": "Flat",
            "from_name": "F",
            "reply_to": "r@x.com",
            "content_html": "h"
        },
        {
            "settings": {
                "subject_line": None
            }
        },
        {
            "recipients": "x"
        },
        {
            "settings": {
                "title": 5
            }
        },
        {},
    ]:
        yield fetch("POST", "campaigns", body=body)
    camp = last() if isinstance(last(), dict) else {}
    for c in [camp.get("id"), "nope"
              ] + [c["id"] for c in mc.get("campaigns", [])[:1]]:
        if c:
            yield fetch("POST", f"campaigns/{c}/actions/send")
    yield fetch("POST",
                "campaigns",
                body={
                    "recipients": {
                        "list_id": lid
                    },
                    "settings": {
                        "subject_line": "S2",
                        "from_name": "a",
                        "reply_to": "b"
                    }
                })
    sent = last() if isinstance(last(), dict) else {}
    if sent.get("id"):
        yield fetch("POST", f"campaigns/{sent['id']}/actions/send")
        yield fetch("POST", f"campaigns/{sent['id']}/actions/send")
    # Tags
    for list_id in [lid, "other"]:
        yield fetch("POST",
                    f"lists/{list_id}/tag-search",
                    body={"name": "Event 2026"})
        yield fetch("POST",
                    f"lists/{list_id}/tag-search",
                    body={"name": "event 2026"})
        yield fetch("GET", f"lists/{list_id}/tag-search",
                    {"name": "EVENT 2026"})
        yield fetch("GET", f"lists/{list_id}/tag-search", {"name": "via get"})
    yield fetch("POST", f"lists/{lid}/tag-search", body={})
    yield fetch("POST", f"lists/{lid}/tag-search", body={"name": 3})
    yield fetch("POST",
                f"lists/{lid}/tag-search",
                body={
                    "name": "x",
                    "extra": 1
                })
    yield fetch("GET", f"lists/{lid}/tag-search", "[1]")
    yield fetch("DELETE", "lists")
    yield fetch("GET", "lists", base="mailchimp/3.0/")
