"""Restore a captured WooCommerce store in disposable, network-isolated OCI
services."""

import asyncio
import base64
import gzip
import hashlib
import hmac
import json
import re
import secrets
from contextlib import AsyncExitStack, asynccontextmanager
from email.parser import BytesHeaderParser
from pathlib import Path
from urllib.parse import urlencode

from aiohttp import web

VENDOR = Path(__file__).parent / "vendor/woocommerce"
MYSQL = ("mysql@sha256:"
         "7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b")
WORDPRESS = (
    "wordpress@sha256:"
    "9973c15252ea54260c711e1074c96864acabebda379c664e812fa9bfe6fef268")
PLUGIN = {
    "url": "https://downloads.wordpress.org/plugin/woocommerce.10.7.0.zip",
    "size": 19340706,
    "sha256":
    "3c3d72be3a2b7fe4b26d34c09c572f6bc0b230d2b69b968307fca41aaeef8bee"
}
WP_CONFIG = """if (!getenv('VFSBENCH_WP_INSTALL')) {
define('MULTISITE', true);
define('SUBDOMAIN_INSTALL', false);
define('DOMAIN_CURRENT_SITE', 'localhost:10003');
define('PATH_CURRENT_SITE', '/');
define('SITE_ID_CURRENT_SITE', 1);
define('BLOG_ID_CURRENT_SITE', 1);
}
define('DISABLE_WP_CRON', true);
define('WP_HTTP_BLOCK_EXTERNAL', true);"""
API_PATH = re.compile(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/?")
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}


async def docker(*args, stdin=None, check=True, missing_ok=False):
    proc = await asyncio.create_subprocess_exec(
        "docker",
        *args,
        stdin=asyncio.subprocess.PIPE
        if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await proc.communicate(stdin)
    except BaseException:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise
    if check and proc.returncode:
        if missing_ok and (b"no such container" in err.lower()
                           or b"not found" in err.lower()):
            return proc.returncode, out
        raise RuntimeError(
            f"Docker {args[0]} failed: {err.decode(errors='replace')[-1500:]}")
    return proc.returncode, out


class WooStore:

    def __init__(self, site):
        self.site = site
        self.name = "vfsbench-woo-" + secrets.token_hex(8)
        self.wordpress = self.name + "-wp"
        self.database = self.name + "-db"
        self.key = "ck_" + secrets.token_hex(20)
        self.secret = "cs_" + secrets.token_hex(20)

    async def request(self, method, resource, query=(), body=None):
        if method not in METHODS or not API_PATH.fullmatch(resource):
            raise ValueError("Invalid WooCommerce REST resource")
        url = f"http://127.0.0.1/{self.site}/wp-json/wc/v3/{resource}"
        if query:
            url += "?" + urlencode(query, doseq=True)
        args = [
            "exec", "-i", self.wordpress, "curl", "--silent", "--show-error",
            "--max-time", "40", "--globoff", "--include", "--header",
            "Expect:", "--header", "Host: localhost:10003", "--user",
            self.key + ":" + self.secret, "--request", method
        ]
        if body is not None:
            args += [
                "--header", "Content-Type: application/json", "--data-binary",
                "@-"
            ]
        _, reply = await docker(*args, url, stdin=body)
        header, data = reply.split(b"\r\n\r\n", 1)
        status, fields = header.split(b"\r\n", 1)
        return int(
            status.split()[1]), BytesHeaderParser().parsebytes(fields), data

    async def get(self, path, query=()):
        code, headers, raw = await self.request("GET", path, query)
        if code == 404:
            raise FileNotFoundError(path)
        if code != 200:
            raise RuntimeError(
                f"WooCommerce GET {path} returned {code}: {raw[:250]!r}")
        return json.loads(raw), headers

    async def listing(self, path):
        rows, page = [], 1
        while True:
            batch, headers = await self.get(path, {
                "per_page": 100,
                "page": page
            })
            rows.extend(batch)
            if page >= int(headers["X-WP-TotalPages"] or 1):
                return rows
            page += 1

    async def state(self):
        paths = ["products", "orders", "customers", "products/categories"]
        data = dict(
            zip(paths,
                await asyncio.gather(*(self.listing(path) for path in paths)),
                strict=True))
        variations = [
            f"products/{p['id']}/variations" for p in data["products"]
            if p["type"] == "variable"
        ]
        data.update(
            zip(variations,
                await
                asyncio.gather(*(self.listing(path) for path in variations)),
                strict=True))
        return data

    async def proxy(self, req):
        auth = "Basic " + base64.b64encode(
            f"{self.key}:{self.secret}".encode()).decode()
        if not secrets.compare_digest(req.headers.get("Authorization", ""),
                                      auth):
            raise web.HTTPUnauthorized()
        resource = req.match_info["resource"]
        if req.method not in METHODS or not API_PATH.fullmatch(resource):
            raise web.HTTPNotFound()
        body = await req.read()
        status, headers, raw = await self.request(req.method, resource,
                                                  list(req.query.items()), body
                                                  or None)
        retained = {
            k: headers[k]
            for k in ("X-WP-Total", "X-WP-TotalPages") if k in headers
        }
        return web.Response(body=raw,
                            status=status,
                            content_type="application/json",
                            headers=retained)


@asynccontextmanager
async def serve(task, *, site="store85", initialize=None):
    store = WooStore(site)
    plugin = await asyncio.to_thread(task._dataset._source_file, PLUGIN)
    password = secrets.token_hex(24)
    sql_cli = [
        "exec", "-i", "-e", "MYSQL_PWD=" + password, store.database, "mysql",
        "--host=127.0.0.1", "--user=wordpress", "wordpress"
    ]
    offline = task._dataset._local_files_only
    pull = "--pull=never" if offline else "--pull=missing"
    async with AsyncExitStack() as scope:
        scope.push_async_callback(docker,
                                  "network",
                                  "rm",
                                  store.name,
                                  missing_ok=True)
        await docker("network", "create", "--internal", store.name)
        for name, alias, image, env in [
            (store.database, "db", MYSQL, {
                "MYSQL_RANDOM_ROOT_PASSWORD": "yes",
                "MYSQL_DATABASE": "wordpress",
                "MYSQL_USER": "wordpress",
                "MYSQL_PASSWORD": password
            }),
            (store.wordpress, "shop", WORDPRESS, {
                "WORDPRESS_DB_HOST": "db",
                "WORDPRESS_DB_NAME": "wordpress",
                "WORDPRESS_DB_USER": "wordpress",
                "WORDPRESS_DB_PASSWORD": password,
                "WORDPRESS_CONFIG_EXTRA": WP_CONFIG
            }),
        ]:
            scope.push_async_callback(docker,
                                      "rm",
                                      "--force",
                                      "--volumes",
                                      name,
                                      missing_ok=True)
            variables = [
                item for key, value in env.items()
                for item in ("--env", key + "=" + value)
            ]
            await docker("run", "--detach", pull, "--network", store.name,
                         "--network-alias", alias, "--name", name, *variables,
                         image)
        async with asyncio.timeout(120):
            while (await docker(*sql_cli, "--execute", "SELECT 1",
                                check=False))[0]:
                await asyncio.sleep(0.5)
            while (await docker("exec",
                                store.wordpress,
                                "test",
                                "-f",
                                "/var/www/html/wp-config.php",
                                check=False))[0]:
                await asyncio.sleep(0.2)
        await docker("cp", str(plugin),
                     store.wordpress + ":/tmp/woocommerce.zip")
        await docker(
            "exec", store.wordpress, "php", "-r",
            '$z=new ZipArchive(); if($z->open("/tmp/'
            'woocommerce.zip")!==true || '
            '!$z->extractTo("/var/www/html/wp-content/plugins")) exit(1);')
        await docker("cp", str(VENDOR / "multisite.htaccess"),
                     store.wordpress + ":/var/www/html/.htaccess")
        hashed = hmac.new(b"wc-api", store.key.encode(),
                          hashlib.sha256).hexdigest()
        if initialize is None:
            sql, media = await asyncio.gather(
                asyncio.to_thread(
                    task.file, "shared/fixtures/woocommerce/database.sql.gz"),
                asyncio.to_thread(
                    task.file, "shared/fixtures/woocommerce/uploads.tar.gz"))
            await docker(*sql_cli,
                         stdin=gzip.decompress(await
                                               asyncio.to_thread(sql.read_bytes
                                                                 )))
            # Rotate just the captured store user's API credential for this
            # trial.
            await docker(
                *sql_cli,
                stdin=(f"UPDATE wp_2_woocommerce_api_keys SET "
                       f"consumer_key='{hashed}', "
                       f"consumer_secret='{store.secret}' WHERE key_id=1;"
                       ).encode())
            await docker("cp", str(media),
                         store.wordpress + ":/tmp/uploads.tar.gz")
            await docker("exec", store.wordpress, "tar", "-xzf",
                         "/tmp/uploads.tar.gz", "-C",
                         "/var/www/html/wp-content")
        else:
            await initialize(store, sql_cli, hashed)
        app = web.Application()
        app.router.add_route("*", "/wp-json/wc/v3/{resource:.*}", store.proxy)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        scope.push_async_callback(runner.cleanup)
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        yield store, f"http://127.0.0.1:{runner.addresses[0][1]}"
