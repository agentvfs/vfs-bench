"""Build the ComplexMCP Hub release from its pinned source data."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import yaml

ROOT = Path(__file__).resolve().parents[3]
PORT = ROOT / "vfs-bench-2/datasets/complexmcp"
RELEASE = ROOT / "datasets/complexmcp"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True) +
            "\n").encode()


def export(source, check):
    pins = json.loads((PORT / "graders/manifest.json").read_bytes())
    revision = pins["upstream_commit"]

    # Read the pinned Git objects, independent of the source working tree.
    def blob(path):
        return subprocess.check_output(
            ["git", "-C", source, "show", f"{revision}:{path}"])

    rows = pq.read_table(pa.BufferReader(
        blob("benchmark/data/data.parquet"))).to_pylist()
    corpus_paths = subprocess.check_output([
        "git", "-C", source, "ls-tree", "-r", "--name-only", revision,
        "software"
    ],
                                           text=True).splitlines()
    files = {}

    def asset(target, data, role):
        digest = sha(data)
        path = f"assets/sha256/{digest}"
        files[path] = data
        return dict(target=target,
                    role=role,
                    path=path,
                    sha256=digest,
                    size=len(data))

    corpora = {
        p: asset(p, blob(p), "corpus")
        for p in corpus_paths if "/corpus/" in p and p.endswith(".yaml")
    }
    catalog = []
    if sorted(v["row"]
              for v in pins["tasks"].values()) != list(range(len(rows))):
        raise ValueError("Pinned rows differ from the source parquet")
    for slug, pin in pins["tasks"].items():
        index = pin["row"]
        row = rows[index]
        record = dict(index=index,
                      seed=int(row["seed"]),
                      level=int(row["level"]),
                      query=row["query"],
                      **{
                          key: json.loads(row[key])
                          for key in ("apps", "gt_env", "tool_cnt")
                      })
        if sha(json.dumps(record,
                          sort_keys=True).encode()) != pin["row_sha256"]:
            raise ValueError(f"Upstream row differs for {slug}")
        folder = PORT / slug
        prompt, guide = (folder / "harbor/instruction.md").read_text().split(
            "\n\n## Tools\n", 1)
        workspace = yaml.safe_load(
            (folder / "workspace/workspace.yaml").read_bytes())
        epoch = workspace["fakes"]["complexmcp_system"]["epoch"]
        assets = [
            asset("workspace/tools.json",
                  (folder / "workspace/tools.json").read_bytes(), "tools"),
            asset("workspace/instructions.md", ("## Tools\n" + guide).encode(),
                  "instructions"),
            asset("verifier/expected.json", encode(record["gt_env"]),
                  "expected"),
            *(binding for path, binding in corpora.items()
              if path.split("/")[1] in pin["apps"]),
        ]
        manifest = f"tasks/{slug}/manifest.json"
        files[manifest] = (json.dumps(dict(schema_version=1,
                                           dataset="complexmcp",
                                           id=slug,
                                           seed=record["seed"],
                                           system_time=epoch,
                                           apps=pin["apps"],
                                           assets=assets,
                                           upstream_revision=revision,
                                           row_sha256=pin["row_sha256"]),
                                      indent=2) + "\n").encode()
        catalog.append(
            encode(
                dict(id=slug,
                     upstream_id=str(index),
                     manifest=manifest,
                     instruction=prompt,
                     level=record["level"])))
    files["index.jsonl"] = b"".join(catalog)
    files["LICENSE"] = blob("LICENSE")
    existing = {
        p.relative_to(RELEASE).as_posix()
        for folder in ["tasks", "assets"]
        for p in (RELEASE / folder).rglob("*") if p.is_file()
    }
    if extra := existing - files.keys():
        raise ValueError(f"Unexpected generated files: {sorted(extra)}")
    for path, data in files.items():
        dest = RELEASE / path
        if check:
            if not dest.exists() or dest.read_bytes() != data:
                raise ValueError(f"Release differs at {dest}")
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
    print(f"{len(rows)} tasks at {revision}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",
                        required=True,
                        type=Path,
                        help="upstream complex-mcp checkout")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    export(args.source, args.check)
