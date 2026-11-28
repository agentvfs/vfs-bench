import asyncio
import json
import os
import re
import shutil
import sysconfig
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import ProxyHandler, Request, build_opener

from aiohttp import ClientSession, web

VENDOR = Path(__file__).parent / 'vendor/gws'
SHEET = 'application/vnd.google-apps.spreadsheet'
FOLDER = 'application/vnd.google-apps.folder'
MIRAGE_REVISION = '20ea0553d8b4c5bae6eba1d7729bc66fa9a82977'


def _node():
    binary = Path(sysconfig.get_path('scripts')) / ('node.exe' if os.name
                                                    == 'nt' else 'node')
    if binary.is_file():
        return str(binary)
    if path := shutil.which('node'):
        return path
    raise RuntimeError(
        'The GWS mock requires Node.js. Install nodejs-wheel-binaries '
        'or Node.js.')


@asynccontextmanager
async def serve(run_dir, checkout=None):
    if checkout is None:
        argv = [_node(), str(VENDOR / 'start.mjs')]
    else:
        # Only an operator can select this prepared checkout via trial config.
        checkout = Path(checkout).expanduser().resolve()
        git = await asyncio.create_subprocess_exec(
            'git',
            '-C',
            str(checkout),
            'rev-parse',
            'HEAD',
            stdout=asyncio.subprocess.PIPE)
        rev, _ = await git.communicate()
        if git.returncode or rev.decode().strip() != MIRAGE_REVISION:
            raise ValueError(
                f'The Mirage checkout must be at {MIRAGE_REVISION}')
        git = await asyncio.create_subprocess_exec('git', '-C', str(checkout),
                                                   'diff', '--quiet', 'HEAD',
                                                   '--', 'integ')
        if await git.wait():
            raise ValueError(
                'The pinned Mirage integration sources have local '
                'modifications')
        integ = checkout / 'integ'
        argv = [
            str(integ / 'node_modules/.bin/tsx'),
            str(integ / 'server/gws/main.ts'), '--port', '0'
        ]
    async with launch(run_dir, argv, 'GWS_URL') as base:
        yield base


@asynccontextmanager
async def launch(run_dir, argv, variable):
    log_path = Path(run_dir) / f'{variable}.stderr.log'
    with log_path.open('wb') as log:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=run_dir,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=log,
            env={
                'PATH': os.environ.get('PATH', ''),
                'MIRAGE_BIND_HOST': '127.0.0.1',
                'MIRAGE_ADVERTISE_HOST': '127.0.0.1',
                'TMPDIR': str(run_dir)
            },
        )
    try:
        try:
            line = await asyncio.wait_for(proc.stdout.readline(), timeout=60)
        except TimeoutError:
            reason = 'timed out waiting for its loopback endpoint'
        except ValueError:
            reason = 'sent an oversized endpoint announcement'
        else:
            match = re.fullmatch(
                re.escape(variable) + r'=(http://127\.0\.0\.1:[0-9]+)',
                line.decode(errors='replace').strip())
            if match:
                yield match.group(1)
                return
            reason = 'failed to announce its loopback endpoint'
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except TimeoutError:
                proc.kill()
                await proc.wait()
    # The run directory is private and is removed during trial cleanup.
    with log_path.open('rb') as log:
        size = log.seek(0, os.SEEK_END)
        log.seek(max(0, size - 8192))
        lines = log.read().decode(errors='replace').splitlines()
    tail = '\n'.join([line for line in lines if line.strip()][-8:])
    message = f'{variable} mock {reason} (exit {proc.returncode})'
    raise RuntimeError(f'{message}\n{tail}' if tail else message)


def call(base, path, body=None, method=None):
    request = Request(base + path,
                      method=method,
                      headers={'Content-Type': 'application/json'},
                      data=None if body is None else json.dumps(body).encode())
    # Controller traffic stays on loopback even when the host exports a proxy.
    with build_opener(ProxyHandler({})).open(request, timeout=30) as response:
        return json.load(response)


@asynccontextmanager
async def agent_api(base,
                    *,
                    prefixes=("/drive/v3/", "/upload/drive/v3/",
                              "/v4/spreadsheets")):
    """Expose task-facing Google APIs on a separate port from the
    controller's reset API."""
    async with ClientSession(trust_env=False) as client:

        async def route(request):
            path = request.rel_url.path
            if ".." in path.split("/") or not any(path == p.rstrip(
                    "/") or path.startswith(p.rstrip("/") + "/")
                                                  for p in prefixes):
                raise web.HTTPForbidden()
            headers = {
                k: request.headers[k]
                for k in ("Content-Type", "Authorization", "Range")
                if k in request.headers
            }
            async with client.request(request.method,
                                      base + request.raw_path,
                                      data=await request.read(),
                                      headers=headers,
                                      allow_redirects=False) as upstream:
                headers = {
                    k: upstream.headers[k]
                    for k in ("Content-Type", "Content-Range", "ETag")
                    if k in upstream.headers
                }
                return web.Response(status=upstream.status,
                                    body=await upstream.read(),
                                    headers=headers)

        app = web.Application(client_max_size=100 * 1024**2)
        app.router.add_route("*", "/{path:.*}", route)
        runner = web.AppRunner(app)
        await runner.setup()
        try:
            await web.TCPSite(runner, "127.0.0.1", 0).start()
            yield f"http://127.0.0.1:{runner.addresses[0][1]}"
        finally:
            await runner.cleanup()


def seed(base, folder_name, source_name, rows):
    folder = call(base, '/drive/v3/files', {
        'name': folder_name,
        'mimeType': FOLDER,
        'parents': ['root']
    })['id']
    sheet = call(base, '/drive/v3/files', {
        'name': source_name,
        'mimeType': SHEET,
        'parents': [folder]
    })['id']
    call(base, f'/v4/spreadsheets/{sheet}/values/Sheet1!A1', {'values': rows},
         'PUT')
    return folder


def state(base):
    """Return a detached JSON view of Drive items and the sheets in this
    trial."""
    files = []
    params = {
        'fields': 'nextPageToken,files(id,name,mimeType,parents,trashed)',
        'pageSize': 1000
    }
    while True:
        page = call(base, '/drive/v3/files?' + urlencode(params))
        files.extend(page.get('files', []))
        token = page.get('nextPageToken')
        if not token:
            break
        params['pageToken'] = token
    spreadsheets = {}
    for item in files:
        if item['mimeType'] != SHEET or item.get('trashed'):
            continue
        path = '/v4/spreadsheets/' + quote(item['id'], safe='')
        tabs = call(base, path).get('sheets', [])
        for tab in tabs:
            title = tab['properties']['title']
            url = path + '/values/' + quote(
                "'" + title.replace("'", "''") + "'", safe='')
            tab['values'] = call(base, url).get('values', [])
        spreadsheets[item['id']] = tabs
    return {'files': files, 'spreadsheets': spreadsheets}


def result_rows(frozen, folder, title, *, tab_name=None):
    for item in frozen['files']:
        if (item['name'] == title and item['mimeType'] == SHEET
                and folder in item.get('parents', [])
                and not item.get('trashed')):
            tabs = frozen['spreadsheets'][item['id']]
            for tab in tabs:
                if tab_name is None or tab['properties']['title'] == tab_name:
                    return tab['values']
    return []
