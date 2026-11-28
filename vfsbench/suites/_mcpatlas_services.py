import asyncio
import json
import stat
from contextlib import asynccontextmanager
from pathlib import Path

from mcp import ClientSession, StdioServerParameters, stdio_client, types

from ..cli.tools import STATE_TOOL


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
