"""The cabs app's calls for gaia2_compare.py."""

KNOWN: dict[str, str] = {}

BAD_TIMES = [
    "2024-02-30 10:00:00",  # no such day
    "2023-02-29 10:00:00",  # not a leap year
    "2024-10-15T10:00:00",
    "2024-10-15 10:00:00 ",  # unconverted data remains
    "2024-10-15 24:00:00",
    "2024-10-15 23:59:60",  # a leap second datetime refuses
    "0000-01-01 00:00:00",
    "15/10/2024 10:00",
    "",
]
ODD_TIMES = [
    "2024-1-5 3:4:5",  # single digits
    "2024-10- 5 10:00:00",  # a space-padded day
    "2024-10-15 \t 10:00:00",  # any run of whitespace
    "٢٠٢٤-10-15 10:00:00",  # a Unicode-digit year
    "2024-02-29 00:00:00",
    "0001-01-01 00:00:00",
    "9999-12-31 23:59:59",
]


def calls(state: dict, last):
    rides = state.get("ride_history") or []
    quotes = state.get("quotation_history") or []
    n = len(rides)
    known = (quotes or rides)[0] if (quotes or rides) else None

    yield "get-ride-history-length", {}
    yield "get-ride-history", {}
    yield "get-ride-history", {"offset": 5, "limit": 3}
    yield "get-ride-history", {"offset": -3}
    yield "get-ride-history", {"offset": -2, "limit": 1}
    yield "get-ride-history", {"offset": n + 5}
    yield "get-ride-history", {"limit": 0}
    yield "get-ride-history", {"offset": 2, "limit": -1}
    yield "get-ride", {"idx": 0}
    yield "get-ride", {"idx": max(n - 1, 0)}
    yield "get-ride", {"idx": n}
    yield "get-ride", {"idx": -1}
    yield "get-ride", {}

    # Nothing on-going yet.
    yield "get-current-ride-status", {}
    yield "user-cancel-ride", {}
    yield "cancel-ride", {}
    yield "cancel-ride", {"who_cancel": "passenger"}
    yield "end-ride", {}
    yield "update-ride-status", {"status": "LOST"}
    yield "update-ride-status", {"status": "DELAYED"}

    # Quotations: a route with history (its distance, and a price varied from
    # the last one), and new routes, for every service type.
    if known is not None:
        a, b, svc = known["start_location"], known["end_location"], known[
            "service_type"]
        yield "get-quotation", {
            "start_location": a,
            "end_location": b,
            "service_type": svc,
            "ride_time": "2024-10-15 09:30:00"
        }
        yield "get-quotation", {
            "start_location": a,
            "end_location": b,
            "service_type": svc,
            "ride_time": "2019-01-01 00:00:00"
        }  # before it: variance clamps
        yield "get-quotation", {
            "start_location": a,
            "end_location": b,
            "service_type": svc
        }
        for other in ("Default", "Premium", "Van"):
            yield "get-quotation", {
                "start_location": a,
                "end_location": b,
                "service_type": other,
                "ride_time": "2024-11-01 18:45:10"
            }
        yield "list-rides", {"start_location": b, "end_location": a}
    for svc in ("Default", "Premium", "Van"):
        yield "get-quotation", {
            "start_location": "Alpha St 1",
            "end_location": "Beta Ave 2",
            "service_type": svc
        }
        yield "get-quotation", {
            "start_location": "Alpha St 1",
            "end_location": "Beta Ave 2",
            "service_type": svc,
            "ride_time": "2030-06-01 12:00:00"
        }
        yield "get-quotation", {
            "start_location": "Alpha St 1",
            "end_location": "Beta Ave 2",
            "service_type": svc,
            "ride_time": "2031-06-01 12:00:00"
        }
    yield "get-quotation", {
        "start_location": "Zürich HB",
        "end_location": "Genève “Cornavin” ✓",
        "service_type": "Premium",
        "ride_time": "2024-10-15 08:00:00"
    }
    yield "get-quotation", {
        "start_location": "Alpha St 1",
        "end_location": "Beta Ave 2",
        "service_type": "Bike"
    }
    yield "get-quotation", {
        "start_location": "Alpha St 1",
        "end_location": "Beta Ave 2",
        "service_type": "default"
    }
    yield "get-quotation", {
        "start_location": "Alpha St 1",
        "end_location": "Beta Ave 2",
        "service_type": "Bike",
        "ride_time": "nope"
    }  # the time fails first
    for t in BAD_TIMES:
        yield "get-quotation", {
            "start_location": "X",
            "end_location": "Y",
            "service_type": "Van",
            "ride_time": t
        }
    for t in ODD_TIMES:
        yield "get-quotation", {
            "start_location": "X",
            "end_location": "Y",
            "service_type": "Van",
            "ride_time": t
        }
    yield "get-quotation", {"start_location": "X", "end_location": "Y"}
    yield "get-quotation", {"end_location": "Y", "service_type": "Van"}
    yield "list-rides", {
        "start_location": "Gamma Rd 3",
        "end_location": "Delta Ln 4"
    }
    yield "list-rides", {
        "start_location": "Gamma Rd 3",
        "end_location": "Delta Ln 4",
        "ride_time": "2024-12-24 20:00:00"
    }
    yield "list-rides", {
        "start_location": "Gamma Rd 3",
        "end_location": "Delta Ln 4",
        "ride_time": "2024-12-24"
    }  # uncaught ValueError
    yield "list-rides", {"start_location": "Gamma Rd 3"}

    # Orders, and what the ENV does to them.
    yield "order-ride", {
        "start_location": "Alpha St 1",
        "end_location": "Beta Ave 2",
        "service_type": "Bike"
    }
    yield "order-ride", {
        "start_location": "Alpha St 1",
        "end_location": "Beta Ave 2",
        "service_type": "Van",
        "ride_time": "tomorrow"
    }  # uncaught ValueError
    yield "order-ride", {
        "start_location": "Alpha St 1",
        "end_location": "Beta Ave 2",
        "service_type": "Van",
        "ride_time": "2024-10-15 06:00:00"
    }
    yield "order-ride", {
        "start_location": "Alpha St 1",
        "end_location": "Beta Ave 2",
        "service_type": "Van"
    }
    yield "get-current-ride-status", {}
    yield "get-current-ride-status", {}
    yield "get-ride-history-length", {}
    yield "get-ride", {"idx": n}
    yield "get-ride-history", {"offset": max(n - 2, 0)}
    yield "update-ride-status", {
        "status": "DELAYED",
        "message": "Traffic on the A2"
    }
    yield "update-ride-status", {"status": "IN_PROGRESS", "message": ""}
    yield "get-current-ride-status", {}
    yield "user-cancel-ride", {}
    yield "user-cancel-ride", {}
    yield "get-ride", {"idx": n}

    yield "order-ride", {
        "start_location": "Gamma Rd 3",
        "end_location": "Delta Ln 4",
        "service_type": "Default"
    }
    yield "update-ride-status", {"status": "ARRIVED_AT_PICKUP"}
    yield "get-current-ride-status", {}
    yield "end-ride", {}
    yield "end-ride", {}
    yield "get-ride", {"idx": n + 1}

    yield "order-ride", {
        "start_location": "Zürich HB",
        "end_location": "Genève “Cornavin” ✓",
        "service_type": "Premium",
        "ride_time": "2030-01-01 00:00:00"
    }
    yield "get-current-ride-status", {}
    yield "cancel-ride", {"who_cancel": "user", "message": "Driver is sick"}
    yield "order-ride", {
        "start_location": "Zürich HB",
        "end_location": "Genève “Cornavin” ✓",
        "service_type": "Premium",
        "ride_time": "2030-01-01 00:00:00"
    }
    yield "cancel-ride", {}
    if known is not None:
        yield "order-ride", {
            "start_location": known["start_location"],
            "end_location": known["end_location"],
            "service_type": known["service_type"]
        }
        yield "cancel-ride", {"message": ""}
    yield "get-ride-history-length", {}
    yield "get-ride-history", {"offset": n, "limit": 20}
