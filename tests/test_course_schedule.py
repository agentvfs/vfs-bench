import json
import os
import unittest

from vfsbench import Toolathlon, TrialConfig


@unittest.skipUnless(os.getenv("VFSBENCH_TEST_SNAPSHOT"),
                     "needs the microsandbox snapshot")
class CourseScheduleTest(unittest.IsolatedAsyncioTestCase):

    async def test_grade_schedule_and_read_private_graph(self):
        task = Toolathlon(
            cache_dir=os.getenv("VFSBENCH_TEST_CACHE"))["course-schedule"]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        async with task.open(config=config) as trial:
            graph = await trial.exec("memory read-graph")
            self.assertEqual(graph.return_code, 0, graph.stderr)
            self.assertIn("2401210477", graph.stdout)
            self.assertIn("entities", await trial.service_state("memory"))
            fetch = await trial.exec(
                """fetch txt '{"url":"https://example.invalid/"}'""")
            self.assertNotEqual(fetch.return_code, 0)
            self.assertIn("No recorded response", fetch.stdout)
            self.assertEqual((await trial.verify()).reward, 0)
        async with task.open(config=config) as trial:
            target = "upstream/groundtruth_workspace/exam_schedule.jsonl"
            reference = task.file(target).read_bytes()
            self.assertTrue(all(json.loads(s) for s in reference.splitlines()))
            await trial.workspace.vfs.write("/workspace/exam_schedule.jsonl",
                                            reference)
            self.assertEqual((await trial.verify()).reward, 1)
