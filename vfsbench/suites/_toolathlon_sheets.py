import asyncio
import gzip
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from ..cli.tools import tool_cli
from . import _toolathlon_gws as gws
from ._mcpatlas_services import stdio_service

VENDOR = Path(__file__).parent / "vendor/google_sheets"
FIXTURE = "shared/fixtures/woocommerce/"


def environment(dataset):
    # The upstream Sheets tools require MCP 1.x. Let uv lock this private
    # environment
    # independently of our runtime's MCP 2.x, including for concurrent first
    # runs.
    lock = hashlib.sha256((VENDOR / "uv.lock").read_bytes()).hexdigest()
    cache = Path(dataset._cache_dir or os.environ.get("XDG_CACHE_HOME")
                 or Path.home() / ".cache")
    env = (cache / "vfsbench/python" /
           f"sheets-{sys.implementation.cache_tag}-{lock}").resolve()
    args = [
        "uv", "sync", "--frozen", "--no-dev", "--python", sys.executable,
        "--project",
        str(VENDOR)
    ]
    if dataset._local_files_only:
        args.append("--offline")
    subprocess.run(args,
                   env={
                       **os.environ, "UV_PROJECT_ENVIRONMENT": str(env)
                   },
                   stdout=subprocess.DEVNULL,
                   check=True)
    return env / "bin"


def seed(base, task, run_dir):
    cache = run_dir / "sheets-restore.db"
    cache.write_bytes(
        gzip.decompress(task.file(FIXTURE + "sheets.db.gz").read_bytes()))
    with closing(
            sqlite3.connect(f"{cache.as_uri()}?mode=ro&immutable=1",
                            uri=True)) as db:
        db.row_factory = sqlite3.Row
        meta = db.execute(
            "SELECT epochMs,ticks FROM Meta WHERE tenant='default'").fetchone(
            )
        snapshot = {
            "ticks":
            meta["ticks"],
            "counters": [
                list(row) for row in db.execute(
                    "SELECT kind,n FROM Counter WHERE tenant='default'")
            ],
            "files": [],
            "spreadsheets": []
        }
        for row in db.execute(
                "SELECT id,name,mimeType,trashed,createdTime,modifiedTime "
                "FROM DriveFile "
                "WHERE tenant='default' ORDER BY seq"):
            file = dict(row)
            file["trashed"] = bool(file["trashed"])
            file["parents"] = [
                r[0] for r in db.execute(
                    "SELECT parentId FROM DriveParent "
                    "WHERE tenant='default' AND childId=? ORDER BY seq", (
                        file["id"], ))
            ]
            file["permissions"] = [{
                k: v
                for k, v in dict(r).items() if v is not None
            } for r in db.execute(
                "SELECT id,role,type,emailAddress FROM Permission "
                "WHERE tenant='default' AND fileId=? ORDER BY seq", (
                    file["id"], ))]
            snapshot["files"].append(file)
        for sheet in db.execute(
                "SELECT id,title,nextSheetId FROM Spreadsheet WHERE "
                "tenant='default'"):
            sheet = dict(sheet)
            sheet["tabs"] = []
            tab_query = (
                "SELECT sheetId,title,rows,cols,rowPixels,columnPixels "
                "FROM SheetTab WHERE tenant='default' AND spreadsheetId=? "
                "ORDER BY seq")
            for tab in db.execute(tab_query, (sheet["id"], )):
                tab = dict(tab)
                if json.loads(tab.pop("rowPixels")) or json.loads(
                        tab.pop("columnPixels")):
                    raise ValueError(
                        "The captured sheet has non-default row/column pixel "
                        "dimensions")
                tab["cells"] = [[
                    f"{r},{c}", text
                ] for r, c, text in db.execute(
                    "SELECT row,col,text FROM SheetCell "
                    "WHERE tenant='default' AND spreadsheetId=? AND sheetId=?",
                    (sheet["id"], tab["sheetId"]))]
                sheet["tabs"].append(tab)
            snapshot["spreadsheets"].append(sheet)
        epoch = datetime.fromtimestamp(meta["epochMs"] / 1000, UTC).isoformat()
        gws.call(base, "/reset", {"epoch": epoch, "capturedSheets": snapshot})


def capture(base):
    files = gws.call(base, "/drive/v3/files?pageSize=1000")
    if files.get("nextPageToken"):
        raise ValueError(
            "The captured Toolathlon sheet collection requires pagination")
    return {
        "files": files["files"],
        "sheets": {
            f["id"]:
            gws.call(
                base, "/v4/spreadsheets/" + quote(f["id"], safe="") +
                "?includeGridData=true")
            for f in files["files"] if f["mimeType"] == gws.SHEET
        }
    }


@asynccontextmanager
async def captured_sheets(task, run_dir):
    tools = json.loads((VENDOR / "tools.json").read_bytes())
    executable = await asyncio.to_thread(environment, task._dataset)
    token = run_dir / "sheets-oauth.json"
    token.write_bytes((VENDOR / "redirect/fake_token.json").read_bytes())
    formats = run_dir / "sheets-formats.json"
    formats.write_bytes(
        (await asyncio.to_thread(task.file,
                                 FIXTURE + "sheet-formats.json")).read_bytes())
    async with gws.serve(run_dir) as base:
        await asyncio.to_thread(seed, base, task, run_dir)
        argv = [
            str(executable / "python"),
            str(VENDOR / "start_formats.py"), base,
            str(formats)
        ]
        async with gws.launch(run_dir, argv, "SHEETS_URL") as formatted:
            source = await asyncio.to_thread(task.file,
                                             FIXTURE + "sheets-api.json.gz")
            expected = json.loads(gzip.decompress(source.read_bytes()))
            if await asyncio.to_thread(capture, formatted) != expected:
                raise ValueError(
                    "Restored Google Sheets API differs from the capture")
            folder, = (f["id"] for f in expected["files"]
                       if f["mimeType"] == gws.FOLDER and f["name"] == task.id)
            async with gws.agent_api(formatted) as endpoint:
                env = {
                    "GWS_MOCK_URL": endpoint,
                    "PYTHONPATH": str(VENDOR / "redirect"),
                    "TOKEN_PATH": str(token),
                    "CREDENTIALS_PATH": "/nonexistent.json",
                    "SERVICE_ACCOUNT_PATH": "/nonexistent.json",
                    "DRIVE_FOLDER_ID": folder,
                    "NO_PROXY": "127.0.0.1"
                }
                async with stdio_service(
                    [str(executable / "mcp-google-sheets")], env, run_dir,
                        tools) as (session, schemas):

                    cli = tool_cli("google-sheet",
                                   session,
                                   schemas,
                                   tools,
                                   write=True)

                    async def state():
                        return await asyncio.to_thread(gws.state, formatted)

                    credentials = {
                        "access_token": "gws-integ-token",
                        "api_base": endpoint,
                        "folder_id": folder
                    }
                    yield {
                        "mounts": {
                            "/gd": {
                                "vfs": "gdrive",
                                "mode": "read",
                                "config": credentials
                            }
                        },
                        "network": {
                            "allowed_domains":
                            [endpoint.removeprefix("http://")]
                        }
                    }, cli, state
