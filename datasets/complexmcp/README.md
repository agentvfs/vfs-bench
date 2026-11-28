---
license: mit
configs:
- config_name: default
  data_files:
  - split: test
    path: index.jsonl
---

# ComplexMCP for vfsbench

All 47 ComplexMCP evaluation tasks are available in the test split. Each row includes its VFS-Bench task ID, the zero-based upstream parquet row, its instruction, difficulty level and a path to its manifest. The manifest records the original seed, app login order, row digest and the assets needed for execution. Shared service corpora and tool definitions are stored once by SHA-256. [Upstream release](https://github.com/ATH-MaaS/complex-mcp/tree/7c01f92e38be6e0c193d5c6c9a55baa92fb628cb)

```python
from datasets import load_dataset
from vfsbench import ComplexMCP

catalog = load_dataset("./datasets/complexmcp", split="test")
suite = ComplexMCP("./datasets/complexmcp")
task = suite["good-morning-paisley"]
print(task.instruction)
```

Each task manifest fixes the seed, clock, apps, tool definitions, corpus and Python runtime. The current release uses Mirage's in-process Monty interpreter. Older manifests without `python_runtime` use CPython in microsandbox. An operator can select a custom guest snapshot or request guest packages for a CPython run.

Each trial starts a private world with a shared simulated clock for its Light apps. The agent can use the service CLIs in Mirage. The verifier compares the initial and final service state against the upstream expected state. It awards one point when every required change is present and there are zero unintended changes.

The current release uses Mirage's MCP-to-CLI syntax inside the shell. For example, `light-talk get-uid-from-name '{"name":"Paisley"}'` passes one JSON object. Use `light-talk get-uid-from-name --help` to see its schema. Older releases without `cli_format` retain their named flags.

```sh
vfsbench run complexmcp --task good-morning-paisley shell -c 'light-system now'
vfsbench harbor export complexmcp --output job --task good-morning-paisley
```

Upload this folder as a Hugging Face dataset repository. After publication, use `ComplexMCP.from_hub("YOUR_ORG/REPO", revision=commit)` for lazy remote reads.
