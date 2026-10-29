"""Twitter calls: every route of tools/api/routes/twitter.py, with the
task's seeded users and tweets, writes that later reads see, and error
cases."""
import json

KNOWN = {}

BASE = "https://api.twitter.com/2/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    tw = world["twitter"]
    users = tw.get("users", [])
    tweets = tw.get("tweets", [])
    me = tw.get("authenticated_user_id")
    yield fetch("GET", "users/me")
    yield fetch("GET", "users/me", {"user.fields": "x"})
    for u in users[:4]:
        yield fetch("GET", f"users/by/username/{u['username']}")
        yield fetch("GET", f"users/by/username/@{u['username'].upper()}")
        yield fetch("GET", f"users/by/username/{u['id']}")
    yield fetch("GET", "users/by/username/nobody_here")
    yield fetch("GET", "tweets/search/recent", {"query": ""})
    words = [t["text"].split()[0]
             for t in tweets[:3] if t.get("text")] or ["the"]
    for w in words:
        yield fetch("GET", "tweets/search/recent", {"query": w})
        yield fetch("GET", "tweets/search/recent", {
            "query": w.upper(),
            "max_results": 1
        })
    yield fetch("GET", "tweets/search/recent", {"query": "zzzz-none"})
    yield fetch("GET", "tweets/search/recent", {
        "query": "",
        "max_results": "2"
    })
    yield fetch("GET", "tweets/search/recent", {
        "query": "",
        "max_results": -1
    })
    yield fetch("GET", "tweets/search/recent", {
        "query": "",
        "max_results": 2.7
    })
    yield fetch("GET", "tweets/search/recent", {
        "query": "",
        "max_results": "x"
    })
    yield fetch("GET", "tweets/search/recent", {
        "query": "",
        "max_results": [1]
    })
    yield fetch("GET", "tweets/search/recent", {"query": 5})
    yield fetch("GET", "tweets/search/recent", {
        "query": "a",
        "tweet.fields": "author_id"
    })
    # Writes.
    yield fetch("POST", "tweets", body={"text": "Thanks for the shout-out!"})
    first = last()
    tid = first.get("data", {}).get("id") if isinstance(first, dict) else None
    reply_to = tweets[0]["id"] if tweets else tid
    yield fetch("POST",
                "tweets",
                body={
                    "text": "Replying",
                    "reply": {
                        "in_reply_to_tweet_id": reply_to
                    }
                })
    yield fetch("POST",
                "tweets",
                body={
                    "text": "Reply to unknown",
                    "reply": {
                        "in_reply_to_tweet_id": "999"
                    }
                })
    yield fetch("POST",
                "tweets",
                body={
                    "text": "Reply not dict",
                    "reply": "x"
                })
    yield fetch("POST", "tweets", body={"text": "Empty reply", "reply": {}})
    yield fetch("POST", "tweets", body={})
    yield fetch("POST", "tweets", body={"text": 5})
    yield fetch("POST",
                "tweets",
                body={
                    "text": "bad reply id",
                    "reply": {
                        "in_reply_to_tweet_id": 7
                    }
                })
    yield fetch("GET", "tweets/search/recent", {"query": "repl"})
    for u in users[1:4]:
        yield fetch("POST",
                    f"users/{me}/following",
                    body={"target_user_id": u["id"]})
        yield fetch("POST",
                    f"users/{me}/following",
                    body={"target_user_id": "@" + u["username"]})
        yield fetch("POST",
                    f"users/{me}/following",
                    body={"target_user_id": u["username"].upper()})
    yield fetch("POST",
                f"users/{me}/following",
                body={"target_user_id": "@stranger"})
    yield fetch("POST",
                f"users/{me}/following",
                body={"target_user_id": "STRANGER"})
    yield fetch("POST", f"users/{me}/following", body={})
    yield fetch("POST", f"users/{me}/following", body={"target_user_id": 3})
    yield fetch("POST",
                f"users/{me}/following",
                body={
                    "id": me,
                    "target_user_id": "x",
                    "extra": 1
                })
    for t in tweets[:3]:
        yield fetch("POST", f"users/{me}/likes", body={"tweet_id": t["id"]})
        yield fetch("POST", f"users/{me}/likes", body={"tweet_id": t["id"]})
    if tid:
        yield fetch("POST", f"users/{me}/likes", body={"tweet_id": tid})
    yield fetch("POST", f"users/{me}/likes", body={"tweet_id": "nope"})
    yield fetch("POST", f"users/{me}/likes", body={})
    yield fetch("POST", f"users/{me}/likes", body={"tweet_id": 12})
    yield fetch("GET", "tweets/search/recent", {"query": ""})
    # Calls Python cannot bind, and routes that are not there.
    yield fetch("POST", "tweets", body={"world": 1})
    yield fetch("POST", "tweets", body="[1]")
    yield fetch("GET", "tweets/search/recent", "[1]")
    yield fetch("GET", "tweets/search/recent", {"query": "", "bogus": 1})
    yield fetch("POST", f"users/{me}/likes", body='"x"')
    yield fetch("GET", "tweets")
    yield fetch("DELETE", "tweets")
    yield fetch("GET", "users/me", base="twitter/2/")
