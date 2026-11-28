#!/usr/bin/env python
import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FIXTURE = HERE / "fixtures" / "academicpages"
# The template the task forks, and the branch it is served on. academicpages
# is one of the repositories whose default branch is still `master`, and the
# grader reads `_config.yml` and `_pages/about.md` at that ref by name, so the
# fixture has to keep it rather than being normalised to `main`.
TEMPLATE = "academicpages/academicpages.github.io"
BRANCH = "master"
NAME = HERE.parent.name
DEFAULT_URL = "http://127.0.0.1:19801"

sys.path.insert(0, str(REPO / "server" / "fakes"))

import github  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",
                        default=os.environ.get("GITHUB_URL", DEFAULT_URL))
    args = parser.parse_args()
    if not FIXTURE.is_dir():
        sys.exit(f"no fixture at {FIXTURE}; see shared/build_fixture.py")
    github.write(
        NAME,
        [
            github.repo(TEMPLATE,
                        branch=BRANCH,
                        source_dir=github.stage(f"{NAME}-template", FIXTURE))
        ],
        # The one task where this is load-bearing. Upstream's token names
        # its repositories (`github_allowed_repos`), so the fork's server
        # refuses `create_repository` outright, while the mirage arm could
        # POST /user/repos and reach a passing grade without ever forking:
        # the grader checks content, not provenance, so creating
        # LJT-Homepage and writing two files skips the whole `/template`
        # survey that dominates both measured draws. Forking and renaming
        # stay open -- the constraint is on creating from nothing, which is
        # the path this task is built around not taking.
        create_repos=False)
    github.reset(args.url, NAME, note=TEMPLATE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
