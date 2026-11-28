import asyncio
import re
import secrets
from contextlib import AsyncExitStack, asynccontextmanager
from urllib.parse import urlsplit
from uuid import uuid4

import aiohttp
from aiohttp import web


class KitHTTPError(RuntimeError):
    pass


class KitRun:

    def __init__(self, client, cleanup, endpoints, task, manifest):
        self.client = client
        self.cleanup = cleanup
        self.endpoints = endpoints
        self.task = task
        self.epoch = manifest["system_time"]
        self.apps = {
            app: app.replace("Light", "light-", 1).lower()
            for app in manifest["apps"]
        }
        self.run_id = uuid4().hex
        self.active = {}
        self.lock = asyncio.Lock()

    async def _delete(self, base):
        async with self.client.delete(f"{base}/_kit/runs/{self.run_id}",
                                      allow_redirects=False) as reply:
            if reply.status not in (200, 204, 404):
                raise RuntimeError(
                    f"Kit could not delete run {self.run_id} ({reply.status})")

    async def _post(self, service, path, body, headers=None):
        try:
            async with self.client.post(self.endpoints[service] + path,
                                        json=body,
                                        headers=headers,
                                        allow_redirects=False) as reply:
                if not 200 <= reply.status < 300:
                    raise KitHTTPError(
                        f"Kit {service} {path.rsplit('/', 1)[-1]} failed "
                        f"(HTTP {reply.status})")
                return await reply.json()
        except (aiohttp.ClientError, TimeoutError, ValueError) as exc:
            raise RuntimeError(
                f"Invalid or unavailable Kit response from {service}") from exc

    async def _ensure(self, service):
        if service not in self.active:
            base = self.endpoints[service]
            # Reset can create a run even when its response is lost.
            self.cleanup.push_async_callback(self._delete, base)
            await self._post(service, "/reset", {
                "run": self.run_id,
                "fixture": self.task,
                "epoch": self.epoch
            })
            self.active[service] = base

    async def _sessions(self, action):
        result = {}
        for app, service in self.apps.items():
            await self._ensure(service)
            reply = await self._post(service, f"/_run/{self.run_id}/{action}",
                                     {})
            if not isinstance(reply, dict) or reply.get("status") != "ok":
                raise RuntimeError(
                    f"Kit {action} failed for {app} with fixture {self.task}")
            result[app] = reply
        return result

    async def clone_into(self, other):
        async with self.lock:
            for service, base in self.active.items():
                try:
                    await self._post(service,
                                     f"/_kit/runs/{self.run_id}/clone",
                                     {"run": other.run_id})
                except KitHTTPError:
                    # Kit can refuse an existing destination.
                    raise
                except BaseException:
                    # A lost reply may follow a successful clone.
                    other.cleanup.push_async_callback(other._delete, base)
                    raise
                other.cleanup.push_async_callback(other._delete, base)
                other.active[service] = base

    async def metadata(self):
        async with self.lock:
            return {"run": self.run_id, "services": dict(self.active)}

    async def request(self, op, **kwargs):
        async with self.lock:
            if op == "init":
                return await self._sessions("login")
            if op == "state":
                return await self._sessions("logout")
            if op != "call":
                raise ValueError(f"Unknown ComplexMCP operation: {op}")
            service, tool = kwargs["service"], kwargs["tool"]
            if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]*", tool) or tool in {
                    "login", "logout", "reset"
            }:
                raise ValueError("Invalid ComplexMCP tool name")
            await self._ensure(service)
            headers = None
            if service.startswith("light-") and service != "light-system":
                clock = self.endpoints["light-system"]
                headers = {"x-light-system": f"{clock}/_run/{self.run_id}"}
            reply = await self._post(service, f"/_run/{self.run_id}/{tool}",
                                     kwargs["args"], headers)
            if not isinstance(reply, str):
                raise RuntimeError(f"Invalid Kit tool response from {service}")
            return reply


@asynccontextmanager
async def kit_run(endpoints, services, task, manifest, *, run_id=None):
    if not isinstance(endpoints, dict) or set(endpoints) != set(services):
        raise ValueError(
            "complexmcp_kit_endpoints must map every service to a Kit URL")
    bases = {}
    for service, url in endpoints.items():
        parsed = urlsplit(url) if isinstance(url, str) else None
        if (not parsed or parsed.scheme not in {"http", "https"}
                or not parsed.hostname or parsed.username is not None
                or parsed.query or parsed.fragment):
            raise ValueError(f"Invalid Kit base URL for {service}")
        bases[service] = url.rstrip("/")
    if len(set(bases.values())) != len(bases):
        raise ValueError("Each Kit service needs its own base URL")
    async with aiohttp.ClientSession() as client, AsyncExitStack() as cleanup:
        kit = KitRun(client, cleanup, bases, task, manifest)
        if run_id is not None:
            kit.run_id = run_id
        yield kit


@asynccontextmanager
async def tool_api(call_tool, catalog):
    # Only this loopback port is reachable from the workspace. The controller
    # owns the Kit management connections and selects the run and clock.
    allowed = {(service["name"], tool["name"])
               for service in catalog
               for tool in service["tools"]}
    token = "Bearer " + secrets.token_hex(32)

    async def call(request):
        if request.headers.get("Authorization") != token:
            raise web.HTTPForbidden()
        service, tool = request.match_info["service"], request.match_info[
            "tool"]
        if (service, tool) not in allowed:
            raise web.HTTPNotFound()
        try:
            args = await request.json()
        except ValueError:
            raise web.HTTPBadRequest() from None
        if not isinstance(args, dict):
            raise web.HTTPBadRequest()
        text = await call_tool(service=service, tool=tool, args=args)
        return web.Response(text=text)

    app = web.Application(client_max_size=16 << 20)
    app.router.add_post("/{service}/{tool}", call)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    try:
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        address = f"127.0.0.1:{runner.addresses[0][1]}"
        async with aiohttp.ClientSession(
                headers={"Authorization": token}) as client:

            async def invoke(service, tool, args):
                url = f"http://{address}/{service}/{tool}"
                async with client.post(url, json=args,
                                       allow_redirects=False) as reply:
                    if reply.status != 200:
                        raise RuntimeError(
                            f"{service}/{tool} failed ({reply.status})")
                    return await reply.text()

            yield invoke, address
    finally:
        await runner.cleanup()
