import asyncio
import base64
import hashlib
import json
import shutil
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import quote
from urllib.request import ProxyHandler, Request, build_opener

from . import _toolathlon_gws as gws

HERE = Path(__file__).parent
INPUTS = json.loads((HERE / "toolathlon_services_inputs.json").read_bytes())
OUTPUTS = {
    "music-analysis": "music_analysis_result.xlsx",
    "wandb-best-score": "best_experiment.csv",
    "wandb-shortest-length": "shortest_length_experiment.csv",
}
WORKBOOK = "upstream/groundtruth_workspace/Billboard Pop Chart by Year.xlsx"
CAPTURE = "suite_shared/fixtures/wandb/deepscaler-1.5b.json"
# Public Mirage fixture key.
WANDB_KEY = "0123456789abcdef0123456789abcdef01234567"


def _input(task, name, hashes=None):
    path = task.file(name)
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    expected = INPUTS[task.id] if hashes is None else hashes
    if digest != expected[name]:
        raise ValueError(
            f"Input differs from the reviewed Toolathlon release: "
            f"{task.id}/{name}")
    return path


def _seed_workbook(base, path, folder_name, title, *, text_cells):
    from openpyxl import load_workbook

    folder = gws.call(base, "/drive/v3/files", {
        "name": folder_name,
        "mimeType": gws.FOLDER,
        "parents": ["root"],
    })["id"]
    sheet = gws.call(base, "/drive/v3/files", {
        "name": title,
        "mimeType": gws.SHEET,
        "parents": [folder],
    })["id"]
    api = f"/v4/spreadsheets/{sheet}"
    with ExitStack() as stack:
        source = stack.enter_context(path.open("rb"))
        book = load_workbook(source, read_only=True, data_only=True)
        stack.callback(book.close)
        for index, tab in enumerate(book):
            rows = [[
                "" if value is None else (str(value) if text_cells else value)
                for value in row
            ] for row in tab.iter_rows(values_only=True)]
            while rows and not any(rows[-1]):
                rows.pop()
            props = {
                "title": tab.title,
                "gridProperties": {
                    "rowCount": max(1, len(rows)),
                    "columnCount": max(map(len, rows), default=1),
                }
            }
            if index == 0:
                change = {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": 0,
                            **props
                        },
                        "fields": "title,gridProperties",
                    }
                }
            else:
                change = {"addSheet": {"properties": props}}
            gws.call(base, api + ":batchUpdate", {"requests": [change]})
            if rows:
                gws.call(base,
                         api + "/values/" + quote(tab.title + "!A1", safe=""),
                         {"values": rows}, "PUT")
    return folder


def _wandb_state(base):
    query = """{ project(entityName: "mluo", name: "deepscaler-1.5b") {
      name runs(first: 100) { edges { node {
        id name displayName state summaryMetrics
      } } }
    } }"""
    auth = base64.b64encode(("api:" + WANDB_KEY).encode()).decode()
    request = Request(base + "/graphql",
                      data=json.dumps({
                          "query": query
                      }).encode(),
                      headers={
                          "Content-Type": "application/json",
                          "Authorization": "Basic " + auth
                      })
    with build_opener(ProxyHandler({})).open(request, timeout=30) as response:
        value = json.load(response)
    if value.get("errors"):
        raise RuntimeError(f"W&B state query failed: {value['errors']}")
    return value["data"]["project"]


async def workspace(task, config, run_dir, stack):
    from .toolathlon import _stage_workspace

    await asyncio.to_thread(_stage_workspace, task, run_dir / "workspace")
    if task.id == "music-analysis":
        base = await stack.enter_async_context(
            gws.serve(run_dir, config.suite_options.get("mirage_checkout")))
        path = await asyncio.to_thread(_input, task, WORKBOOK)
        await asyncio.to_thread(_seed_workbook,
                                base,
                                path,
                                "Music-Analysis",
                                "Billboard Pop Chart by Year",
                                text_cells=True)
        endpoint = await stack.enter_async_context(gws.agent_api(base))
        credentials = {"access_token": "gws-integ-token", "api_base": endpoint}
        mounts = {
            "/gd": {
                "vfs": "gdrive",
                "mode": "read",
                "config": credentials
            }
        }
        clis = {"gws": {"config": credentials}}
        instruction = (
            "Read the Billboard Pop Chart by Year spreadsheet under "
            "/gd/Music-Analysis. "
            "Use the gws CLI to read its tabs. The example workbook is in "
            "/workspace. "
            "Write music_analysis_result.xlsx in /workspace.")
        readers = {"gws": lambda: asyncio.to_thread(gws.state, base)}
    else:
        fixture = run_dir / "fixtures/wandb/capture.json"
        fixture.parent.mkdir(parents=True)
        capture = await asyncio.to_thread(_input, task, CAPTURE)
        await asyncio.to_thread(shutil.copyfile, capture, fixture)
        command = [
            gws._node(),
            str(HERE / "vendor/wandb/server.mjs"), "--port", "0",
            "--fixture-root",
            str(fixture.parent.parent), "--fixture", "capture"
        ]
        base = await stack.enter_async_context(
            gws.launch(run_dir, command, "WANDB_BASE_URL"))
        endpoint = base
        mounts = {
            "/wandb": {
                "vfs": "wandb",
                "mode": "read",
                "config": {
                    "entities": ["mluo"],
                    "api_key": WANDB_KEY,
                    "base_url": base,
                }
            }
        }
        clis = {}
        instruction = (
            "Read the captured W&B project in /wandb/mluo/deepscaler-1.5b. "
            "Each run has "
            "run.json, config.json, summary.json, history.jsonl and files/. "
            f"Save {OUTPUTS[task.id]} in /workspace.")
        readers = {"wandb": lambda: asyncio.to_thread(_wandb_state, base)}
    return {
        "mounts": mounts,
        "clis": clis,
        "network": {
            "allowed_domains": [endpoint.removeprefix("http://")]
        }
    }, instruction, readers
