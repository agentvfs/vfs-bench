#!/usr/bin/env python
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SUB = REPO_ROOT / "submodule" / "Toolathlon"
UPSTREAM = ("tasks/finalpool/nhl-b2b-analysis/groundtruth_workspace/"
            "standard_answer.csv")
GT = HERE / "gt.csv"


def upstream() -> bytes:
    """Upstream's answer sheet, read from the pinned commit.

    Returns:
        bytes: the file, with any UTF-8 BOM removed. `csv.DictReader` keeps
            the BOM in the first field name, so `Team` arrives as
            `﻿Team` and every row lookup misses.

    Raises:
        SystemExit: upstream has no such file.
    """
    found = subprocess.run(
        ["git", "-C", str(SUB), "show", f"HEAD:{UPSTREAM}"],
        capture_output=True,
        check=False)
    if found.returncode != 0:
        raise SystemExit(f"derive_gt: upstream has no {UPSTREAM}")
    return found.stdout.removeprefix(b"\xef\xbb\xbf")


def main() -> int:
    """Copy upstream's answer sheet, or check ours still matches it.

    Args:
        argv[1:]: `--check` compares without writing.

    Returns:
        int: 0, or 1 if `--check` found a difference.
    """
    want = upstream()
    if "--check" in sys.argv[1:]:
        if GT.is_file() and GT.read_bytes() == want:
            print(f"gt.csv matches upstream ({len(want)} bytes)")
            return 0
        print("gt.csv has drifted from upstream", file=sys.stderr)
        return 1
    GT.write_bytes(want)
    print(f"gt.csv: {len(want)} bytes from upstream")
    return 0


if __name__ == "__main__":
    sys.exit(main())
