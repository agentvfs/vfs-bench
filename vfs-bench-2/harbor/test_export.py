"""export.py's check of mirage.yaml's ``copy`` against a Dockerfile.

    uv run --project harbor python -I harbor/test_export.py

Two COPYs to one destination are two entries, in order: a ``copy`` that
states one of them, or names the destination twice, fails the check. So
does one that states destinations out of the Dockerfile's order, or a
file's destination without its ``/``.
"""
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export  # noqa: E402

DOCKERFILE = """FROM liveclawbench-example-base:latest
COPY policies/ /workspace/
COPY notes/ /workspace/
"""

OVERLAPPING = """FROM liveclawbench-example-base:latest
COPY base/ /workspace/
COPY patch/ /workspace/policies/
"""


class CopyCheck(unittest.TestCase):

    def setUp(self) -> None:
        self.root = tempfile.TemporaryDirectory()
        environment = Path(self.root.name, "example", "environment")
        environment.mkdir(parents=True)
        (environment / "Dockerfile").write_text(DOCKERFILE)
        self.upstream = export.UPSTREAM
        export.UPSTREAM = Path(self.root.name)

    def tearDown(self) -> None:
        export.UPSTREAM = self.upstream
        self.root.cleanup()

    def problems(self, copy: dict, dockerfile: str | None = None) -> list[str]:
        environment = Path(self.root.name, "example", "environment")
        if dockerfile is not None:
            (environment / "Dockerfile").write_text(dockerfile)
            (environment / "base").mkdir(exist_ok=True)
            (environment / "patch").mkdir(exist_ok=True)
            (environment / "seed.sql").write_text("")
        mirage = {"env": {"TASK_NAME": "example"}, "copy": copy}
        return [
            p for p in export.agrees("example", mirage)
            if "copy" in p or "COPY" in p
        ]

    def test_destinations_in_order_agree(self) -> None:
        self.assertEqual(
            self.problems(
                {
                    "/workspace": "base/",
                    "/workspace/policies": "patch/"
                }, OVERLAPPING), [])

    def test_destinations_out_of_order_disagree(self) -> None:
        # mirage.ts lays them out in this order, so the base would replace
        # the patch.
        self.assertNotEqual(
            self.problems(
                {
                    "/workspace/policies": "patch/",
                    "/workspace": "base/"
                }, OVERLAPPING), [])

    def test_split_copies_to_one_destination_disagree(self) -> None:
        self.assertNotEqual(
            self.problems({"/workspace": "base/"},
                          OVERLAPPING + "COPY base/ /workspace/\n"), [])

    def test_a_file_keeps_its_destination_slash(self) -> None:
        dockerfile = "FROM x\nCOPY seed.sql /workspace/config/\n"
        self.assertEqual(
            self.problems({"/workspace/config/": "seed.sql"}, dockerfile), [])
        self.assertNotEqual(
            self.problems({"/workspace/config": "seed.sql"}, dockerfile), [])

    def test_both_copies_in_order_agree(self) -> None:
        self.assertEqual(
            self.problems(
                {"/workspace": [{
                    "src": "policies/"
                }, {
                    "src": "notes/"
                }]}), [])

    def test_one_of_two_copies_disagrees(self) -> None:
        self.assertNotEqual(self.problems({"/workspace": "notes/"}), [])

    def test_the_wrong_order_disagrees(self) -> None:
        self.assertNotEqual(
            self.problems(
                {"/workspace": [{
                    "src": "notes/"
                }, {
                    "src": "policies/"
                }]}), [])

    def test_one_destination_named_twice_disagrees(self) -> None:
        self.assertIn(
            "copy names one destination twice",
            self.problems({
                "/workspace": [{
                    "src": "policies/"
                }, {
                    "src": "notes/"
                }],
                "/workspace/":
                "notes/"
            }))

    def test_a_repeated_key_is_refused(self) -> None:
        text = "copy:\n  /workspace: policies/\n  /workspace: notes/\n"
        self.assertEqual(
            yaml.safe_load(text)["copy"], {"/workspace": "notes/"})
        with self.assertRaises(yaml.constructor.ConstructorError):
            yaml.load(text, Loader=export.UniqueKeyLoader)


if __name__ == "__main__":
    unittest.main()
