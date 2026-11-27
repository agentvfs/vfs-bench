#!/usr/bin/env python
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEST = HERE / "fixtures" / "repos.json"
# The queries an agent plausibly runs, from the paper's title. Their union is
# the fixture, so the answer does not depend on which phrasing it picks.
QUERIES = [
    "Mixture-of-Depths",
    "Mixture-of-Depths implementation",
    "Mixture-of-Depths pytorch",
    "Mixture-of-Depths transformer",
    "dynamically allocating compute transformer",
]
KEEP = ("full_name", "description", "stargazers_count", "forks_count",
        "language", "html_url", "created_at", "updated_at", "topics",
        "default_branch", "archived", "fork", "open_issues_count")


def search(query: str) -> list[dict]:
    """One search page, most-starred first.

    Args:
        query (str): the search terms.

    Returns:
        list[dict]: the matching repositories.
    """
    params = urllib.parse.urlencode({
        "q": query,
        "sort": "stars",
        "order": "desc",
        "per_page": "30",
    })
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"https://api.github.com/search/repositories?{params}",
        headers=headers)
    with urllib.request.urlopen(request, timeout=30) as reply:
        return json.load(reply).get("items", [])


def main() -> int:
    found: dict[str, dict] = {}
    for i, query in enumerate(QUERIES):
        if i:
            time.sleep(6)
        for item in search(query):
            entry = {k: item.get(k) for k in KEEP}
            found[str(item["full_name"])] = entry
        print(f"{query!r}: {len(found)} repositories so far")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    ordered = dict(
        sorted(found.items(),
               key=lambda kv: -int(kv[1]["stargazers_count"] or 0)))
    DEST.write_text(json.dumps(ordered, indent=2, sort_keys=False) + "\n")
    print(f"{len(ordered)} repositories -> {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
