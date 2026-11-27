"""Build uploadable Hugging Face dataset folders from the published VFS-Bench 1 tasks."""

import argparse
import contextlib
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
REVISION = "3f45f90f620c8096dd85bbe854b757eae1231392"
SUITES = {"toolathlon": "Toolathlon", "mcpatlas": "MCP-Atlas"}


@contextlib.contextmanager
def source_tree(suite):
    """Read exactly the release revision, including binaries, independent of worktree state."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        archive = root / "v1.tar"
        subprocess.run(
            ["git", "-C", str(REPO), "archive", "-o", str(archive), REVISION,
             "LICENSE", f"vfs-bench-1/task/{suite}"],
            check=True,
        )
        with tarfile.open(archive) as tar:
            tar.extractall(root, filter="data")
        yield root


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)


def render(suite, root):
    spec = importlib.util.spec_from_file_location(f"{suite}_export", HERE / suite / "export.py")
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    files = {}

    def add_asset(data, *, target, role):
        digest = hashlib.sha256(data).hexdigest()
        path = f"assets/sha256/{digest}"
        files[path] = data
        return {"path": path, "sha256": digest, "size": len(data), "target": target, "role": role}

    rows = []
    for row, manifest in adapter.export(root, add_asset):
        task = row["id"]
        if not re.fullmatch("[a-z0-9][a-z0-9-]*", task):
            raise ValueError(f"Invalid {suite} task ID: {task!r}")
        path = f"tasks/{task}/manifest.json"
        if path in files:
            raise ValueError(f"Duplicate {suite} task: {task}")
        targets = set()
        for asset in [*manifest["assets"], *manifest.get("source_assets", ())]:
            target = asset["target"]
            if (not target or any(part in ("", ".", "..") for part in target.split("/"))
                    or "\\" in target or target in targets):
                raise ValueError(f"{suite}/{task}: invalid or duplicate target {target!r}")
            targets.add(target)
        rows.append({**row, "manifest": path})
        files[path] = (json.dumps(
            {**manifest, "schema_version": 1, "dataset": suite, "id": task},
            indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False,
        ) + "\n").encode()

    if len(rows) != 100:
        raise ValueError(f"The published {suite} release has 100 tasks, found {len(rows)}")
    rows.sort(key=lambda row: row["id"])
    files["index.jsonl"] = "".join(encode(row) + "\n" for row in rows).encode()
    files[".gitattributes"] = b"/assets/sha256/* binary\nindex.jsonl text eol=lf\n"
    files["LICENSE.vfs-bench"] = (root / "LICENSE").read_bytes()
    card = f"""---
license: {adapter.LICENSE}
configs:
- config_name: default
  data_files:
  - split: test
    path: index.jsonl
---

# VFS-Bench 1.0 · {SUITES[suite]}

These are the 100 {SUITES[suite]} tasks selected for VFS-Bench 1.0, packaged for the VFS-Bench 2 dataset reader. Each row points to its task manifest. A bundled asset is stored at `assets/sha256/<digest>` and records its role and original target path. Some inputs are resolved from pinned upstream sources.

{adapter.CARD.strip()}

## Read the release

```python
from pathlib import Path

from datasets import load_dataset
from vfsbench.dataset import Dataset

release = Path.cwd()
catalog = load_dataset(str(release), split="test")
suite = Dataset(release)
task = suite[catalog[0]["id"]]
print(task.instruction)
```

From an uploaded repository use `Dataset.from_hub(repo_id, revision=commit_sha)`. The manifests describe the original environment and evaluator dependencies. Use `vfsbench status <release-folder>` to inspect execution support in the installed package. Mirage Python and Harbor use the same trial and verifier lifecycle.

[VFS-Bench source release](https://github.com/agentvfs/vfs-bench/tree/{REVISION}/vfs-bench-1/task/{suite}).
"""
    files["README.md"] = card.encode()
    return files


def sync(suite, out, *, check):
    with source_tree(suite) as root:
        files = render(suite, root)
    # Reject stragglers in the upload tree. Leave Git metadata and HF client's
    # local upload records alone so this can also check a cloned dataset repo.
    present = {p.relative_to(out).as_posix() for p in out.rglob("*")
               if p.is_file() and not {".git", ".cache"}.intersection(p.relative_to(out).parts)
               and p.name != ".DS_Store"}
    stale = present.difference(files)
    for name in sorted(stale):
        path = out / name
        if (not re.fullmatch(r"assets/sha256/[0-9a-f]{64}", name) or path.is_symlink()
                or hashlib.sha256(path.read_bytes()).hexdigest() != path.name):
            raise SystemExit(f"{out} contains a file outside the managed release: {name}")
    changed = []
    for name, data in files.items():
        path = out / name
        if path.is_file() and path.read_bytes() == data:
            continue
        changed.append(name)
        if not check:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                stream.write(data)
            staged = Path(stream.name)
            staged.chmod(0o644)
            staged.replace(path)
    if check and (changed or stale):
        raise SystemExit(f"{out}: {len(changed)} missing or changed files, {len(stale)} obsolete assets")
    for name in stale:
        (out / name).unlink()
    count = sum(name.startswith("assets/") for name in files)
    print(f"{suite}: 100 tasks, {count} distinct bundled assets")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite", nargs="?", choices=SUITES, help="defaults to both suites")
    parser.add_argument("--output", type=Path, default=HERE.parent / "huggingface",
                        help="parent directory for the two upload folders")
    parser.add_argument("--check", action="store_true", help="check without modifying files")
    args = parser.parse_args()
    for suite in [args.suite] if args.suite else SUITES:
        sync(suite, args.output / suite, check=args.check)


if __name__ == "__main__":
    main()
