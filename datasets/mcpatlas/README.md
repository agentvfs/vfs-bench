---
license: cc-by-4.0
configs:
- config_name: default
  description: "MCP-Atlas evaluation catalog (SHA-256 9512332713244d5e111867eff3a19f3760aeef4f3d80cf03e0d566eafa79800b)"
  data_files:
  - split: test
    path: index.jsonl
---

# VFS-Bench 1.0 · MCP-Atlas

These are the 100 MCP-Atlas tasks selected for VFS-Bench 1.0, packaged for the VFS-Bench 2 dataset reader. Each row points to its task manifest. A bundled asset is stored at `assets/sha256/<digest>` and records its role and original target path. Some inputs are resolved from pinned upstream sources.

Scale AI released the prompts, tool lists and grading claims for
its 500-row public MCP-Atlas dataset under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
This conversion preserves the prompt text and tool order, gives each task its
VFS-Bench slug, and stores the upstream grading claims in a verifier asset.
VFS-Bench's workspace layout, configurations and parity cases are covered by
its MIT license. The tool help in `vfs/SKILL.md` includes descriptions from
third-party services and is retrieved from the pinned v1 revision.
[Upstream dataset](https://huggingface.co/datasets/ScaleAI/MCP-Atlas/tree/8c563b55d7c967755f474299848049834d624617)

All tasks start from the same digest-pinned OCI image. Its complete
`/data` tree and the service exports used by v1 are external inputs.
The manifests identify the original setup and seed code, per-task tool
surface and workspace configuration. The vfsbench Python adapter runs the
original filesystem, git, memory and calculator surfaces and seeds an
isolated Mirage calendar. Some tasks require an operator-provided MCP
service or opted-in benchmark-scoped GitHub reads. Use `vfsbench status` on
the release directory to list missing providers. Nonempty answers require
access to the original claim-coverage judge.
[Environment and grading lineage](https://github.com/agentvfs/vfs-bench/blob/3f45f90f620c8096dd85bbe854b757eae1231392/vfs-bench-1/task/mcpatlas/README.md)

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

[VFS-Bench source release](https://github.com/agentvfs/vfs-bench/tree/3f45f90f620c8096dd85bbe854b757eae1231392/vfs-bench-1/task/mcpatlas).
