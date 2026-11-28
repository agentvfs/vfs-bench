import json
import os
import shlex
import unittest
from xml.etree import ElementTree
from zipfile import ZipFile

from vfsbench import Toolathlon, TrialConfig


@unittest.skipUnless(os.getenv("VFSBENCH_TEST_NOTION"),
                     "needs Notion/Word Docker images and verifier VM")
class NotionTrials(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.task = Toolathlon(
            os.getenv("VFSBENCH_TEST_DATASET"),
            cache_dir=os.getenv("VFSBENCH_TEST_CACHE"),
            local_files_only=True)["notion-personal-website"]
        self.config = TrialConfig(
            snapshot=os.environ["VFSBENCH_TEST_SNAPSHOT"])

    async def test_unchanged_and_populated_page(self):
        async with self.task.open(config=self.config) as trial:
            state = await trial.service_state("notion")
            self.assertEqual(len(state["blocks"]), 8)
            search = await trial.exec("notion post-search")
            self.assertIn(state["page_id"], search.stdout)
            directory = await trial.exec("ls /notion")
            self.assertEqual(directory.return_code, 0, directory.stderr)
            word = await trial.exec(
                """word get-document-text """
                """'{"filename":"/workspace/colley_whisson.docx"}'""")
            self.assertIn("Brisbane", word.stdout)
            self.assertEqual((await trial.verify()).reward, 0)

        async with self.task.open(config=self.config) as trial:
            state = await trial.service_state("notion")
            headings = [
                block for block in state["blocks"]
                if block["type"] == "heading_1"
            ][1:]
            with ZipFile(
                    self.task.file(
                        "upstream/initial_workspace/colley_whisson.docx")
            ) as archive:
                document = ElementTree.fromstring(
                    archive.read("word/document.xml"))
            paragraphs = [
                "".join(t.text or "" for t in p.findall(".//{*}t"))
                for p in document.findall(".//{*}body/{*}p")
            ]
            sections = [
                paragraphs[2:8], paragraphs[12:30], paragraphs[31:81],
                paragraphs[82:105], paragraphs[106:]
            ]
            for heading, section in zip(headings, sections, strict=True):
                blocks = [{
                    "paragraph": {
                        "rich_text": [{
                            "text": {
                                "content": text
                            }
                        }]
                    }
                } for text in section if text.strip()]
                arguments = {
                    "block_id": state["page_id"],
                    "after": heading["id"],
                    "children": blocks
                }
                result = await trial.exec("notion patch-block-children " +
                                          shlex.quote(json.dumps(arguments)))
                self.assertEqual(result.return_code, 0,
                                 result.stderr + result.stdout[:300])
            saved = await trial.service_state("notion")
            self.assertGreater(len(saved["blocks"]), 100)
            self.assertEqual((await trial.verify()).reward, 1)
