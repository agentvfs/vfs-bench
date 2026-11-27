import asyncio
import gzip
import hashlib
import json
import tarfile
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

from ..cli.tools import tool_cli
from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from ..vfs.woocommerce import WooFiles
from . import _woocommerce_inventory
from ._mcpatlas_services import stdio_service
from ._npm import install_locked
from ._woocommerce_store import VENDOR, serve

MANIFESTS = {
    "woocommerce-update-cover":
    "810f5451b77958434aaeed59143a5f033fe43513d2f07380f1eb6279fa94ef26",
    "inventory-sync":
    "53c0d5b975085d5f4e7bd6f2af51ca2f169e1b393e84151048ef8e856dc2c66d"
}


def _comparison(state):
    # The service shuffles related product IDs on every request, including
    # during capture.
    return {
        **state, "products": [{
            **product, "related_ids":
            sorted(product["related_ids"])
        } for product in state["products"]]
    }


def _reference(task):
    with tarfile.open(
            task.file(
                "shared/fixtures/woocommerce/groundtruth.tar.gz")) as archive:
        return archive.extractfile(
            "groundtruth_workspace/expected_results.json").read()


@asynccontextmanager
async def tools(task, store, url, run_dir):
    node, modules = await asyncio.to_thread(install_locked, task._dataset,
                                            VENDOR)
    tools = json.loads((VENDOR / "tools.json").read_bytes())
    cli = modules / "@lockon0927/woocommerce-mcp/dist/index.js"
    env = {
        "WORDPRESS_SITE_URL": url,
        "WOOCOMMERCE_CONSUMER_KEY": store.key,
        "WOOCOMMERCE_CONSUMER_SECRET": store.secret,
        "NO_PROXY": "127.0.0.1"
    }
    argv = [
        str(node), "--require",
        str(VENDOR / "stdio-logging.cjs"),
        str(cli)
    ]
    async with stdio_service(argv, env, run_dir,
                             tools) as (client, descriptions):

        yield tool_cli("woocommerce",
                       client,
                       descriptions,
                       tools,
                       prefix="woo_",
                       write=True)


@asynccontextmanager
async def prepare(task, config, run_dir):
    manifest = await asyncio.to_thread(lambda: task.manifest)
    digest = hashlib.sha256(
        json.dumps(manifest, sort_keys=True,
                   separators=(",", ":")).encode()).hexdigest()
    if digest != MANIFESTS[task.id]:
        raise ValueError(f"Unexpected release manifest for {task.id}")
    inventory = task.id == "inventory-sync"
    options = {
        "site": "store81",
        "initialize": partial(_woocommerce_inventory.initialize, task, run_dir)
    } if inventory else {}
    async with serve(task, **options) as (store, url):
        if not inventory:
            fixture = await asyncio.to_thread(
                task.file, "shared/fixtures/woocommerce/api.json.gz")
            expected = json.loads(gzip.decompress(fixture.read_bytes()))
            if _comparison(await store.state()) != _comparison(expected):
                raise ValueError(
                    "Restored WooCommerce REST objects differ from the "
                    "original capture")
        async with tools(task, store, url, run_dir) as cli:

            async def evaluate(trial):
                if inventory:
                    return await _woocommerce_inventory.verify(
                        trial, task, config, run_dir)
                products = (await
                            trial.service_state("woocommerce"))["products"]
                evaluator, truth = await asyncio.gather(
                    asyncio.to_thread(task.file,
                                      "upstream/evaluation/main.py"),
                    asyncio.to_thread(_reference, task))
                inputs = {
                    "driver.py":
                    Path(__file__).with_name(
                        "_woocommerce_grader.py").read_bytes(),
                    "code/evaluation/main.py":
                    evaluator.read_bytes(),
                    "code/groundtruth_workspace/expected_results.json":
                    truth,
                    "products.json":
                    json.dumps(products).encode()
                }
                async with VerifierGuest(config) as guest:
                    result = await guest.run(inputs,
                                             ["python3", "-I", "driver.py"])
                if result.return_code not in (0, 10):
                    raise RuntimeError("WooCommerce evaluator failed: " +
                                       (result.stdout + result.stderr)[-2000:])
                return {
                    "reward": int(result.return_code == 0),
                    "grader": "toolathlon/evaluation/main.py"
                }

            instructions = (
                "Read products, variations, customers, orders and "
                "categories in /woo. Run woocommerce --help for the "
                "original WooCommerce tools. Pass tool arguments as a "
                "single JSON object.")
            yield TrialEnvironment(workspace={},
                                   verifier=SuiteVerifier(evaluate),
                                   instructions=instructions,
                                   clis={"woocommerce": cli},
                                   mounts={"/woo": WooFiles(store)},
                                   state_readers={"woocommerce": store.state})
