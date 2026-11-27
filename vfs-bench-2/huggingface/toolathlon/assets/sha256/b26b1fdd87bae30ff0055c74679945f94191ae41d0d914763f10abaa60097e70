#!/usr/bin/env python
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
HUB = HERE / "hub"
NAME = HERE.parent.name
LOGIN = "integ-user"
DEFAULT_URL = "http://127.0.0.1:5199"
CARD = "README.md"

# The two the ask is about, and the upstream file each card is copied from.
# Read out of the checkout rather than committed here: they are upstream's
# fixture, `dvc status` watches the pin, and a copy in this tree would be a
# second place for the same bytes to live.
OURS = [
    ("Annoy-PyEdu-Rs", "hf-reasoning"),
    ("Annoy-PyEdu-Rs-Raw", "hf-raw"),
]

# The two the answer is in. Captured from the live Hub at a pinned commit,
# because what the task turns on is a licence a real repository really
# declares: `odc-by` on the corpus, and `other` plus a link to a model
# licence on DeepSeek-V2.5. An authored card would be this repo deciding
# the answer to its own question.
SOURCES = [
    ("datasets", "HuggingFaceTB/smollm-corpus"),
    ("models", "deepseek-ai/DeepSeek-V2.5"),
]

sys.path.insert(0, str(REPO / "server" / "fakes"))
sys.path.insert(0, str(REPO / "agent"))

import dataset  # noqa: E402
import hf  # noqa: E402
from services import agent_workspace  # noqa: E402


def upstream_card(folder: str) -> str:
    """One of the two cards upstream ships, with its namespaces filled in.

    Args:
        folder (str): `hf-reasoning` or `hf-raw`, upstream's own directory.

    Returns:
        str: the card.

    Raises:
        SystemExit: the checkout has moved it.
    """
    path = dataset.task_dir(NAME) / "files" / folder / CARD
    if not path.is_file():
        sys.exit(f"no card at {path}; the checkout has moved it")
    return (path.read_text(encoding="utf-8").replace(
        "{hf_namespace}", NAME).replace("{github_namespace}", LOGIN))


def captured_card(kind: str, repo_id: str) -> Path:
    """One source repository's captured card.

    Args:
        kind (str): `datasets` or `models`.
        repo_id (str): `namespace/name`.

    Returns:
        Path: the file.

    Raises:
        SystemExit: the fixture was never built.
    """
    path = HUB / kind / repo_id.replace("/", "__") / CARD
    if not path.is_file():
        sys.exit(f"no capture at {path}; run shared/build_fixture.py")
    return path


def seed(url: str, work: Path) -> None:
    """Put all four repositories on the fake.

    Args:
        url (str): the fake's base URL.
        work (Path): scratch directory the two written cards go in.
    """
    rows = []
    for name, folder in OURS:
        written = work / folder / CARD
        written.parent.mkdir(parents=True, exist_ok=True)
        written.write_text(upstream_card(folder), encoding="utf-8")
        rows.append(
            hf.repo(f"{NAME}/{name}",
                    source_dir=hf.stage(f"{NAME}-{name}", {CARD: written})))
    for kind, repo_id in SOURCES:
        rows.append(
            hf.repo(repo_id,
                    kind=kind,
                    source_dir=hf.stage(f"{NAME}-{repo_id.replace('/', '-')}",
                                        {CARD: captured_card(kind, repo_id)})))
    hf.write(NAME, rows)
    hf.reset(url, NAME, note=f"{len(rows)} repositories")


def place_token() -> Path:
    """Write the token file the ask tells the agent to look for.

    "If you need the huggingface token, you can find it under `.hf_token`",
    and upstream's preprocess puts it there. Neither arm here needs to read
    it -- both are handed the tenant already, the MCP arm through its
    server's environment and the mirage arm through the mount's config --
    but the ask is copied byte-for-byte and an agent that goes looking for
    a file the ask names should find it rather than spend turns on its
    absence.

    Returns:
        Path: the file written.
    """
    into = agent_workspace(dataset.local(NAME))
    into.mkdir(parents=True, exist_ok=True)
    path = into / ".hf_token"
    path.write_text(NAME, encoding="utf-8")
    return path


def verify(url: str) -> None:
    """Check every repository serves the one card it was seeded with.

    Seeding reports the rows it wrote and says nothing about the blobs the
    fake expanded, so the trees are read back: a repository whose
    `sourceDir` resolved to nothing seeds cleanly and serves an empty one.

    Args:
        url (str): the base URL.

    Raises:
        SystemExit: a card is missing.
    """
    wanted = [("datasets", f"{NAME}/{name}") for name, _ in OURS] + SOURCES
    for kind, repo_id in wanted:
        tree = hf.call(url,
                       f"/api/{kind}/{repo_id}/tree/main",
                       method="GET",
                       tenant=NAME)
        listed = tree if isinstance(tree, list) else []
        paths = [entry.get("path") for entry in listed]
        if paths != [CARD]:
            sys.exit(f"{repo_id} serves {json.dumps(paths)}, not [{CARD!r}]")
        print(f"verified {kind}/{repo_id}: {CARD}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",
                        default=os.environ.get("HF_ENDPOINT", DEFAULT_URL))
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        seed(args.url, Path(tmp))
    verify(args.url)
    print(f"hf: token at {place_token()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
