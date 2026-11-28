"""A task's tools as Mirage CLIs, as ``workspace/cli.ts`` and
``workspace/tools.ts`` make them for the TypeScript daemon.

``tools.json`` lists each CLI's tools as upstream's task gives them, each
with the endpoint upstream's dispatcher posts it to. Each becomes a CLI
registered under its spec name (``spec_name``, cli.ts's ``specName``), which
the plan's ``clis:`` installs under its own name, with its service's run URL
(``config: {url: ...}``), any headers each call carries and the trial's
dispatch log.

Tool ``a.b_c`` is the command ``<cli> a b-c``, and each parameter in its
JSON schema a flag of the same name, typed as cli.ts types it. A call goes
as upstream's dispatcher sends it: the arguments as the JSON body to the
endpoint's path at the run's URL, the reply's JSON the result, an error
from status 400 up and a failure as a 500, each appended to the dispatch
log. What prints is what the TypeScript CLI prints: JSON as
``JSON.stringify`` writes it.
"""
import hashlib
import json
import math
import re
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
from mirage.accessor.base import NOOPAccessor
from mirage.commands.cli.specs import CLI_SPECS, register_cli_spec
from mirage.commands.cli.types import CLI, CLIHandler
from mirage.commands.config import Context
from mirage.commands.spec.flag_view import FlagView
from mirage.commands.spec.types import Argument, CommandSpec
from mirage.io.types import IOResult
from mirage.types import PathSpec
from mirage.utils.clock import system_date
from pydantic import BaseModel, ConfigDict

INDEX = re.compile(r"0|[1-9][0-9]*")
DECIMAL = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")
RADIX = re.compile(r"0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+")
# Each dispatch log's calls, numbered from 1.
CALLS: dict[str, int] = {}


class Config(BaseModel):
    """An install's config: the run's URL, the headers every call carries
    (ComplexMCP's apps are told their LightSystem run this way) and the
    trial's dispatch log."""

    model_config = ConfigDict(extra="forbid")

    url: str
    headers: dict[str, str] | None = None
    dispatches: str | None = None


def _number(value: float) -> str:
    """A float as JavaScript's ``Number.prototype.toString`` writes it."""
    if not math.isfinite(value):
        return "null"
    if value == 0:
        return "0"
    text = repr(abs(value))
    mantissa, _, exponent = text.partition("e")
    whole, _, fraction = mantissa.partition(".")
    if whole != "0":
        point = len(whole) + int(exponent or 0)
    else:
        point = int(exponent
                    or 0) - (len(fraction) - len(fraction.lstrip("0")))
    digits = (whole + fraction).lstrip("0").rstrip("0") or "0"
    k = len(digits)
    if k <= point <= 21:
        out = digits + "0" * (point - k)
    elif 0 < point <= 21:
        out = f"{digits[:point]}.{digits[point:]}"
    elif -6 < point <= 0:
        out = f"0.{'0' * -point}{digits}"
    else:
        e = point - 1
        out = (digits[0] + (f".{digits[1:]}" if k > 1 else "") +
               f"e{'+' if e >= 0 else '-'}{abs(e)}")
    return f"-{out}" if value < 0 else out


def _keys(value: dict) -> list:
    """An object's keys in JavaScript's order: array indices ascending,
    then the rest as inserted."""
    index = [
        k for k in value
        if INDEX.fullmatch(k) is not None and int(k) < 2**32 - 1
    ]
    rest = [k for k in value if k not in set(index)]
    return sorted(index, key=int) + rest


def stringify(value, indent: int | None = None, depth: int = 0) -> str:
    """``JSON.stringify(value, null, indent)``."""
    if value is None or value is True or value is False:
        return json.dumps(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, dict)):
        items = ([stringify(v, indent, depth + 1)
                  for v in value] if isinstance(value, list) else [
                      f"{json.dumps(k, ensure_ascii=False)}:"
                      f"{'' if indent is None else ' '}"
                      f"{stringify(value[k], indent, depth + 1)}"
                      for k in _keys(value)
                  ])
        open_, close = "[]" if isinstance(value, list) else "{}"
        if not items:
            return open_ + close
        if indent is None:
            return open_ + ",".join(items) + close
        inner = "\n" + " " * (indent * (depth + 1))
        return (open_ + inner + f",{inner}".join(items) + "\n" + " " *
                (indent * depth) + close)
    raise TypeError(f"not JSON: {value!r}")


def _concrete(schema: dict) -> dict:
    """The schema with a nullable union reduced to its one non-null
    branch."""
    union = schema.get("anyOf", schema.get("oneOf"))
    if union is not None:
        real = [s for s in union if s.get("type") != "null"]
        if len(real) == 1:
            description = schema.get("description", real[0].get("description"))
            out = {**_concrete(real[0])}
            out.pop("description", None)
            if description is not None:
                out["description"] = description
            return out
        return {**schema, "type": "object"}
    if isinstance(schema.get("type"), list):
        real = [t for t in schema["type"] if t != "null"]
        return {**schema, "type": real[0] if len(real) == 1 else "object"}
    return schema


def _kind(schema: dict) -> str:
    if schema.get("x-flag") is True:
        return "flag"
    kind = schema.get("type")
    if kind == "string":
        return "str"
    if kind == "integer":
        return "int"
    if kind == "number":
        return "float"
    if kind == "boolean":
        return "bool"
    if kind == "array":
        item = ("str" if "items" not in schema else _kind(
            _concrete(schema["items"])))
        return "list" if item in ("str", "int", "float") else "json"
    if kind is None:
        return "str" if "enum" in schema else "json"
    return "json"


def _shape(raw: dict, depth: int = 0) -> str:
    """A JSON value's shape, compactly:
    ``[{description: string, amount?: number}]``."""
    schema = _concrete(raw)
    if depth > 4:
        return "any"
    if "enum" in schema:
        return "|".join(stringify(v) for v in schema["enum"])
    kind = schema.get("type")
    if kind == "array":
        return ("[any]" if "items" not in schema else
                f"[{_shape(schema['items'], depth + 1)}]")
    if kind in ("object", None):
        if "properties" not in schema:
            return "any" if kind is None else "object"
        need = set(schema.get("required") or [])
        fields = [
            f"{k}{'' if k in need else '?'}: {_shape(v, depth + 1)}"
            for k, v in schema["properties"].items()
        ]
        return "{" + ", ".join(fields) + "}"
    return str(kind)


def command_path(name: str) -> list[str]:
    """A tool name's command path: ``a.b_c`` is ``['a', 'b-c']``."""
    return [part.replace("_", "-") for part in name.split(".")]


def _flag(param: str) -> str:
    return "--" + param.replace("_", "-")


def _key(param: str) -> str:
    return param.replace("-", "_")


@dataclass(frozen=True)
class Param:
    name: str
    kind: str
    item: str
    strict: bool


def _nullable(schema: dict) -> bool:
    """Whether a schema admits null, which a flag expresses by being left
    out."""
    union = schema.get("anyOf", schema.get("oneOf")) or []
    kind = schema.get("type")
    return (schema.get("nullable") is True
            or any(s.get("type") == "null" for s in union)
            or (isinstance(kind, list) and "null" in kind))


def _argument(name: str, raw: dict, listed: bool,
              strict: bool) -> tuple[Argument, Param]:
    schema = _concrete(raw)
    # Strict function schemas list every parameter as required, defaults
    # and nulls included; a flag is required only when it cannot be left
    # out.
    kind = _kind(schema)
    needed = (kind != "flag" and listed and "default" not in raw
              and not _nullable(raw))
    item = _kind(_concrete(schema.get("items")
                           or {})) if kind == "list" else kind
    help_ = "; ".join(part for part in (
        schema.get("description") or "",
        _shape(schema) if kind == "json" else "",
        f"default {stringify(schema['default'])}" if "default" in
        schema else "",
        # What a strict flag's own checks would say.
        "one of " + ", ".join(_text(v) for v in schema["enum"])
        if not strict and "enum" in schema else "",
        "required" if not strict and needed else "",
    ) if part)
    options: dict = {"required": strict and needed, "help": help_ or None}
    if kind == "flag":
        options["action"] = "store_true"
    elif kind == "list":
        options["action"] = "append"
    elif kind == "json":
        options["metavar"] = "JSON"
    if strict:
        if kind == "int":
            options["type"] = "int"
        elif kind == "float":
            options["type"] = "float"
        elif kind == "bool":
            options["choices"] = ("true", "false")
        elif kind == "str" and "enum" in schema:
            options["choices"] = tuple(_text(v) for v in schema["enum"])
    return Argument(_flag(name), **options), Param(name, kind, item, strict)


def _text(value) -> str:
    """``String(value)``."""
    if isinstance(value, str):
        return value
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return _number(value)
    if isinstance(value, (list, dict)):
        return stringify(value)
    return str(value)


def _js_number(text: str):
    """``Number(text)``, or None where it is NaN or infinite."""
    trimmed = text.strip()
    if trimmed == "":
        return 0
    if RADIX.fullmatch(trimmed):
        return int(trimmed, 0)
    if DECIMAL.fullmatch(trimmed):
        value = float(trimmed)
        return value if math.isfinite(value) else None
    return None


def _loose(text: str, kind: str):
    """A loose flag's value as the schema's type where it reads as one,
    else as it is."""
    if kind == "int":
        return (_js_number(text)
                if re.fullmatch(r"[+-]?\d+", text.strip()) else text)
    if kind == "float":
        value = _js_number(text) if text.strip() != "" else None
        return text if value is None else value
    if kind == "bool":
        return True if text == "true" else False if text == "false" else text
    if kind == "json":
        try:
            return json.loads(text)
        except ValueError:
            return text
    return text


def _json_array(text: str) -> list | None:
    """A list flag's one value as the JSON array it spells, if it is
    one."""
    if not text.lstrip().startswith("["):
        return None
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, list) else None


def _arguments(params: list[Param], ctx: Context) -> dict:
    """The tool's arguments, typed back from its flags."""
    flags = FlagView(ctx.flags, ctx.spec)
    out: dict = {}
    for p in params:
        key = _key(p.name)
        if key not in (ctx.flags or {}):
            continue
        if not p.strict and p.kind in ("int", "float", "bool", "json"):
            out[p.name] = _loose(flags.as_str(key) or "", p.kind)
        elif p.kind == "int":
            out[p.name] = flags.as_int(key)
        elif p.kind == "float":
            out[p.name] = flags.as_float(key)
        elif p.kind == "bool":
            out[p.name] = flags.as_str(key) == "true"
        elif p.kind == "flag":
            if flags.as_bool(key):
                out[p.name] = True
        elif p.kind == "list":
            values = flags.as_list(key)
            array = _json_array(values[0]) if len(values) == 1 else None
            if array is not None:
                out[p.name] = array
            elif not p.strict:
                out[p.name] = [_loose(v, p.item) for v in values]
            elif p.item in ("int", "float"):
                out[p.name] = [_js_number(v) for v in values]
            else:
                out[p.name] = values
        elif p.kind == "json":
            text = flags.as_str(key) or ""
            try:
                out[p.name] = json.loads(text)
            except ValueError:
                raise ValueError(
                    f"{_flag(p.name)} takes JSON: {text}") from None
        else:
            out[p.name] = flags.as_str(key)
    return out


def _render(result) -> str:
    """A tool's result: strings as they are, anything else as JSON."""
    text = result if isinstance(result, str) else stringify(result, 2)
    return text if text.endswith("\n") else f"{text}\n"


async def send(tool: dict, args: dict, config: Config) -> tuple[bool, object]:
    """One call, as upstream's dispatcher sends and records it
    (``runner/dispatcher.py``): the result, or why it failed."""
    if config.dispatches is None:
        raise ValueError(f"{tool['name']}: no dispatch log")
    call = CALLS.get(config.dispatches, 0) + 1
    CALLS[config.dispatches] = call
    endpoint = tool["endpoint"]
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            reply = await client.request(
                endpoint["method"],
                config.url + httpx.URL(endpoint["url"]).path,
                headers={
                    "content-type": "application/json",
                    **(config.headers or {})
                },
                content=stringify(args).encode())
            status = reply.status_code
            body = reply.json()
    except (httpx.HTTPError, ValueError) as error:
        status = 500
        body = {"error": f"{type(error).__name__}: {error}"}
    now = system_date()
    dispatch = {
        "tool_use_id":
        f"call_{call}",
        "tool_name":
        tool.get("call", tool["name"]),
        "endpoint_url":
        endpoint["url"],
        "request_body":
        args,
        "response_status":
        status,
        "response_body":
        body,
        "latency_ms": (time.perf_counter() - started) * 1000,
        "timestamp":
        now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z",
    }
    with Path(config.dispatches).open("a") as log:
        log.write(stringify(dispatch) + "\n")
    # An error's text, where the body is one (a Gaia2 app's stderr), prints
    # as it is.
    if status < 400:
        return True, body
    return False, body if isinstance(body, str) else stringify(body, 2)


def _handler(tool: dict, params: list[Param]) -> CLIHandler:

    async def run(accessor: NOOPAccessor, paths: list[PathSpec],
                  texts: list[str],
                  ctx: Context) -> tuple[bytes | None, IOResult]:
        try:
            args = _arguments(params, ctx)
        except ValueError as error:
            return None, IOResult(exit_code=2, stderr=f"{error}\n".encode())
        ok, value = await send(tool, args, accessor.config)
        if not ok:
            return None, IOResult(
                exit_code=1,
                stderr=_render("failed" if value is None else value).encode())
        return _render(value).encode(), IOResult()

    return CLIHandler(fn=run, write=True)


def spec_name(cli: dict) -> str:
    """The name a task's CLI is registered under: its name and a digest of
    it, as ``tools.json`` gives it (``crm-1f2e3d4c5b6a``)."""
    digest = hashlib.sha256(stringify(cli).encode()).hexdigest()
    return f"{cli['name']}-{digest[:12]}"


def tools_cli(name: str, tools: list[dict], description: str | None) -> CLI:
    """A CLI named ``name`` with one subcommand per tool."""
    root: dict = {"children": {}}
    handlers: dict[str, CLIHandler] = {}
    for tool in tools:
        path = command_path(tool["name"])
        parameters = tool.get("parameters") or {}
        required = set(parameters.get("required") or [])
        pairs = [
            _argument(param, schema, param in required,
                      tool.get("strict", True))
            for param, schema in (parameters.get("properties") or {}).items()
        ]
        node = root
        for part in path:
            node = node["children"].setdefault(part, {"children": {}})
        node["tool"] = {
            "spec":
            CommandSpec(name=path[-1],
                        description=tool.get("description"),
                        arguments=tuple(a for a, _ in pairs)),
            "path":
            " ".join(path),
        }
        handlers[" ".join(path)] = _handler(tool, [p for _, p in pairs])

    def build(part: str, node: dict) -> CommandSpec:
        if not node["children"]:
            return node["tool"]["spec"]
        if "tool" in node:
            raise ValueError(
                f"{name}: '{node['tool']['path']}' is both a tool and a group")
        return CommandSpec(name=part,
                           subcommands=tuple(
                               build(child, sub)
                               for child, sub in node["children"].items()))

    return CLI(spec=CommandSpec(
        name=name,
        description=description,
        subcommands=tuple(
            build(part, node) for part, node in root["children"].items())),
               handlers=handlers,
               config_model=Config)


def register(path: Path) -> None:
    """Register each CLI ``tools.json`` lists under its spec name, once."""
    for cli in json.loads(Path(path).read_text()):
        name = spec_name(cli)
        if name not in CLI_SPECS:
            register_cli_spec(
                tools_cli(name, cli["tools"], cli.get("description")))
