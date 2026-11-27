import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from vfsbench.dataset import Dataset, load_dataset


def write_release(root):
    root.mkdir(parents=True, exist_ok=True)
    blob = b"sample seed"
    digest = hashlib.sha256(blob).hexdigest()
    asset = {
        "path": f"assets/sha256/{digest}",
        "sha256": digest,
        "size": len(blob),
        "target": "fixtures/seed",
        "role": "service_seed"
    }
    (root / asset["path"]).parent.mkdir(parents=True)
    (root / asset["path"]).write_bytes(blob)
    prompt = b"Original prompt\r\n"
    source = {
        "url": "https://example.org/pinned/source",
        "path": "original/prompt.md",
        "sha256": hashlib.sha256(prompt).hexdigest(),
        "size": len(prompt)
    }
    rows = []
    for task_id in ["a", "b"]:
        manifest = {
            "schema_version": 1,
            "dataset": "example",
            "id": task_id,
            "assets": [asset],
            "sources": [],
            "source_assets": []
        }
        row = {
            "id": task_id,
            "instruction": "Inline text",
            "upstream_id": task_id,
            "manifest": f"tasks/{task_id}/manifest.json"
        }
        if task_id == "b":
            row.update(instruction=None, instruction_source=source)
            manifest["source_assets"].append({
                **source, "target": "prompt.md",
                "role": "instruction"
            })
        path = root / row["manifest"]
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(manifest))
        rows.append(json.dumps(row))
    (root / "index.jsonl").write_text("\n".join(rows) + "\n")
    return asset, prompt


class DatasetTests(unittest.TestCase):

    def test_pinned_hub_reads_only_requested_files(self):
        with tempfile.TemporaryDirectory() as directory:
            commit = "a" * 40
            root = Path(directory) / "snapshots" / commit
            asset, _ = write_release(root)
            calls = []

            def download(repo_id, filename, *, revision, **kwargs):
                self.assertEqual(repo_id, "org/demo")
                self.assertEqual(kwargs["repo_type"], "dataset")
                self.assertTrue(kwargs["local_files_only"])
                calls.append((revision, filename))
                return str(root / filename)

            with patch("huggingface_hub.hf_hub_download",
                       side_effect=download):
                tasks = Dataset.from_hub("org/demo",
                                         revision="release",
                                         local_files_only=True)
                self.assertEqual(tasks.revision, commit)
                self.assertEqual(len(tasks), 2)
                self.assertIs(tasks[0], tasks["a"])
                self.assertEqual(tasks["a"].instruction, "Inline text")
                self.assertEqual(calls, [("release", "index.jsonl")])
                files = tasks["a"].materialize()
                self.assertEqual(files["fixtures/seed"].read_bytes(),
                                 b"sample seed")
                self.assertEqual(calls[1:], [(commit, "tasks/a/manifest.json"),
                                             (commit, asset["path"])])

    def test_hub_release_fetches_on_demand_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots" / ("b" * 40)
            write_release(root)

            def download(repo_id, filename, *, revision, local_files_only,
                         **kwargs):
                self.assertFalse(local_files_only)
                self.assertEqual(repo_id, "org/release")
                return str(root / filename)

            with patch("huggingface_hub.hf_hub_download",
                       side_effect=download) as fetch:
                suite = load_dataset("org/release", revision="v1")
                self.assertEqual(fetch.call_count, 1)
                self.assertEqual(fetch.call_args.kwargs["revision"], "v1")
                self.assertEqual(suite["a"].manifest["id"], "a")
                self.assertEqual(fetch.call_count, 2)
                self.assertEqual(fetch.call_args.kwargs["revision"], root.name)

    def test_external_prompt_cache_and_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "suite"
            cache = Path(directory) / "cache"
            asset, prompt = write_release(root)
            tasks = Dataset(root, cache_dir=cache)
            offline = Dataset(root, cache_dir=cache, local_files_only=True)
            with self.assertRaisesRegex(FileNotFoundError,
                                        "unavailable offline"):
                _ = offline["b"].instruction
            with patch("urllib.request.urlopen",
                       return_value=io.BytesIO(prompt)) as fetch:
                self.assertEqual(set(tasks["b"].materialize()),
                                 {"fixtures/seed"})
                fetch.assert_not_called()
                self.assertEqual(tasks["b"].instruction, prompt.decode())
                self.assertEqual(
                    offline["b"].materialize(
                        include_sources=True)["prompt.md"].read_bytes(),
                    prompt)
                fetch.assert_called_once()
            (root / asset["path"]).write_bytes(b"sample Seed")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                offline["a"].materialize()


if __name__ == "__main__":
    unittest.main()
