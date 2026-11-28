import asyncio
import json
import re
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from aiohttp import ClientSession, web
from mcp import types

from ..cli.tools import tool_cli
from . import _toolathlon_gws as gws

INPUTS = (
    ("agentvfs/vfs-bench", "3f45f90f620c8096dd85bbe854b757eae1231392",
     "vfs-bench-1/server/seed/atlas_exports.py", "", 29937,
     "72fc74dfbc68e77305007b0610d3485669e7502a0e9852c34314a2b3e0216fbe"),
    ("scaleapi/mcp-atlas", "f24ba3fb0bfa484c86acb28431fad6d7282455f9",
     "data_exports/calendar_mcp_eval_export.zip",
     "vfs-bench-1/submodule/mcp-atlas/", 8241,
     "3f9f1303fbf78093cabdf7ad693ca89291bffa28ed7d07086b9e7b56b9881009"),
    ("strukto-ai/mirage", "ccfaa92485fe0bcbbdf5ff393b6e7e5ab1388f53",
     "integ/fixtures/gws/v1.json", "vfs-bench-1/submodule/mirage/", 438,
     "88fb4a1bbf7e50172a8150363e3dda62c9cae0b20e97925b80873bf8c860341a"),
)
# Run v1's pure conversion in a child. Supply the exact two verified inputs in
# place of its git-submodule accessor; preserve its recurrence and timezone
# rules.
CONVERT = """
import json, runpy, sys
from pathlib import Path
convert = runpy.run_path(sys.argv[1])["calendar_workspace"]
inputs = {
    ("submodule/mcp-atlas", "data_exports/calendar_mcp_eval_export.zip"):
        Path(sys.argv[2]),
    ("submodule/mirage", "integ/fixtures/gws/v1.json"): Path(sys.argv[3]),
}
def shown(module, path):
    return inputs[module, path].read_bytes()
convert.__globals__["shown"] = shown
print(json.dumps(convert()))
"""
TOOL = {
    "name": "list_events",
    "description": "List upcoming calendar events",
    "inputSchema": {
        "type": "object",
        "properties": {
            "maxResults": {
                "type": "number",
                "description":
                "Maximum number of events to return (default: 10)"
            },
            "timeMin": {
                "type": "string",
                "description": "Start time in ISO format (default: now)"
            },
            "timeMax": {
                "type": "string",
                "description": "End time in ISO format"
            },
        }
    },
}


def seed_events(world):
    primary, = world["calendars"]
    zone = ZoneInfo(primary["timeZone"])
    events = []
    for row in world["events"]:
        event = {
            k: row[k]
            for k in ("id", "status", "summary", "created", "updated",
                      "description", "location") if k in row
        }
        for field in ("start", "end"):
            value = datetime.fromisoformat(
                row[field + "DateTime"]).astimezone(zone).isoformat()
            event[field] = {"dateTime": value}
            if name := row.get(field + "TimeZone"):
                event[field]["timeZone"] = name
        events.append(event)
    return {"calendars": [{**primary, "events": events}]}


class _EventTool:
    """The list_events projection from
    @geobio/google-workspace-server@0.1.0."""

    def __init__(self, client, origin):
        self.client = client
        self.origin = origin

    async def call_tool(self, name, *, arguments):
        if name != "list_events":
            raise ValueError(f"Unknown calendar tool {name}")
        query = {
            "timeMin": arguments.get("timeMin")
            or datetime.now(UTC).isoformat(),
            "maxResults": arguments.get("maxResults") or 10,
            "singleEvents": "true",
            "orderBy": "startTime"
        }
        if arguments.get("timeMax"):
            query["timeMax"] = arguments["timeMax"]
        async with self.client.get(self.origin +
                                   "/calendar/v3/calendars/primary/events",
                                   params=query) as res:
            res.raise_for_status()
            rows = (await res.json())["items"]
        events = [{
            k: row[k]
            for k in ("id", "summary", "start", "end", "location") if k in row
        } for row in rows]
        return types.CallToolResult(content=[
            types.TextContent(type="text", text=json.dumps(events, indent=2))
        ])


@asynccontextmanager
async def calendar(task, run_dir):
    from .mcpatlas import _command

    files = []
    for repo, rev, path, local, size, digest in INPUTS:
        ref = {
            "url": f"https://raw.githubusercontent.com/{repo}/{rev}/{path}",
            "path": local + path,
            "size": size,
            "sha256": digest
        }
        files.append(await asyncio.to_thread(task._dataset._source_file, ref))
    world = json.loads(await _command(sys.executable,
                                      "-I",
                                      "-c",
                                      CONVERT,
                                      *files,
                                      cwd=run_dir))
    async with gws.serve(run_dir) as origin, ClientSession(
            trust_env=False) as client:
        await asyncio.to_thread(gws.call, origin, "/reset", seed_events(world),
                                "POST")

        # The agent reads the native calendar VFS. Only GETs to these calendar
        # resources reach the mock. Its /reset and unrelated products stay
        # private.
        async def read(request):
            path = request.path
            if not re.fullmatch(
                    r"/calendar/v3/(?:users/me/calendarList|calendars/"
                    r"(?:primary|integ@example\.com)(?:/events(?:/[A-Za-z0-9_"
                    r"-]+)?)?)", path):
                raise web.HTTPForbidden()
            async with client.get(origin + path,
                                  params=request.query,
                                  allow_redirects=False) as reply:
                return web.Response(status=reply.status,
                                    body=await reply.read(),
                                    content_type="application/json")

        app = web.Application()
        app.router.add_get("/{path:.*}", read, allow_head=False)
        runner = web.AppRunner(app)
        await runner.setup()
        try:
            await web.TCPSite(runner, "127.0.0.1", 0).start()
            url = f"http://127.0.0.1:{runner.addresses[0][1]}"
            cli = tool_cli("google-workspace", _EventTool(client, url),
                           {"list_events": TOOL}, ["list_events"])

            async def read_state():
                params = {
                    "maxResults": len(world["events"]),
                    "orderBy": "startTime"
                }
                async with client.get(origin +
                                      "/calendar/v3/calendars/primary/events",
                                      params=params) as reply:
                    reply.raise_for_status()
                    return await reply.json()

            yield url, cli, read_state
        finally:
            await runner.cleanup()
