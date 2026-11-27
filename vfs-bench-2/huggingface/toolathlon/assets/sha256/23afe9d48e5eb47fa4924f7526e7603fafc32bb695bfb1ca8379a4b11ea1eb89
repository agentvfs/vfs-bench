#!/usr/bin/env python
import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
NAME = HERE.parent.name
# The Hub id upstream's own grader names, in
# groundtruth_workspace/expected_dataset_info.json.
REPO_ID = "agentica-org/DeepScaleR-Preview-Dataset"
FILENAME = "deepscaler.json"
DEFAULT_URL = "http://127.0.0.1:5199"

sys.path.insert(0, str(REPO / "server" / "fakes"))
sys.path.insert(0, str(REPO / "agent"))

import dataset  # noqa: E402
import hf  # noqa: E402


def source() -> Path:
    """The dataset's own bytes, read out of the pinned checkout.

    Upstream grades this task by comparing the agent's parquet against
    `groundtruth_workspace/deepscaler.json`, which IS the repository's one
    file -- 40,315 records of problem, answer and solution. So the fixture
    is not captured and not committed here: it is read from the submodule at
    seed time, and the pin is its lineage. A copy in this tree would be
    21MB that could drift from the answer it is graded against.

    Returns:
        Path: the file.

    Raises:
        SystemExit: the checkout is missing it.
    """
    path = (dataset.task_dir(NAME) / "groundtruth_workspace" / FILENAME)
    if not path.is_file():
        sys.exit(f"no {FILENAME} at {path}; the checkout has moved it")
    return path


def seed(url: str) -> None:
    """Put the dataset repository on the fake.

    Args:
        url (str): the fake's base URL.
    """
    where = source()
    snapshot = json.loads((HERE / "search.json").read_text())
    candidates = [row for page in snapshot["pages"] for row in page["body"]]
    if not candidates or max(
            candidates, key=lambda row: row["downloads"])["id"] != REPO_ID:
        raise ValueError(
            "Captured ranking disagrees with upstream ground truth")
    repositories = []
    for row in candidates:
        source_dir = ""
        if row["id"] == REPO_ID:
            source_dir = hf.stage(f"{NAME}-{FILENAME.removesuffix('.json')}",
                                  {FILENAME: where})
        repositories.append(
            hf.repo(row["id"],
                    source_dir=source_dir,
                    downloads=row["downloads"],
                    likes=row["likes"],
                    created_at=row["createdAt"]))
    hf.write(NAME, repositories)
    hf.reset(url, NAME, note=f"{REPO_ID}, {where.stat().st_size} bytes")


def verify(url: str) -> None:
    """Check the fake serves the file the task is graded on reading.

    Seeding reports the rows it wrote and says nothing about the blobs
    `afterSeed` expanded, so the tree is read back rather than assumed --
    a repository whose `sourceDir` resolved to nothing seeds cleanly and
    serves an empty tree.

    Args:
        url (str): the base URL.

    Raises:
        SystemExit: the fake came up without the file in it.
    """
    tree = hf.call(url,
                   f"/api/datasets/{REPO_ID}/tree/main",
                   method="GET",
                   tenant=NAME)
    listed = tree if isinstance(tree, list) else []
    found = {entry.get("path"): entry.get("size") for entry in listed}
    if FILENAME not in found:
        sys.exit(f"fake serves {sorted(found)} and not {FILENAME}")
    want = source().stat().st_size
    if found[FILENAME] != want:
        sys.exit(f"{FILENAME} is {found[FILENAME]} bytes on the fake, "
                 f"{want} in the checkout")
    print(f"verified {REPO_ID}: {FILENAME}, {want} bytes")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",
                        default=os.environ.get("HF_ENDPOINT", DEFAULT_URL))
    args = parser.parse_args()
    seed(args.url)
    verify(args.url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
