# Preprocess for the mock-GWS variant of this task, installed over
# upstream's by setup/toolathlon/setup_toolathlon.py so Toolathlon's own runner can drive
# the mocks. Upstream's version (kept as main.real_google.py.bak) copies a
# real public spreadsheet out of Google Drive, which cannot work here.
#
# It is a shim and nothing more: shared/seed_mock.py is the one seeder both
# arms use, and it writes files/folder_id.txt itself, so this does not
# re-derive the id by scraping stdout.

import os
import subprocess
import sys
from argparse import ArgumentParser

MOCK_TASK = os.environ.get(
    "VFS_BENCH_TASK",
    "/Users/zecheng/strukto/toolathlon/task/toolathlon/nhl-b2b-analysis")


def main() -> None:
    parser = ArgumentParser(description="Seed the mock GWS server")
    parser.add_argument("--agent_workspace", required=False)
    parser.add_argument("--launch_time", required=False)
    parser.parse_args()

    gws_url = os.environ.get("GWS_URL", "http://127.0.0.1:19999")
    result = subprocess.run(
        [sys.executable, os.path.join(MOCK_TASK, "shared", "seed_mock.py")],
        env={**os.environ, "GWS_URL": gws_url},
        capture_output=True, text=True,
    )
    print(result.stdout, end="")
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)
    print(f"seeded mock at {gws_url}")


if __name__ == "__main__":
    main()
