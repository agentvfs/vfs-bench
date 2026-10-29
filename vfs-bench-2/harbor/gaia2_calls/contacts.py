"""The contacts app's calls for gaia2_compare.py."""
import json

KNOWN: dict[str, str] = {}


def calls(state: dict, last):
    contacts = list((state.get("contacts") or {}).values())
    some = contacts[3] if len(contacts) > 3 else contacts[0]
    yield "get-contacts", {}
    yield "get-contacts", {"offset": 10}
    yield "get-contacts", {"offset": len(contacts) - 2}
    yield "get-contacts", {"offset": -3}
    yield "get-contacts", {"offset": len(contacts) + 5}
    yield "get-contact", {"contact_id": some["contact_id"]}
    yield "get-contact", {"contact_id": "nope"}
    yield "get-current-user-details", {}
    yield "search-contacts", {"query": some["first_name"][:3].upper()}
    yield "search-contacts", {
        "query": f"{some['last_name']} {some['first_name']}"
    }
    yield "search-contacts", {"query": "zzzz-none"}
    if some.get("email"):
        yield "search-contacts", {"query": some["email"]}
    yield "add-new-contact", {
        "first_name": some["first_name"].upper(),
        "last_name": some["last_name"]
    }
    yield "add-new-contact", {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "gender": "Robot"
    }
    yield "add-new-contact", {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "status": "Busy"
    }
    yield "add-new-contact", {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "age": 101
    }
    yield "add-new-contact", {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "email": "no-at-sign"
    }
    yield "add-new-contact", {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "gender": "Female",
        "age": 36,
        "nationality": "British",
        "city_living": "London",
        "country": "UK",
        "status": "Retired",
        "job": "Mathematician",
        "description": "Analyst — “engine” ✓",
        "phone": "+44 20 0000",
        "email": "ada@example.com",
        "address": "12 St James's Square"
    }
    new_id = last()["contact_id"]
    yield "add-new-contact", {"first_name": "Charles", "last_name": "Babbage"}
    yield "get-contact", {"contact_id": new_id}
    yield "search-contacts", {"query": "lovelace"}
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({
            "job": "Countess",
            "age": 37
        })
    }
    yield "edit-contact", {"contact_id": new_id, "updates": "{not json"}
    yield "edit-contact", {"contact_id": "nope", "updates": "{}"}
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({"shoe_size": 7})
    }
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({"gender": "x"})
    }
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({"status": "x"})
    }
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({"age": 0})
    }
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({"first_name": None})
    }
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({"last_name": None})
    }
    yield "edit-contact", {
        "contact_id": new_id,
        "updates": json.dumps({"email": "bad"})
    }
    yield "edit-contact", {
        "contact_id": some["contact_id"],
        "updates": json.dumps({
            "email": None,
            "phone": "555"
        })
    }
    yield "get-contact", {"contact_id": some["contact_id"]}
    yield "delete-contact", {"contact_id": new_id}
    yield "delete-contact", {"contact_id": new_id}
    yield "get-contacts", {"offset": len(contacts) - 1}
