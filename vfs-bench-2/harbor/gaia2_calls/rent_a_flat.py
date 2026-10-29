"""The rent-a-flat app's calls for gaia2_compare.py."""

KNOWN: dict[str, str] = {}


def calls(state: dict, last):
    apartments = list((state.get("apartments") or {}).values())
    saved = list(state.get("saved_apartments") or [])
    some = apartments[min(3, len(apartments) - 1)]
    unsaved = next((a for a in apartments if a["apartment_id"] not in saved),
                   some)
    yield "list-all-apartments", {}
    yield "get-apartment-details", {"apartment_id": some["apartment_id"]}
    yield "get-apartment-details", {"apartment_id": "nope"}
    yield "list-saved-apartments", {}
    yield "save-apartment", {"apartment_id": unsaved["apartment_id"]}
    yield "save-apartment", {"apartment_id": unsaved["apartment_id"]}
    yield "save-apartment", {"apartment_id": "nope"}
    yield "get-apartment-details", {"apartment_id": unsaved["apartment_id"]}
    yield "list-saved-apartments", {}
    yield "remove-saved-apartment", {"apartment_id": unsaved["apartment_id"]}
    yield "remove-saved-apartment", {"apartment_id": unsaved["apartment_id"]}
    if saved:
        yield "remove-saved-apartment", {"apartment_id": saved[0]}
        yield "save-apartment", {"apartment_id": saved[0]}
    # Searches: every filter, its case and its falsy value.
    yield "search-apartments", {}
    yield "search-apartments", {"name": some["name"][1:4].upper()}
    yield "search-apartments", {
        "location": some["location"].split(",")[-1].strip().lower()
    }
    yield "search-apartments", {"zip_code": some["zip_code"]}
    yield "search-apartments", {"zip_code": some["zip_code"].lower() + " "}
    yield "search-apartments", {"min_price": 1500, "max_price": 2500.5}
    yield "search-apartments", {"min_price": 0, "max_price": 0}
    yield "search-apartments", {
        "min_price": some["price"],
        "max_price": some["price"]
    }
    yield "search-apartments", {
        "number_of_bedrooms": some["bedrooms"],
        "number_of_bathrooms": some["bathrooms"]
    }
    yield "search-apartments", {"number_of_bedrooms": 0, "square_footage": 0}
    yield "search-apartments", {"square_footage": some["square_footage"]}
    yield "search-apartments", {
        "property_type": (some.get("property_type") or "condo").upper()
    }
    yield "search-apartments", {
        "furnished_status": "unfurnished",
        "pet_policy": "PETS ALLOWED"
    }
    yield "search-apartments", {
        "floor_level": some.get("floor_level") or "Ground floor"
    }
    yield "search-apartments", {"floor_level": "upper floors"}
    yield "search-apartments", {"lease_term": "1 YEAR", "furnished_status": ""}
    yield "search-apartments", {"amenities": "gym, Laundry"}
    yield "search-apartments", {"amenities": '["Parking"]'}
    yield "search-apartments", {"amenities": '"Gym"'}
    yield "search-apartments", {"amenities": '{"pool": 1}'}
    yield "search-apartments", {"amenities": "[]"}
    yield "search-apartments", {"amenities": ""}
    yield "search-apartments", {"amenities": "[1, 2]"}
    yield "search-apartments", {"amenities": "5"}
    yield "search-apartments", {"amenities": "null"}
    yield "search-apartments", {"amenities": "[gym"}
    yield "search-apartments", {"saved_only": True}
    yield "search-apartments", {
        "saved_only": True,
        "max_price": 1800,
        "amenities": "Gym"
    }
    # The ENV commands, and reads that see them.
    yield "add-new-apartment", {
        "name": "Harbor Loft",
        "location": "1 Pier Rd, Göteborg",
        "zip_code": "411 01",
        "price": 2150.75,
        "number_of_bedrooms": 2,
        "number_of_bathrooms": 1,
        "square_footage": 750,
        "property_type": "Condo",
        "furnished_status": "Furnished",
        "floor_level": "Penthouse",
        "pet_policy": "Cats allowed",
        "lease_term": "6 months",
        "amenities": '["Gym", "Sauna"]'
    }
    new_id = last()["apartment_id"]
    yield "add-new-apartment", {
        "name": "Bare",
        "location": "Nowhere",
        "zip_code": "000",
        "price": 900,
        "number_of_bedrooms": 0,
        "number_of_bathrooms": 0,
        "square_footage": 10,
        "amenities": "not json"
    }
    bare_id = last()["apartment_id"]
    yield "get-apartment-details", {"apartment_id": new_id}
    yield "get-apartment-details", {"apartment_id": bare_id}
    yield "search-apartments", {"amenities": "sauna", "name": "loft"}
    yield "search-apartments", {
        "property_type": "condo",
        "furnished_status": "furnished"
    }
    yield "update-apartment", {"apartment_id": new_id, "new_price": 1999.99}
    yield "update-apartment", {"apartment_id": bare_id, "new_price": 1000}
    yield "update-apartment", {"apartment_id": "nope", "new_price": 1}
    yield "search-apartments", {"max_price": 1000}
    yield "save-apartment", {"apartment_id": new_id}
    yield "search-apartments", {"saved_only": True, "name": "harbor"}
    yield "delete-apartment", {"apartment_id": new_id}
    yield "delete-apartment", {"apartment_id": new_id}
    yield "list-saved-apartments", {}
    yield "get-apartment-details", {"apartment_id": bare_id}
    yield "delete-apartment", {"apartment_id": bare_id}
    yield "list-all-apartments", {}
