"""Replay the original Calendar MCP response recorded when the trial was
sealed."""

import json
from pathlib import Path
from types import SimpleNamespace


class ToolCallError(RuntimeError):
    pass


class MCPServerManager:

    def __init__(self, **kwargs):
        self.servers = {"google_calendar": self}
        self.connected_servers = self.servers

    async def connect_servers(self, servers):
        if servers != ["google_calendar"]:
            raise ValueError("Unexpected verifier services")

    def is_server_connected(self, name):
        return name in self.servers

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


async def call_tool_with_retry(server, name, arguments):
    captured = json.loads(Path("calendar.json").read_bytes())
    if name != "list_events" or arguments != captured["query"]:
        raise ValueError("Verifier requested a different calendar query")
    return SimpleNamespace(content=[SimpleNamespace(text=captured["reply"])])
