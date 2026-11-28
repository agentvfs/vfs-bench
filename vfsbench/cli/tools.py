import json
from functools import partial

from jsonschema.validators import validator_for
from mirage.commands.cli.mcp.build import leaf
from mirage.commands.cli.mcp.types import MCPTool
from mirage.commands.cli.types import CLI, CLIHandler
from mirage.commands.spec.types import CommandSpec
from mirage.io.types import IOResult
from referencing import Registry

STATE_TOOL = "vfsbench_state"


async def _call(service, name, schema, call, accessor, paths, texts, ctx):
    if len(texts) > 1:
        return None, IOResult(exit_code=2, stderr=b"Pass one JSON object\n")
    try:
        args = json.loads(texts[0]) if texts else {}
        if not isinstance(args, dict):
            raise ValueError("Expected a JSON object")
        if service == "met-museum" and name == "get-museum-object":
            args["returnImage"] = False
        if problem := next(schema.iter_errors(args), None):
            raise ValueError(problem.message)
    except ValueError as exc:
        return None, IOResult(exit_code=2, stderr=f"{exc}\n".encode())
    text, code = await call(name, args)
    return text.encode(), IOResult(exit_code=code)


def json_cli(service, call, tools, enabled, *, prefix="", write=False):
    commands, handlers = [], {}
    for name in enabled:
        if name == STATE_TOOL:
            raise ValueError(f"{STATE_TOOL} is reserved for verifiers")
        tool = tools[name]
        verb = name.removeprefix(prefix).replace("_", "-")
        shape = tool["inputSchema"]
        model = validator_for(shape)
        model.check_schema(shape)
        validator = model(shape, registry=Registry())
        command = leaf(
            MCPTool(verb, tool.get("description", ""), shape,
                    tool.get("annotations", {})))
        commands.append(command)
        if verb in handlers:
            raise ValueError(f"Ambiguous CLI verb {service} {verb}")
        handlers[verb] = CLIHandler(
            fn=partial(_call, service, name, validator, call),
            write=write if isinstance(write, bool) else name in write)
    return CLI(spec=CommandSpec(name=service, subcommands=tuple(commands)),
               handlers=handlers)


async def _mcp_call(session, name, args):
    reply = await session.call_tool(name, arguments=args)
    data = reply.model_dump(by_alias=True, exclude_none=True)
    blocks = data.get("content")
    if isinstance(blocks, list) and all(
            block.get("type") == "text" for block in blocks):
        body = "\n".join(block["text"] for block in blocks)
    else:
        body = json.dumps(data, ensure_ascii=False) + "\n"
    return body, int(data.get("isError", False))


def tool_cli(service, session, tools, enabled, *, prefix=None, write=None):
    if prefix is None:
        prefix = "API-" if service == "notion" else ""
    if write is None:
        write = service == "memory"
    return json_cli(service,
                    partial(_mcp_call, session),
                    tools,
                    enabled,
                    prefix=prefix,
                    write=write)
