"""The city app's calls for gaia2_compare.py."""

KNOWN: dict[str, str] = {}


def calls(state: dict, last):
    zips = list(state.get("crime_data") or {})
    limit = state.get("api_call_limit", 100)
    yield "get-api-call-limit", {}
    yield "get-api-call-count", {}
    yield "get-crime-rate", {"zip_code": zips[0]}
    yield "get-crime-rate", {"zip_code": "00000-none"}
    yield "get-api-call-count", {}
    yield "update-crime-rate", {"zip_code": zips[1]}
    yield "update-crime-rate", {
        "zip_code": "nope",
        "new_violent_crime_rate": 1.5
    }
    yield "update-crime-rate", {
        "zip_code": zips[1],
        "new_violent_crime_rate": 3
    }
    yield "update-crime-rate", {
        "zip_code": zips[1],
        "new_property_crime_rate": 2.25
    }
    yield "get-crime-rate", {"zip_code": zips[1]}
    yield "add-crime-rate", {
        "zip_code": "99999",
        "violent_crime_rate": 1,
        "property_crime_rate": 0.5
    }
    yield "add-crime-rate", {
        "zip_code": zips[2],
        "violent_crime_rate": 7.75,
        "property_crime_rate": 8
    }
    yield "get-crime-rate", {"zip_code": "99999"}
    # Past the limit: the first refused call starts the cooldown, which a
    # frozen clock never ends.
    for _ in range(limit):
        yield "get-crime-rate", {"zip_code": zips[0]}
    yield "get-api-call-count", {}
    yield "get-crime-rate", {"zip_code": zips[0]}
    yield "get-api-call-count", {}
