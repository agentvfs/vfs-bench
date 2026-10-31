# UI

A page for running Harbor jobs on Mirage and watching them, laid out like
E2B's dashboard. The datasets are down the left. Each has two views:

- **Runs**: every run of the dataset that Harbor wrote to disk, newest first,
  however it was started, with its agent, status, counts and mean reward.
  New run starts one, and a row's trash icon deletes one.
- **Tasks**: the dataset's tasks and their metadata, from each task's
  `task.toml`. A task's page has its `instruction.md` and its metadata.

A run's page has a cell per trial (not started, in progress, succeeded at
reward 1, or failed) and a terminal per trial with the commands the agent
ran in its Mirage workspace. The run's page stops or resumes it, and each
terminal stops or retries its trial. Runs are read from disk, so leaving a page loses nothing.

The UI has no run format of its own. A job is the directory Harbor
writes under `<runs folder>/<jobs dir>/<job>/`. Run starts
`harbor run -c <runs folder>/console/jobs-console/<job>.json -y`, where that config is
`harbor/<dataset>.yaml` with the form's agent, model, concurrency and
attempts written over it. The job lands in `<runs folder>/jobs-console/`.

- **Stop** (a run) sends the job Ctrl-C, SIGINT to its process group; a
  second Stop sends SIGTERM. Trials in progress are cancelled, which counts
  as not started.
- **Resume** runs `harbor job resume` on a stopped job, which runs the trials
  that never finished.
- **Stop** (a terminal) kills that trial's Mirage workspace, so the agent's
  next command fails and the trial ends as failed.
- **Delete** (a run) removes Harbor's directory for it and its retries',
  and the UI's configs, logs and terminal histories of them. It asks
  first, refuses a run still running, and cannot be undone. Each delete is
  recorded in `<runs folder>/console/deleted.log`.
- **Retry** runs the task again as a job of its own beside the original,
  `<job>__retry-<n>`, with the original's resolved `config.json`. The
  original's directory is left as Harbor wrote it, and the task's cell shows
  its latest attempt.

Stopping a job works only while the UI that started it is running.
While it is, the UI reads each running trial's history every second,
so a terminal keeps its commands even if no page watched the trial.

## Run

From `ui/`, after vfs-bench-2's setup in
[../vfs-bench-2/README.md](../vfs-bench-2/README.md) and the Harbor setup in
[../vfs-bench-2/harbor/README.md](../vfs-bench-2/harbor/README.md):

```sh
pnpm install
pnpm start                      # build, then serve on http://127.0.0.1:8787
pnpm dev                        # or Vite with the API, on http://127.0.0.1:5174
pnpm typecheck && pnpm test
```

## Settings

The Settings page (bottom of the left nav) sets the two folders the UI works
in, kept in `ui/settings.json`, which is gitignored:

- **Benchmark folder**: the vfs-bench-2 checkout whose `harbor/*.yaml`
  configs and tasks it lists and runs; Harbor runs in it. By default
  `VFSBENCH_ROOT`, else `../vfs-bench-2`.
- **Runs folder**: where Harbor's jobs are written and read. By default the
  benchmark folder's `state/harbor`.

A folder is checked before it is saved, and the folders cannot change while
runs this UI started are going.

`pnpm dev` restarts its server when `server/` changes, and forgets which jobs
it started. Use `pnpm start` for long runs. Model agents read their keys
from `vfs-bench-2/.env`, passed to Harbor as `--env-file`.

## Terminals

A terminal shows Mirage's own record of the commands its workspace ran, the
workspace's `/.bash_history`. Every session writes to it, an agent working
over SSH included. The UI reads it from the trial's daemon while the
trial runs, and keeps a copy under `<runs folder>/console/observed/`, since
the daemon goes when the trial ends. It finds the daemon's port from
`HARBOR_SERVER=` in `mirage/daemon.log` (Claw-Eval's daemon), or from the pid
in `mirage/mirage-home/daemon.pid` and the port that pid listens on (Mirage's
own).

What the agent did not run is left out: the task's setup (the `run` steps in
the trial's `mirage/plan.json`), the environment Harbor exports before each
command, Harbor's own steps around the agent, and the verifier's commands.
