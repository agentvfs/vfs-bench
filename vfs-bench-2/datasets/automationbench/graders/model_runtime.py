"""Monty model adapter for the pinned AutomationBench schema.

The fake stores canonical model JSON. The original task's initial state may
also contain aliases and nested records; generated upstream validators run
before typed field construction. No Pydantic or host callbacks are used.
"""
import hashlib  # noqa: F401 (generated schema helpers)
import json
import math
import random
import re
import time  # noqa: F401 (generated schema helpers)
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path  # noqa: F401 (assembled entry point)

# Supplied by the generated port in the same Monty program.
MODELS = {}
METHODS = {}
PROPERTIES = {}
VALIDATORS = {}
FACTORIES = {}
FIELD_OPTIONS = {}
POST_INIT = {}
INITIALIZERS = {}
HANDLERS = {}


@dataclass
class Model:
    kind: str
    data: dict


@dataclass
class UUIDValue:
    hex: str

    def __str__(self):
        h = self.hex
        return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def new_uuid():
    # Only default-generated identifiers use randomness, as in the reference.
    bits = random.getrandbits(128)
    bits = (bits & ~(15 << 76)) | (4 << 76)
    bits = (bits & ~(3 << 62)) | (2 << 62)
    return UUIDValue(format(bits, "032x"))


def url_unquote(value):
    # urllib.parse.unquote's UTF-8 replacement and malformed-% semantics.
    if not isinstance(value, str):
        return value.decode("utf-8", errors="replace")
    chunks = re.split(r"((?:%[0-9a-fA-F]{2})+)", value)
    for i in range(1, len(chunks), 2):
        chunks[i] = bytes.fromhex(chunks[i].replace("%", "")).decode(
            "utf-8", errors="replace")
    return "".join(chunks)


def model_get(obj, name, *default):
    if isinstance(obj, Model):
        if name in obj.data:
            return obj.data[name]
        prop = PROPERTIES.get(obj.kind, {}).get(name)
        if prop is not None:
            return prop(obj)
        if default:
            return default[0]
        raise AttributeError(f"{obj.kind} has no attribute {name}")
    return getattr(obj, name, *default)


def model_has(obj, name):
    if isinstance(obj, Model):
        return name in obj.data or name in PROPERTIES.get(
            obj.kind, {}) or name in METHODS.get(obj.kind, {})
    return hasattr(obj, name)


def model_set(obj, name, value):
    if isinstance(obj, Model):
        obj.data[name] = value
    else:
        setattr(obj, name, value)


def model_call(obj, name, *args, **kwargs):
    if isinstance(obj, Model):
        if name == "model_dump":
            return model_dump(obj, **kwargs)
        method = METHODS.get(obj.kind, {}).get(name)
        if method is None:
            raise AttributeError(f"{obj.kind} has no method {name}")
        return method(obj, *args, **kwargs)
    return getattr(obj, name)(*args, **kwargs)


def model_dump(value, mode="python"):
    if isinstance(value, Model):
        names = {f["name"] for f in MODELS[value.kind]["fields"]}
        return {
            k: model_dump(v, mode)
            for k, v in value.data.items() if k in names
        }
    if isinstance(value, dict):
        return {k: model_dump(v, mode) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [model_dump(v, mode) for v in value]
    if mode == "json" and isinstance(value, (datetime, date, Decimal)):
        return str(value) if isinstance(value, Decimal) else value.isoformat()
    return value


def convert(desc, value):
    kind = desc["k"]
    if kind == "any":
        return value
    if kind == "none":
        if value is not None:
            raise ValueError("Expected None")
        return None
    if kind == "union":
        # Pydantic smart unions prefer exact primitive types over coercion.
        exact = {
            str: "str",
            int: "int",
            float: "float",
            bool: "bool",
            type(None): "none"
        }.get(type(value))
        options = sorted(desc["of"], key=lambda t: t["k"] != exact)
        for option in options:
            try:
                return convert(option, value)
            except (ValueError, TypeError):
                pass
        raise ValueError("No matching union variant")
    if kind == "model":
        return build_model(desc["name"], value)
    if kind in ("list", "set"):
        if not isinstance(value, (list, tuple, set)):
            raise ValueError("Expected sequence")
        items = [convert(desc["item"], v) for v in value]
        return set(items) if kind == "set" else items
    if kind == "dict":
        if not isinstance(value, dict):
            raise ValueError("Expected mapping")
        return {
            convert(desc["key"], k): convert(desc["value"], v)
            for k, v in value.items()
        }
    if kind == "literal":
        for literal in desc["values"]:
            if value == literal:
                return literal
        raise ValueError("Invalid literal")
    if kind == "str":
        if not isinstance(value, str):
            raise ValueError("Expected string")
        return value
    if kind == "bool":
        if isinstance(value, str):
            lowered = value.lower()
            if lowered in ("0", "off", "f", "false", "n", "no"):
                return False
            if lowered in ("1", "on", "t", "true", "y", "yes"):
                return True
        if value in (0, 1):
            return bool(value)
        raise ValueError("Expected boolean")
    if kind == "int":
        if isinstance(value, int):
            return int(value)
        if isinstance(value, str):
            text = value.strip()
            if not re.fullmatch(r"[+-]?[0-9](?:_?[0-9])*(?:\.0+)?", text):
                raise ValueError("Expected integer string")
            return int(text.split(".")[0])
        if isinstance(value,
                      float) and math.isfinite(value) and int(value) == value:
            return int(value)
        raise ValueError("Expected integral number")
    if kind == "float":
        if value is None:
            raise ValueError("Expected number")
        return float(value)
    if kind == "decimal":
        if isinstance(value, (bool, type(None))):
            raise ValueError("Expected decimal")
        result = Decimal(str(value))
        if not result.is_finite():
            raise ValueError("Expected finite decimal")
        return result
    if kind in ("datetime", "date"):
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, date):
            parsed = datetime(value.year, value.month, value.day)
        elif isinstance(value, (int, float)) or (isinstance(
                value, str) and re.fullmatch(r"[+-]?\d+(?:\.\d+)?", value)):
            timestamp = float(value)
            if abs(timestamp) > 20000000000:
                timestamp /= 1000
            parsed = datetime(
                1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=timestamp)
        elif isinstance(value, str):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            raise ValueError("Expected date/time")
        return parsed.date() if kind == "date" else parsed
    raise ValueError(f"Unsupported field type {kind}")


def default_value(field):
    if "default" in field:
        # Mutable defaults are fresh for every object.
        return convert(field["type"], json.loads(json.dumps(field["default"])))
    factory = field.get("factory")
    if factory in ("list", "dict", "set"):
        return {"list": list, "dict": dict, "set": set}[factory]()
    if factory == "datetime.now":
        return datetime.now()
    if factory and factory.startswith("model:"):
        return build_model(factory[6:], {})
    if factory in FACTORIES:
        return FACTORIES[factory]()
    raise ValueError(f"Missing required field {field['name']}")


def populate_model(obj, data):
    desc = MODELS[obj.kind]
    options = FIELD_OPTIONS[obj.kind]
    for name in desc["before"]:
        data = VALIDATORS[obj.kind][name](None, data)
    if not isinstance(data, dict):
        raise ValueError("Expected model mapping")
    consumed = set()
    for field in desc["fields"]:
        name = field["name"]
        alias = options["validation_aliases"].get(name,
                                                  field.get("alias", name))
        if alias not in data and options["populate_by_name"]:
            alias = name
        if alias in data:
            consumed.add(alias)
            value = data[alias]
            for validator, fields in desc["field_validators"].items():
                if name in fields:
                    value = VALIDATORS[obj.kind][validator](None, value)
            value = convert(field["type"], value)
        else:
            value = default_value(field)
        obj.data[name] = value
    extra = data.keys() - consumed
    if extra:
        raise ValueError(f"Extra fields in {obj.kind}: {sorted(extra)}")
    post = POST_INIT.get(obj.kind)
    if post:
        post(obj, None)


def build_model(kind, data):
    if isinstance(data, Model):
        return data
    obj = Model(kind, {})
    init = INITIALIZERS.get(kind)
    if init:
        init(obj, dict(data))
    else:
        populate_model(obj, data)
    return obj


def check_assertion(world, assertion):
    # The reference grade.py removes the environment override; registry.py
    # therefore uses STRICT_MODE=True and propagates assertion errors.
    handler = HANDLERS.get(assertion["type"])
    if handler is None:
        raise ValueError(f"Unknown assertion type: {assertion['type']}")
    return handler(world, assertion)


def strip_none_values(obj):
    if isinstance(obj, dict):
        return {
            k: strip_none_values(v)
            for k, v in obj.items() if v is not None
        }
    if isinstance(obj, list):
        return [strip_none_values(v) for v in obj if v is not None]
    return obj
