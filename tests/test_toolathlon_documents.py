import json
import os
import unittest
from pathlib import Path

from vfsbench.dataset import Toolathlon
from vfsbench.runtime import TrialConfig
from vfsbench.suites._toolathlon_documents import _WorkspaceDocuments


class DocumentPaths(unittest.TestCase):

    def test_document_paths_cannot_leave_the_trial_mount(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "outside").symlink_to(root.parent)
            docs = _WorkspaceDocuments(None, "word", root)
            self.assertEqual(docs._file("test.docx"), "/workspace/test.docx")
            for path in ("../other.docx", "/etc/passwd", "outside/other.docx",
                         "https://example.com/doc.pdf"):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    docs._file(path)


@unittest.skipUnless(os.getenv("VFSBENCH_TEST_DOCUMENTS"),
                     "requires Docker, document image and verifier snapshot")
class DocumentTrials(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.suite = Toolathlon(local_files_only=True,
                                cache_dir=os.getenv("VFSBENCH_TEST_CACHE"))
        self.config = TrialConfig(
            snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])

    async def test_interview_report(self):
        task = self.suite["interview-report"]
        async with task.open(config=self.config) as trial:
            result = await trial.exec(
                """word get-document-text """
                """'{"filename":"/workspace/Candidates_resumes.docx"}'""")
            self.assertIn("Anna Taylor", result.stdout)
            self.assertEqual(result.return_code, 0, result.stderr)
            self.assertNotEqual(
                (await trial.exec("python3 --version")).return_code, 0)
            self.assertEqual((await trial.verify()).reward, 0)
        async with task.open(config=self.config) as trial:
            result = await trial.exec(
                """word create-document """
                """'{"filename":"/workspace/Created.docx"}'""")
            self.assertEqual(result.return_code, 0, result.stderr)
            self.assertTrue(
                await trial.workspace.vfs.is_file("/workspace/Created.docx"))
            for binding in task.manifest["source_assets"]:
                target = binding["target"]
                if target.startswith("upstream/groundtruth_workspace/"
                                     ) and target.endswith(".docx"):
                    await trial.workspace.vfs.write(
                        "/workspace/" + Path(target).name,
                        task.file(target).read_bytes())
            await trial.workspace.vfs.write("/workspace/recommend.txt",
                                            b"John Smith")
            self.assertEqual((await trial.verify()).reward, 1)

    async def test_ppt_analysis(self):
        task = self.suite["ppt-analysis"]
        async with task.open(config=self.config) as trial:
            self.assertEqual(
                (await trial.service_state("pptx"))["total_presentations"], 0)
            result = await trial.exec(
                """pptx open-presentation """
                """'{"file_path":"/workspace/Compile.pptx","id":"lecture"}'""")
            self.assertEqual(result.return_code, 0, result.stderr)
            self.assertEqual((await trial.service_state("pptx")
                              )["presentations"][0]["slide_count"], 26)
            result = await trial.exec("""pptx get-presentation-info """
                                      """'{"presentation_id":"lecture"}'""")
            self.assertEqual(json.loads(result.stdout)["slide_count"], 26)
            result = await trial.exec(
                """pdf-tools get-pdf-info """
                """'{"pdf_file_path":"/workspace/HW.pdf"}'""")
            self.assertEqual(result.return_code, 0, result.stderr)
            self.assertIn("PDF file information", result.stdout)
            self.assertEqual((await trial.verify()).reward, 0)
        async with task.open(config=self.config) as trial:
            self.assertEqual(
                (await trial.service_state("pptx"))["total_presentations"], 0)
            # The format fixture contains the lecture's actual reference code.
            code = task.file("upstream/evaluation/code.md").read_text()
            summary = """# Symbol table

## Comparison

In the functional style, insert returns a new table and the original remains
available. The imperative style changes the current table. The difference
matters because a later lookup can see the change through another reference.

## Homework

The exercise asks which binding a name refers to in a nested scope.
For example, a string variable shadows the integer argument until execution
leaves the inner block.
"""
            await trial.workspace.vfs.write("/workspace/NOTE.md",
                                            (summary + code).encode())
            self.assertEqual((await trial.verify()).reward, 1)
