import asyncio
import gzip
import hashlib
import json
import tarfile
from contextlib import asynccontextmanager
from pathlib import Path

from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from ..vfs.woocommerce import WooFiles
from . import _toolathlon_woocommerce as woo
from ._toolathlon_sheets import captured_sheets
from ._woocommerce_store import serve

MANIFEST = "ac911458cfcc9e4f605ed552f9d348aa32af95c0a5276ae817f4486cbe40f689"
FIX = "shared/fixtures/woocommerce/"


def _reference(task):
    with tarfile.open(task.file(FIX + "groundtruth.tar.gz")) as archive:
        return {
            f"code/{k}": archive.extractfile(k).read()
            for k in ("initial_workspace/config.json",
                      "groundtruth_workspace/expected_results.json")
        }


async def verify(task, config, view):
    woo_state, gws = await asyncio.gather(view.service_state("woocommerce"),
                                          view.service_state("gws"))
    files = await asyncio.to_thread(_reference, task)
    files["driver.py"] = Path(__file__).with_name(
        "_woocommerce_material_grader.py").read_bytes()
    files["state.json"] = json.dumps({
        "drive": gws,
        "products": woo_state["products"]
    }).encode()
    for item in task.manifest["source_assets"]:
        name = item["target"]
        if name.startswith("upstream/evaluation/"
                           ) or name == "upstream/preprocess/sheets_setup.py":
            path = await asyncio.to_thread(task._dataset._source_file, item)
            files["code/" + name.removeprefix("upstream/")] = path.read_bytes()
    for name in ("config.json", "initial_workspace/config.json"):
        if await view.is_file("/workspace/" + name):
            files["agent/" + name] = await view.read_file("/workspace/" + name)
    async with VerifierGuest(config) as guest:
        result = await guest.run(files, ["python3", "-I", "driver.py"])
    if result.return_code not in (0, 10):
        raise RuntimeError("Material inventory verifier failed: " +
                           (result.stdout + result.stderr)[-1800:])
    return {
        "reward": int(result.return_code == 0),
        "grader": "toolathlon/evaluation/main.py"
    }


@asynccontextmanager
async def prepare(task, config, run_dir):
    manifest = await asyncio.to_thread(lambda: task.manifest)
    if hashlib.sha256(
            json.dumps(manifest, sort_keys=True,
                       separators=(",",
                                   ":")).encode()).hexdigest() != MANIFEST:
        raise ValueError(
            "Unexpected release manifest for update-material-inventory")
    work = run_dir / "workspace"
    work.mkdir()
    archive = await asyncio.to_thread(task.file, FIX + "workspace.tar.gz")
    with tarfile.open(archive) as stream:
        (work / "config.json").write_bytes(
            stream.extractfile("./config.json").read())
    async with serve(task, site="store91") as (store, url):
        original = await asyncio.to_thread(task.file, FIX + "api.json.gz")
        expected = json.loads(gzip.decompress(original.read_bytes()))
        if woo._comparison(await store.state()) != woo._comparison(expected):
            raise ValueError(
                "Restored WooCommerce REST objects differ from the material "
                "inventory capture")
        async with woo.tools(task, store, url,
                             run_dir) as store_cli, captured_sheets(
                                 task, run_dir) as sheets:
            spec, sheet_cli, sheet_state = sheets

            instructions = (
                "The active spreadsheet ID is in /workspace/config.json. "
                "Read the spreadsheet under /gd and use google-sheet for "
                "its original tools. Read orders and products under /woo "
                "and use woocommerce to update the store. Both CLIs "
                "accept one JSON object.")
            yield TrialEnvironment(
                workspace=spec,
                verifier=SuiteVerifier(
                    lambda view: verify(task, config, view)),
                instructions=instructions,
                clis={
                    "woocommerce": store_cli,
                    "google-sheet": sheet_cli
                },
                mounts={"/woo": WooFiles(store)},
                state_readers={
                    "woocommerce": store.state,
                    "gws": sheet_state
                })
