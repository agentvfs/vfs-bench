"""Check the complete private mailbox, PDF and memory task with its upstream
grader."""
import json
import os
import shlex
import unittest

from vfsbench import Toolathlon, TrialConfig

PACK = """
from pathlib import Path
from zipfile import ZipFile

root = Path('/workspace/Application_Materials_flat')
academic = '02_Academic_Materials'
letters = '03_Recommendation_Letters'
files = {
    '01_Personal_Information/ID_Card.pdf': 'ID_Card.pdf',
    '01_Personal_Information/Resume.pdf': 'CV.pdf',
    '01_Personal_Information/Photo.jpg': 'Photo.jpg',
    f'{academic}/Enrollment_Certificate.pdf': 'Enrollment_Certificate.pdf',
    f'{academic}/Transcript.pdf': 'Transcript.pdf',
    f'{academic}/Awards_Certificates/All_Awards_Certificates.pdf':
        '/workspace/awards.pdf',
    f'{letters}/Recommendation_Letter_Alex-1.pdf':
        'Recommendation_Letter_1.pdf',
    f'{letters}/Recommendation_Letter_Lily-2.pdf':
        'Recommendation_Letter_2.pdf',
    '04_Supplementary_Materials/Portfolio.pdf': 'Portfolio.pdf',
    '04_Supplementary_Materials/Project_Report.pdf': 'Project_Report.pdf',
}
prefix = 'Application_Materials_MaryCastillo_2201210606/'
with ZipFile('/workspace/application.zip', 'w') as archive:
    for target, source in files.items():
        archive.write(root / source, prefix + target)
"""


@unittest.skipUnless(
    os.getenv("VFSBENCH_TEST_EMAIL_TOOLS")
    and os.getenv("VFSBENCH_TEST_SNAPSHOT"),
    "requires the locked private mail, memory and PDF images and a "
    "local VM snapshot")
class PhDApplicationTests(unittest.IsolatedAsyncioTestCase):

    async def test_grade_delivered_archive_and_merged_pdf(self):
        task = Toolathlon(os.getenv("VFSBENCH_TEST_RELEASE"),
                          cache_dir=os.getenv("VFSBENCH_TEST_CACHE"),
                          local_files_only=True)["apply-phd-email"]
        config = TrialConfig(snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])
        for pages in (0, 2, 3):
            with self.subTest(award_pages=pages):
                async with task.open(config=config) as trial:
                    if pages:
                        await self._send(trial, pages)
                    self.assertEqual((await trial.verify()).reward,
                                     float(pages == 3))

    async def _send(self, trial, pages):

        async def api(command, **args):
            result = await trial.exec(command + " " +
                                      shlex.quote(json.dumps(args)))
            self.assertEqual(result.return_code, 0, result.stderr
                             or result.stdout)
            return result.stdout

        folders = await trial.exec("ls /mail")
        self.assertEqual(folders.return_code, 0, folders.stderr)
        self.assertIn("INBOX", folders.stdout)
        self.assertIn("kaiming", (await api("emails get-emails",
                                            folder="INBOX")).lower())
        self.assertIn("2201210606", await api("memory read-graph"))
        certificates = [
            "Outstanding_Student_Award_2021.pdf",
            "Research_Competition_First_Place_2022.pdf",
            "Academic_Excellence_Award_2023.pdf"
        ][:pages]
        await api("pdf-tools merge-pdfs",
                  pdf_paths=[
                      "/workspace/Application_Materials_flat/" + f
                      for f in certificates
                  ],
                  output_path="/workspace/awards.pdf")
        packed = await trial.exec("python3 -c " + shlex.quote(PACK))
        self.assertEqual(packed.return_code, 0, packed.stderr)
        subject = ("PhD Application Materials Submission "
                   "(Student ID: 2201210606)")
        await api("emails send-email",
                  to="myersj@mcp.com",
                  subject=subject,
                  body="Please find my application materials attached.",
                  attachments=["/workspace/application.zip"])
        self.assertEqual(
            len((await trial.service_state("mail"))["myersj"]["INBOX"]), 1)
