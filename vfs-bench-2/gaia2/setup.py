"""Fetch Gaia2's scenarios and file tree at pinned revisions.

    uv run --project gaia2 python -I gaia2/setup.py

Downloads the ``meta-agents-research-environments/gaia2`` splits (CC BY 4.0)
and exports each scenario to ``state/gaia2/scenarios/<split>/<id>.json``,
and downloads ``meta-agents-research-environments/gaia2_filesystem``
(CC BY 4.0), the files the scenarios' Files app points at, to
``state/gaia2/filesystem``, where ``gaia2-init`` copies them from. Also
fetches gaia2-cli's agent prompt template, ``AGENTS_TEMPLATE.md``, at the
commit ``pyproject.toml`` pins.
"""
import json
import shutil
import urllib.request
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "state" / "gaia2"
HF = "https://huggingface.co"
SCENARIOS = ("meta-agents-research-environments/gaia2",
             "78ea3bdbdeec2bdcd6afa5420915d8a22f23ed99")
FILESYSTEM = ("meta-agents-research-environments/gaia2_filesystem",
              "132e26376f5e963bb59f64bcccdd02188cb08dee")
SPLITS = ("search", "execution")
TEMPLATE = ("https://raw.githubusercontent.com/facebookresearch/"
            "meta-agents-research-environments/"
            "a9fd2edccb4bc7e22fbf45c8482a5fef30a2a5a4/"
            "gaia2-cli/shared/AGENTS_TEMPLATE.md")


def fetch(url: str, dest: Path) -> None:
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url) as reply, open(tmp, "wb") as out:
        shutil.copyfileobj(reply, out)
    tmp.rename(dest)


def resolve(repo: str, rev: str, path: str) -> str:
    return f"{HF}/datasets/{repo}/resolve/{rev}/{path}"


def main() -> int:
    repo, rev = SCENARIOS
    for split in SPLITS:
        parquet = STATE / "raw" / f"{split}.parquet"
        fetch(resolve(repo, rev, f"{split}/validation-00000-of-00001.parquet"),
              parquet)
        out = STATE / "scenarios" / split
        out.mkdir(parents=True, exist_ok=True)
        rows = pq.read_table(parquet).to_pylist()
        for row in rows:
            (out / f"{row['id']}.json").write_text(row["data"])
        print(f"{split}: {len(rows)} scenarios")

    repo, rev = FILESYSTEM
    with urllib.request.urlopen(
            f"{HF}/api/datasets/{repo}/tree/{rev}?recursive=true") as reply:
        tree = json.load(reply)
    files = [
        e["path"] for e in tree
        if e["type"] == "file" and e["path"].startswith("demo_filesystem/")
    ]
    for path in files:
        fetch(resolve(repo, rev, path), STATE / "filesystem" / path)
    print(f"filesystem: {len(files)} files")
    fetch(TEMPLATE, STATE / "AGENTS_TEMPLATE.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
