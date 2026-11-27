#!/usr/bin/env python
import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
FIXTURE = HERE / "fixtures"
ARCHIVE = "Toolathlon-Archive"
LOGIN = "integ-user"
REPOS = {
    "My-Homepage": "master",
    "optimizing-llms-contextual-reasoning": "main",
    "llm-adaptive-learning": "main",
    "ipsum-lorem-all-you-need": "main",
    "enhancing-llms": "main",
}
NAME = HERE.parent.name
DEFAULT_URL = "http://127.0.0.1:19801"

sys.path.insert(0, str(REPO / "server" / "fakes"))

import github  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",
                        default=os.environ.get("GITHUB_URL", DEFAULT_URL))
    args = parser.parse_args()
    for name in REPOS:
        if not (FIXTURE / name).is_dir():
            sys.exit(f"no fixture for {name} under {FIXTURE}; "
                     f"see shared/build_fixture.py")
    rows = []
    for name, branch in REPOS.items():
        # Staged once and named by both owners: the two rows are the same
        # tree under two logins, which is what the archive and the user's
        # own copy are.
        source = github.stage(f"{NAME}-{name}", FIXTURE / name)
        rows += [
            github.repo(f"{owner}/{name}", branch=branch, source_dir=source)
            for owner in (ARCHIVE, LOGIN)
        ]
    github.write(
        NAME,
        rows,
        # Upstream's token names its repositories (`github_allowed_repos`),
        # and the fork's server disables repository creation outright
        # whenever it does ("repository creation is disabled when
        # GITHUB_ALLOWED_REPOS is configured"). The MCP arm therefore
        # cannot create one and the mirage arm could, so the fake is told
        # to refuse it too. The refusal has to live here rather than in
        # `gh`: `curl` and `wget` are unconditional builtins with no host
        # allowlist, and `gh api /` hands out the base URL, so a CLI-layer
        # guard reads as a refusal in the transcript while the capability
        # remains.
        create_repos=False)
    github.reset(args.url,
                 NAME,
                 note=f"{len(REPOS)} repositories under two owners")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
