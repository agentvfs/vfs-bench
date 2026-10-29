"""HubSpot calls: every route of tools/api/routes/hubspot.py, with the task's
seeded contacts, companies, deals and tickets, writes (creates, updates,
associations, activities), searches with every filter operator, and error
cases (unknown ids, bodies of the wrong type, invalid field values)."""
import json

KNOWN = {}

BASE = "https://api.hubapi.com/crm/v3/objects/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params, str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def search(*groups, **extra):
    return fetch("POST", "contacts/search", body={"filterGroups": list(groups), **extra})


def flt(prop, op="EQ", value=None, **extra):
    f = {"propertyName": prop, "operator": op}
    if value is not None:
        f["value"] = value
    f.update(extra)
    return {"filters": [f]}


def calls(world, last):
    hs = world["hubspot"]
    contacts, companies, deals, tickets = hs["contacts"], hs["companies"], hs["deals"], hs["tickets"]

    # Reads.
    for path in ["contacts", "companies", "deals", "tickets"]:
        yield fetch("GET", path)
    for c in contacts[:4]:
        yield fetch("GET", f"contacts/{c['id']}")
    yield fetch("GET", "contacts/nope")
    yield fetch("GET", "contacts", params={"limit": 2})

    # Searches: each operator, on direct, model and property fields.
    c0 = contacts[0] if contacts else {"email": "x@example.com", "firstname": "X", "id": "1"}
    yield search(flt("email", "EQ", c0.get("email") or ""))
    yield search(flt("email", "EQ", (c0.get("email") or "").upper()))
    yield search(flt("firstname", "NEQ", c0.get("firstname") or ""))
    yield search(flt("email", "CONTAINS_TOKEN", "example"))
    yield search(flt("email", "NOT_CONTAINS_TOKEN", "example"))
    yield search(flt("company", "HAS_PROPERTY"))
    yield search(flt("phone", "NOT_HAS_PROPERTY"))
    yield search(flt("lifecyclestage", "IN", values=["lead", "Subscriber", "customer"]))
    yield search(flt("lifecyclestage", "NOT_IN", values=["lead"]))
    yield search(flt("lifecyclestage", "IN", values="lead"))
    yield search(flt("id", "EQ", c0.get("id")))
    yield search(flt("hs_object_id", "EQ", c0.get("id")))
    for prop in ["lead_score", "nps_score", "lifetime_value", "last_login_days_ago", "support_tickets_30d"]:
        for op, value in [("GT", "5"), ("GTE", 5), ("LT", "100.5"), ("LTE", "abc"), ("EQ", "7")]:
            yield search(flt(prop, op, value))
        yield search(flt(prop, "BETWEEN", "1", highValue="50"))
        yield search(flt(prop, "BETWEEN", "zz", highValue="50"))
    yield search(flt("demo_requested", "EQ", "true"))
    yield search(flt("demo_requested", "EQ", True))
    yield search(flt("open_ticket", "CONTAINS_TOKEN", "priority"))
    yield search(flt("open_ticket", "HAS_PROPERTY"))
    yield search(flt("created_at", "GT", "2026-01-01"))
    yield search(flt("created_at", "CONTAINS_TOKEN", "2026"))
    yield search(flt("properties", "CONTAINS_TOKEN", "a"))
    yield search(flt("lastname", "LT", "m"))
    yield search(flt("lastname", "GTE", "M"))
    yield search(flt("firstname", "BETWEEN", "a", highValue="m"))
    yield search(flt("custom_thing", "HAS_PROPERTY"))
    yield search(flt("to_display_dict", "HAS_PROPERTY"))
    yield search(flt("email", "BOGUS", "x"))
    yield search(flt("email", "eq", c0.get("email") or ""))
    yield search(flt("email", "=", c0.get("email") or ""))
    yield search(flt("company", "EQ", "nothing"), flt("email", "CONTAINS_TOKEN", "example"))
    yield search({"filters": []})
    yield search({"filters": [{"propertyName": "email", "operator": "HAS_PROPERTY"},
                              {"propertyName": "lifecyclestage", "operator": "EQ", "value": "lead"}]})
    yield search(flt("email", "HAS_PROPERTY"), limit=2)
    yield search(flt("email", "HAS_PROPERTY"), limit="3")
    yield search(flt("email", "HAS_PROPERTY"), limit=-1)
    yield search(flt("email", "HAS_PROPERTY"), limit=2.7)
    yield search(flt("email", "HAS_PROPERTY"), limit="x")
    yield search(flt("email", "HAS_PROPERTY"), limit=None)
    yield search(flt(5, "EQ", "x"))
    yield search(flt(None, "EQ", "x"))
    yield search(flt(["a"], "EQ", "x"))
    yield search({"filters": [{"propertyName": "email", "operator": 3}]})
    yield search({"filters": [{"propertyName": "email"}]})
    yield search({"filters": ["x"]})
    yield search({"filters": "ab"})
    yield search({"filters": 5})
    yield search({"filters": {"a": 1}})
    yield search("x")
    yield search(flt("email", "IN", values=5))
    yield fetch("POST", "contacts/search", body={"email": c0.get("email") or "a@b.c"})
    yield fetch("POST", "contacts/search", body={"email": (c0.get("email") or "a@b.c").upper()})
    yield fetch("POST", "contacts/search", body={"contact_id": c0.get("id")})
    yield fetch("POST", "contacts/search", body={"contact_id": "missing"})
    yield fetch("POST", "contacts/search", body={"email": 5})
    yield fetch("POST", "contacts/search", body={"filterGroups": "x"})
    yield fetch("POST", "contacts/search", body={})
    yield fetch("POST", "contacts/search", body="[1]")
    yield fetch("POST", "contacts/search", body="7")

    # Contacts: create and update.
    yield fetch("POST", "contacts", body={"properties": {"email": "new.person@acme.example.com", "firstname": "New",
                                                         "lastname": "Person", "company": "Acme",
                                                         "lifecyclestage": "lead", "lead_score": "42",
                                                         "nps_score": "x", "favorite": 3, "notes": None,
                                                         "utm_source": "google", "demo_requested": "yes",
                                                         "lifetime_value": 10, "to_display_dict": "v",
                                                         "status": [1, "a"], "open_ticket": {"id": "T1", "age_days": 3},
                                                         "additional_properties_json": json.dumps({"tier": 1, "vip": True, "x": None})}})
    new_id = last().get("id") if isinstance(last(), dict) else None
    yield fetch("POST", "contacts", body={"email": "flat@example.com", "firstname": "Flat", "properties_extra": {"a": 1}})
    yield fetch("POST", "contacts", body={"properties": {"email": "bad.json@example.com", "additional_properties_json": "{bad"}})
    yield fetch("POST", "contacts", body={"properties": {"email": "list.json@example.com", "additional_properties_json": "[1, 2]"}})
    yield fetch("POST", "contacts", body={"properties": {"email": "num.json@example.com", "additional_properties_json": 5}})
    yield fetch("POST", "contacts", body={"properties": {"email": 5}})
    yield fetch("POST", "contacts", body={"properties": {"lifecyclestage": None}})
    yield fetch("POST", "contacts", body={"properties": {"properties": {"a": "b"}, "id": "custom-1"}})
    yield fetch("POST", "contacts", body={"properties": {"properties": {"a": 1}, "created_at": "2026-01-02T03:04:05Z"}})
    yield fetch("POST", "contacts", body={"properties": None})
    yield fetch("POST", "contacts", body={"properties": "abc"})
    yield fetch("POST", "contacts", body="[1]")
    yield fetch("GET", f"contacts/{new_id}")
    yield search(flt("tier", "EQ", "1"))
    target = c0.get("id") if contacts else new_id
    yield fetch("PATCH", f"contacts/{target}", body={"properties": {"lifecyclestage": "customer", "phone": "555-0100",
                                                                     "linkedin_url": "https://linkedin.com/in/x",
                                                                     "nps_score": 9, "region": "EMEA",
                                                                     "additional_properties_json": "{\"plan\": \"pro\"}"}})
    yield fetch("PATCH", f"contacts/{target}", body={"jobtitle": "CTO", "payment_status": None, "notes": "flat"})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": {"email": 3}})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": {"additional_properties_json": "nope"}})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": {"additional_properties_json": "[]"}})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": ["email"]})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": ["nothing"]})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": "email me"})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": "zzz"})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": 4})
    yield fetch("PATCH", f"contacts/{target}", body={"properties": None})
    yield fetch("PATCH", f"contacts/{target}", body="[2]")
    yield fetch("PATCH", "contacts/missing", body={"properties": {"email": "a@b.c"}})
    yield fetch("GET", f"contacts/{target}")

    # Companies.
    yield fetch("POST", "companies", body={"properties": {"name": "Globex", "domain": "globex.example.com",
                                                          "annual_revenue": "1200000", "employee_count": "50.0",
                                                          "lifecyclestage": "customer", "tier": "gold"}})
    yield fetch("POST", "companies", body={"name": "Flat Co", "employee_count": "lots", "industry": None})
    yield fetch("POST", "companies", body={"properties": {"domain": "noname.example.com"}})
    yield fetch("POST", "companies", body={"properties": {"name": None}})
    yield fetch("POST", "companies", body={"properties": {"name": "J", "additional_properties_json": "{\"k\": [1]}"}})
    yield fetch("GET", "companies")

    # Deals.
    yield fetch("POST", "deals", body={"properties": {"dealname": "Big Deal", "dealstage": "appointmentscheduled",
                                                      "amount": "50000", "closedate": "2026-06-30",
                                                      "days_in_stage": "3", "region": "NA",
                                                      "associated_contact_ids": [c0.get("id")]}})
    deal_id = last().get("id") if isinstance(last(), dict) else "none"
    yield fetch("POST", "deals", body={"dealname": "Zero", "dealstage": "closedwon", "amount": 0})
    yield fetch("POST", "deals", body={"dealname": "Fraction", "dealstage": "x", "amount": 12.5,
                                       "closedate": "2026-07-01T10:00:00Z", "description": "desc"})
    yield fetch("POST", "deals", body={"properties": {"dealname": "Bad", "dealstage": "x", "amount": "lots"}})
    yield fetch("POST", "deals", body={"properties": {"dealname": "Bad date", "dealstage": "x", "closedate": "soon"}})
    yield fetch("POST", "deals", body={"properties": {"dealstage": 3}})
    yield fetch("GET", "deals")
    for d in deals[:2] + [{"id": deal_id}]:
        yield fetch("PATCH", f"deals/{d['id']}", body={"properties": {"dealstage": "closedwon", "amount": "75000.50",
                                                                      "hubspot_owner_id": "owner-1", "probability": 0.9}})
    yield fetch("PATCH", f"deals/{deal_id}", body={"amount": "zz"})
    yield fetch("PATCH", f"deals/{deal_id}", body={"properties": {"description": "now described", "closedate": None}})
    yield fetch("PATCH", f"deals/{deal_id}", body={"properties": {"additional_properties_json": "{\"a\": 1.0}"}})
    yield fetch("PATCH", "deals/missing", body={"dealstage": "x"})
    target_contact = c0.get("id") or "c1"
    yield fetch("PUT", f"deals/{deal_id}/associations/contacts/{target_contact}/deal_to_contact")
    yield fetch("PUT", f"deals/{deal_id}/associations/contacts/{target_contact}")
    yield fetch("PUT", f"deals/{deal_id}/associations/contacts/other-1/3/extra")
    yield fetch("PUT", "deals/missing/associations/contacts/x")
    yield fetch("GET", "deals")

    # Tickets.
    yield fetch("POST", "tickets", body={"properties": {"subject": "Login broken", "content": "Can't log in",
                                                        "hs_pipeline_stage": "2", "priority": "HIGH",
                                                        "customer_email": "a@b.c", "status": "open",
                                                        "complexity": "high", "created": "x"}})
    ticket_id = last().get("id") if isinstance(last(), dict) else "none"
    yield fetch("POST", "tickets", body={"subject": "Flat", "hs_ticket_priority": "URGENT"})
    yield fetch("POST", "tickets", body={"subject": "Bad prio", "hs_ticket_priority": "SEVERE"})
    yield fetch("POST", "tickets", body={"subject": "Empty prio", "hs_ticket_priority": "", "priority": ""})
    yield fetch("POST", "tickets", body={"subject": 5, "hs_pipeline_stage": 3})
    yield fetch("POST", "tickets", body={"properties": {"content": "no subject"}})
    for t in tickets[:2] + [{"id": ticket_id}]:
        yield fetch("PATCH", f"tickets/{t['id']}", body={"properties": {"hs_pipeline_stage": "4", "priority": "LOW",
                                                                        "notes": "escalated", "sla": "24h"}})
    yield fetch("PATCH", f"tickets/{ticket_id}", body={"hs_ticket_priority": None, "priority": None})
    yield fetch("PATCH", f"tickets/{ticket_id}", body={"hs_ticket_priority": "", "priority": ""})
    yield fetch("PATCH", f"tickets/{ticket_id}", body={"hs_ticket_priority": "bad"})
    yield fetch("PATCH", f"tickets/{ticket_id}", body={"subject": None})
    yield fetch("PATCH", f"tickets/{ticket_id}", body={"properties": {"additional_properties_json": "{\"x\": {\"y\": 1}}",
                                                                       "hubspot_owner_id": "o2"}})
    yield fetch("PATCH", f"tickets/{ticket_id}", body={"properties": ["priority"]})
    yield fetch("PATCH", f"tickets/{ticket_id}", body={"properties": ["other"]})
    yield fetch("PATCH", "tickets/missing", body={"subject": "x"})
    yield fetch("GET", "tickets")

    # Activities and engagements.
    yield fetch("POST", "notes", body={"properties": {"hs_note_body": "Called the customer", "hs_timestamp": "2026-01-01"},
                                       "associations": [{"to": {"id": c0.get("id")},
                                                         "types": [{"associationCategory": "HUBSPOT_DEFINED",
                                                                    "associationTypeId": 202}]},
                                                        {"to": {"id": deal_id}, "types": [{"associationTypeId": "214"}]},
                                                        {"to": {"id": 123}, "types": [{"associationTypeId": 190}]},
                                                        {"to": {"id": "noTypes"}},
                                                        {"to": {"id": ""}, "types": []},
                                                        {"to": {}, "types": [{"associationTypeId": None}]}]})
    yield fetch("POST", "emails", body={"properties": {"hs_email_text": "Sent pricing"}, "contact_ids": ["c1", "c2"]})
    yield fetch("POST", "calls", body={"hs_call_body": "Flat call", "deal_ids": ["d1"], "company_ids": "co1"})
    yield fetch("POST", "meetings", body={"properties": {"hs_meeting_body": "", "body": "", "content": None}})
    yield fetch("POST", "tasks", body={"properties": {"hs_task_body": "Follow up", "contact_ids": ["x"]}})
    yield fetch("POST", "notes", body={"properties": {"hs_note_body": 5}})
    yield fetch("POST", "notes", body={"associations": [{"to": {"id": "a"}, "types": [{"associationTypeId": "x"}]}]})
    yield fetch("POST", "notes", body={"associations": [{"to": {"id": "a"}, "types": 5}]})
    yield fetch("POST", "notes", body={"associations": ["x"]})
    yield fetch("POST", "notes", body={"associations": "x", "contact_ids": "abc"})
    yield fetch("POST", "notes", body={"properties": "x"})
    yield fetch("POST", "notes", body="[1]")
    yield fetch("POST", "engagements", body={"properties": {"engagement_type": "CALL", "body": "Logged call"},
                                             "associations": [{"to": {"id": "c9"}, "types": [{"associationTypeId": 3}]}]})
    yield fetch("POST", "engagements", body={"engagement_type": "MEETING", "hs_note_body": "Fallback body"})
    yield fetch("POST", "engagements", body={"engagement_type": "LUNCH"})
    yield fetch("POST", "engagements", body={})
    yield fetch("POST", "engagements", body={"properties": [1]})

    # Routing misses.
    yield fetch("DELETE", "contacts/1")
    yield fetch("GET", "companies/1")
    yield fetch("POST", "contacts/search/extra")
    yield fetch("GET", "contacts", base="hubspot/crm/v3/objects/")
    yield fetch("GET", "crm/v3/objects/deals?limit=2", base="https://api.hubapi.com/")
    yield fetch("GET", "contacts")
