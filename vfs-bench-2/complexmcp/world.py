"""ComplexMCP's 15 MCP servers, as one bridge world.

Upstream's own servers run as processes, launched as its
``docker/start_benchmark_sandbox.sh`` launches them but on free local
ports. This world is their MCP client, as upstream's ``client/agent.py``
Toolbox is:

- tools are named ``<Server>.<tool>``. The 8 plain servers list theirs over
  MCP; the 7 Light apps' come from their ``desc.json``, the descriptions
  upstream shows its model, without ``login``, ``logout`` and the hidden
  ``session_id``.
- ``reset`` logs into LightSystem and then each task app with the task's
  seed, as upstream's ``AgentClient.__login`` does, and keeps each login's
  ``session_info`` as the starting environment.
- a call to a Light app gets its ``session_id`` added, as upstream adds it.
- ``__finish__`` (not a tool) logs every app out and returns what logout
  returns, which is the end environment upstream's judge reads.
"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from fastmcp import Client

SERVERS = {  # name: (argv after the interpreter, desc.json or None)
    "MathServer": (["run", "servers/math/app.py"], None),
    "UnitServer": (["-m", "servers.unit.app"], None),  # its own __main__
    "OSINTServer": (["run", "servers/osint/app.py"], None),
    "TimeServer": (["run", "servers/time/app.py"], None),
    "LangServer": (["run", "servers/lang/app.py"], None),
    "CryptoServer": (["run", "servers/crypto/app.py"], None),
    "GraphServer": (["run", "servers/graphs/app.py"], None),
    "ChemServer": (["run", "servers/chem/app.py"], None),
    "LightSystem": (["run", "software/LightSystem/app.py"],
                    "software/LightSystem/desc.json"),
    "LightTalk": (["run", "software/LightTalk/app.py"],
                  "software/LightTalk/desc.json"),
    "LightShop": (["run", "software/LightShop/app.py"],
                  "software/LightShop/desc.json"),
    "LightWeather": (["run", "software/LightWeather/app.py"],
                     "software/LightWeather/desc.json"),
    "LightFlight": (["run", "software/LightFlight/app.py"],
                    "software/LightFlight/desc.json"),
    "LightStock": (["run", "software/LightStock/app.py"],
                   "software/LightStock/desc.json"),
    "LightNews": (["run", "software/LightNews/app.py"],
                  "software/LightNews/desc.json"),
}
SYSTEM = "LightSystem"
HIDDEN = {"login", "logout", "health"}


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def schema_of(arguments: dict) -> dict:
    """desc.json's arguments as a JSON schema; ``array[string]`` is an
    array of strings."""
    properties = {}
    for name, spec in arguments.items():
        kind = spec.get("type", "string")
        prop = {"description": spec.get("description", "")}
        if kind.startswith("array[") and kind.endswith("]"):
            prop.update(type="array", items={"type": kind[6:-1]})
        elif kind in ("string", "integer", "number", "boolean", "array",
                      "object"):
            prop["type"] = kind
        else:
            prop["type"] = "object"
        properties[name] = prop
    return {"type": "object", "properties": properties}


class ComplexMCP:
    """The servers, their tools and one task's sessions."""

    def __init__(self, src: str):
        self.src = Path(src)
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, daemon=True).start()
        self.urls: dict[str, str] = {}
        self.processes = []
        for name, (argv, _) in SERVERS.items():
            port = free_port()
            extra = (["--transport", "http", "--host", "127.0.0.1", "--port",
                      str(port)])
            # The fastmcp script beside this interpreter, as upstream runs
            # `fastmcp run`; the unit server is a module with its own main.
            program = ([sys.executable] if argv[0] == "-m" else
                       [str(Path(sys.executable).parent / "fastmcp")])
            self.processes.append(subprocess.Popen(
                [*program, *argv, *extra], cwd=self.src,
                env={**os.environ, "PYTHONPATH": str(self.src)},
                stdout=subprocess.DEVNULL, stderr=sys.stderr))
            self.urls[name] = f"http://127.0.0.1:{port}/mcp"
        for name, url in self.urls.items():
            self.wait(name, url)
        self.catalog = self.list_tools()
        self.sessions: dict[str, str] = {}
        self.initial: dict[str, Any] = {}
        self.final: dict[str, Any] | None = None

    def run(self, coroutine):
        return asyncio.run_coroutine_threadsafe(coroutine, self.loop).result()

    def wait(self, name: str, url: str, timeout: float = 60) -> None:
        port = int(url.rsplit(":", 1)[1].split("/")[0])
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with socket.socket() as sock:
                if sock.connect_ex(("127.0.0.1", port)) == 0:
                    return
            time.sleep(0.2)
        raise RuntimeError(f"{name} did not listen on {url}")

    async def _call(self, server: str, tool: str, arguments: dict) -> str:
        async with Client(self.urls[server]) as client:
            return (await client.call_tool(tool, arguments,
                                           raise_on_error=False)).content[0].text

    def list_tools(self) -> list[dict]:
        tools = []
        for server, (_, desc) in SERVERS.items():
            if desc is None:
                async def listed(url=self.urls[server]):
                    async with Client(url) as client:
                        return await client.list_tools()
                for tool in self.run(listed()):
                    tools.append({"name": f"{server}.{tool.name}",
                                  "description": tool.description or "",
                                  "parameters": tool.inputSchema})
            else:
                for tool in json.loads((self.src / desc).read_text()):
                    if tool["tool_name"] in HIDDEN:
                        continue
                    tools.append({"name": f"{server}.{tool['tool_name']}",
                                  "description": tool["description"],
                                  "parameters": schema_of(tool["arguments"])})
        return tools

    def tools(self) -> list[dict]:
        return self.catalog

    def reset(self, fixture: dict, epoch: str | None) -> None:
        if self.sessions and self.final is None:
            self.finish()
        self.sessions, self.initial, self.final = {}, {}, None
        seed, apps = fixture["seed"], fixture["apps"]
        login = json.loads(self.run(self._call(SYSTEM, "login",
                                               {"seed": seed})))
        self.initial[SYSTEM] = login.pop("session_info")
        self.sessions[SYSTEM] = login["session_id"]
        os_cfg = {"session_id": self.sessions[SYSTEM],
                  "url": self.urls[SYSTEM]}
        for app in apps:
            login = json.loads(self.run(self._call(
                app, "login", {"seed": seed, "os_cfg": os_cfg})))
            self.initial[app] = login.pop("session_info")
            self.sessions[app] = login["session_id"]

    def call(self, tool: str, arguments: dict) -> Any:
        if tool == "__finish__":
            return self.finish()
        server, _, name = tool.partition(".")
        if server not in self.urls or name in HIDDEN:
            return {"status": "error", "output": f"This tool `{tool}` doesn't exist."}
        if SERVERS[server][1] is not None:
            if server not in self.sessions:
                return {"status": "failed",
                        "output": f"{server} has not been logged into yet."}
            arguments = {**arguments, "session_id": self.sessions[server]}
        try:
            return self.run(self._call(server, name, arguments))
        except Exception as error:
            return {"status": "error", "output": str(error)}

    def finish(self) -> dict:
        """Log every app out; what each logout returns is its end state."""
        if self.final is None:
            self.final = {
                app: json.loads(self.run(self._call(app, "logout",
                                                    {"session_id": sid})))
                for app, sid in self.sessions.items()}
        return self.final

    def snapshot(self) -> dict:
        return {"initial": self.initial, "final": self.final}

    def close(self) -> None:
        """Stop the servers."""
        for process in self.processes:
            process.terminate()
        for process in self.processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
