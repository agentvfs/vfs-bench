"""DocuSign calls: every route of tools/api/routes/docusign.py, with the task's
seeded templates, envelopes and workspaces, envelope creation in each of its
shapes (template, signature request, signers JSON, recipients, template roles
with tabs, field collections), updates (void, send, other statuses),
recipients, listing filters and paging, workspaces, and error cases."""
import json

KNOWN = {}

BASE = "https://demo.docusign.net/restapi/v2.1/accounts/acct-1/"


def fetch(method, path, params=None, body=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


def calls(world, last):
    ds = world["docusign"]
    templates, envelopes, workspaces = ds["templates"], ds["envelopes"], ds[
        "workspaces"]
    tmpl = templates[0]["id"] if templates else "tmpl-none"

    # Reads.
    yield fetch("GET", "templates")
    for t in templates[:3]:
        yield fetch("GET", f"templates/{t['id']}")
        yield fetch("GET", f"templates/{t['id']}/documents")
    yield fetch("GET", "templates/missing")
    yield fetch("GET", "templates/missing/documents")
    yield fetch("GET",
                "templates",
                params={
                    "search_text":
                    (templates[0]["name"][:4] if templates else "x")
                })
    yield fetch("GET", "templates", params={"search_text": "zzz"})
    yield fetch("GET", "templates", params={"count": 1, "start_position": 1})
    yield fetch("GET", "templates", params={"count": "2"})
    yield fetch("GET", "templates", params={"search_text": 5})
    yield fetch("GET", "templates", params={"count": "x"})
    yield fetch("GET", "templates", params={"world": 1})
    yield fetch("GET", "templates", params="[1]")
    yield fetch("GET", "envelopes")
    for e in envelopes[:3]:
        yield fetch("GET", f"envelopes/{e['id']}")
        yield fetch("GET",
                    f"envelopes/{e['id']}/recipients",
                    params={"include_tabs": "true"})
    yield fetch("GET", "workspaces")

    # Creates: from a template, with every shape of recipients and fields.
    yield fetch("POST",
                "envelopes",
                body={
                    "templateId":
                    tmpl,
                    "emailSubject":
                    "Please sign",
                    "status":
                    "sent",
                    "templateRoles": [{
                        "name": "Ana Ruiz",
                        "email": "ana@example.com",
                        "roleName": "Signer",
                        "tabs": {
                            "textTabs": [{
                                "tabLabel": "salary",
                                "value": 120000
                            }, {
                                "tabLabel": "start",
                                "value": "2026-05-01"
                            }, {
                                "value": "nolabel"
                            }]
                        }
                    }, "not a role", {
                        "name": "Bo",
                        "email": "bo@example.com"
                    }]
                })
    env1 = last().get("envelopeId") if isinstance(last(), dict) else "none"
    yield fetch("GET", f"envelopes/{env1}")
    yield fetch("POST",
                "envelopes",
                body={
                    "template_id":
                    tmpl,
                    "signerName":
                    "Cy",
                    "signerEmail":
                    "cy@example.com",
                    "status":
                    "created",
                    "signers_json":
                    json.dumps([{
                        "name": "Di",
                        "email": "di@example.com",
                        "role_name": "Witness"
                    }, {
                        "recipient_id": 7,
                        "name": None,
                        "routing_order": 2
                    }, "x"]),
                    "field_values_json":
                    json.dumps({
                        "department":
                        "Sales",
                        "level":
                        3,
                        "textCustomFields": [{
                            "name": "region",
                            "value": "EU"
                        }],
                        "nested": {
                            "tabs": {
                                "textTabs": [{
                                    "tabLabel": "t",
                                    "value": "v"
                                }]
                            }
                        },
                        "none":
                        None
                    })
                })
    env2 = last().get("envelopeId") if isinstance(last(), dict) else "none"
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject":
                    "No template",
                    "recipients": {
                        "signers": [{
                            "name": "Ed",
                            "email": "ed@example.com",
                            "recipientId": "3",
                            "routingOrder": "2"
                        }, {
                            "name": "Fi"
                        }, 5],
                        "carbonCopies": [{
                            "name": "Gil",
                            "email": "gil@example.com"
                        }, {
                            "recipientId": "9",
                            "name": "Hal",
                            "email": "h@x"
                        }]
                    },
                    "documents": [{
                        "documentId": "1",
                        "name": "Offer.pdf"
                    }, {
                        "name": "Second"
                    }, "doc"],
                    "customFields": {
                        "textCustomFields": [{
                            "name": "po",
                            "value": "PO-1"
                        }, {
                            "label": "lbl",
                            "value": 2
                        }]
                    },
                    "textCustomFields": [{
                        "name": "po",
                        "value": "ignored"
                    }, {
                        "name": "cost",
                        "value": 9.5
                    }],
                    "fieldValues":
                    "{\"json\": \"string\"}"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject": "Fields as list",
                    "fieldValuesJson": [{
                        "tabLabel": "a",
                        "value": "b"
                    }]
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject": "Fields as str list",
                    "field_values_json":
                    "[{\"name\": \"k\", \"value\": \"v\"}]"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject": "Bad fields",
                    "field_values_json": "{oops"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject": "Num fields",
                    "field_values_json": 5
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject": "Bad signers",
                    "signers_json": "[oops"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject": "Dict signers",
                    "signers_json": "{\"a\": 1}"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "emailSubject": "Num signers",
                    "signers_json": 5
                })
    yield fetch("POST", "envelopes", body={"templateId": "missing-template"})
    yield fetch("POST", "envelopes", body={})
    yield fetch("POST",
                "envelopes",
                body={
                    "status": "created",
                    "signerEmail": "only@example.com"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "status": 5,
                    "signerName": "Num status"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "templateRoles": "ab",
                    "emailBlurb": "blurb"
                })
    yield fetch("POST", "envelopes", body={"templateRoles": 3})
    yield fetch("POST", "envelopes", body={"documents": [{"documentId": 1}]})
    yield fetch("POST", "envelopes", body={"recipients": {"signers": 5}})
    yield fetch("POST", "envelopes", body={"recipients": [1]})
    yield fetch("POST", "envelopes", body={"emailSubject": 5})
    yield fetch("POST",
                "envelopes",
                body={
                    "bogus": 1,
                    "tabs": {
                        "textTabs": [{
                            "tabLabel": "x",
                            "value": None
                        }]
                    }
                })
    yield fetch("POST", "envelopes", body={"world": 1})
    yield fetch("POST", "envelopes", body="[1]")

    # Signature requests (sender fields, no signers JSON).
    yield fetch("POST",
                "envelopes",
                body={
                    "templateId": tmpl,
                    "signerName": "Ivy",
                    "signerEmail": "ivy@example.com",
                    "senderName": "Ops",
                    "senderEmail": "ops@example.com"
                })
    env3 = last().get("envelopeId") if isinstance(last(), dict) else "none"
    yield fetch("POST",
                "envelopes",
                body={
                    "template_id": tmpl,
                    "sender_email": "",
                    "email_blurb": "hi"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "senderName": "Ops",
                    "templateId": "missing"
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "senderName": "",
                    "sender_name": None,
                    "templateId": tmpl
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "senderName": 5,
                    "templateId": tmpl
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "senderName": "Ops",
                    "templateId": tmpl,
                    "signerName": 3
                })
    yield fetch("POST",
                "envelopes",
                body={
                    "senderName": "Ops",
                    "signers_json": "[]",
                    "emailSubject": "has extra"
                })
    yield fetch("GET", f"envelopes/{env3}")

    # Updates.
    yield fetch("PUT",
                f"envelopes/{env1}",
                body={
                    "emailSubject": "Updated subject",
                    "emailBlurb": "New blurb"
                })
    yield fetch("PUT",
                f"envelopes/{env1}",
                body={
                    "status": "voided",
                    "voidedReason": "Superseded"
                })
    yield fetch("PUT", f"envelopes/{env1}", body={"status": "voided"})
    yield fetch("PUT", f"envelopes/{env2}", body={"status": "sent"})
    yield fetch("PUT", f"envelopes/{env2}", body={"status": "sent"})
    yield fetch("PUT",
                f"envelopes/{env2}",
                body={
                    "status": "processing",
                    "emailSubject": 5
                })
    yield fetch("PUT", f"envelopes/{env2}", body={"status": "deleted"})
    yield fetch("PUT", f"envelopes/{env2}", body={"status": "completed"})
    yield fetch("PUT",
                f"envelopes/{env2}",
                body={
                    "status": "voided",
                    "voided_reason": 3
                })
    yield fetch("PUT",
                f"envelopes/{env3}",
                body={
                    "status": "voided",
                    "voided_reason": "Old"
                })
    for e in envelopes[:2]:
        yield fetch("PUT",
                    f"envelopes/{e['id']}",
                    body={
                        "status": "voided",
                        "voidedReason": "cleanup"
                    })
    yield fetch("PUT", f"envelopes/{env3}", body={"envelopeId": "x"})
    yield fetch("PUT", f"envelopes/{env3}", body={"status": ["sent"]})
    yield fetch("PUT", "envelopes/missing", body={"status": "sent"})
    yield fetch("PUT", f"envelopes/{env3}", body="[1]")

    # Recipients.
    yield fetch("POST",
                f"envelopes/{env2}/recipients",
                body={
                    "signers": [{
                        "name": "Jo",
                        "email": "jo@example.com",
                        "roleName": "Approver"
                    }, {
                        "signerName": "Kai",
                        "signerEmail": "kai@example.com",
                        "routing_order": "5",
                        "role_name": "R"
                    }, "skip"],
                    "carbonCopies": [{
                        "ccName": "Lu",
                        "ccEmail": "lu@example.com"
                    }, {
                        "name": "Mo",
                        "email": "mo@x",
                        "recipientId": "c1"
                    }]
                })
    yield fetch("POST",
                f"envelopes/{env2}/recipients",
                body={"signers": [{
                    "name": 5
                }]})
    yield fetch("POST", f"envelopes/{env2}/recipients", body={"signers": "ab"})
    yield fetch("POST",
                f"envelopes/{env2}/recipients",
                body={"carbonCopies": 5})
    yield fetch("POST", f"envelopes/{env2}/recipients", body={})
    yield fetch("POST",
                f"envelopes/{env2}/recipients",
                body={"envelopeId": "x"})
    yield fetch("POST", "envelopes/missing/recipients", body={"signers": []})
    yield fetch("GET", f"envelopes/{env2}/recipients")
    yield fetch("GET", "envelopes/missing/recipients")
    yield fetch("GET",
                f"envelopes/{env2}/recipients",
                params={"envelopeId": 1})

    # Listing filters and paging.
    yield fetch("GET", "envelopes", params={"status": "sent, voided"})
    yield fetch("GET", "envelopes", params={"status": "created"})
    yield fetch("GET", "envelopes", params={"status": 5})
    yield fetch("GET", "envelopes", params={"from_date": "2020-01-01"})
    yield fetch("GET",
                "envelopes",
                params={"from_date": "2020-01-01T00:00:00Z"})
    yield fetch("GET",
                "envelopes",
                params={
                    "from_date": "2030-01-01T00:00:00Z",
                    "from_to_status": "changed"
                })
    yield fetch("GET",
                "envelopes",
                params={"to_date": "2020-01-01T00:00:00+00:00"})
    yield fetch("GET", "envelopes", params={"to_date": "not a date"})
    yield fetch("GET", "envelopes", params={"from_date": 5})
    yield fetch("GET", "envelopes", params={"search_text": "please"})
    yield fetch("GET", "envelopes", params={"search_text": "BLURB"})
    yield fetch("GET", "envelopes", params={"search_text": 3})
    yield fetch("GET", "envelopes", params={"count": 2, "start_position": 1})
    yield fetch("GET", "envelopes", params={"count": "1"})
    yield fetch("GET", "envelopes", params={"start_position": 50})
    yield fetch("GET", "envelopes", params={"count": -1})
    yield fetch("GET",
                "envelopes",
                params={
                    "order_by": "created",
                    "folder_ids": "x",
                    "extra": 1
                })
    yield fetch("GET", "envelopes", params="[1]")

    # Workspaces.
    yield fetch("POST",
                "workspaces",
                body={
                    "name": "Deal Room",
                    "description": "Q3",
                    "ownerName": "Pat",
                    "ownerEmail": "pat@example.com"
                })
    ws = last().get("workspaceId") if isinstance(last(), dict) else "none"
    yield fetch("POST", "workspaces", body={"name": "Default owner"})
    yield fetch("POST", "workspaces", body={})
    yield fetch("POST", "workspaces", body={"name": 5})
    yield fetch("POST", "workspaces", body={"name": "x", "owner_email": 3})
    yield fetch("POST", "workspaces", body="[1]")
    for w in [{"id": ws}] + workspaces[:2]:
        yield fetch("POST",
                    f"workspaces/{w['id']}/users",
                    body={
                        "email": "new@example.com",
                        "userName": "New User",
                        "role": "admin"
                    })
    yield fetch("POST",
                f"workspaces/{ws}/users",
                body={"email": "NEW@example.com"})
    yield fetch("POST",
                f"workspaces/{ws}/users",
                body={
                    "user_email": "other@example.com",
                    "user_name": "Other"
                })
    yield fetch("POST", f"workspaces/{ws}/users", body={})
    yield fetch("POST", f"workspaces/{ws}/users", body={"email": 5})
    yield fetch("POST",
                f"workspaces/{ws}/users",
                body={
                    "email": "r@x",
                    "role": 1
                })
    yield fetch("POST", f"workspaces/{ws}/users", body={"workspace_id": "x"})
    yield fetch("POST", f"workspaces/{ws}/users", body={"world": 1})
    yield fetch("POST", f"workspaces/{ws}/users", body="[1]")
    yield fetch("POST", "workspaces/missing/users", body={"email": "a@b.c"})
    yield fetch("GET", "workspaces")

    # Routing misses.
    yield fetch("DELETE", f"envelopes/{env2}")
    yield fetch("GET", "envelopes/a/b/c")
    yield fetch("POST", "templates")
    yield fetch("GET", "v2.1/accounts/x/envelopes", base="docusign/")
    yield fetch("GET", "envelopes?status=sent")
    yield fetch("GET", "envelopes")
