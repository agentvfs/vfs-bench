"""Serve a Python world as a fake, under the Mirage integ kit's contract.

    uv run --project <dataset> python -I bridge/server.py \\
        --name NAME --world module:Class [--path DIR] [--config JSON]

Benchmarks whose apps are Python simulations (AutomationBench's world,
Gaia2's apps, ComplexMCP's servers) keep their own state and logic; this
puts an HTTP face on it so the harness treats it like any other fake:

- prints ``<NAME>_URL=http://127.0.0.1:<port>`` once it is listening
- ``POST /reset`` ``{"fixture": ..., "epoch": ...}`` loads a task's state
- ``GET /tools`` lists the world's tools as JSON schemas
- ``POST /call`` ``{"tool": ..., "arguments": {...}}`` runs one, answering
  ``{"ok": true, "result": ...}`` or ``{"ok": false, "error": ...}``
- ``GET /snapshot`` returns the state a grader compares

A world is any class with those four methods; see ``World``. Calls are
serialized, as the simulations assume one caller.
"""
import argparse
import importlib
import json
import signal
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol


class World(Protocol):
    """What a dataset's world implements."""

    def tools(self) -> list[dict]:
        """Each tool as ``{"name", "description", "parameters"}``, the
        parameters a JSON schema object."""

    def reset(self, fixture: Any, epoch: str | None) -> None:
        """Replace all state with the task's starting state."""

    def call(self, tool: str, arguments: dict) -> Any:
        """Run one tool. Raise to report an error to the caller."""

    def snapshot(self) -> Any:
        """The state graders read, as JSON-ready data."""

    # Optional: ``close()``, called on exit, to stop what the world started.


class ToolError(Exception):
    """An error the world reports to the agent as the tool's own message."""


def load_world(spec: str, config: dict) -> World:
    """Import ``module:Class`` and construct it with ``config``.

    Args:
        spec (str): ``module:Class``.
        config (dict): keyword arguments for the class.
    """
    module, _, name = spec.partition(":")
    return getattr(importlib.import_module(module), name)(**config)


def serve(name: str, world: World, port: int = 0) -> None:
    """Serve ``world`` until killed.

    Args:
        name (str): the fake's name, which spells the ready line.
        world (World): the world.
        port (int): 0 for a free port.
    """
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):

        def log_message(self, format, *args):  # noqa: A002
            sys.stderr.write(f"{self.command} {self.path} "
                             f"{format % args}\n")

        def reply(self, status: int, body: Any) -> None:
            data = json.dumps(body, ensure_ascii=False, default=str).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def body(self) -> dict:
            length = int(self.headers.get("content-length") or 0)
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):  # noqa: N802
            with lock:
                if self.path == "/tools":
                    return self.reply(200, world.tools())
                if self.path == "/snapshot":
                    return self.reply(200, world.snapshot())
                if self.path == "/health":
                    return self.reply(200, {"ok": True})
            self.reply(404, {"error": f"no route {self.path}"})

        def do_POST(self):  # noqa: N802
            body = self.body()
            with lock:
                if self.path == "/reset":
                    world.reset(body.get("fixture"), body.get("epoch"))
                    return self.reply(200, {"ok": True})
                if self.path == "/call":
                    try:
                        result = world.call(body["tool"],
                                            body.get("arguments") or {})
                    except ToolError as error:
                        return self.reply(200, {"ok": False,
                                                "error": str(error)})
                    except Exception as error:  # the agent sees the error
                        sys.stderr.write(traceback.format_exc())
                        return self.reply(200, {
                            "ok": False,
                            "error": f"{type(error).__name__}: {error}"})
                    return self.reply(200, {"ok": True, "result": result})
            self.reply(404, {"error": f"no route {self.path}"})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"{name}_URL=http://127.0.0.1:{server.server_address[1]}",
          flush=True)
    server.serve_forever()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--name", required=True)
    parser.add_argument("--world", required=True, help="module:Class")
    parser.add_argument("--path", action="append", default=[],
                        help="directories to import the world from")
    parser.add_argument("--config", default="{}",
                        help="JSON keyword arguments for the world")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--dump-tools", action="store_true",
                        help="print the tools as JSON and exit")
    args = parser.parse_args(argv)
    # -I leaves the script's own directory off sys.path, so add the repo
    # root (for `bridge`) and the dataset's directories explicitly.
    sys.path[:0] = [str(Path(__file__).resolve().parents[1]), *args.path]
    # Run as a script, this module is `__main__`; let a world's
    # `from bridge.server import ToolError` get this module's class.
    sys.modules.setdefault("bridge.server", sys.modules[__name__])
    # The harness stops a fake with SIGTERM; exit through `finally`, so a
    # world that runs its own processes can stop them.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    world = load_world(args.world, json.loads(args.config))
    try:
        if args.dump_tools:
            print(json.dumps(world.tools(), indent=1, ensure_ascii=False))
            return 0
        serve(args.name, world, args.port)
    finally:
        close = getattr(world, "close", None)
        if close is not None:
            close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
