import json
import os
import unittest

from vfsbench import Toolathlon, TrialConfig


@unittest.skipUnless(os.getenv("VFSBENCH_TEST_SNAPSHOT"),
                     "requires a local microsandbox snapshot")
class HowToCookTests(unittest.IsolatedAsyncioTestCase):

    async def test_original_recipe_tools_and_graders(self):
        suite = Toolathlon(cache_dir=os.getenv("VFSBENCH_TEST_CACHE"))
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        for name in ("dietary-health", "cooking-guidance"):
            task = suite[name]
            with self.subTest(task=name):
                async with task.open(config=config) as trial:
                    result = await trial.exec(
                        "howtocook getRecipeById '{\"query\": \"西红柿炒鸡蛋\"}'")
                    self.assertEqual(result.return_code, 0, result.stderr)
                    self.assertIn("ingredients", json.loads(result.stdout))
                    self.assertEqual((await trial.verify()).reward, 0)
                    self.assertEqual(
                        len((await
                             trial.service_state("howtocook"))["recipes"]),
                        322)
                if name == "dietary-health":
                    async with task.open(config=config) as trial:
                        reference = task.file(
                            "upstream/groundtruth_workspace/analysis.md")
                        await trial.workspace.vfs.write(
                            "/workspace/analysis.md", reference.read_bytes())
                        self.assertEqual((await trial.verify()).reward, 1)
                else:
                    async with task.open(config=config) as trial:
                        dishes = []
                        for dish in ("瘦肉土豆片", "冬瓜酿肉", "蒸水蛋"):
                            recipe = await trial.exec(
                                f"howtocook getRecipeById "
                                f"'{{\"query\":\"{dish}\"}}'")
                            self.assertEqual(recipe.return_code, 0)
                            dishes.append(
                                {"name": json.loads(recipe.stdout)["name"]})
                        shopping = (
                            "Name,Quantity\n纯瘦肉,50g\n猪肉末,300g\n土豆,100g\n冬瓜,"
                            "100g\n鸡蛋,1个\n"
                            "葱花,20g\n葱姜末,30g\n胡椒粉,5g\n生抽,20ml\n老抽,3g\n生粉,5g\n"
                            "淀粉,30g\n"
                            "水淀粉,25g\n食用盐,2g\n盐,22g\n热水,260ml\n锡纸或保鲜膜,1张\n")
                        await trial.workspace.vfs.write(
                            "/workspace/shopping.csv", shopping.encode())
                        await trial.workspace.vfs.write(
                            "/workspace/cuisine.json",
                            json.dumps({
                                "recommended_dishes": dishes
                            }).encode())
                        grade = await trial.verify()
                        self.assertEqual(grade.reward, 1,
                                         grade.details["output"])
