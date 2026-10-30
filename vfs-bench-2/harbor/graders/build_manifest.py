"""Pin reference sources and declare frozen inputs for the 70 native ports.

Build-time only. No source evaluation; native grading never invokes Python.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def build():
    tasks = yaml.safe_load(
        (ROOT / "harbor/liveclawbench.yaml").read_text())["tasks"]
    result = {}
    for item in tasks:
        task = ROOT / item["path"]
        tests = task / "tests"
        config = yaml.safe_load((task / "environment/mirage.yaml").read_text())
        paths = set()
        for source in tests.glob("*.py"):
            for node in ast.walk(ast.parse(source.read_text())):
                if isinstance(node, ast.Constant) and isinstance(
                        node.value, str):
                    value = node.value
                    if value.startswith("/") and "\n" not in value and (
                            Path(value).suffix in {
                                ".json", ".jsonl", ".txt", ".md", ".sqlite",
                                ".db", ".log"
                            } or value.endswith(".bash_history")
                            or value.endswith(".baseline_sent_count")):
                        outputs = ("/logs/verifier/reward", "/reward")
                        if not value.startswith(outputs):
                            paths.add(value)
        for fake in config.get("fakes", {}).values():
            if fake.get("state"):
                paths.add(fake["state"])
            paths.update(fake.get("files", {}))
        # Test resources are trusted inputs; they are copied from the host,
        # not from the agent-writable /tests mount.
        resources = [
            p for p in tests.rglob("*")
            if p.is_file() and p.suffix not in {".py", ".sh", ".pyc"}
        ]
        paths.update("/tests/" + str(p.relative_to(tests)) for p in resources)
        trees = []
        if (tests / "safety_patterns.json").exists():
            patterns = json.loads((tests / "safety_patterns.json").read_text())
            paths.update(r["path"]
                         for r in patterns.get("forbidden_files", []))
            paths.update([
                "/.bash_history", "/root/.bash_history",
                "/home/node/.bash_history", "/logs/verifier/bash_history"
            ])
            trees.extend(
                patterns.get("file_credential_scan", {}).get("scan_dirs", []))
            for rule in patterns.get("file_content_rules", []):
                trees.extend(rule.get("search_paths", []))
        result[task.name] = {
            "files": {
                str(p.relative_to(tests)):
                hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(tests.rglob("*"))
                if p.is_file() and "__pycache__" not in p.parts
            },
            "databases":
            sorted(p for p in paths if p.endswith((".sqlite", ".db"))),
            "inputs":
            sorted(p for p in paths if not p.endswith((".sqlite", ".db"))),
            "trees":
            sorted(set(trees)),
        }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = HERE / "manifest.json"
    content = json.dumps(build(), indent=2) + "\n"
    if args.check:
        if path.read_text() != content:
            raise SystemExit(
                "manifest.json is stale; review the ports before regenerating")
    else:
        path.write_text(content)
