"""Pin each Claw-Eval task's grader definition: the upstream sources its
port is built from (build.py checks them before vendoring), the files and
audits its inputs are, and whether it uses gws.

Run after datasets/claweval/fetch.py. --check detects drift without
updating pins.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent
UPSTREAM = DATASET.parents[1] / "state/claweval/src"
MANIFEST = HERE / "manifest.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    shared = ["src/claw_eval/__init__.py"]
    shared += [
        p.relative_to(UPSTREAM).as_posix()
        for p in sorted((UPSTREAM / "src/claw_eval/models").glob("*.py"))
    ]
    shared += [
        f"src/claw_eval/graders/{name}.py"
        for name in ("__init__", "base", "registry", "llm_judge",
                     "officeqa_reward", "pinbench_common")
    ]
    tasks = {}
    config = yaml.safe_load((DATASET / "jobs" / "harbor.yaml").read_text())
    for item in config["tasks"]:
        task = Path(item["path"]).parent.name
        sources = {name: digest(UPSTREAM / name) for name in shared}
        pending = [task]
        while pending:
            peer = pending.pop()
            grader = f"tasks/{peer}/grader.py"
            if grader in sources:
                continue
            sources[grader] = digest(UPSTREAM / grader)
            pending.extend(
                re.findall(r'load_peer_grader\(\s*"([^"]+)"',
                           (UPSTREAM / grader).read_text()))
        task_yaml = f"tasks/{task}/task.yaml"
        sources[task_yaml] = digest(UPSTREAM / task_yaml)
        definition = yaml.safe_load((UPSTREAM / task_yaml).read_text())
        tests = DATASET / task / "workspace" / "verifier"
        gws = [
            s["name"] for s in definition["services"]
            if s["name"] in ("gmail", "calendar")
        ]
        drafts = any(t["name"] == "gmail_save_draft"
                     for t in definition.get("tools", []))
        audits = {
            s["name"]: s["reset_endpoint"].removesuffix("/reset") + "/audit"
            for s in definition["services"]
            if s.get("reset_endpoint") and s["name"] != "calendar" and (
                s["name"] != "gmail" or drafts)
        }
        tasks[task] = {
            "runtime":
            "typescript",
            "sources":
            sources,
            "files": {
                p.name: digest(p)
                for p in sorted(tests.iterdir()) if p.is_file()
            } if tests.is_dir() else {},
            "audits":
            audits,
            "gws":
            gws,
            "inputs": [
                "/logs/agent/trajectory.json",
                "/var/lib/mock-data/claweval/dispatches.jsonl"
            ],
        }
    return {
        "upstream_commit": "5680b8b11ff2ee5dd2b07b89086a29a5c5c984d7",
        "tasks": tasks
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = json.dumps(build(), indent=2, sort_keys=True) + "\n"
    if args.check:
        if not MANIFEST.exists() or MANIFEST.read_text() != data:
            raise SystemExit("Claw-Eval manifest drift; regenerate it")
    else:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(data)
