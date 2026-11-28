import os
import unittest
from email.message import EmailMessage
from email.policy import SMTP

from vfsbench import Toolathlon, TrialConfig


@unittest.skipUnless(os.getenv("VFSBENCH_TEST_SNAPSHOT"),
                     "needs the microsandbox snapshot")
class CourseAssistantTest(unittest.IsolatedAsyncioTestCase):

    async def test_grade_against_simulated_recipient_inboxes(self):
        task = Toolathlon(
            cache_dir=os.getenv("VFSBENCH_TEST_CACHE"))["course-assistant"]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        async with task.start(config=config) as trial:
            state = await trial.service_state("mail")
            self.assertEqual(len(state["virginia_diaz"]["INBOX"]), 13)
            self.assertEqual((await trial.verify()).reward, 0)
        async with task.start(config=config) as trial:
            inbox = await trial.exec("ls /mail")
            self.assertIn("INBOX", inbox.stdout, inbox.stderr)
            check = await trial.exec(
                "python3 -c 'import openpyxl; "
                "print(openpyxl.load_workbook(\"/workspace/nlp_"
                "statistics.xlsx\").sheetnames)'")
            self.assertEqual(check.return_code, 0, check.stderr)
            students = [("smorgan", "Steven Morgan", "2000016613"),
                        ("calvarez", "Carolyn Alvarez", "2000016630"),
                        ("michelle_brooks26", "Michelle Brooks", "2000016606")]
            for recipient, name, number in students:
                msg = EmailMessage(policy=SMTP)
                msg["From"] = "virginia_diaz@mcp.com"
                msg["To"] = recipient + "@mcp.com"
                msg["Subject"] = "nlp-course-emergency"
                msg.set_content(
                    f"{name} ({number}), please send your outstanding "
                    f"coursework.")
                await trial.workspace.vfs.write("/workspace/notice.eml",
                                                msg.as_bytes())
                sent = await trial.exec(
                    "cat /workspace/notice.eml | himalaya message send")
                self.assertEqual(sent.return_code, 0, sent.stderr)
            self.assertEqual((await trial.verify()).reward, 1)
            self.assertIsNone(trial.report.result)
