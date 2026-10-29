"""LinkedIn calls: every route of tools/api/routes/linkedin.py, with the
task's seeded profiles, connections, companies, posts and jobs, writes
(posts, company updates, invitations, messages), and error cases."""
import json

KNOWN = {}

BASE = "https://api.linkedin.com/v2/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    li = world["linkedin"]
    profiles, conns = li.get("profiles", []), li.get("connections", [])
    companies, posts, jobs = li.get("companies", []), li.get("posts", []), li.get("jobs", [])
    yield fetch("GET", "me")
    for p in profiles[:3] + [{"id": "nobody"}]:
        yield fetch("GET", f"people/{p['id']}")
    for c in conns[:2]:
        yield fetch("GET", f"people/{c.get('connected_profile_id') or 'x'}")
    words = []
    for p in profiles[:3]:
        words += [p.get("first_name"), (p.get("headline") or "").split(" ")[0], p.get("current_company"),
                  p.get("location"), (p.get("email") or "")[:4]]
    for c in conns[:2]:
        words += [c.get("first_name"), c.get("company")]
    words = [w for w in words if w]
    yield fetch("GET", "people")
    for w in words[:8]:
        yield fetch("GET", "people", {"keywords": w.upper(), "count": 5})
    for p in profiles[:2]:
        yield fetch("GET", "people", {"company": p.get("current_company") or "Acme", "title": p.get("current_title") or None})
        yield fetch("GET", "people", {"location": p.get("location") or "x", "count": "3"})
    for c in conns[:2]:
        yield fetch("GET", "people", {"company": c.get("company") or "x", "title": c.get("headline") or "x"})
    yield fetch("GET", "people", {"location": "San", "count": 2.7})
    yield fetch("GET", "people", {"count": 0})
    yield fetch("GET", "people", {"count": -3})
    yield fetch("GET", "people", {"count": "x"})
    yield fetch("GET", "people", {"count": None})
    yield fetch("GET", "people", {"keywords": 5})
    yield fetch("GET", "people", {"company": 5})
    yield fetch("GET", "people", {"bogus": 1})
    yield fetch("GET", "people", "[1]")
    # Connections
    yield fetch("GET", "connections")
    yield fetch("GET", "connections", {"start": 1, "count": 2})
    yield fetch("GET", "connections", {"start": 0, "count": 3, "keywords": (conns[0].get("company") if conns else "x") or "x"})
    yield fetch("GET", "connections", {"keywords": "ENG"})
    yield fetch("GET", "connections", {"start": "0", "count": "5"})
    yield fetch("GET", "connections", {"start": "0"})
    yield fetch("GET", "connections", {"start": None})
    yield fetch("GET", "connections", {"start": 1.0})
    yield fetch("GET", "connections", {"start": True, "count": -1})
    yield fetch("GET", "connections", {"keywords": 3})
    yield fetch("GET", "connections", {"q": "viewer", "extra": 1})
    # Organizations
    yield fetch("GET", "organizations")
    for c in companies[:3]:
        yield fetch("GET", "organizations", {"name": c["name"][:4].lower()})
        yield fetch("GET", f"organizations/{c['id']}")
    yield fetch("GET", "organizations", {"name": "zzz"})
    yield fetch("GET", "organizations", {"name": 5})
    yield fetch("GET", "organizations", {"role_type": "ADMIN"})
    yield fetch("GET", "organizations/none")
    # Jobs
    yield fetch("GET", "jobs")
    yield fetch("GET", "jobs", {"keywords": "x"})
    for j in jobs[:2] + [{"id": "nojob"}]:
        yield fetch("GET", f"jobs/{j['id']}")
    # Posts
    yield fetch("GET", "ugcPosts")
    for p in posts[:2]:
        yield fetch("GET", "ugcPosts", {"author": f"urn:li:person:{p.get('author_id')}"})
        yield fetch("GET", "ugcPosts", {"author": p.get("author_id") or "x", "q": " ".join((p.get("text") or "a b").split()[:2])})
    for body in [
        {"author": "urn:li:person:abc", "specificContent": {"com.linkedin.ugc.ShareContent": {
            "shareCommentary": {"text": "Hello network é"}}}, "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"}},
        {"text": "Flat text", "visibility__code": "CONNECTIONS"},
        {"comment": "With content", "content__title": "T", "content__submitted_url": "https://x", "visibility": {}},
        {"author": "urn:li:organization:42", "text": "org post"},
        {"author": "urn:li:company:42", "text": "company post"},
        {"author": "urn:li:x", "text": "short urn"},
        {"author": "plain-author", "text": "plain author"},
        {"author": 5, "text": "int author"},
        {"text": 7},
        {"text": "bad content", "content__title": 5},
        {"specificContent": "x"},
        {"visibility": "PUBLIC", "text": "v"},
        {"text": "vis other", "visibility__code": "anyone"},
        {},
        {"world": 1},
    ]:
        yield fetch("POST", "ugcPosts", body=body)
    yield fetch("GET", "ugcPosts", {"q": "hello"})
    yield fetch("GET", "ugcPosts", {"author": 5})
    yield fetch("GET", "ugcPosts", {"q": 5})
    yield fetch("POST", "ugcPosts", body="[1]")
    # Company updates
    for c in companies[:2]:
        yield fetch("POST", "companyUpdates", body={"company": c["id"], "comment": "We are hiring", "submitted_url": "https://j"})
        yield fetch("POST", "companyUpdates", body={"company_id": c["id"], "comment": "Plain"})
    yield fetch("POST", "companyUpdates", body={"company": "nope", "comment": "x"})
    yield fetch("POST", "companyUpdates", body={})
    if companies:
        yield fetch("POST", "companyUpdates", body={"company": companies[0]["id"], "comment": 5})
    # Invitations
    targets = [p["id"] for p in profiles[:2]] + [c["id"] for c in conns[:1]] + [
        "https://www.linkedin.com/in/new-person/", "https://linkedin.com/in/new-person", "unknown-id", ""]
    for t in targets:
        yield fetch("POST", "invitations", body={"profile_url": t, "message": "Let's connect"})
    yield fetch("POST", "invitations", body={"invitee_url": "https://linkedin.com/in/via-invitee-url"})
    yield fetch("POST", "invitations", body={"invitee": "https://linkedin.com/in/via-invitee", "tracking_token": "t"})
    yield fetch("POST", "invitations", body={"profile_url": 5})
    yield fetch("POST", "invitations", body={"profile_url": "https://x/in/y", "message": 5})
    yield fetch("POST", "invitations", body={"profile_url": None})
    # Messages
    for p in profiles[:2]:
        yield fetch("POST", "messages", body={"profile_id": p["id"], "text": "Hi there", "subject": "Hello"})
        yield fetch("POST", "messages", body={"recipients": [f"urn:li:person:{p['id']}"], "body": "Via recipients"})
        if p.get("email"):
            yield fetch("POST", "messages", body={"email": p["email"].upper(), "text": "By email"})
        if p.get("public_profile_url"):
            yield fetch("POST", "messages", body={"profile_url": p["public_profile_url"], "text": "By url"})
    for c in conns[:2]:
        yield fetch("POST", "messages", body={"profileId": c.get("connected_profile_id") or c["id"], "text": "Conn"})
        if c.get("email"):
            yield fetch("POST", "messages", body={"email": c["email"], "text": "Conn email"})
    yield fetch("POST", "messages", body={"recipients": ["a", "urn:li:person:b", 5], "text": "Multi"})
    yield fetch("POST", "messages", body={"profile_id": "ghost", "text": "Ghost"})
    yield fetch("POST", "messages", body={"email": "ghost@x.com", "text": "x"})
    yield fetch("POST", "messages", body={"profile_url": "https://ghost", "text": "x"})
    yield fetch("POST", "messages", body={"text": "no recipient"})
    yield fetch("POST", "messages", body={"profile_id": "x"})
    yield fetch("POST", "messages", body={"profile_id": 5, "text": "int id"})
    yield fetch("POST", "messages", body={"email": 5, "text": "int email"})
    yield fetch("POST", "messages", body={"recipients": ["r"], "text": 5})
    yield fetch("POST", "messages", body={"recipients": "r", "profile_id": "p", "text": "t", "subject": 3})
    yield fetch("POST", "messages", body="[1]")
    yield fetch("DELETE", "me")
    yield fetch("GET", "me", base="linkedin/v2/")
