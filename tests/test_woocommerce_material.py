import json
import os
import shlex
import unittest

from vfsbench import Toolathlon, TrialConfig


@unittest.skipUnless(
    os.getenv("VFSBENCH_TEST_WOOCOMMERCE")
    and os.getenv("VFSBENCH_TEST_SNAPSHOT"),
    "requires OCI images, upstream MCP dependencies and a local "
    "microVM snapshot")
class WooCommerceMaterialTests(unittest.IsolatedAsyncioTestCase):

    async def test_both_services_required(self):
        task = Toolathlon(cache_dir=os.getenv("VFSBENCH_TEST_CACHE"),
                          local_files_only=True)["update-material-inventory"]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        for change_sheet, change_store in [(False, False), (True, False),
                                           (False, True), (True, True)]:
            with self.subTest(sheet=change_sheet, store=change_store):
                async with task.open(config=config) as trial:
                    if change_sheet or change_store:
                        await self._apply(trial, change_sheet, change_store)
                    self.assertEqual((await trial.verify()).reward,
                                     float(change_sheet and change_store))

    async def _apply(self, trial, change_sheet, change_store):

        async def google(name, **kwargs):
            result = await trial.exec("google-sheet " + name + " " +
                                      shlex.quote(json.dumps(kwargs)))
            self.assertEqual(result.return_code, 0, result.stderr
                             or result.stdout)
            return json.loads(result.stdout)

        async def mounted(name):
            vfs = trial.workspace.vfs
            return [
                json.loads(await vfs.read(path))
                for path in await vfs.readdir("/woo/" + name)
                if path.endswith(".json")
            ]

        config = json.loads(await
                            trial.workspace.vfs.read("/workspace/config.json"))
        sheet = config["spreadsheet_id"]
        recipe = {}
        bom = (await google("get-sheet-data",
                            spreadsheet_id=sheet,
                            sheet="BOM"))["valueRanges"][0]["values"]
        header = [cell.strip() for cell in bom[0]]
        for row in bom[1:]:
            if row and row[0]:
                sku, material, quantity = (row[header.index(c)]
                                           for c in ("Product SKU",
                                                     "Raw Material ID",
                                                     "Unit Quantity"))
                recipe.setdefault(sku, {})[material] = float(quantity)
        rows = (await
                google("get-sheet-data",
                       spreadsheet_id=sheet,
                       sheet="Material_Inventory"))["valueRanges"][0]["values"]
        ident, qty = (rows[0].index(c) for c in ("原材料ID", "当前库存"))
        held = {row[ident]: float(row[qty]) for row in rows[1:]}
        for order in await mounted("orders"):
            if order["status"] == "processing":
                for line in order["line_items"]:
                    for material, rate in recipe[line["sku"]].items():
                        held[material] = round(
                            held[material] - rate * line["quantity"], 4)
        if change_sheet:
            col = chr(ord("A") + qty)
            await google("update-cells",
                         spreadsheet_id=sheet,
                         sheet="Material_Inventory",
                         range=f"{col}2:{col}{len(held)+1}",
                         data=[[held[r[ident]]] for r in rows[1:]])
        if change_store:
            products = {p["sku"]: p["id"] for p in await mounted("products")}
            for sku, parts in recipe.items():
                quantity = min(
                    int(held[mid] // rate) for mid, rate in parts.items())
                args = {
                    "productId": products[sku],
                    "productData": {
                        "manage_stock": True,
                        "stock_quantity": quantity
                    }
                }
                result = await trial.exec("woocommerce products-update " +
                                          shlex.quote(json.dumps(args)))
                self.assertEqual(result.return_code, 0, result.stderr)
