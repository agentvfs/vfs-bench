"""Serve one Claw-Eval mock service on a free port.

    python -I claweval/serve.py <server.py> <NAME>

Runs the service's FastAPI app unchanged, from upstream's checkout as its
runner starts it (``python mock_services/<service>/server.py`` from the
repo root, with the task's fixtures in the environment), and prints
``<NAME>_URL=<url>`` once it listens. The app loads its fixtures on import.
"""
import importlib.util
import socket
import sys

import uvicorn


def main() -> int:
    path, name = sys.argv[1:]
    spec = importlib.util.spec_from_file_location("server", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    print(f"{name}_URL=http://127.0.0.1:{sock.getsockname()[1]}", flush=True)
    config = uvicorn.Config(module.app, log_level="warning")
    uvicorn.Server(config).run(sockets=[sock])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
