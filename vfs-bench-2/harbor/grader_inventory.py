"""Count migration coverage from the seven job configs, not directory names.

    uv run --project harbor python -I harbor/grader_inventory.py
"""
import json
from pathlib import Path

import yaml
from vfsbench_harbor.claweval_verifier import definitions as claweval
from vfsbench_harbor.enterpriseops_verifier import definitions as enterpriseops
from vfsbench_harbor.environment import ROOT
from vfsbench_harbor.parity import REFERENCE_BACKENDS


def inventory(root: Path = ROOT) -> dict:
    manifest = json.loads((root / "harbor/graders/manifest.json").read_text())
    complexmcp = json.loads(
        (root /
         "harbor/graders/complexmcp/manifest.json").read_text())["tasks"]
    dataspace = json.loads(
        (root / "harbor/graders/dataspace/manifest.json").read_text())["tasks"]
    automationbench = json.loads(
        (root /
         "harbor/graders/automationbench/manifest.json").read_text())["tasks"]
    datasets = {}
    seen = set()
    for dataset, backend in REFERENCE_BACKENDS.items():
        config = yaml.safe_load(
            (root / "harbor" / f"{dataset}.yaml").read_text())
        tasks = config["tasks"]
        native = []
        compatibility = []
        for item in tasks:
            task = root / item["path"]
            if not task.is_dir():
                raise FileNotFoundError(task)
            identity = task.resolve()
            if identity in seen:
                raise ValueError(f"Task appears more than once: {task}")
            seen.add(identity)
            ported = ((dataset == "liveclawbench" and task.name in manifest)
                      or (dataset == "complexmcp" and task.name in complexmcp)
                      or (dataset == "dataspace" and task.name in dataspace)
                      or (dataset == "automationbench"
                          and task.name in automationbench)
                      or (dataset == "enterpriseops"
                          and task.name in enterpriseops()))
            if ported:
                native.append(task.name)
            elif dataset == "claweval" and task.name in claweval():
                compatibility.append(task.name)
        datasets[dataset] = {
            "tasks": len(tasks),
            "reference_backend": backend,
            "native_candidates": native,
            "compatibility_candidates": compatibility,
            "unported": len(tasks) - len(native) - len(compatibility),
        }
    return {
        "total":
        len(seen),
        "native_candidates":
        sum(len(d["native_candidates"]) for d in datasets.values()),
        "compatibility_candidates":
        sum(len(d["compatibility_candidates"]) for d in datasets.values()),
        "datasets":
        datasets
    }


if __name__ == "__main__":
    print(json.dumps(inventory(), indent=2))
