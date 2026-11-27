"""Reproduce the captured fixture without following moving branches."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "script"))
from git_fixture import reproduce  # noqa: E402

BINARY = {
    '.bin', '.png', '.ico', '.so', '.gif', '.pth', '.woff2', '.woff', '.whl',
    '.parquet', '.jpg', '.pt', '.jpeg', '.pdf', '.ttf', '.ipynb'
}


def main():
    return reproduce(HERE, BINARY, skip={'.DS_Store'})


if __name__ == "__main__":
    raise SystemExit(main())
