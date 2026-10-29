"""Twilio calls: both routes of tools/api/routes/twilio.py, every body shape
they read, and error cases."""
import json

KNOWN = {}

BASE = "https://api.twilio.com/2010-04-01/Accounts/AC123/"


def post(path, body=None, params=None):
    args = {"method": "POST", "url": BASE + path}
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    if params is not None:
        args["params"] = json.dumps(params)
    return "api_fetch", args


def calls(world, last):
    for body in [
        {
            "From": "+15550001",
            "To": "+15550002",
            "Body": "Water leak in B2"
        },
        {
            "from_number": "+1",
            "to_number": "+2",
            "message": "alt names"
        },
        {
            "From": "",
            "from_number": "+3",
            "To": "+4",
            "Body": ""
        },
        {
            "To": "+5"
        },
        {},
        {
            "From": 5,
            "To": "+6",
            "Body": "x"
        },
        {
            "From": None,
            "To": "+6",
            "Body": "x"
        },
        {
            "From": "+1",
            "To": "+2",
            "Body": "é ✓ unicode"
        },
        {
            "From": "+1",
            "To": "+2",
            "Body": "x",
            "StatusCallback": "http://x"
        },
    ]:
        yield post("Messages.json", body)
        yield post("Calls.json", {**body, "Url": "http://twiml"})
    yield post("Calls.json", {
        "From": "+1",
        "To": "+2",
        "message": "Evacuate",
        "url": "http://u"
    })
    yield post("Calls.json", {"From": "+1", "To": "+2", "message": 5})
    yield post("Messages.json", "[1]")
    yield post("Calls.json", '"x"')
    yield post("Messages.json", "5")
    yield post("Messages.json", {
        "From": "+1",
        "To": "+2",
        "Body": "q"
    },
               params={"a": 1})
    yield "api_fetch", {"method": "GET", "url": BASE + "Messages.json"}
    yield "api_fetch", {"method": "POST", "url": BASE + "Messages"}
    yield "api_fetch", {
        "method": "POST",
        "url":
        "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json/extra"
    }
    yield "api_fetch", {
        "method": "POST",
        "url": "twilio/2010-04-01/Accounts/A/Messages.json",
        "body": json.dumps({
            "To": "+9",
            "From": "+8",
            "Body": "bare"
        })
    }
