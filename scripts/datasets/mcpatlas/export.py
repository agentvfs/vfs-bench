import hashlib
import json
import runpy
from pathlib import Path

V1 = "3f45f90f620c8096dd85bbe854b757eae1231392"
ATLAS = "f24ba3fb0bfa484c86acb28431fad6d7282455f9"
MIRAGE = "ccfaa92485fe0bcbbdf5ff393b6e7e5ab1388f53"
DATA = "8c563b55d7c967755f474299848049834d624617"

LICENSE = "cc-by-4.0"
CC_BY = "https://creativecommons.org/licenses/by/4.0/"
HUB = "https://huggingface.co/datasets"
ATLAS_DATASET = f"{HUB}/ScaleAI/MCP-Atlas/tree/{DATA}"
TASK_README = (f"https://github.com/agentvfs/vfs-bench/blob/{V1}/"
               "vfs-bench-1/task/mcpatlas/README.md")
CARD = f"""Scale AI released the prompts, tool lists and grading claims for
its 500-row public MCP-Atlas dataset under [CC BY 4.0]({CC_BY}).
This conversion preserves the prompt text and tool order, gives each task its
VFS-Bench slug, and stores the upstream grading claims in a verifier asset.
VFS-Bench's workspace layout, configurations and parity cases are covered by
its MIT license. The tool help in `vfs/SKILL.md` includes descriptions from
third-party services and is retrieved from the pinned v1 revision.
[Upstream dataset]({ATLAS_DATASET})

All tasks start from the same digest-pinned OCI image. Its complete
`/data` tree and the service exports used by v1 are external inputs.
The manifests identify the original setup and seed code, per-task tool
surface and workspace configuration. The vfsbench Python adapter runs the
original filesystem, git, memory and calculator surfaces and seeds an
isolated Mirage calendar. Some tasks require an operator-provided MCP
service or opted-in benchmark-scoped GitHub reads. Use `vfsbench status` on
the release directory to list missing providers. Nonempty answers require
access to the original claim-coverage judge.
[Environment and grading lineage]({TASK_README})
"""


def export(repo: Path, add_asset):
    suite = repo / "vfs-bench-1/task/mcpatlas"
    # Read the v1 task inventory, image and tool naming rules at the export
    # pin.
    # Its service processes start only when the v1 harness opens a trial.
    v1 = runpy.run_path(str(suite / "__init__.py"))
    for task in v1["tasks"]():
        root = suite / task
        spec = json.loads((root / "task.json").read_bytes())
        original = v1["declaration"](task)
        if (spec["id"] != f"mcpatlas_{task}"
                or original["task"] != spec["atlas_task"]
                or original["dataset"] != f"ScaleAI/MCP-Atlas@{DATA}"):
            raise ValueError(f"Inconsistent MCP-Atlas provenance for {task}")

        row = {
            "id": task,
            "upstream_id": original["task"],
            "instruction":
            (root / "shared/task.md").read_bytes().decode("utf-8"),
        }
        assets = [
            add_asset((root / "vfs" / name).read_bytes(),
                      target=f"vfs/{name}",
                      role=role)
            for name, role in (("VFS.md", "workspace"), ("workspace.yaml",
                                                         "workspace_config"))
        ]
        skill = root / "vfs/SKILL.md"
        skill_path = skill.relative_to(repo).as_posix()
        skill_data = skill.read_bytes()
        assets.append(
            add_asset((root / "tests/parity.json").read_bytes(),
                      target="tests/parity.json",
                      role="parity"))
        claims = json.dumps(original["claims"], ensure_ascii=False,
                            indent=2) + "\n"
        assets.append(
            add_asset(claims.encode("utf-8"),
                      target="verifier/claims.json",
                      role="verifier"))
        yield row, {
            "assets":
            assets,
            "source_assets": [{
                "role":
                "workspace",
                "target":
                "vfs/SKILL.md",
                "path":
                skill_path,
                "url":
                f"https://raw.githubusercontent.com/agentvfs/vfs-bench/{V1}/"
                f"{skill_path}",
                "size":
                len(skill_data),
                "sha256":
                hashlib.sha256(skill_data).hexdigest(),
            }],
            "enabled_tools":
            original["enabled_tools"],
            "servers":
            v1["needed_mcp_servers"](task),
            "sources": {
                "row": {
                    "repo_id": "ScaleAI/MCP-Atlas",
                    "revision": DATA,
                    "file": "MCP-Atlas.parquet",
                    "TASK": original["task"]
                },
                "environment": {
                    "image": v1["IMAGE"],
                    "path": "/data"
                },
                "atlas": {
                    "repo": "https://github.com/scaleapi/mcp-atlas",
                    "revision": ATLAS,
                    "exports": "data_exports",
                    "server_config": v1["TEMPLATE"]
                },
                "mirage": {
                    "repo": "https://github.com/strukto-ai/mirage",
                    "revision": MIRAGE
                },
                "vfs_bench": {
                    "repo": "https://github.com/agentvfs/vfs-bench",
                    "revision": V1,
                    "path": f"vfs-bench-1/task/mcpatlas/{task}",
                    "setup": "vfs-bench-1/server/mcp/setup_mcpatlas.py",
                    "seed": "vfs-bench-1/task/mcpatlas/script/seed_task.py",
                    "service_seeds":
                    "vfs-bench-1/server/seed/atlas_exports.py",
                    "services": "vfs-bench-1/task/mcpatlas/__init__.py"
                },
            },
            "grader": {
                "id": "mcpatlas.claim-coverage",
                "input": "final_answer",
                "claims": "verifier/claims.json",
                "scorer": "services/scoring/score_claims.py",
                "scorer_source": "atlas",
                "adapter": "vfs-bench-1/task/mcpatlas/script/grade_task.py",
                "adapter_source": "vfs_bench",
                "judge": "google/gemini-3.1-pro-preview",
                "pass_threshold": 0.75,
            },
        }
