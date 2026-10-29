"""ChatGPT calls: every route of tools/api/routes/chatgpt.py on the keyless
(simulated) path, writes that later calls see (a response continued by its
``previous_response_id``), and error cases: bad message shapes, prompts of
every JSON type, values the models refuse (422), and ``**`` of a non-mapping.

Run the compare without ``OPENAI_API_KEY``: upstream's ``_call_openai``
calls OpenAI when its process has one."""
import json

KNOWN = {}

BASE = "https://api.openai.com/v1/"


def fetch(method, path, body=None, params=None, base=BASE):
    args = {"method": method, "url": base + path}
    if params is not None:
        args["params"] = params if isinstance(params,
                                              str) else json.dumps(params)
    if body is not None:
        args["body"] = body if isinstance(body, str) else json.dumps(body)
    return "api_fetch", args


PROMPT = ("Classify this lead: ACME Corp wants a demo next week, budget "
          "approved, 500 seats. ") * 2


def calls(world, last):
    # Chat completions.
    yield fetch(
        "POST", "chat/completions", {
            "model":
            "gpt-5-mini",
            "messages": [{
                "role": "system",
                "content": "You are a classifier."
            }, {
                "role": "user",
                "content": PROMPT
            }]
        })
    yield fetch(
        "POST", "chat/completions", {
            "messages": [{
                "role": "user",
                "content": "short"
            }, {
                "role": "user",
                "content": "  two\twords été "
            }]
        })
    yield fetch("POST", "chat/completions", {
        "messages": [],
        "max_tokens": 5,
        "max_completion_tokens": 0
    })
    yield fetch("POST", "chat/completions", {})
    yield fetch("POST", "chat/completions", {"messages": {}})
    yield fetch("POST", "chat/completions", {
        "messages": [{
            "role": "assistant",
            "content": "x"
        }],
        "temperature": 1.0
    })
    yield fetch("POST", "chat/completions", {"messages": [{"role": "user"}]})
    for content in [None, 5, 2.5, True, ["a"], {"a": 1}, "☃" * 120, ""]:
        yield fetch("POST", "chat/completions",
                    {"messages": [{
                        "role": "user",
                        "content": content
                    }]})
    for messages in [
            "hello", 5, True, {
                "role": "user"
            }, [1], [["role"]], [None]
    ]:
        yield fetch("POST", "chat/completions", {"messages": messages})
    yield fetch("POST", "chat/completions", {
        "model": 5,
        "messages": [{
            "role": "user",
            "content": "hi"
        }]
    })
    yield fetch(
        "POST", "chat/completions", {
            "messages": [{
                "role": "system",
                "content": 7
            }, {
                "role": "user",
                "content": "hi"
            }]
        })
    yield fetch("POST", "chat/completions", {
        "messages": [{
            "role": "user",
            "content": "hi"
        }],
        "unknown": 1
    })
    yield fetch("POST", "chat/completions", {"world": 1})
    yield fetch("POST", "chat/completions", "[1, 2]")
    yield fetch("POST", "chat/completions", '"text"')
    # Legacy completions.
    yield fetch("POST", "completions", {
        "prompt": PROMPT,
        "temperature": 0,
        "top_p": 0.5,
        "stop": ["\n"]
    })
    yield fetch("POST", "completions", {"model": "gpt-4o", "prompt": ""})
    yield fetch("POST", "completions", {})
    for prompt in [None, 3, ["a", "b"], {"k": "v"}, 1.0]:
        yield fetch("POST", "completions", {"prompt": prompt})
    yield fetch("POST", "completions", {"prompt": "x", "model": None})
    # Responses, a conversation continued by its previous id.
    yield fetch(
        "POST", "responses", {
            "input": PROMPT,
            "instructions": "Be brief.",
            "max_output_tokens": 100,
            "temperature": 0.2
        })
    first = last().get("id") if isinstance(last(), dict) else None
    yield fetch("POST", "responses", {
        "input": "and then?",
        "previous_response_id": first
    })
    yield fetch("POST", "responses", {
        "input": "a key",
        "previous_response_id": "mem-1"
    })
    yield fetch(
        "POST", "responses", {
            "input": "same key",
            "previous_response_id": "mem-1",
            "max_tokens": 7,
            "top_p": 1
        })
    yield fetch(
        "POST", "responses", {
            "input": [{
                "role": "system",
                "content": "s"
            }, {
                "role": "user",
                "content": "u1"
            }, {
                "role": "user",
                "content": "u2"
            }, "junk", 4]
        })
    yield fetch("POST", "responses", {"input": [{"role": "user"}]})
    yield fetch("POST", "responses",
                {"input": [{
                    "role": "user",
                    "content": None
                }]})
    yield fetch("POST", "responses",
                {"input": [{
                    "role": "user",
                    "content": ["x"]
                }]})
    yield fetch("POST", "responses",
                {"input": {
                    "role": "user",
                    "content": "dict input"
                }})
    yield fetch("POST", "responses", {"input": 5})
    yield fetch("POST", "responses", {})
    for text in [{
            "format": {
                "type": "json_object"
            }
    }, {
            "format": {
                "type": "json_schema"
            }
    }, {
            "format": {
                "type": "xml"
            }
    }, {
            "format": "json"
    }, {
            "format": {}
    }, "plain", {
            "verbosity": "low"
    }]:
        yield fetch("POST", "responses", {"input": "fmt", "text": text})
    yield fetch("POST", "responses", {"input": "x", "previous_response_id": 0})
    yield fetch("POST", "responses", {
        "input": "x",
        "previous_response_id": 12
    })
    yield fetch("POST", "responses", {"input": "x", "instructions": ["no"]})
    yield fetch("POST", "responses", {"input": "x", "model": {"m": 1}})
    yield fetch("POST", "responses", {
        "input": "x",
        "temperature": 0,
        "top_p": 0.0,
        "max_output_tokens": 0
    })
    yield fetch("POST", "responses", "[]")
    # Moderations.
    yield fetch("POST", "moderations", {"input": "some text"})
    yield fetch("POST", "moderations", {
        "input": ["a", "b"],
        "model": "text-moderation-latest"
    })
    yield fetch("POST", "moderations", {"model": ""})
    yield fetch("POST", "moderations", {"extra": True})
    yield fetch("POST", "moderations", "5")
    # Routing: methods and paths no route takes.
    yield fetch("GET", "chat/completions")
    yield fetch("POST", "chat/completions/x", {})
    yield fetch("POST", "embeddings", {"input": "x"})
    yield fetch("POST", "openai/v1/moderations", {"input": "bare"}, base="")
