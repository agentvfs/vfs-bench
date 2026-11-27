# vfsbench

`vfsbench` provides datasets, Mirage workspaces, private mock services, and verification. Install it from the repository root with Python 3.12 or newer.

```sh
pip install .
```

## Run one trial

The trial supplies the workspace. Use Mirage's `shell -c` to run a shell line or `workspace vfs` to call the filesystem directly. Each invocation opens a fresh trial and grades it before teardown.

```sh
vfsbench run toolathlon --task wandb-best-score shell -c 'ls /wandb/mluo/deepscaler-1.5b'
vfsbench run toolathlon --task wandb-best-score workspace vfs readdir /wandb/mluo/deepscaler-1.5b
```

Both examples list the five W&B runs. Mirage's shell prints command output and returns the shell exit code. Its VFS uses native call names, arguments, and output types. For example, `workspace vfs read PATH` emits the selected bytes, and `workspace vfs write PATH` reads bytes from stdin. Use `workspace vfs --help` to list operations. [Mirage CLI](https://github.com/strukto-ai/mirage/tree/main/python/mirage/cli)

In Python, `run` passes your async function the actual Mirage `Workspace`.

```python
from vfsbench import run

async def inspect(ws):
    entries = await ws.vfs.readdir("/wandb/mluo/deepscaler-1.5b")
    result = await ws.shell("ls /wandb/mluo/deepscaler-1.5b")
    print(entries, await result.stdout_str())

report = await run("toolathlon", task="wandb-best-score", action=inspect)
print(report.verification.reward)
```

Use `--output run1` before `shell` or `workspace` to save the controller's report to `run1/trial.json`. A run with no operation grades the initial state and prints that report as JSON. Listing the runs earns a reward of zero on this task.

| Operation | CLI | Python |
| --- | --- | --- |
| Select a Hub revision | `--revision COMMIT` | `revision=commit` |
| Apply lifecycle and verifier settings | `--config trial.toml` | `config="trial.toml"` |
| Load Mirage workspace YAML | `--workspace-yaml workspace.yaml` | `workspace_yaml="workspace.yaml"` |
| Save the report to a new directory | `--output run1` | `output="run1"` |
| Inspect service requirements | `vfsbench status toolathlon --task wandb-best-score` | `status("toolathlon", task_ids=["wandb-best-score"])` |

## Mirage workspace YAML

Pass the same Mirage workspace file to a Python run, a CLI run or a Harbor job. For example, save this as `workspace.yaml` to give each trial a writable RAM mount.

```yaml
mounts:
  /scratch:
    vfs: ram
    mode: write
```

```sh
vfsbench run complexmcp --task good-morning-paisley --workspace-yaml workspace.yaml workspace vfs readdir /scratch
vfsbench harbor export complexmcp --task good-morning-paisley --workspace-yaml workspace.yaml --output job
```

```python
from vfsbench import run

async def inspect(ws):
    await ws.vfs.write("/scratch/note", b"one trial")
    result = await ws.shell("light-system now")
    print(await result.stdout_str())

report = await run("complexmcp", task="good-morning-paisley",
                   workspace_yaml="workspace.yaml", action=inspect)
```

For an open trial, pass `TrialConfig(workspace_yaml=Path("workspace.yaml"))` to `task.open(config=...)`. You can also set `workspace_yaml = "workspace.yaml"` under `[trial]` in TOML. Paths there resolve relative to the TOML file. An explicit run or export option takes precedence. Harbor reads the referenced file when it starts a trial.

Mirage loads and validates the YAML. Use `mounts: {}` when configuring only profiles, limits or environment variables. Named entries are combined with the trial configuration. Suite mounts, suite-configured CLIs and the trial's managed Python machine reserve their names. The trial's network policy permits individual loopback mock ports.

## Application lifecycle

For an interactive runner, open the task and issue commands over the lifetime of the trial. Call `verify()` when the attempt is ready for grading.

```python
from vfsbench import load_dataset

task = load_dataset("toolathlon")["wandb-best-score"]
async with task.open() as trial:
    listing = await trial.workspace.vfs.readdir("/wandb/mluo/deepscaler-1.5b")
    verdict = await trial.verify()
print(trial.report.to_dict())
```

`Trial.start()` and `Trial.close()` also work explicitly. Verification seals the command trace. The workspace and service state stay live until you close the trial. The report remains readable afterward. Each trial has its own writable state and consumes memory for its guest and mock processes. Closing releases those resources. The wheel bundles the Mirage mock server code and depends on a Node binary wheel. Starting a supported JavaScript mock is part of opening the trial. Immutable fixture files, service dependencies, and the guest base disk can be reused across trials. [Runnable example](../examples/trial.py)

## Datasets and first use

Pass a checkout suite name (`toolathlon`, `mcpatlas`, or `complexmcp`), a release directory, or a Hugging Face dataset ID to `load_dataset`, `run`, or the CLI. For a published release, loading initially reads the catalog. Accessing a task fetches its manifest, prompt or assets as needed, pinned to the catalog's Hub commit. `Toolathlon()` is the typed checkout reader. [Release format and upload](datasets.md)

Tasks using a microVM require a working `msb` installation. On first use the runtime builds the default disk snapshot with CPython, SSHFS and the pinned analysis packages. Each agent guest and verifier guest restores a separate disk from that snapshot. The snapshot contains the runtime dependencies. Task fixtures and private grading inputs are staged per trial. Operators can prebuild the disk with `vfsbench snapshot build` or select their own installed snapshot in `trial.toml`. [Microsandbox](https://github.com/microsandbox/microsandbox)

Dependency downloads are enabled by default. The Toolathlon release uses local fixtures and private mock endpoints for task execution. For an intentionally disconnected host, the optional `--local-files-only` flag corresponds to Python's `local_files_only=True` and requires the dependencies to be present. Some tasks require Docker or additional provider software. `vfsbench status` lists those requirements. The separate MCP-Atlas catalog includes tasks that need provisioned services or an external judge. [MCP-Atlas configuration](../vfsbench/suites/MCP_ATLAS.md)

## Verification

The controller owns the verifier. It receives a `TrialView` with the attempt's trace, optional result, workspace reads and named readers for private service state. Built-in verifiers that execute upstream grading scripts stage them and their expected outputs in a separate grader environment. An agent receives its task workspace.

```python
from vfsbench import TrialView, VerificationResult

class OrderVerifier:
    async def verify(self, trial: TrialView) -> VerificationResult:
        state = await trial.service_state("orders")
        return VerificationResult(float(state["count"] == 3), {"count": state["count"]})
```

A custom environment can expose that `orders` reader. Pass the instance with `task.open(verifier=OrderVerifier(), environment=environment)` or select installed providers in TOML for both Python and the CLI.

The verifier gets a read-only view of one attempt.

| Evidence | Contents |
| --- | --- |
| `trial.trace.commands` | Commands issued through the runner with times, stdout, stderr and exit codes |
| `trial.trace.workspace_events` | Mirage's native shell, result and VFS events from the CLI and Python workspace |
| `trial.trace.agent` | The runner's structured trajectory, when available. Harbor records its ATIF trajectory here. |
| `trial.result` | The optional `AgentResult` recorded by the runner, with structured output, a final answer or metadata |
| `await trial.read_file(path)` | The bytes currently visible at a virtual workspace path |
| `await trial.service_state(name)` | A detached, controller-side snapshot of the named mock run. `trial.services` lists the names. |

A Python runner can capture a structured return value with `trial.record_result(AgentResult(output=value))` and an agent trajectory with `trial.record_agent_trace(trajectory)`. Both are optional. Mirage records native shell output, exit codes, and VFS calls in `trial.trace.workspace_events`. Calls made through the Harbor adapter or the existing `trial.exec()` helper also populate `trial.trace.commands`. A verifier can grade an attempt entirely from service state. It can include selected observations in `VerificationResult.details` so they survive teardown. The full mock database lives only for the duration of the trial. A verifier exception propagates and is recorded separately from a benchmark reward.

For a reusable verifier selected by TOML, register the verifier class in your installed project's `[project.entry-points."vfsbench.verifiers"]`. The entry point name goes in `[verifier].name`, and `[verifier.options]` contains its constructor arguments. The included trial configuration uses `name = "suite"`. The `[trial]` section controls the snapshot, CPU count, memory, command timeout and optional staging parent directory. Suite-specific service settings go in `[suite_options]`. [Example configuration](../trial.toml)

### Own a service's lifecycle

To use an existing mock deployment, pass an async context manager factory as `task.open(environment=factory, verifier=...)`. The factory receives the task, configuration and a unique staging directory. It starts or leases a service run and yields a `TrialEnvironment`. The trial closes the Mirage workspace before exiting the factory. In this example, `my_service` is the deployment's client.

```python
from contextlib import asynccontextmanager
from vfsbench import TrialEnvironment

@asynccontextmanager
async def environment(task, config, run_dir):
    async with my_service.open_run(task.id, run_dir) as service:
        yield TrialEnvironment(
            workspace=service.mirage_config,
            state_readers={"orders": service.snapshot},
        )
```

Each state reader is an async function returning the current run's state. A factory can provide a default `verifier` alongside the workspace. For use from the CLI or Harbor, register the factory in the installed project's `[project.entry-points."vfsbench.environments"]` and put its name in `[trial].environment`. The default `"suite"` selects the built-in environment.

## Harbor

Install the adapter with `pip install '.[harbor]'`. Exporting a job has matching CLI and Python calls. Choose a fresh output directory for each export.

```sh
vfsbench harbor export toolathlon --task wandb-best-score --output wandb-job
```

```python
from vfsbench.harbor import export

job = export("toolathlon", "wandb-job", task_ids=["wandb-best-score"])
```

Launch the exported job from its directory.

```sh
cd wandb-job
harbor run -c job.json
```

Harbor supplies its built-in `nop` agent for the exported baseline. Choose your own agent with Harbor's agent configuration. In both cases Harbor loads `vfsbench.harbor:MirageEnvironment` and `vfsbench.harbor:MirageVerifier` from the installed wheel. They call `task.open()`, record the available trajectory and result, call `trial.verify()`, and close the trial. Reward and report files live in Harbor's controller-side verifier directory.

Omit `--task` (or `task_ids`) to export the whole release. Use `--available` (`available=True`) for tasks with configured suite adapters, and `--concurrency N` (`concurrency=N`) for batch execution.
