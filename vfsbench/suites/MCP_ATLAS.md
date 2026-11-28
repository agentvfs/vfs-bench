# MCP-Atlas service configuration

The adapter reads each task’s original workspace specification. It installs the declared commands, exposes the specified subset of the image’s `/data` tree and enables the isolated Python interpreter only for tasks that allow it. Each task has its own writable data and scratch space. Docker copies data from the published image by digest.

The filesystem, git and Python surfaces run locally. The memory and calculator CLIs use the original executables from the Atlas image in fresh containers with networking disabled. For calendars, the adapter runs the pinned v1 import on the original ICS export and Mirage seed. Each trial starts a dedicated Mirage GWS process. The `/calendar` VFS and the Google Workspace `list-events` tool query the same calendar, including the expanded recurring events. The agent can read its task calendar. The verifier can inspect its full state through `view.service_state("calendar")`.

The verifier can also read the original memory server’s graph through `view.service_state("memory")`. Both service states belong to the current trial.

The GitHub distractor uses the empty tenant defined by v1. Four tasks ask for actual GitHub history. For those tasks, `atlas_live_github = true` enables benchmark-scoped public reads through the native `gh` command. The controller limits these requests to the repositories in the image or the original parity cases and to the task’s declared read operations.

## Private service providers

Two release rows can start with the bundled services and the OCI image: `fantasy-sports-average` and `florida-keys-meal-spending`. Enabling benchmark GitHub reads also permits `serpent-repo-first-pr-branch` and `storyteller-last-commit`. Data, service dependencies and the interpreter snapshot must already be installed or accessible. The other 96 rows need at least one more service. `vfsbench status <release-directory>` lists the requirements per row.

Additional services require a per-trial mock or an operator-provisioned replica. The v1 fixtures for `airtable`, `mongodb`, `notion` and `slack` include the exported benchmark state. For example, Notion requires the original six tables with 29,388 rows and recorded schemas, IDs and ordering. Their providers must supply those fixtures. The other release service names are `arxiv`, `clinicaltrialsgov-mcp-server`, `context7`, `ddg-search`, `e2b-server`, `exa`, `fetch`, `google-maps`, `mcp-server-code-runner`, `met-museum`, `national-parks`, `open-library`, `osm-mcp-server`, `oxylabs`, `pubmed`, `weather`, `weather-data`, `whois` and `wikipedia`. For these services, provide the original task’s declared operations using isolated benchmark data or scoped endpoints. Run code-execution providers in a dedicated sandbox. The provider executable is trusted operator code. Configure each one as an MCP stdio command in the trial TOML file. For example, a deployment with its own Notion provider could use the following configuration.

```toml
[suite_options.atlas_providers]
notion = ["/opt/benchmark/bin/atlas-notion"]
```

The command starts once per trial and service, in a new private working directory. It receives `VFSBENCH_ATLAS_TASK`, `VFSBENCH_ATLAS_SERVICE` and the JSON array `VFSBENCH_ATLAS_TOOLS`. Publish the requested original MCP tool names and their argument schemas through `tools/list`. Calls go through `tools/call`, with their original JSON arguments. The adapter registers only those verbs the task enables. An explicit argument array in operator configuration selects the executable.

When the task also has a service mount, the provider receives `VFSBENCH_ATLAS_MOUNT`. Before initialization returns, create that directory and write the original service’s agent-visible VFS snapshot there. The adapter checks that it contains ordinary files and directories, then mounts it read-only. Keep the controller API, fixture internals and credentials outside the snapshot.

An operator provider can advertise the optional MCP tool `vfsbench_state`. It takes an empty argument object and returns JSON as MCP structured content or one text block. Only a verifier can call it, through `await view.service_state("notion")` or the other provider's configured name. Keep service credentials out of this snapshot. The tool never appears among the agent’s registered commands.

An operator-supplied GitHub provider also receives `VFSBENCH_ATLAS_GITHUB_ORIGIN_FILE`. Before initialization returns, write the origin of its run-scoped GitHub REST API to that file as `http://127.0.0.1:<port>`. The native `gh` command reaches it through the adapter’s read-only route filter. Each provider owns its child processes and releases its trial state when its MCP session closes.

## Grading

The original claim-coverage scorer runs in an isolated `uv` environment with its upstream requirements. Configure `EVAL_LLM_BASE_URL` and `EVAL_LLM_API_KEY` on the controller for nonempty submissions. The judge uses `google/gemini-3.1-pro-preview`. Empty answers and upstream error responses receive zero. A coverage score of at least 0.75 earns a reward of one. The claims and the score report stay on the controller.
