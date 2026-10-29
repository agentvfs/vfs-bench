"""Gmail calls: every route of routes/gmail.py, with ids from the task's
world and the replies before, the request shapes upstream reads (``raw``
RFC 2822 in several encodings, ``payload`` headers and parts, flat fields),
Gmail ``q`` operators, and error cases."""
import base64
import json

BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

# Upstream's threads.list without ``q`` gathers thread ids in a Python
# ``set``: their order is the strings' hashes, randomized per process
# (PYTHONHASHSEED), so no fixed order can match it. The fake keeps the order
# the ids are first seen in.
KNOWN = {
    '/threads", "params": "{\\"labelIds\\": \\"INBOX\\", \\"maxResults\\": 1}"':
        "threads.list without q: Python set order, randomized per process",
}


def b64(data) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.urlsafe_b64encode(data).decode("ascii")


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


RAWS = [
    "To: alice@example.com\r\nSubject: Hello\r\n\r\nPlain body line one.\r\nLine two.",
    "To: a@x.com, b@y.com\nCc: c@z.com\nBcc: d@w.com\nSubject: Folded\n subject line\nFrom: me@example.com\n\nbody\n",
    "From: me@example.com\r\nTo: bob@example.com\r\nSubject: QP\r\nContent-Type: text/plain; charset=utf-8\r\n"
    "Content-Transfer-Encoding: quoted-printable\r\n\r\nCaf=C3=A9 =3D good=\r\n soft break=\r\nend =ZZ",
    "To: carol@example.com\r\nSubject: B64 body\r\nContent-Transfer-Encoding: base64\r\n\r\n"
    + base64.b64encode("Grüße aus Köln, total: $1,200".encode()).decode() + "\r\n",
    "To: dan@example.com\r\nSubject: Multipart\r\nMIME-Version: 1.0\r\n"
    'Content-Type: multipart/alternative; boundary="BOUND"\r\n\r\npreamble\r\n--BOUND\r\n'
    "Content-Type: text/html\r\n\r\n<p>html part</p>\r\n--BOUND\r\nContent-Type: text/plain; charset=utf-8\r\n"
    "Content-Transfer-Encoding: base64\r\n\r\n" + base64.b64encode("the plain part ✓".encode()).decode()
    + "\r\n--BOUND--\r\nepilogue",
    "To: erin@example.com\nSubject: Nested\nContent-Type: multipart/mixed; boundary=outer\n\n--outer\n"
    "Content-Type: multipart/alternative; boundary=inner\n\n--inner\nContent-Type: text/plain\n\nnested plain\n"
    "--inner--\n--outer\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\n\nJVBERi0=\n--outer--\n",
    "To: frank@example.com\r\nSubject: Café non-ascii subject\r\n\r\nbody",
    "To: gina@example.com\r\nSubject: no body separator",
    "just some body text without headers",
    "Subject: only subject\r\n\r\nno recipient here",
    "To: émilie@example.com\r\nSubject: hi\r\n\r\nbody",
    "To: hank@example.com\r\nCc: über@example.com\r\nSubject: cc non-ascii\r\n\r\nbody",
    "From root@host Mon Jan 1\nTo: ivy@example.com\nSubject: unixfrom\n\nbody",
    "To: jo@example.com\nSubject: digest\nContent-Type: multipart/digest; boundary=D\n\n--D\n\nTo: x@y\nSubject: inner\n\ninner body\n--D--\n",
    "To: ken@example.com\nSubject: rfc822\nContent-Type: message/rfc822\n\nSubject: wrapped\n\nwrapped body\n",
    "To: lu@example.com\nSubject: no boundary\nContent-Type: multipart/mixed\n\nraw text body\n",
]


def calls(world, last):
    gmail = world.get("gmail") or {}
    messages = gmail.get("messages", [])
    msg_ids = [m["id"] for m in messages][:6]
    thread_ids = list(dict.fromkeys(m["thread_id"] for m in messages))[:4]
    label_ids = [l["id"] for l in gmail.get("labels", [])]
    draft_ids = [d["id"] for d in gmail.get("drafts", [])]
    senders = [m.get("from_", "") for m in messages][:3]
    subjects = [(m.get("subject") or "").split(" ")[0] for m in messages][:3]

    # Reads.
    yield fetch("GET", "/messages")
    yield fetch("GET", "/messages", {"maxResults": 3})
    yield fetch("GET", "/messages", {"maxResults": "2"})
    yield fetch("GET", "/messages", {"maxResults": -2})
    yield fetch("GET", "/messages", {"labelIds": "INBOX"})
    yield fetch("GET", "/messages", {"labelIds": ["INBOX", "UNREAD"]})
    yield fetch("GET", "/messages", {"labelIds": []})
    yield fetch("GET", "/messages", {"labelIds": 5})
    yield fetch("GET", "/messages", {"includeSpamTrash": True})
    queries = ["is:unread", "is:read", "is:starred", "has:attachment", "*", "  ", "label:inbox",
               "in:inbox", "newer_than:7d", "subject:urgent", "subject:(urgent OR critical)",
               '"quarterly report"', "from:nobody@nowhere.test", "to:me OR from:me", "invoice OR receipt",
               "rfc822msgid:" + (msg_ids[0] if msg_ids else "x"), "category:primary renewal", "from:", "OR"]
    for s in senders:
        queries.append(f"from:{s}")
        queries.append(f"from:{s.split('@')[0]} is:unread")
    for s in subjects:
        if s:
            queries.append(f"subject:{s}")
            queries.append(s.lower())
    for q in queries:
        yield fetch("GET", "/messages", {"q": q})
    yield fetch("GET", "/messages", {"q": 5})
    yield fetch("GET", "/messages", {"q": "x", "maxResults": "abc"})
    yield fetch("GET", "/messages", {"q": "x", "bogus": 1})
    yield fetch("GET", "/messages", "[1]")
    for mid in msg_ids:
        yield fetch("GET", f"/messages/{mid}")
    if msg_ids:
        yield fetch("GET", f"/messages/{msg_ids[0]}", {"format": "minimal"})
        yield fetch("GET", f"/messages/{msg_ids[0]}", {"format": "metadata"})
        yield fetch("GET", f"/messages/{msg_ids[0]}", {"message_id": "x"})
    yield fetch("GET", "/messages/does-not-exist")
    yield fetch("GET", "/labels")
    for lid in label_ids[:4]:
        yield fetch("GET", f"/labels/{lid}")
    yield fetch("GET", "/labels/nope")
    yield fetch("GET", "/drafts")
    yield fetch("GET", "/drafts", {"q": "re"})
    yield fetch("GET", "/drafts", {"maxResults": 1})
    for did in draft_ids[:2]:
        yield fetch("GET", f"/drafts/{did}")
    yield fetch("GET", "/drafts/nope")
    yield fetch("GET", "/threads", {"q": "is:unread"})
    yield fetch("GET", "/threads", {"q": "a", "maxResults": 2})
    yield fetch("GET", "/threads", {"q": "a", "labelIds": "INBOX"})
    yield fetch("GET", "/threads", {"q": "a", "labelIds": ["INBOX"]})
    yield fetch("GET", "/threads", {"labelIds": "INBOX", "maxResults": 1})
    for tid in thread_ids:
        yield fetch("GET", f"/threads/{tid}")
    yield fetch("GET", "/threads/nope")
    yield fetch("GET", "/messages/x/extra")
    yield fetch("PATCH", "/messages")
    yield fetch("GET", "/messages?q=is:unread")

    # Sends.
    for raw in RAWS:
        yield fetch("POST", "/messages/send", {}, {"raw": b64(raw)})
    yield fetch("POST", "/messages/send", None, {"raw": b64(RAWS[0]).rstrip("=")})
    yield fetch("POST", "/messages/send", None, {"raw": "  " + b64(RAWS[0]) + "\n"})
    yield fetch("POST", "/messages/send", None, {"raw": base64.b64encode(RAWS[3].encode()).decode()})
    yield fetch("POST", "/messages/send", None, {"raw": "not base64 at all!"})
    yield fetch("POST", "/messages/send", None, {"raw": "To: x@y.com\r\n\r\nplain text raw"})
    yield fetch("POST", "/messages/send", None, {"raw": b64("hello") + "="})
    yield fetch("POST", "/messages/send", None, {"raw": "a"})
    yield fetch("POST", "/messages/send", None, {"raw": "é"})
    yield fetch("POST", "/messages/send", None, {"raw": 12345})
    yield fetch("POST", "/messages/send", None, {"message": {"raw": b64(RAWS[1])}})
    yield fetch("POST", "/messages/send", None, {"raw": b64(RAWS[0]), "threadId": thread_ids[0] if thread_ids else "t"})
    yield fetch("POST", "/messages/send", None, {"raw": b64(RAWS[0]), "threadId": "no-such-thread"})
    if msg_ids:
        yield fetch("POST", "/messages/send", None, {"raw": b64(RAWS[1]), "thread_id": msg_ids[-1]})
    yield fetch("POST", "/messages/send", None, {"raw": b64(RAWS[0]), "from": "boss@example.com"})
    yield fetch("POST", "/messages/send", None, {"raw": b64(RAWS[0]), "from": 7})
    payload = {"headers": [{"name": "To", "value": "pat@example.com"}, {"name": "Subject", "value": "Payload send"},
                           {"name": "CC", "value": "q@example.com"}],
               "body": {"data": b64("payload body text")}}
    yield fetch("POST", "/messages/send", None, {"payload": payload})
    yield fetch("POST", "/messages/send", None, {"message": {"payload": payload}})
    yield fetch("POST", "/messages/send", None, {"payload": {
        "headers": [{"name": "to", "value": "r@example.com"}, {"name": "subject", "value": "Parts"}],
        "parts": [{"mimeType": "text/html", "body": {"data": b64("<b>html</b>")}},
                  {"mimeType": "text/plain", "body": {"data": b64("plain wins")}}]}})
    yield fetch("POST", "/messages/send", None, {"payload": {
        "headers": [{"name": "To", "value": "s@example.com"}],
        "parts": [{"mimeType": "text/html", "body": {"data": b64("only html")}}, "junk", {"body": "x"}]}})
    yield fetch("POST", "/messages/send", None, {"payload": {"headers": [{"name": "To", "value": "t@example.com"}],
                                                             "body": "plain string body"}})
    yield fetch("POST", "/messages/send", None, {"payload": {"headers": [{"name": "To", "value": "t@example.com"}],
                                                             "body": {"data": "has spaces!!"}}})
    yield fetch("POST", "/messages/send", None, {"payload": {"headers": "To: x", "body": {"data": b64("x")}}})
    yield fetch("POST", "/messages/send", None, {"payload": {"headers": [{"name": 5, "value": "x"}]}})
    yield fetch("POST", "/messages/send", None, {"payload": {"headers": [{"name": "To", "value": 5}],
                                                             "body": {"data": b64("x")}}})
    yield fetch("POST", "/messages/send", None, {"payload": {"headers": None}})
    yield fetch("POST", "/messages/send", None, {"to": "u@example.com", "subject": "Flat", "body": "flat body"})
    yield fetch("POST", "/messages/send", None, {"to": ["v@example.com", "w@example.com"], "subject": "list to",
                                                 "raw": b64("Subject: x\r\n\r\nraw body")})
    yield fetch("POST", "/messages/send", None, {"to": ["v@example.com", 3]})
    yield fetch("POST", "/messages/send", None, {"to": "x@example.com", "subject": 99, "raw": b64(RAWS[0])})
    yield fetch("POST", "/messages/send", None, {"to": "", "subject": "nobody"})
    yield fetch("POST", "/messages/send", None, {})
    yield fetch("POST", "/messages/send", None, {"world": 1})
    yield fetch("POST", "/messages/send", None, "[1, 2]")
    yield fetch("POST", "/messages/send", None, {"to": "y@example.com", "cc": ["a@b.c"], "bcc": "z@q.r",
                                                 "payload": {"body": {"data": b64("cc list")}}})
    yield fetch("POST", "/messages/send", None, {"raw": b64(RAWS[0]), "text": "flat text too"})
    sent = None
    yield fetch("POST", "/messages/send", None, {"raw": b64("To: zed@example.com\nSubject: keep\n\nkeep me")})
    sent = last()

    # Labels.
    yield fetch("POST", "/labels", None, {"name": "Follow Up"})
    new_label = last().get("id") if isinstance(last(), dict) else None
    yield fetch("POST", "/labels", None, {"name": "follow up"})
    yield fetch("POST", "/labels", None, {"name": "Vis", "labelListVisibility": "labelHide",
                                         "messageListVisibility": "hide", "color": {}})
    yield fetch("POST", "/labels", None, {"name": 5})
    yield fetch("POST", "/labels", None, {})
    if new_label:
        yield fetch("PUT", f"/labels/{new_label}", None, {"name": "Renamed"})
        yield fetch("PATCH", f"/labels/{new_label}", None, {"messageListVisibility": "hide"})
        yield fetch("PATCH", f"/labels/{new_label}", None, {"name": 3})
        yield fetch("GET", f"/labels/{new_label}")
    yield fetch("PUT", "/labels/nope", None, {"name": "x"})

    # Modify, trash, untrash.
    targets = msg_ids[:3] + ([sent["id"]] if isinstance(sent, dict) and sent.get("id") else [])
    for mid in targets:
        yield fetch("POST", f"/messages/{mid}/modify", None,
                    {"addLabelIds": ["STARRED", new_label or "IMPORTANT"], "removeLabelIds": ["UNREAD"]})
        yield fetch("POST", f"/messages/{mid}/modify", None, {"addLabelIds": ["UNREAD"]})
        yield fetch("POST", f"/messages/{mid}/trash")
        yield fetch("POST", f"/messages/{mid}/trash")
        yield fetch("POST", f"/messages/{mid}/untrash")
    if msg_ids:
        mid = msg_ids[0]
        yield fetch("POST", f"/messages/{mid}/modify", None, {"addLabelIds": "UNREAD"})
        yield fetch("POST", f"/messages/{mid}/modify", None, {"removeLabelIds": "UNREAD"})
        yield fetch("POST", f"/messages/{mid}/modify", None, {"addLabelIds": 5})
        yield fetch("POST", f"/messages/{mid}/modify", None, {"addLabelIds": {"K": 1}})
        yield fetch("POST", f"/messages/{mid}/modify", None, {"removeLabelIds": ["nothere"], "x": 1})
        yield fetch("GET", "/messages", {"q": "label:starred"})
    yield fetch("POST", "/messages/nope/modify", None, {"addLabelIds": ["X"]})
    yield fetch("POST", "/messages/nope/trash")
    yield fetch("POST", "/messages/nope/untrash")
    if new_label:
        yield fetch("DELETE", f"/labels/{new_label}")
        yield fetch("DELETE", f"/labels/{new_label}")

    # Threads.
    for tid in thread_ids[:2]:
        yield fetch("POST", f"/threads/{tid}/modify", None, {"addLabelIds": ["IMPORTANT"], "removeLabelIds": ["INBOX"]})
        yield fetch("POST", f"/threads/{tid}/trash")
        yield fetch("POST", f"/threads/{tid}/untrash")
        yield fetch("GET", f"/threads/{tid}")
    yield fetch("POST", "/threads/nope/modify", None, {"addLabelIds": ["X"]})
    yield fetch("POST", "/threads/nope/trash")
    yield fetch("POST", "/threads/nope/untrash")
    yield fetch("DELETE", "/threads/nope")

    # Drafts.
    yield fetch("POST", "/drafts", None, {"message": {"raw": b64(RAWS[0])}})
    d1 = last()
    yield fetch("POST", "/drafts", None, {"message": {"raw": b64(RAWS[4]), "threadId": thread_ids[0] if thread_ids else "x"}})
    d2 = last()
    yield fetch("POST", "/drafts", None, {"message": {"payload": payload, "threadId": "no-such"}})
    yield fetch("POST", "/drafts", None, {"message": {"raw": b64(RAWS[0]), "thread_id": msg_ids[0] if msg_ids else "x"}})
    yield fetch("POST", "/drafts", None, {"to": "flat@example.com", "subject": "flat draft"})
    yield fetch("POST", "/drafts", None, {"to": ["a@b.c", "d@e.f"], "raw": b64("Subject: s\n\nb")})
    yield fetch("POST", "/drafts", None, {"raw": b64(RAWS[1])})
    yield fetch("POST", "/drafts", None, {})
    yield fetch("POST", "/drafts", None, {"message": "oops"})
    yield fetch("POST", "/drafts", None, {"message": {"payload": {"body": 5}}})
    yield fetch("POST", "/drafts", None, {"message": {"raw": "!!"}})
    yield fetch("POST", "/drafts", None, {"body": "flat body only"})
    yield fetch("POST", "/drafts", None, {"message": {"to": "m@example.com", "subject": "in message", "cc": "n@example.com"}})
    yield fetch("GET", "/drafts")
    yield fetch("GET", "/drafts", {"q": "hello"})
    yield fetch("GET", "/drafts", {"q": 3})
    for d in (d1, d2):
        if isinstance(d, dict) and d.get("id"):
            yield fetch("GET", f"/drafts/{d['id']}")
            yield fetch("PUT", f"/drafts/{d['id']}", None,
                        {"message": {"raw": b64("To: new1@example.com, new2@example.com\r\nCc: c1@example.com\r\n"
                                                "Subject: Updated subject\r\n\r\nUpdated body")}})
            yield fetch("PUT", f"/drafts/{d['id']}", None, {"to": "plain@example.com"})
            yield fetch("PUT", f"/drafts/{d['id']}", None, {"subject": ["x"]})
            yield fetch("GET", f"/drafts/{d['id']}")
    yield fetch("PUT", "/drafts/nope", None, {"to": "x@y.z"})
    if isinstance(d1, dict) and d1.get("id"):
        yield fetch("POST", "/drafts/send", None, {"id": d1["id"]})
        yield fetch("POST", "/drafts/send", None, {"id": d1["id"]})
    for did in draft_ids[:1]:
        yield fetch("POST", "/drafts/send", None, {"id": did})
    yield fetch("POST", "/drafts/send", None, {})
    yield fetch("POST", "/drafts/send", None, {"draftId": "x"})
    yield fetch("POST", "/drafts/send", None, {"id": "nope"})
    if isinstance(d2, dict) and d2.get("id"):
        yield fetch("DELETE", f"/drafts/{d2['id']}")
        yield fetch("DELETE", f"/drafts/{d2['id']}")

    # Deletes.
    for mid in msg_ids[3:5]:
        yield fetch("DELETE", f"/messages/{mid}")
    yield fetch("DELETE", "/messages/nope")
    for tid in thread_ids[2:3]:
        yield fetch("DELETE", f"/threads/{tid}")
    yield fetch("GET", "/threads", {"q": "zed"})
    yield fetch("GET", "/messages", {"q": "keep"})

    # Other spellings of the host and path.
    yield fetch("GET", "/messages", None, None, "https://www.googleapis.com/gmail/v1/users/me")
    yield fetch("GET", "/labels", None, None, "gmail/v1/users/me")
    yield fetch("GET", "/labels", None, None, "https://gmail.googleapis.com/gmail/v1/users/user%40example.com")
