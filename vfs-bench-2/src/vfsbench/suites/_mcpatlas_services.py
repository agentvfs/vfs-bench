"""Bind a private MCP stdio session to the verbs authorized by one Atlas
row."""

import asyncio
import json
import stat
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

from jsonschema.validators import validator_for
from mcp import ClientSession, StdioServerParameters, stdio_client, types
from mirage.commands.cli.mcp.build import leaf
from mirage.commands.cli.mcp.types import MCPTool
from mirage.commands.cli.types import CLI, CLIHandler
from mirage.commands.spec.types import CommandSpec
from mirage.io.types import IOResult
from referencing import Registry


def provider_command(value, name):
    if not isinstance(value, list) or not value or any(
            type(x) is not str or not x for x in value):
        raise ValueError(
            f"atlas_providers.{name} must be a nonempty command argument array"
        )
    return value


def check_snapshot(root: Path):
    """Only the service's exported, read-only agent filesystem goes in a
    mount."""
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError(
            f"The Atlas mock did not export its VFS under {root}")
    for item in root.rglob("*"):
        info = item.lstat()
        if not (stat.S_ISDIR(info.st_mode)
                or stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
            raise ValueError(f"Unexpected file in Atlas service mount: "
                             f"{item.relative_to(root)}")


STATE_TOOL = "vfsbench_state"


async def _list_tools(session, enabled, optional):
    wanted = set(enabled) | set(optional)
    selected = {}
    cursor = None
    seen = set()
    while True:
        page = await session.list_tools(params=types.PaginatedRequestParams(
            cursor=cursor))
        for tool in page.tools:
            if tool.name in wanted:
                if tool.name in selected:
                    raise ValueError(f"Duplicate MCP tool {tool.name}")
                selected[tool.name] = tool.model_dump(by_alias=True,
                                                      exclude_none=True)
        cursor = page.next_cursor
        if cursor is None:
            break
        if cursor in seen:
            raise ValueError("MCP provider repeated its tool-list cursor")
        seen.add(cursor)
    if missing := set(enabled) - selected.keys():
        raise RuntimeError(
            f"MCP provider lacks declared tools: {', '.join(sorted(missing))}")
    return selected


@asynccontextmanager
async def stdio_service(argv, env, cwd, enabled, *, optional=()):
    """Keep the MCP SDK's cancel scopes in a single asyncio task through
    teardown."""
    params = StdioServerParameters(command=argv[0],
                                   args=argv[1:],
                                   env=env,
                                   cwd=cwd)
    ready = asyncio.get_running_loop().create_future()
    stop = asyncio.Event()

    async def serve():
        try:
            async with stdio_client(params) as (receive, send), ClientSession(
                    receive, send) as session:
                async with asyncio.timeout(60):
                    await session.initialize()
                    tools = await _list_tools(session, enabled, optional)
                ready.set_result((session, tools))
                await stop.wait()
        except BaseException as exc:
            if not ready.done():
                ready.set_exception(exc)
            else:
                raise

    worker = asyncio.create_task(serve())
    try:
        yield await asyncio.shield(ready)
    finally:
        stop.set()
        if not ready.done():
            worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            if not worker.cancelled():
                raise


async def provider_state(session):
    """Read the operator provider's optional controller-only snapshot."""
    async with asyncio.timeout(60):
        reply = await session.call_tool(STATE_TOOL, arguments={})
    if reply.is_error:
        raise RuntimeError(
            "The Atlas provider could not read its private trial state")
    if reply.structured_content is not None:
        return reply.structured_content
    if len(reply.content) != 1 or not isinstance(reply.content[0],
                                                 types.TextContent):
        raise ValueError(
            f"{STATE_TOOL} must return structured content or one JSON text "
            f"block")
    return json.loads(reply.content[0].text)


async def _call(service, name, schema, session, accessor, paths, texts, ctx):
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
    async with asyncio.timeout(60):
        reply = await session.call_tool(name, arguments=args)
    data = reply.model_dump(by_alias=True, exclude_none=True)
    blocks = data.get("content")
    if isinstance(blocks, list) and all(
            block.get("type") == "text" for block in blocks):
        body = "\n".join(block["text"] for block in blocks)
    else:
        body = json.dumps(data, ensure_ascii=False) + "\n"
    return body.encode(), IOResult(exit_code=int(data.get("isError", False)))


def tool_cli(service, session, tools, enabled, *, prefix=None, write=None):
    if prefix is None:
        prefix = "API-" if service == "notion" else ""
    if write is None:
        write = service == "memory"
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
            raise ValueError(f"Ambiguous Atlas CLI verb {service} {verb}")
        handlers[verb] = CLIHandler(fn=partial(_call, service, name, validator,
                                               session),
                                    write=write)
    return CLI(spec=CommandSpec(name=service, subcommands=tuple(commands)),
               handlers=handlers)
