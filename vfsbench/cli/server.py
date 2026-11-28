import asyncio
import json

from ..server import get_server


def add_parser(commands):
    server = commands.add_parser(
        "server", help="connect to a mock server and manage its runs")
    server.add_argument("--endpoint", help="vfsbench controller URL")
    commands = server.add_subparsers(dest="operation")
    commands.add_parser("runs", help="list live mock runs")
    commands.add_parser(
        "shutdown",
        help="shut down an existing controller with no active runs")
    for name, help_text in (("clone", "clone a live mock run"),
                            ("stop", "stop a mock run"),
                            ("state",
                             "read the live app data used for grading")):
        cmd = commands.add_parser(name, help=help_text)
        cmd.add_argument("run", help="mock run ID")
    serve = commands.add_parser("serve",
                                help="serve on loopback in the foreground")
    serve.add_argument("--port", type=int, default=8931)


def invoke(operation, endpoint=None, run=None, port=None):
    if operation == "serve":
        if endpoint:
            raise ValueError(
                "Use --port to choose the foreground listening port")
        from .._mock_server import serve

        return serve(port)

    async def execute():
        server = await get_server(endpoint, start=operation != "shutdown")
        if operation is None:
            return server.endpoint
        if operation == "runs":
            return await server.list_runs()
        if operation == "shutdown":
            return await server.shutdown()
        return await getattr(server, operation)(run)

    result = asyncio.run(execute())
    if result is not None:
        print(result if isinstance(result, str) else json.
              dumps(result, indent=2))
