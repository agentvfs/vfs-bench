#!/usr/bin/env python
import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FIXTURE = HERE / "fixtures" / "repos.json"
NAME = HERE.parent.name
DEFAULT_URL = "http://127.0.0.1:19801"

sys.path.insert(0, str(REPO / "server" / "fakes"))

import github  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",
                        default=os.environ.get("GITHUB_URL", DEFAULT_URL))
    args = parser.parse_args()
    if not FIXTURE.is_file():
        sys.exit(f"no fixture at {FIXTURE}; see shared/capture_repos.py")
    captured = json.loads(FIXTURE.read_text(encoding="utf-8"))
    # Metadata and no files: this task surveys repositories rather than
    # reading them, so every row names a `metaJson` and no `sourceDir`.
    # The captured fields are the vendor's own spelling and are passed
    # through untouched -- the fake merges them into the repository JSON it
    # answers with, which is what the task is scored on reading.
    github.write(NAME, [
        github.repo(
            full_name, branch=meta.get("default_branch", "main"), meta=meta)
        for full_name, meta in sorted(captured.items())
    ])
    github.reset(args.url, NAME, note=f"{len(captured)} repositories")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
