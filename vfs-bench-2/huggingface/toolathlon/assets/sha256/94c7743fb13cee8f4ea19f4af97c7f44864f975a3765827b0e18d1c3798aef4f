#!/usr/bin/env python
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
HUB = HERE / "hub"
ENDPOINT = "https://huggingface.co"

# The project the issue is filed against, at the commit it was read at. The
# evaluator fails a run whose HEAD moved, so what the fixture holds is one
# commit and not a branch.
OWNER = "Toolathlon-Archive"
REPO = "Annoy-DataSync"
REVISION = "272cfc2f232eb47f33ca3bcfd3e4dc733952a3a0"
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf"}

# The two repositories the answer is found in, which is the whole of the
# task: the raw card credits the HuggingFaceTB team, whose corpus is
# `odc-by`; the reasoning card says the responses were synthesised with
# DeepSeek-V2.5, whose card says `license: other` and links a model licence.
# The ask wants the most permissive of the sources, so both have to be
# readable or the comparison has nothing to compare.
CARDS = [
    ("datasets", "HuggingFaceTB/smollm-corpus",
     "3ba9d605774198c5868892d7a8deda78031a781f"),
    ("models", "deepseek-ai/DeepSeek-V2.5",
     "c85b5ede86f2a598af339624cac5723861e557ed"),
]


def vendor(work: Path) -> tuple[int, int]:
    """Clone the project at its pinned commit into the fixture.

    Binary files are replaced by a placeholder, the way
    `email-paper-homepage` does it: two screenshots are 370KB that no agent
    opens, and a fixture is read far more often than it is fetched.

    Args:
        work (Path): scratch directory for the clone.

    Returns:
        tuple[int, int]: files vendored, binaries stubbed.
    """
    clone = work / REPO
    subprocess.run([
        "git", "clone", "-q", f"https://github.com/{OWNER}/{REPO}.git",
        str(clone)
    ],
                   check=True)
    subprocess.run(
        ["git", "-C", str(clone), "checkout", "-q", REVISION], check=True)
    tracked = subprocess.run(["git", "ls-files"],
                             cwd=clone,
                             capture_output=True,
                             text=True,
                             check=True).stdout.splitlines()
    out_root = FIXTURES / REPO
    if out_root.exists():
        shutil.rmtree(out_root)
    kept = stubbed = 0
    for relative in tracked:
        source = clone / relative
        if not source.is_file() or Path(relative).name == ".DS_Store":
            continue
        out = out_root / relative
        out.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower() in BINARY:
            out.write_text(f"placeholder for {relative}\n")
            stubbed += 1
        else:
            shutil.copyfile(source, out)
            kept += 1
    return kept, stubbed


def card(kind: str, repo_id: str, revision: str) -> int:
    """One source repository's card, as the Hub serves it at that commit.

    Args:
        kind (str): `datasets` or `models`, the plural the URL spells.
        repo_id (str): `namespace/name`.
        revision (str): the commit sha.

    Returns:
        int: bytes written.
    """
    prefix = "" if kind == "models" else f"/{kind}"
    url = f"{ENDPOINT}{prefix}/{repo_id}/raw/{revision}/README.md"
    with urllib.request.urlopen(url) as answer:
        text = answer.read().decode("utf-8")
    into = HUB / kind / repo_id.replace("/", "__") / "README.md"
    into.parent.mkdir(parents=True, exist_ok=True)
    into.write_text(text, encoding="utf-8")
    return len(text.encode())


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        kept, stubbed = vendor(Path(tmp))
    print(f"{OWNER}/{REPO}@{REVISION[:7]}: {kept} files, {stubbed} stubbed")
    for kind, repo_id, revision in CARDS:
        print(f"{repo_id}: README.md, {card(kind, repo_id, revision)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
