import argparse
import asyncio
import hmac
import os
import re
import tempfile
import time
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from aiohttp import web

from .server import _local_token
from .suites._complexmcp_kit import kit_run
from .suites._complexmcp_stdio import _stdio_run


class Run:

    def __init__(self, run_id, settings, mock, resources):
        self.id = run_id
        self.settings = settings
        self.mock = mock
        self.resources = resources
        self.lock = asyncio.Lock()
        self.stopped = False

    def info(self):
        return {
            "run":
            self.id,
            "task":
            self.settings["task"],
            "backend":
            "kit" if self.settings.get("endpoints") is not None else "bundled"
        }


class Registry:

    def __init__(self):
        self.runs = {}
        self.pending = {}
        self.last_request = time.monotonic()
        self.shutdown_requested = asyncio.Event()

    async def create(self, run_id, settings, corpus=None, source=None):
        if self.shutdown_requested.is_set():
            raise web.HTTPServiceUnavailable(
                text="Mock server is shutting down")
        if not isinstance(run_id, str) or not re.fullmatch(
                "[a-f0-9]{32}", run_id):
            raise web.HTTPBadRequest(text="Invalid run ID")
        if run_id in self.pending or run_id in self.runs:
            raise web.HTTPConflict(text="Run ID already exists")
        self.pending[run_id] = asyncio.Event()
        try:
            async with AsyncExitStack() as resources:
                endpoints = settings.get("endpoints")
                if endpoints is not None:
                    mock = await resources.enter_async_context(
                        kit_run(endpoints,
                                settings["tools"],
                                settings["task"],
                                settings,
                                run_id=run_id))
                    if source:
                        await source.mock.clone_into(mock)
                    else:
                        await mock.request("init")
                else:
                    root = Path(
                        resources.enter_context(tempfile.TemporaryDirectory()))
                    pattern = (r"software/Light[A-Za-z]+/corpus/"
                               r"[A-Za-z0-9_-]+\.yaml")
                    for name, contents in (corpus or {}).items():
                        if not re.fullmatch(pattern, name):
                            raise web.HTTPBadRequest(
                                text="Invalid corpus asset name")
                        dest = root / name
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_text(contents, encoding="utf-8")
                    mock = await resources.enter_async_context(_stdio_run(root)
                                                               )
                    if source:
                        await mock.request("load",
                                           snapshot=await
                                           source.mock.request("snapshot"))
                    else:
                        await mock.request("init",
                                           seed=settings["seed"],
                                           apps=settings["apps"])
                run = Run(run_id, settings, mock, resources.pop_all())
                self.runs[run_id] = run
                return run.info()
        finally:
            self.pending.pop(run_id).set()

    @asynccontextmanager
    async def live(self, rid):
        run = self.runs.get(rid)
        if run is None:
            raise web.HTTPNotFound(text="Unknown mock run")
        async with run.lock:
            if run.stopped:
                raise web.HTTPNotFound(text="Mock run has stopped")
            yield run

    async def stop(self, rid):
        if event := self.pending.get(rid):
            await event.wait()
        run = self.runs.get(rid)
        if run:
            async with run.lock:
                if not run.stopped:
                    await run.resources.aclose()
                    run.stopped = True
                    self.runs.pop(rid, None)


def application(token, registry):

    @web.middleware
    async def authenticate(request, handler):
        authorization = request.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(authorization, f"Bearer {token}".encode()):
            raise web.HTTPUnauthorized()
        registry.last_request = time.monotonic()
        return await handler(request)

    async def health(request):
        return web.json_response({
            "service": "vfsbench",
            "runs": len(registry.runs)
        })

    async def listing(request):
        return web.json_response(
            [run.info() for run in registry.runs.values()])

    async def create(request):
        body = await request.json()
        try:
            info = await registry.create(body["run"], body["settings"],
                                         body.get("corpus"))
        except (KeyError, TypeError, ValueError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        return web.json_response(info, status=201)

    async def stop(request):
        await registry.stop(request.match_info["run"])
        return web.Response(status=204)

    async def shutdown(request):
        if registry.runs or registry.pending:
            raise web.HTTPConflict(
                text="Close active trials and stop remaining mock runs first")
        registry.shutdown_requested.set()
        return web.Response(status=204)

    async def clone(request):
        body = await request.json()
        async with registry.live(request.match_info["run"]) as run:
            info = await registry.create(body["run"], run.settings, source=run)
        return web.json_response(info, status=201)

    async def state(request):
        async with registry.live(request.match_info["run"]) as run:
            return web.json_response(await run.mock.request("state"))

    async def metadata(request):
        async with registry.live(request.match_info["run"]) as run:
            if run.settings.get("endpoints") is None:
                return web.json_response(run.info())
            return web.json_response({
                **run.info(),
                **await run.mock.metadata()
            })

    async def call(request):
        body = await request.json()
        async with registry.live(request.match_info["run"]) as run:
            service, tool, args = body["service"], body["tool"], body["args"]
            if tool not in run.settings["tools"].get(service, ()):
                raise web.HTTPNotFound(text="Unknown tool")
            if not isinstance(args, dict):
                raise web.HTTPBadRequest(text="Expected an arguments object")
            result = await run.mock.request("call",
                                            service=service,
                                            tool=tool,
                                            args=args)
            return web.json_response(result)

    app = web.Application(middlewares=[authenticate], client_max_size=64 << 20)
    app.add_routes([
        web.get("/_kit/health", health),
        web.get("/_kit/runs", listing),
        web.post("/shutdown", shutdown),
        web.post("/reset", create),
        web.delete("/_kit/runs/{run}", stop),
        web.get("/_kit/runs/{run}", metadata),
        web.post("/_kit/runs/{run}/clone", clone),
        web.get("/_kit/runs/{run}/state", state),
        web.post("/_kit/runs/{run}/call", call)
    ])

    async def close_runs(app):
        await asyncio.gather(*(registry.stop(rid)
                               for rid in list(registry.runs)))

    app.on_cleanup.append(close_runs)
    return app


def serve(port, *, idle_exit=False):
    token = os.getenv("VFSBENCH_SERVER_TOKEN") or _local_token()
    registry = Registry()
    app = application(token, registry)

    async def run():
        runner = web.AppRunner(app, handle_signals=True)
        await runner.setup()
        try:
            await web.TCPSite(runner, "127.0.0.1", port,
                              reuse_port=False).start()
            while not registry.shutdown_requested.is_set():
                try:
                    await asyncio.wait_for(registry.shutdown_requested.wait(),
                                           60 if idle_exit else None)
                except TimeoutError:
                    if (not registry.runs and not registry.pending and
                            time.monotonic() - registry.last_request >= 60):
                        registry.shutdown_requested.set()
        finally:
            await runner.cleanup()

    try:
        asyncio.run(run())
    except (KeyboardInterrupt, web.GracefulExit):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int)
    parser.add_argument("--idle-exit", action="store_true")
    args = parser.parse_args()
    serve(args.port, idle_exit=args.idle_exit)
