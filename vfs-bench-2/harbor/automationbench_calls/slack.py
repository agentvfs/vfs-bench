"""Slack calls: every route of tools/api/routes/slack.py, with the task's
channels, users and messages, writes that later reads see, and error cases."""
import json

KNOWN = {}

BASE = "https://slack.com/api/"


def get(path, params=None):
    args = {"method": "GET", "url": BASE + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    return "api_fetch", args


def post(path, body=None, url=None):
    args = {"method": "POST", "url": (url or BASE) + path}
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    slack = world["slack"]
    channels = slack.get("channels", [])
    users = slack.get("users", [])
    messages = slack.get("messages", [])
    ch = channels[0] if channels else {"id": "CNONE", "name": "none"}
    ch2 = channels[-1] if channels else ch
    user = users[0] if users else {"id": "UNONE", "name": "Nobody"}
    msg = next((m for m in messages if m.get("channel_id") == ch["id"]), None)

    # Reads.
    yield get("conversations.list")
    yield get("conversations.list", {"exclude_archived": True})
    yield get("conversations.list", {"exclude_archived": "false", "limit": 3})
    yield get("conversations.list", {"bogus": 1})
    yield get("conversations.list", "[1]")
    for c in channels[:4]:
        yield get("conversations.info", {"channel": c["id"]})
        yield get("conversations.info", {"channel": "#" + c["name"].upper()})
        yield get("conversations.history", {"channel": c["id"]})
        yield get("conversations.members", {"channel": c["name"]})
    yield get("conversations.info", {"channel": "nope"})
    yield get("conversations.info", {"channel": 5})
    yield get("conversations.info", {})
    yield get("conversations.history", {"channel": ch["id"], "limit": 2})
    yield get("conversations.history", {"channel": ch["id"], "limit": "3"})
    yield get("conversations.history", {"channel": ch["id"], "limit": -1})
    yield get("conversations.history", {"channel": ch["id"], "limit": "x"})
    yield get("conversations.history", {"channel": ch["id"], "limit": None})
    yield get("conversations.history", {"channel": ch["id"], "limit": 2.5})
    yield get(f"channels/{ch['id']}/messages", {"limit": 1})
    yield get(f"channels.{ch['name']}/messages")
    yield get(f"channels/{ch['id']}/messages", {"channel": "x"})
    yield get("channels.history", {"channel": ch2["id"]})
    yield get("conversations.history", {"channel": "nope"})
    if msg:
        yield get("conversations.replies", {
            "channel": ch["id"],
            "ts": msg["ts"]
        })
        yield get("reactions.get", {
            "channel": ch["id"],
            "timestamp": msg["ts"]
        })
    yield get("conversations.replies", {"channel": "nope", "ts": "1"})
    yield get("search.messages", {"query": "the"})
    yield get("search.messages", {"query": "THE", "sort": "timestamp"})
    yield get("search.messages", {
        "query": "a",
        "sort": "timestamp",
        "sort_dir": "asc"
    })
    yield get("search.messages", {"query": ""})
    yield get("search.messages", {"query": 3})
    yield get("users.list")
    yield get("users.list", {"x": 1})
    for u in users[:3]:
        yield get("users.info", {"user": u["id"]})
        if u.get("email"):
            yield get("users.lookupByEmail", {"email": u["email"].upper()})
    yield get("users.info", {"user": "UNOPE"})
    yield get("users.lookupByEmail", {"email": "nobody@nowhere.test"})
    yield get("users.lookupByEmail", {})
    yield get("users.lookupByEmail", {"email": 7})

    # Writes.
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "Status update: all clear"
    })
    ts = last().get("ts") if isinstance(last(), dict) else None
    yield post(
        "chat.postMessage", {
            "channel": "#" + ch["name"],
            "text": "Second note",
            "username": "Bot",
            "thread_ts": ts
        })
    yield post(
        "chat.postMessage", {
            "channel":
            ch["id"],
            "text":
            "Short",
            "blocks": [{
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "Block body"
                }
            }, {
                "type": "section",
                "fields": [{
                    "text": "F1"
                }, {
                    "text": ""
                }, "x"]
            }, {
                "type": "section",
                "text": "plain",
                "accessory": {
                    "text": {
                        "text": "Acc"
                    }
                }
            }, {
                "type": "context",
                "elements": [{
                    "text": "ctx"
                }, {
                    "type": "image"
                }]
            }, "junk"]
        })
    yield post(
        "chat.postMessage", {
            "channel": ch["id"],
            "blocks": json.dumps([{
                "text": {
                    "text": "Only blocks"
                }
            }])
        })
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "Short",
        "blocks": "not json"
    })
    yield post(
        "chat.postMessage", {
            "channel": ch["id"],
            "text": "Block body",
            "blocks": [{
                "text": {
                    "text": "Block body"
                }
            }]
        })
    yield post(
        "chat.postMessage", {
            "channel": ch["id"],
            "attachments": [{
                "fallback": "fb text"
            }, {
                "text": "t2"
            }]
        })
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "attachments": [1, {
            "text": ""
        }, {
            "text": "att"
        }]
    })
    yield post("chat.postMessage", {"channel": ch["id"]})
    yield post("chat.postMessage", {"channel": ch["id"], "text": 5})
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": 5,
        "blocks": [{
            "text": "x"
        }]
    })
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": ["x"],
        "blocks": [{
            "text": "x"
        }]
    })
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "x",
        "blocks": [{
            "text": 5
        }]
    })
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "x",
        "blocks": [{
            "fields": None
        }]
    })
    yield post("chat.postMessage", {"channel": "nowhere", "text": "x"})
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "x",
        "username": 9
    })
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "x",
        "unknown": True
    })
    yield post("chat.postMessage", "[1]")
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "via www"
    },
               url="https://www.slack.com/api/")
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "via root"
    },
               url="https://slack.com/")
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "via google"
    },
               url="https://slack.googleapis.com/")
    for u in users[:2]:
        yield post("chat.postMessage", {
            "channel": u["id"],
            "text": "DM by id"
        })
        if u.get("username"):
            yield post("chat.postMessage", {
                "channel": "@" + u["username"],
                "text": "DM by username"
            })
        if u.get("email"):
            yield post("chat.postMessage", {
                "channel": u["email"],
                "text": "DM by email"
            })
    yield post(
        "chat.postMessage", {
            "channel": ch["id"],
            "text": "Thread reply",
            "thread_ts": msg["ts"] if msg else "1"
        })
    yield post("chat.postMessage", {
        "channel": ch["id"],
        "text": "Another",
        "thread_ts": "999.000001"
    })
    if msg:
        yield get("conversations.replies", {
            "channel": ch["id"],
            "ts": msg["ts"]
        })
        yield get("conversations.replies", {
            "channel": ch["id"],
            "ts": msg["ts"],
            "limit": 1
        })
        yield post("reactions.add", {
            "channel": ch["id"],
            "timestamp": msg["ts"],
            "name": ":thumbsup:"
        })
        yield post("reactions.add", {
            "channel": ch["name"],
            "timestamp": msg["ts"],
            "name": "thumbsup"
        })
        yield post("reactions.add", {
            "channel": ch["id"],
            "timestamp": msg["ts"],
            "name": "eyes"
        })
        yield get("reactions.get", {
            "channel": ch["name"],
            "timestamp": msg["ts"]
        })
        yield post("chat.update", {
            "channel": ch["id"],
            "ts": msg["ts"],
            "text": "Edited text"
        })
        yield post(
            "chat.update", {
                "channel": ch["id"],
                "ts": msg["ts"],
                "blocks": [{
                    "text": {
                        "text": "B"
                    }
                }]
            })
        yield post("chat.update", {
            "channel": ch["id"],
            "ts": msg["ts"],
            "text": 3
        })
        yield get("conversations.history", {"channel": ch["id"]})
        yield post("chat.delete", {"channel": ch["name"], "ts": msg["ts"]})
        yield post("chat.delete", {"channel": ch["id"], "ts": msg["ts"]})
        yield post("chat.update", {
            "channel": ch["id"],
            "ts": msg["ts"],
            "text": "again"
        })
    yield post("reactions.add", {
        "channel": ch["id"],
        "timestamp": "nope",
        "name": "x"
    })
    yield post("reactions.add", {
        "channel": "nope",
        "timestamp": "1",
        "name": "x"
    })
    yield post("reactions.add", {
        "channel": ch["id"],
        "timestamp": (msg or {}).get("ts", "1"),
        "name": 4
    })
    yield get("reactions.get", {"channel": ch["id"], "timestamp": "nope"})
    yield post("chat.update", {"channel": "nope", "ts": "1", "text": "x"})
    yield post("chat.delete", {"channel": 4, "ts": "1"})
    yield get("search.messages", {"query": "status", "sort": "timestamp"})

    yield post("conversations.create", {"name": "New Ops Room"})
    yield post("conversations.create", {"name": "#new-ops-room"})
    yield post("conversations.create", {"name": "Secret", "is_private": True})
    yield post("conversations.create", {
        "name": "Secret2",
        "is_private": "yes"
    })
    yield post("conversations.create", {"name": "Bad", "is_private": "maybe"})
    yield post("conversations.create", {"name": 3})
    yield post("conversations.create", {})
    created = "new-ops-room"
    ids = ",".join(u["id"] for u in users[:2])
    yield post("conversations.invite", {
        "channel": created,
        "users": ids + ", , UNOPE"
    })
    yield post(
        "conversations.invite", {
            "channel": created,
            "users": [u.get("username") or u["id"] for u in users[:3]]
        })
    yield post("conversations.invite", {"channel": created, "users": 5})
    yield post("conversations.invite", {"channel": created, "users": [5]})
    yield post("conversations.invite", {"channel": "nope", "users": ids})
    yield post("conversations.setTopic", {
        "channel": created,
        "topic": "Weekly ops"
    })
    yield post("conversations.setTopic", {"channel": created, "topic": 12})
    yield post("conversations.setTopic", {"channel": created, "topic": None})
    yield get("conversations.info", {"channel": created})
    yield post("conversations.archive", {"channel": created})
    yield post("conversations.archive", {"channel": created})
    yield post("conversations.invite", {"channel": created, "users": ids})
    yield post("conversations.setTopic", {"channel": created, "topic": "x"})
    yield post("chat.postMessage", {"channel": created, "text": "archived?"})
    yield get("conversations.list", {"exclude_archived": True})
    yield post("conversations.archive", {"channel": "nope"})

    yield post("conversations.open", {"users": ids})
    yield post("conversations.open", {"users": ids})
    if users:
        yield post("conversations.open", {"users": users[0]["name"]})
        yield post("conversations.open",
                   {"users": users[0]["name"].split()[0].lower()})
    yield post("conversations.open", {"users": "UNOPE"})
    yield post("conversations.open", {"users": ","})
    yield post("conversations.open", {"users": ["a"]})
    yield post("conversations.open", {})
    yield post("conversations.open", {"channel": ch["id"]})
    yield post("conversations.open", {"channel": "nope"})

    yield post("users.profile.set", {
        "profile": {
            "status_text": "In a meeting",
            "status_emoji": ":calendar:"
        }
    })
    yield post("users.profile.set", {
        "user": user["id"],
        "status_text": "Out",
        "status_emoji": "palm_tree"
    })
    yield post("users.profile.set", {"user": user["id"], "status_text": 3})
    yield post("users.profile.set", {"user": user["id"], "profile": "x"})
    yield post("users.profile.set", {"user": user["id"], "status_emoji": 3})
    yield post("users.profile.set", {"user": "UNOPE"})
    yield get("users.info", {"user": user["id"]})

    # Unrouted.
    yield get("chat.postMessage")
    yield post("conversations.list")
    yield get("nothing.here")
