# vfsbench

`vfsbench` loads VFS-Bench tasks from local release folders or Hugging Face and runs supported tasks in a Mirage Python workspace. Python commands execute inside a per-trial microsandbox. Harbor uses the same Python trial and verifier APIs.

## Install and prepare

From the repository root, install the package with Python 3.12 or newer. Install the Harbor extra to run Harbor jobs.

```sh
pip install './vfs-bench-2[harbor]'
vfsbench snapshot build
vfsbench status vfs-bench-2/huggingface/toolathlon
```

Running trials requires the `msb` executable and a host that supports its microVMs. The snapshot builder installs native CPython, the analysis and document packages, and SSHFS into a build VM. It saves a reusable disk snapshot and removes the builder. Each trial restores its own guest with outbound networking disabled. Some task surfaces omit Python upstream and run entirely in Mirage. The dataset reader works independently of these services. [Microsandbox](https://github.com/microsandbox/microsandbox)

The Toolathlon release contains the v1 tasks verified to run and grade with local fixtures or per-trial services. `vfsbench status` lists their service prerequisites. The MCP-Atlas catalog contains all 100 v1 entries, with execution coverage dependent on configured providers. MCP-Atlas also uses a digest-pinned Docker image for its dataset and original service binaries. Its nonempty-answer grader requires `uv` and an explicitly configured judge endpoint. [MCP-Atlas service configuration](src/vfsbench/suites/MCP_ATLAS.md)

The WooCommerce tasks also require Docker. Each trial has a private MySQL database, WordPress installation and Node MCP process. The workspace reads the live store at `/woo` and uses `woocommerce` commands to update it. The first run caches the pinned images, WooCommerce plugin and npm packages listed in the bundled lockfile. The inventory initializer additionally uses the pinned Python image and WP-CLI. The material-inventory task restores both the Sheets and store captures. It uses `uv` to install its original twenty Google Sheets tools in a separate, locked Python environment. Store state and volumes are removed on teardown. These processes use host memory in addition to the trial VM’s configured memory.

The Notion personal website task starts the v1 Mirage Notion server and the upstream Word server in separate Docker containers. The first run builds their images and caches the task's pinned sources. Each trial has its own SQLite database, seeded with the original page and eight blocks. The agent can browse `/notion` and use all 19 Notion commands to work on the page. `await trial.service_state("notion")` returns the current target page and its child blocks. Closing the trial removes both containers and their writable state.

The PhD application task runs its email, PDF and memory tools in per-trial Docker containers. It restores the original inbox and application files. SMTP delivers only to private fixture accounts on the local Mirage mail server. The verifier checks the recipient’s delivered ZIP against the original filenames and file contents.

## Prepare an offline run

Choose the same host, Python version and cache location for setup and execution. After building the snapshot, warm the dependencies for one task with:

```sh
vfsbench prepare vfs-bench-2/huggingface/toolathlon --task update-material-inventory
```

This starts an empty trial, runs its original verifier and tears it down. It caches the prompt, required fixture files and the service software used by that task. Omit `--task` to prepare the whole release. Use `--offline` on a subsequent prepare or Harbor export to require cached dependencies. For Python, set `Toolathlon(local_files_only=True)`. `XDG_CACHE_HOME` selects the default cache root.

## Load one task

```python
from vfsbench import Toolathlon

suite = Toolathlon("vfs-bench-2/huggingface/toolathlon")
task = suite["nhl-b2b-analysis"]
print(task.instruction)
schedule = task.file("shared/nhl.csv")
```

For a published release use `Toolathlon.from_hub(repo_id, revision=...)`. The reader pins subsequent reads to the catalog's resolved commit. `task.files(names)` resolves multiple selected files. `task.materialize(include_sources=True)` retrieves all individually referenced files for the task. `local_files_only=True` uses files already present in the checkout or cache.

## Run and verify

```python
import asyncio
from vfsbench import Toolathlon, TrialConfig

async def main():
    task = Toolathlon()["nhl-b2b-analysis"]
    config = TrialConfig.from_toml("vfs-bench-2/trial.toml")
    async with task.open(config=config) as trial:
        print((await trial.exec("cat /VFS.md")).stdout)
        # Run an agent here. The default NHL verifier reads the live Google Sheets mock.
        verification = await trial.verify()
    print(verification.reward, trial.report.to_dict())

asyncio.run(main())
```

`Trial.start()` and `Trial.close()` expose the same lifecycle explicitly. `verify()` seals the agent's command trace and keeps the workspace and mocks alive for verification. Multiple verifications may inspect that same attempt. Leaving the async context or calling `close()` closes the workspace, removes the guest, releases the mock run and cleans up staging files. The Python report remains readable after teardown.

### Choose the verification method

The default is the benchmark's suite verifier. To use a different method, pass an object with an async `verify(trial)` method. This example scores the presence of a named spreadsheet and records how many commands the agent used.

```python
from vfsbench import TrialView, VerificationResult

class SpreadsheetVerifier:
    def __init__(self, title):
        self.title = title

    async def verify(self, trial: TrialView) -> VerificationResult:
        drive = await trial.service_state("gws")
        found = any(item.get("name") == self.title and not item.get("trashed")
                    for item in drive["files"])
        return VerificationResult(float(found), {"commands": len(trial.trace.commands)})

# Inside an async function:
# async with task.open(verifier=SpreadsheetVerifier("Team totals")) as trial:
#     ... run the agent ...
#     verdict = await trial.verify()
```

The verifier gets a read-only view of one attempt.

| Evidence | Contents |
| --- | --- |
| `trial.trace.commands` | Commands issued through the runner with times, stdout, stderr and exit codes |
| `trial.trace.workspace_events` | Mirage's native event log, including commands issued through its workspace API |
| `trial.trace.agent` | The runner's structured trajectory, when available. Harbor records its ATIF trajectory here. |
| `trial.result` | The optional `AgentResult` recorded by the runner, with structured output, a final answer or metadata |
| `await trial.read_file(path)` | The bytes currently visible at a virtual workspace path |
| `await trial.service_state(name)` | A detached, controller-side snapshot of the named mock run. `trial.services` lists the names. |

A Python runner can capture a structured return value with `trial.record_result(AgentResult(output=value))` and an agent trajectory with `trial.record_agent_trace(trajectory)`. Both are optional. Command stdout, stderr and exit codes are captured automatically by `trial.exec()`. A verifier can grade an attempt entirely from service state. It can include selected observations in `VerificationResult.details` so they survive teardown. The full mock database lives only for the duration of the trial. A verifier exception propagates and is recorded separately from a benchmark reward.

For a reusable verifier selected by TOML, register the verifier class in your installed project's `[project.entry-points."vfsbench.verifiers"]`. The entry point name goes in `[verifier].name`, and `[verifier.options]` contains its constructor arguments. The included trial configuration uses `name = "suite"`. The `[trial]` section controls the snapshot, CPU count, memory, command timeout and optional staging parent directory. Suite-specific service settings go in `[suite_options]`. [Example configuration](trial.toml)

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

## Run the same task from Python and the CLI

From the repository root, prepare the W&B task once. The examples use the
local mock project and its five recorded experiment histories.

```sh
vfsbench snapshot build
vfsbench prepare toolathlon --task wandb-best-score
python vfs-bench-2/examples/wandb_best_score.py
```

The Python example opens a trial, runs the analysis inside its microVM and
records a structured result. The original verifier reads the CSV in the
workspace. It gives the correct experiment and step a reward of 1.
[Python example](examples/wandb_best_score.py) · [Analysis script](examples/best_experiment.py)

Use `vfsbench run` to execute the same analysis as a Harbor agent.

```sh
PYTHONPATH="$PWD/vfs-bench-2/examples" vfsbench run toolathlon \
  --task wandb-best-score --agent-import-path wandb_agent:WandbAgent --offline
```

For an empty baseline, run `vfsbench run toolathlon --task wandb-best-score
--agent nop --offline`. Its expected reward is 0. Each invocation creates
a fresh directory under `runs/` with the exported `job.json`, Harbor
results and a `verifier/vfsbench.json` for each trial. `--output` selects
a new directory. A completed benchmark score of 0 is a successful command.
Harbor launch errors and trial exceptions give the command a nonzero exit.

Repeat `--task` to select multiple tasks or omit it to run the whole release.
Use `-n` to control concurrency, `--config` for trial settings and
`--agent NAME --model MODEL` for a configured Harbor model agent. After
upload, replace `toolathlon` with the Hub repository ID and use
`--revision COMMIT` to select an immutable release. Outside a checkout,
a local release folder also works. [Harbor agent example](examples/wandb_agent.py)

## Export a Harbor job for editing

Stock Harbor loads two providers from the installed Python package.
`vfsbench.harbor:MirageEnvironment` opens the selected task with
`task.open()` and releases the trial after grading.
`vfsbench.harbor:MirageVerifier` records the available agent evidence and
calls `trial.verify()` while the workspace and service state are live.
Both `vfsbench run` and a manual export write these provider paths to
`job.json`.

```sh
vfsbench harbor export --dataset vfs-bench-2/huggingface/toolathlon \
  --task nhl-b2b-analysis --output /tmp/nhl-harbor
cd /tmp/nhl-harbor
harbor run -c job.json -a nop
```

The exported job uses the package defaults. Pass `--config path/to/trial.toml` to supply your own trial lifecycle settings. Harbor records the agent's trace and result, runs verification while the services are live, and then tears down the environment. The verifier directory contains the Harbor reward and `vfsbench.json` with the trial evidence and verifier details. Use `--repo-id` and `--revision` in place of `--dataset` to export from a published Hub release.

To run the entire local Toolathlon release, omit `--task nhl-b2b-analysis`. Add `--offline` after warming the fixture and service caches. Use `--available` to select just the tasks supported by the installed adapter when working with another release revision.
