# vfsbench

`vfsbench` provides datasets, Mirage workspaces, private mock services, and verification. Install it from the repository root with Python 3.12 or newer.

```sh
pip install .
```

To run the OpenAI Agents SDK benchmark, install the checkout with
`pip install -e '.[notebook]'` and open the [ComplexMCP notebook](../examples/complexmcp_colab.ipynb).
It reads each task's configuration from the local release and saves a trial report per attempt.

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
| Record an answer for the verifier | `--final-answer "answer text"` | `final_answer="answer text"` |
| Load Mirage workspace settings | `--config workspace.yaml` | `config="workspace.yaml"` or `config=WorkspaceConfig(...)` |
| Select guest provisioning or a verifier | `--config trial.toml` | `config=TrialConfig(...)` |
| Save the report to a new directory | `--output run1` | `output="run1"` |
| Inspect service requirements | `vfsbench status toolathlon --task wandb-best-score` | `status("toolathlon", task_ids=["wandb-best-score"])` |

## Mirage workspace YAML

Toolathlon ships its workspace defaults in the Python package. Each of the 38 task IDs selects its built-in Mirage commands and whether the agent has a CPython guest. The suite adapter binds the live service endpoints, custom commands and filesystems for each trial. Opening a task in Python, from the CLI, or through Harbor applies those settings automatically. [Toolathlon workspace definitions](../vfsbench/suites/toolathlon_workspace.py)

Pass the same Mirage workspace file to a Python run, a CLI run or a Harbor job. This example gives the trial a writable RAM mount and gives each shell line a 30-second deadline. The 64 MB workspace budget covers RAM-backed files and command working memory. A mock server running in its own process allocates memory separately.

```yaml
mounts:
  /scratch:
    vfs: ram
    mode: write
max_memory: 64MB
command_limits:
  "@line":
    timeout_seconds: 30
```

```sh
vfsbench run complexmcp --task good-morning-paisley --config workspace.yaml workspace vfs readdir /scratch
vfsbench harbor export complexmcp --task good-morning-paisley --config workspace.yaml --output job
```

```python
from vfsbench import run

async def inspect(ws):
    await ws.vfs.write("/scratch/note", b"one trial")
    result = await ws.shell("light-system now")
    print(await result.stdout_str())

report = await run("complexmcp", task="good-morning-paisley",
                   config="workspace.yaml", action=inspect)
```

In a script or notebook, pass Mirage's own configuration object directly.

```python
from mirage.config import WorkspaceConfig
from vfsbench import Toolathlon

workspace = WorkspaceConfig(
    mounts={}, max_memory="64MB", command_limits={"@line": {"timeout_seconds": 30}}
)
async with Toolathlon()["wandb-best-score"].start(config=workspace) as trial:
    result = await trial.workspace.shell("ls /wandb")
```

`task.start`, `run`, and `harbor.export` accept either form. Harbor references a workspace file by path and embeds an in-memory configuration in the exported job. If you also use a controller TOML, pass `--config trial.toml --workspace-yaml workspace.yaml`, or set `workspace_yaml` under `[trial]` relative to the TOML file.

Mirage loads and validates the YAML. Use `mounts: {}` when configuring only profiles, limits or environment variables. The application can add a scratch mount, another CLI, or resource limits. Task-owned mount trees, CLI names, machine names, environment variables, and any task-specified clock and mock network settings are reserved.

### Implementing a Toolathlon command or mount

Custom command implementations live under `vfsbench/cli/`. A suite adapter supplies its Mirage CLI objects in `TrialEnvironment.clis`. For example, the two Calendar tasks bind `google-calendar` to the private Mirage Calendar API. The five commands use the original argument schemas and operate on the same events the verifier reads. Several other tasks still use a pinned upstream MCP process behind a Mirage command, including the Word, recipe and WooCommerce tools. [Calendar commands](../vfsbench/cli/google_calendar.py)

Custom filesystem implementations live under `vfsbench/vfs/`. A suite supplies its read-only Python backends in `TrialEnvironment.mounts`. The WooCommerce integration binds `/woo` to the current trial's store. For built-in Mirage backends such as W&B or Drive, the adapter sets the backend and its credentials in the workspace configuration. [WooCommerce filesystem](../vfsbench/vfs/woocommerce.py)

## Application lifecycle

For an interactive runner, start the task and issue commands over the lifetime of the trial. Call `verify()` when the attempt is ready for grading.

```python
from vfsbench import load_dataset

task = load_dataset("toolathlon")["wandb-best-score"]
async with task.start() as trial:
    listing = await trial.workspace.vfs.readdir("/wandb/mluo/deepscaler-1.5b")
    verdict = await trial.verify()
print(trial.report.to_dict())
```

For explicit lifecycle management, use `trial = await task.start()` and call `await trial.close()` in a `finally` block. Verification seals the command trace. The workspace and service state stay live until you close the trial. The report remains readable afterward. Each trial has its own writable state and consumes memory for its guest and mock processes. Closing releases those resources. The wheel bundles the Mirage mock server code and depends on a Node binary wheel. Starting a supported JavaScript mock is part of starting the trial. Immutable fixture files, service dependencies, and the guest base disk can be reused across trials. [Runnable example](../examples/trial.py)

### Workspace documentation and mock state

Mirage exposes live, read-only `/SKILL.md` and `/VFS.md` in each trial.
To expose the public guide as a read-only virtual file at `/INSTRUCTIONS.md`,
use `task.start(instructions_file=True)`, `vfsbench.run(..., instructions_file=True)`,
or `vfsbench run --instructions-file`. Harbor exports enable the guide by default.
Use `vfsbench harbor export --no-instructions-file` to omit it. Only the Harbor
adapter creates `/logs` for its agent and artifact directories.

The ComplexMCP notebook passes the public guide directly to the SDK by default.
With `USE_WORKSPACE_DOCS = True`, the prompt points to `/SKILL.md` and `/VFS.md`.
Set `INSTRUCTIONS_FILE = True` to expose the guide as well. Set
`AGENT_INSTRUCTIONS` to append your own text in either mode.

Keep the trial handle to inspect a running ComplexMCP mock from the controller.
`trial.service_state("complexmcp")` and `server.state(trial.id)` return the
same grader-visible records. For example, LightTalk’s `mark_as_read` sets
`read_new_message` on the selected contact. The verifier compares these
records with the starting data and the task’s private expected outcome.
This example saves the current records for inspection. Exiting the block
releases the trial’s mock run.

```python
import json
from pathlib import Path
from vfsbench import ComplexMCP

async with ComplexMCP()["mark-sean-baker-read"].start() as trial:
    state = await trial.service_state("complexmcp")
    Path(f"{trial.id}-state.json").write_text(json.dumps(state, indent=2))
```

### Manage live ComplexMCP runs

Starting a ComplexMCP trial automatically connects to the vfsbench HTTP server
at `http://127.0.0.1:8931` and starts it if needed. Notebook kernels and CLI
processes using that endpoint and account see the same runs. The default backend
uses one bundled Node worker per run. A clone gets its own worker and includes
the source's simulated clock and random-generator state.

```python
from vfsbench import ComplexMCP, get_server

server = await get_server()
print(server.endpoint)
async with ComplexMCP()["mark-sean-baker-read"].start() as trial:
    print(await trial.server.list_runs())
    branch = await server.clone(trial.id)

try:
    clock = await server.call(branch["run"], "light-system", "now", {})
    print(clock)
finally:
    await server.stop(branch["run"])
```

Each listed entry has `run`, `task`, and `backend`. The source uses `trial.id`.
Closing the trial removes its source run. Clones remain on the server until you
stop them. `stop` releases the selected mock, and `trial.close()` releases the
workspace. Verify a source trial before stopping its mock if you need its grade.
When managing a trial explicitly, use `await trial.close()` in a `finally`
block. It closes the Mirage workspace, drops the trial's mock run, and removes
the trial's temporary directory and any trial VM. The report remains available
as `trial.report`. Python's `del` only removes a reference. If a kernel was
killed before cleanup, use `server.list_runs()` and `server.stop(run_id)` to
release its orphaned mock.
In the notebook, set `KEEP_MOCK_CLONES = True` before the benchmark to retain
each graded mock. Its ID appears in the summary and saved report.
A clone contains service state. The conversation, trace and workspace files belong
to the trial.

```sh
vfsbench server                  # print the controller endpoint
vfsbench server runs
vfsbench server clone RUN_ID
vfsbench server state RUN_ID
vfsbench server stop RUN_ID
vfsbench server shutdown
```

Pass `TrialConfig(server_url="http://127.0.0.1:9000")` to select a port for
one trial, or set `VFSBENCH_SERVER_URL` for a notebook and its CLI clients.
To inspect that server explicitly, use `await get_server("http://127.0.0.1:9000")`
or `vfsbench server --endpoint http://127.0.0.1:9000 runs`. For Harbor, set
`server_url` in the controller TOML’s `[trial]` section.

An automatically started server exits after it becomes idle with no live runs.
Use `await server.shutdown()` to shut it down explicitly. The controller refuses
while any run is live or starting, including retained clones. To connect from
a cleanup script without launching a controller, use `await get_server(start=False)`.
For a foreground server, run `vfsbench server serve --port 9000`. Local clients
authenticate using a private per-user token. For a separately hosted controller
behind HTTPS, set `VFSBENCH_SERVER_TOKEN` on both ends. Agent workspaces only
receive access to a per-trial tool endpoint.

### Use deployed Mirage Kit services

To use shared Mirage Kit HTTP servers, supply their addresses in the controller
configuration. For example, if your deployment exports a JSON object mapping
the 15 service names in `workspace/tools.json` to their base URLs, use it
directly in Python.

```python
import json
from pathlib import Path
from vfsbench import ComplexMCP, TrialConfig

endpoints = json.loads(Path("kit-endpoints.json").read_text())
config = TrialConfig(suite_options={"complexmcp_kit_endpoints": endpoints})
async with ComplexMCP()["mark-sean-baker-read"].start(config=config) as trial:
    kit = await trial.service_state("complexmcp_kit")
    print(kit["run"], list(kit["services"]))
```

The notebook accepts the same configuration in `TRIAL_CONFIG`. For the CLI or
Harbor, put the mapping in `[suite_options.complexmcp_kit_endpoints]` in
`trial.toml` and pass `--config trial.toml`.

Each base URL points to its own ComplexMCP Kit service, for example
`light-talk` to the `complexmcp_talk` server and `math-server` to
`complexmcp_math`. Light services must be able to reach the configured
`light-system` address. Set the servers’ `COMPLEXMCP_SRC` to the matching ComplexMCP corpus root (the directory containing `software/`)
and register the release's fixtures on the deployment. Under the Kit
`--fixture-root`, each service reads `<service>/<task-id>.json`. Copy the
task's `workspace/fixtures/login.json` for Light services and
`workspace/fixtures/none.json` for plain services. [ComplexMCP fixtures](../vfs-bench-2/datasets/complexmcp/mark-sean-baker-read/workspace/fixtures)

Starting a trial creates an isolated run on the task's logged-in apps.
Other services get the same run ID on first use. The agent uses the same
Mirage shell commands with either backend. Its only network destination is a per-trial loopback endpoint for published tools. The controller gets the run ID and
initialized service addresses from `service_state("complexmcp_kit")`.

With this backend, `server.clone(trial.id)` calls Kit’s clone endpoint on each
initialized service, including LightSystem, while holding the run’s tool-call
lock. `server.stop(run_id)` deletes those service runs. Listing shows runs
created through this vfsbench controller. For durable service snapshots,
use Kit’s snapshot and load routes. [Mirage Kit lifecycle API](https://github.com/strukto-ai/mirage/blob/0c664adb81a4e86a912195b2cebb22177d688318/integ/README.md#L265-L287)

## Datasets and first use

Pass a checkout suite name (`toolathlon`, `mcpatlas`, or `complexmcp`), a release directory, or a Hugging Face dataset ID to `load_dataset`, `run`, or the CLI. For a published release, loading initially reads the catalog. Accessing a task fetches its manifest, prompt or assets as needed, pinned to the catalog's Hub commit. `Toolathlon()` is the typed checkout reader. [Release format and upload](datasets.md)

Tasks using a microVM require a working `msb` installation. On first use the runtime builds the default disk snapshot with CPython, SSHFS and the pinned analysis packages. Each agent guest and verifier guest restores a separate disk from that snapshot. The snapshot contains the runtime dependencies. Task fixtures and private grading inputs are staged per trial. Operators can prebuild the disk with `vfsbench snapshot build` or select their own installed snapshot in `trial.toml`. [Microsandbox](https://github.com/microsandbox/microsandbox)

For a task that needs another CPython package, select its exact PyPI version in the trial configuration. For example, save the following as `trial.toml` and pass `--config trial.toml` to a run or Harbor export.

```toml
[trial]
python_packages = ["tabulate==0.9.0"]
```

The equivalent Python call is `task.start(config=TrialConfig(python_packages=("tabulate==0.9.0",)))`. The builder installs compatible binary wheels before a trial starts and caches the disk by its image and package pins. You can also prebuild it with `vfsbench snapshot build --package tabulate==0.9.0`. The default disk already includes pandas, openpyxl, SciPy and PyMuPDF. A task that exposes only service commands still uses its configured agent workspace. [Guest package pins](../vfsbench/snapshot.py)

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

A custom environment can expose that `orders` reader. Pass the instance with `task.start(verifier=OrderVerifier(), environment=environment)` or select installed providers in TOML for both Python and the CLI.

A Python action can return `AgentResult(final_answer=answer, output=data)` from the workspace callback. `run` records it before invoking the verifier. If the runner already has the answer, pass `final_answer=answer` to `run` or `--final-answer "$answer"` to the CLI.

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

For a reusable verifier selected by TOML, register the verifier class in your installed project's `[project.entry-points."vfsbench.verifiers"]`. The entry point name goes in `[verifier].name`, and `[verifier.options]` contains its constructor arguments. The optional `[trial]` section configures the guest snapshot, vCPUs and guest RAM passed to `msb restore`. Its optional `timeout_sec` sets a controller deadline for the entire `run` action and for a private grader guest invocation. Grader guest invocations default to 120 seconds. Mirage enforces workspace command limits. Suite-specific service settings go in `[suite_options]`.

### Own a service's lifecycle

To use an existing mock deployment, pass an async context manager factory as `task.start(environment=factory, verifier=...)`. The factory receives the task, configuration and a unique staging directory. It starts or leases a service run and yields a `TrialEnvironment`. The trial closes the Mirage workspace before exiting the factory. In this example, `my_service` is the deployment's client.

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

Harbor supplies its built-in `nop` agent for the exported baseline. Choose your own agent with Harbor's agent configuration. In both cases Harbor loads `vfsbench.harbor:MirageEnvironment` and `vfsbench.harbor:MirageVerifier` from the installed wheel. They call `task.start()`, record the available trajectory and result, call `trial.verify()`, and close the trial. Reward and report files live in Harbor's controller-side verifier directory.

Omit `--task` (or `task_ids`) to export the whole release. Use `--available` (`available=True`) for tasks with configured suite adapters, and `--concurrency N` (`concurrency=N`) for batch execution.
