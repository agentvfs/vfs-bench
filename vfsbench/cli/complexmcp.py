import json
from functools import partial

from mirage.commands.cli.types import CLI, CLIHandler
from mirage.commands.spec.flag_view import FlagView
from mirage.commands.spec.types import Argument, CommandSpec
from mirage.io.types import IOResult


def _shape(schema):
    branches = [s for s in schema.get("anyOf", []) if s.get("type") != "null"]
    return branches[0] if len(branches) == 1 else schema


def _argument(name, schema, required):
    shape = _shape(schema)
    kind = shape.get("type")
    item = shape.get("items", {}).get("type")
    return Argument("--" + name.replace("_", "-"),
                    action="append" if kind == "array"
                    and item in ("number", "integer", "string") else "store",
                    type={
                        "integer": "int",
                        "number": "float"
                    }.get(kind, "str"),
                    choices=("true", "false") if kind == "boolean" else tuple(
                        shape.get("enum", [])),
                    required=required and "default" not in schema,
                    help=schema.get("description"))


def _value(flags, name, schema):
    kind = _shape(schema).get("type")
    if kind == "number":
        return flags.as_float(name)
    if kind == "integer":
        return flags.as_int(name)
    if kind == "array":
        item = schema.get("items", {}).get("type")
        if item in ("number", "integer", "string"):
            values = flags.as_list(name)
            if len(values) == 1 and values[0].lstrip().startswith("["):
                return json.loads(values[0])
            convert = {"number": float, "integer": int, "string": str}[item]
            return [convert(value) for value in values]
    raw = flags.as_str(name)
    if kind == "boolean":
        return raw == "true"
    return raw if kind == "string" else json.loads(raw)


async def _call(mock, service, name, properties, accessor, paths, texts, ctx):
    flags = FlagView(ctx.flags, ctx.spec)
    try:
        args = {
            key: _value(flags, key, schema)
            for key, schema in properties.items() if key in (ctx.flags or {})
        }
    except ValueError as exc:
        return None, IOResult(exit_code=2, stderr=f"{exc}\n".encode())
    output = await mock.request("call", service=service, tool=name, args=args)
    return (output if output.endswith("\n") else output +
            "\n").encode(), IOResult()


def service_cli(service, mock):
    commands, handlers = [], {}
    for tool in service["tools"]:
        schema = tool["parameters"]
        properties = schema["properties"]
        verb = tool["name"].replace("_", "-")
        commands.append(
            CommandSpec(name=verb,
                        description=tool["description"],
                        arguments=tuple(
                            _argument(k, s, k in schema.get("required", ()))
                            for k, s in properties.items())))
        handlers[verb] = CLIHandler(fn=partial(_call, mock, service["name"],
                                               tool["name"], properties),
                                    write=True)
    return CLI(spec=CommandSpec(name=service["name"],
                                description=service["description"],
                                subcommands=tuple(commands)),
               handlers=handlers)
