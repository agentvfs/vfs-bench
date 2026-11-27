"""Reproduce the captured fixture without following moving branches."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "script"))
from git_fixture import reproduce  # noqa: E402

BINARY = {
    '.png', '.ico', '.gif', '.woff2', '.otf', '.woff', '.eot', '.parquet',
    '.jpg', '.jpeg', '.pdf', '.ttf', '.ipynb'
}


def main():
    return reproduce(HERE, BINARY, skip={'.DS_Store'})


if __name__ == "__main__":
    raise SystemExit(main())
