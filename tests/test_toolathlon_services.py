import json
import os
import shlex
import unittest
from pathlib import PurePosixPath

from vfsbench.dataset import Toolathlon
from vfsbench.runtime import TrialConfig
from vfsbench.suites._toolathlon_services import OUTPUTS
from vfsbench.verifier import SuiteVerifier


@unittest.skipUnless(os.getenv("VFSBENCH_TEST_SNAPSHOT"),
                     "requires an offline microsandbox snapshot")
class ToolathlonServices(unittest.IsolatedAsyncioTestCase):

    async def _exercise(self, name):
        suite = Toolathlon(local_files_only=True,
                           cache_dir=os.getenv("VFSBENCH_TEST_CACHE"))
        task = suite[name]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        async with task.open(config=config) as nop:
            self.assertEqual((await nop.verify()).reward, 0)
        async with task.open(config=config) as trial:
            vfs = trial.workspace.vfs
            filename = OUTPUTS[name]
            if name == "music-analysis":
                result = await trial.exec("ls /gd/Music-Analysis")
                self.assertEqual(result.return_code, 0, result.stderr)
                self.assertIn("Billboard", result.stdout)
                sample = await trial.exec(
                    "gws sheets read --spreadsheet f0002 --range '1940!A2:B2'")
                self.assertEqual(sample.return_code, 0, sample.stderr)
                self.assertIn("Make-Believe Island", sample.stdout)
                self.assertTrue(await vfs.exists(
                    "/workspace/music_analysis_result_example.xlsx"))
            else:
                runs = await vfs.readdir("/wandb/mluo/deepscaler-1.5b")
                self.assertEqual(len(runs), 5)
                history = await vfs.read(
                    "/wandb/mluo/deepscaler-1.5b/owwdhljy/history.jsonl")
                rows = [json.loads(line) for line in history.splitlines()]
                self.assertEqual(len(rows), 301)
                peak = max((row for row in rows
                            if row.get("val/test_score/") is not None),
                           key=lambda r: r["val/test_score/"])
                self.assertEqual(peak["_step"], 230)
            if name == "wandb-best-score":
                run = json.loads(
                    await
                    vfs.read("/wandb/mluo/deepscaler-1.5b/owwdhljy/run.json"))
                self.assertIn("deepscaler-1.5b-24k", run.values())
                answer = ("best_experiment_name,best_step,best_val_score\n"
                          f'deepscaler-1.5b-24k,{peak["_step"]},'
                          f'{peak["val/test_score/"]}\n').encode()
            else:
                answer = task.file(
                    f"upstream/groundtruth_workspace/{filename}").read_bytes()
            await vfs.write(str(PurePosixPath("/workspace") / filename),
                            answer)
            self.assertEqual((await trial.verify()).reward, 1)

    async def test_music_analysis(self):
        await self._exercise("music-analysis")

    async def test_wandb_best_score(self):
        await self._exercise("wandb-best-score")

    async def test_wandb_shortest_length(self):
        await self._exercise("wandb-shortest-length")

    async def test_custom_wandb_verifier_gets_live_project_state(self):

        async def evaluate(view):
            self.assertEqual(view.services, ("wandb", ))
            project = await view.service_state("wandb")
            runs = [edge["node"] for edge in project["runs"]["edges"]]
            self.assertEqual(len(runs), 5)
            self.assertIn("deepscaler-1.5b-24k",
                          [run["displayName"] for run in runs])
            return {"reward": 1, "project": project["name"]}

        task = Toolathlon(
            local_files_only=True,
            cache_dir=os.getenv("VFSBENCH_TEST_CACHE"))["wandb-best-score"]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        async with task.open(config=config,
                             verifier=SuiteVerifier(evaluate)) as trial:
            self.assertEqual((await trial.verify()).details["project"],
                             "deepscaler-1.5b")

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_WOOCOMMERCE"),
                         "requires the pinned OCI images and cached plugin")
    async def test_woocommerce_update_cover(self):
        task = Toolathlon(
            local_files_only=True, cache_dir=os.getenv(
                "VFSBENCH_TEST_CACHE"))["woocommerce-update-cover"]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        async with task.open(config=config) as first:
            self.assertEqual((await first.verify()).reward, 0)
        async with task.open(config=config) as trial:
            for product, image in [(21, 10), (26, 12), (31, 16)]:
                # These are the expected covers in the captured upstream
                # evaluator data.
                path = f"/woo/products/{product}.json"
                self.assertNotEqual(
                    json.loads(
                        await
                        trial.workspace.vfs.read(path))["images"][0]["id"],
                    image)
                args = {
                    "productId": product,
                    "productData": {
                        "images": [{
                            "id": image
                        }]
                    }
                }
                mutation = await trial.exec("woocommerce products-update " +
                                            shlex.quote(json.dumps(args)))
                self.assertEqual(mutation.return_code, 0, mutation.stderr
                                 or mutation.stdout)
                self.assertEqual(
                    json.loads(
                        await
                        trial.workspace.vfs.read(path))["images"][0]["id"],
                    image)
            self.assertEqual((await trial.verify()).reward, 1)

    @unittest.skipUnless(os.getenv("VFSBENCH_TEST_WOOCOMMERCE"),
                         "requires OCI images and upstream seeder inputs")
    async def test_inventory_sync(self):
        task = Toolathlon(
            local_files_only=True,
            cache_dir=os.getenv("VFSBENCH_TEST_CACHE"))["inventory-sync"]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        async with task.open(config=config) as first:
            self.assertEqual((await first.verify()).reward, 0)
        async with task.open(config=config) as trial:
            # Read the six agent-visible SQLite databases and stock counts
            # through the same
            # Mirage tools and WooCommerce handlers an agent receives.
            code = """
from pathlib import Path
import json, sqlite3
totals = {}
for filename in Path('warehouse').glob('*.db'):
    db = sqlite3.connect(filename)
    for region, sku, count in db.execute(
        'SELECT w.region, i.product_id, i.quantity FROM inventory i '
        'JOIN warehouses w USING(warehouse_id)'
    ):
        products = totals.setdefault(region, {})
        products[sku] = products.get(sku, 0) + count
    db.close()
print(json.dumps(totals))
"""
            report = await trial.exec("python3 -c " + shlex.quote(code))
            self.assertEqual(report.return_code, 0, report.stderr)
            totals = json.loads(report.stdout)
            self.assertEqual(set(totals), {"East", "South", "West"})
            changed = 0
            for path in await trial.workspace.vfs.readdir("/woo/products"):
                if not path.endswith(".json"):
                    continue
                product = json.loads(await trial.workspace.vfs.read(path))
                meta = {m["key"]: m["value"] for m in product["meta_data"]}
                if (region := meta.get("region")) not in totals:
                    continue
                stock = totals[region][meta["original_product_id"]]
                args = {
                    "productId": product["id"],
                    "productData": {
                        "manage_stock": True,
                        "stock_quantity": stock
                    }
                }
                mutation = await trial.exec("woocommerce products-update " +
                                            shlex.quote(json.dumps(args)))
                self.assertEqual(mutation.return_code, 0, mutation.stderr
                                 or mutation.stdout)
                changed += 1
            self.assertEqual(changed, 51)
            self.assertEqual((await trial.verify()).reward, 1)
