#!/usr/bin/env python
import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
NAME = HERE.parent.name
# The repository the task asks for, which upstream's own preprocess deletes
# before every run. Nothing here creates it: the agent does, and whether it
# can is half of what the task measures.
TARGET = "MyAwesomeModel-TestRepo"
DEFAULT_URL = "http://127.0.0.1:5199"

sys.path.insert(0, str(REPO / "server" / "fakes"))

import hf  # noqa: E402


def seed(url: str) -> None:
    """Empty the task's Hub, which is the whole fixture.

    This task starts from nothing on the Hub -- upstream's preprocess is a
    `remote_cleanup` that deletes the repository if a previous run left one
    -- so what has to be true at the start is that the tenant exists and
    holds no repositories. A fixture stating no rows says exactly that, and
    resetting to it is what makes a second draw start where the first did.

    Args:
        url (str): the fake's base URL.
    """
    hf.write(NAME, [])
    hf.reset(url, NAME, note=f"empty Hub; the agent creates {TARGET}")


def verify(url: str) -> None:
    """Check the Hub really is empty for this task's tenant.

    A repository left behind by a previous draw is not a harmless leftover:
    the grader downloads `{whoami}/MyAwesomeModel-TestRepo` and compares it
    against the groundtruth, so a stale one is a pass the arm did not earn.

    Args:
        url (str): the base URL.

    Raises:
        SystemExit: something is already there.
    """
    listed = hf.call(url, "/api/models", method="GET", tenant=NAME)
    rows = listed if isinstance(listed, list) else []
    if rows:
        sys.exit(f"hf-hub still holds {[r.get('id') for r in rows]} "
                 f"for tenant {NAME}")
    print(f"verified {NAME}: no model repositories")


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
