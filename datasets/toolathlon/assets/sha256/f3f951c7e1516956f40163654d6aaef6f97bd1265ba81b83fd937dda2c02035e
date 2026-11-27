#!/usr/bin/env python
import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FIXTURE = HERE / "fixtures"
# Upstream pushes the mirror into the caller's own account, and the grader
# reads back `{login}/LUFFY` on `dev`, so the repository is the fake's login
# rather than the archive owner.
TEMPLATE = "integ-user/LUFFY"
BRANCH = "main"
NAME = HERE.parent.name
DEFAULT_URL = "http://127.0.0.1:19801"

sys.path.insert(0, str(REPO / "server" / "fakes"))

import github  # noqa: E402


def tree_of(root: Path) -> dict[str, bytes]:
    """One fixture directory, as the files a commit carries.

    Args:
        root (Path): the directory to read.

    Returns:
        dict[str, bytes]: repository-relative path to content.
    """
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",
                        default=os.environ.get("GITHUB_URL", DEFAULT_URL))
    args = parser.parse_args()
    for branch in ("main", "dev"):
        if not (FIXTURE / branch).is_dir():
            sys.exit(f"no {branch} fixture under {FIXTURE}; "
                     f"see shared/build_fixture.py")

    # A repo row names one tree and one branch to load it into, so `main`
    # comes from the fixture and `dev` is made afterwards over the git data
    # API -- the same two calls a client would make.
    github.write(NAME, [
        github.repo(TEMPLATE,
                    branch=BRANCH,
                    source_dir=github.stage(f"{NAME}-main", FIXTURE / "main"))
    ])
    github.reset(args.url, NAME, note=TEMPLATE)

    github.branch(args.url, TEMPLATE, "dev", BRANCH)
    # `replace`, because the fake this ports from seeded a named branch into
    # an EMPTY tree: `dev` holds what fixtures/dev holds, not that plus
    # main's. Adding to main's tree would put files on the branch that the
    # task never had there.
    github.commit(args.url,
                  TEMPLATE,
                  "dev",
                  tree_of(FIXTURE / "dev"),
                  "Seed dev",
                  replace=True)
    print(f"github: dev branch seeded from {FIXTURE / 'dev'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
