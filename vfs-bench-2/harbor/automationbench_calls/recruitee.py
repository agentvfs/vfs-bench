"""Recruitee calls: every route of tools/api/routes/recruitee.py (all
recorded actions), writes that later reads see, envelopes, and error cases."""
import json

KNOWN = {}

BASE = "https://api.recruitee.com/c/acme/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    # Reads of an empty state.
    for path in ["offers", "candidates", "departments", "locations", "interview/events",
                 "interview/templates", "search/new/candidates", "offers/o1", "candidates/c1",
                 "candidates/c1/notes"]:
        yield fetch("GET", path)
    # Writes, flat and in their envelopes.
    yield fetch("POST", "offers", body={"offer": {"title": "Engineer", "offer_id": "o1", "scope": "active"}})
    yield fetch("POST", "offers", body={"title": "Designer", "id": "o2", "scope": "archived"})
    yield fetch("POST", "offers", body={"offer": "not a dict", "title": "x"})
    yield fetch("PATCH", "offers/o1", body={"offer": {"status": "published"}, "note": "n"})
    yield fetch("PATCH", "offers/o1", body={"offer": {"offer": {"x": 1}}})
    yield fetch("DELETE", "offers/o2")
    yield fetch("GET", "offers", {"scope": "active"})
    yield fetch("GET", "offers", {"scope": ""})
    yield fetch("GET", "offers", {"scope": "nope", "view_mode": "brief"})
    yield fetch("GET", "offers/o1")
    yield fetch("GET", "offers/o2")
    yield fetch("GET", "offers/missing", {"extra": 1})
    yield fetch("POST", "candidates", body={"candidate": {"name": "Ada", "candidate_id": "c1", "offer_id": "o1",
                                                          "emails": ["ada@x.io"]}})
    yield fetch("POST", "candidates", body={"name": "Bob", "id": "c2", "offer_id": "o2", "rating": 4.0})
    yield fetch("PATCH", "candidates/c1", body={"candidate": {"stage": "offer"}, "tags": ["a", "b"]})
    yield fetch("PATCH", "candidates/c1/update_cv", body={"candidate": {"cv_url": "https://x/cv.pdf"}})
    yield fetch("DELETE", "candidates/c1/delete_cv")
    yield fetch("DELETE", "candidates/c1/delete_cover_letter")
    yield fetch("POST", "candidates/c1/notes", body={"note": {"body": "Strong"}, "visibility": "public"})
    yield fetch("POST", "candidates/c2/notes", body={"body": "Okay"})
    yield fetch("GET", "candidates/c1/notes")
    yield fetch("DELETE", "notes/n1")
    yield fetch("POST", "custom_fields/candidates/c1/fields", body={"field": {"kind": "text", "value": "x"}})
    yield fetch("GET", "candidates", {"offer_id": "o1"})
    yield fetch("GET", "candidates", {"offer_id": "o2", "limit": 5, "qualified": True})
    yield fetch("GET", "candidates/c1")
    yield fetch("GET", "candidates/c2")
    yield fetch("GET", "search/new/candidates", {"limit": 1, "sort_by": "name"})
    yield fetch("DELETE", "candidates/c2")
    yield fetch("POST", "offers/eng-1/candidates", base="https://api.recruitee.com/",
                body={"candidate": {"name": "Cy", "email": "cy@x.io"}})
    yield fetch("POST", "placements", body={"placement": {"candidate_id": "c1", "offer_id": "o1"}})
    yield fetch("PATCH", "placements/p1", body={"stage_id": 3})
    yield fetch("DELETE", "placements/p1")
    yield fetch("POST", "departments", body={"department": {"name": "R&D"}})
    yield fetch("POST", "departments", body={"name": "Sales"})
    yield fetch("DELETE", "departments/d1")
    yield fetch("GET", "departments")
    yield fetch("DELETE", "locations/l1")
    yield fetch("GET", "locations", {"query": "x"})
    yield fetch("POST", "interview/events", body={"event": {"candidate_id": "c1", "offer_id": "o1", "starts_at": "2026-03-01T10:00:00Z"}})
    yield fetch("POST", "interview/events", body={"candidate_id": "c2"})
    yield fetch("PATCH", "interview/events/e1", body={"event": {"starts_at": "2026-03-02"}})
    yield fetch("GET", "interview/events", {"candidate_id": "c1"})
    yield fetch("GET", "interview/events", {"candidate_id": "c1", "offer_id": "o9"})
    yield fetch("GET", "interview/events", {"offer_id": "o1"})
    yield fetch("DELETE", "interview/events/e1")
    yield fetch("DELETE", "interview/templates/t1")
    yield fetch("GET", "interview/templates")
    for sub in ["schedules", "request_links", "result_requests", "meeting_rooms"]:
        yield fetch("DELETE", f"interview/{sub}/x1")
    # Other URL shapes the router maps.
    yield fetch("GET", "offers", base="https://api.recruitee.com/recruitee/c/acme/")
    yield fetch("GET", "offers", base="https://api.recruitee.com/v1/c/acme/")
    yield fetch("GET", "c/acme/offers", base="https://api.recruitee.com/")
    yield fetch("GET", "recruitee/v1/c/acme/candidates", base="")
    # Errors: clashing arguments, non-mapping bodies and params, unknown routes.
    yield fetch("POST", "offers", body={"company_id": "dup"})
    yield fetch("PATCH", "offers/o1", body={"offer_id": "dup"})
    yield fetch("POST", "offers", body={"world": 1})
    yield fetch("POST", "offers", body="[1]")
    yield fetch("POST", "offers", body='"text"')
    yield fetch("GET", "offers", "[1]")
    yield fetch("GET", "candidates/c1", {"candidate_id": "dup"})
    yield fetch("DELETE", "offers/o1", body={"ignored": 1})
    yield fetch("PUT", "offers/o1", body={})
    yield fetch("GET", "nothing")
    yield fetch("POST", "offers/eng-2/candidates", base="https://api.recruitee.com/", body={"offer_slug": "dup"})
    yield fetch("POST", "offers", body={})
    yield fetch("GET", "offers")
    yield fetch("GET", "candidates")
