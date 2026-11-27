# Dataset storage and migration

VFS-Bench v2 carries one Hugging Face release folder for each imported suite. Toolathlon contains the reviewed, fully local subset of the 100 v1 tasks. MCP-Atlas preserves its 100-row catalog. The Python package is named `vfsbench`. Its public API, install instructions and Harbor job example are in the [package guide](PACKAGE.md).

## Release layout

```text
huggingface/<suite>/
    README.md
    index.jsonl
    tasks/<task-id>/manifest.json
    assets/sha256/<digest>
```

Each folder is the root of a separate Hub dataset repository. The dataset card selects `index.jsonl` as the evaluation split. Listing a suite loads only this index. The manifest identifies the prompt, assets, upstream sources and grader for an individual task. Repeated assets share a digest. Sources that must be retrieved separately have pinned references. A Hub reader resolves a release revision to a commit and uses it for subsequent reads. [Toolathlon](huggingface/toolathlon/README.md) · [MCP-Atlas](huggingface/mcpatlas/README.md)

The exporter reconstructs the folders from v1 and the pinned task inventories. Run these commands from the repository root to generate both releases and check for drift.

```sh
python3 -I vfs-bench-2/datasets/export_v1.py
python3 -I vfs-bench-2/datasets/export_v1.py --check
```

## Execution and remaining ports

One `Trial` owns the writable workspace, any guest and its service runs. Immutable inputs are cached across attempts. The bundled JS mocks run with Node supplied as a Python wheel dependency. Some services run in Docker, and others require a provisioned MCP provider. Active mock state and guest memory scale with concurrent trials. The process layout depends on the service. An open trial retains those resources until the caller exits its context or calls `close()`.

The Python and Harbor entry points use the same trial. Its configured verifier receives the trace, optional agent result, workspace files and named mock state while the services are alive. See the [verifier interface](PACKAGE.md#choose-the-verification-method).

Run `vfsbench status <release-folder>` for the installed execution coverage. The 100-task Toolathlon source inventory is kept in `datasets/toolathlon/upstream.jsonl`. A task enters the upload folder when its agent and original verifier run on local fixtures or private services. Record reviewed task IDs in `datasets/toolathlon/mocked.txt` and regenerate the release. Validate against both an unsuccessful attempt and a known successful attempt. The other v2 suites retain their existing runners. [Existing Harbor runner](formats/harbor/README.md)

## Storage and prior art

Terminal-Bench's Hugging Face mirror at `v4.1.0` has a root `registry.json` and 66 directories under `tasks/`. A task has `instruction.md`, `task.toml`, an environment, tests and usually an oracle solution. In `biped-contact-dynamics`, the Dockerfile copies `environment/data/` into `/app/`, including a JSON configuration and a URDF robot model. The verifier has additional JSON inputs in `tests/data/configs/`. In the 2.1 mirror, `constraints-scheduling` ships three actual iCalendar files under `environment/inputs/`. The fixture keeps the encoding its consumer needs. The HF Harbor reader exposes each task's instruction, parsed configuration, file paths and location in a row. [Tagged registry](https://huggingface.co/datasets/harborframework/terminal-bench/blob/v4.1.0/registry.json) · [Environment files](https://huggingface.co/datasets/harborframework/terminal-bench/tree/v4.1.0/tasks/biped-contact-dynamics/environment/data) · [Verifier inputs](https://huggingface.co/datasets/harborframework/terminal-bench/tree/v4.1.0/tasks/biped-contact-dynamics/tests/data/configs) · [Calendar fixtures](https://huggingface.co/datasets/harborframework/terminal-bench-2.1/tree/main/tasks/constraints-scheduling/environment/inputs) · [HF Harbor reader](https://huggingface.co/docs/datasets/v5.2.0/harbor_load)

DataSpace uses a different layout for a similar reason. Its `data/tasks.jsonl` lets people browse questions and file inventories, while its workspaces ship in a checksummed ZIP. For VFS-Bench, keep that catalog experience and give each task and shared asset its own address so opening one task only fetches its dependencies. [DataSpace repository layout](https://huggingface.co/datasets/HKUSTDial/DataSpace#repository-layout)

PyG provides named datasets with a common indexing interface. Its on-disk examples implement per-item reads through `get()`, but the base constructor can also download and process a whole dataset. Adopt its collection interface and specify the network behavior independently. [PyG dataset tutorial](https://pytorch-geometric.readthedocs.io/en/latest/tutorial/create_dataset.html) · [PyG implementation](https://pytorch-geometric.readthedocs.io/en/latest/_modules/torch_geometric/data/dataset.html)
