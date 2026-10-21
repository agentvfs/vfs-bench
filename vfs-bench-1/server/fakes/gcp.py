#!/usr/bin/env python
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "agent"))
sys.path.insert(0, str(REPO / "server" / "seed"))

import dataset  # noqa: E402
import seed_bigquery  # noqa: E402
from services import stack_dir  # noqa: E402

COMPOSE = REPO / "docker" / "compose.yml"
# The four that come and go with a task. Everything else in the stack is
# always on, which is why they carry compose's `gcp` profile and these
# four are named together everywhere they are touched.
SERVICES = ("bigquery", "gcs", "bqproxy", "tokenstub")
# What the emulator was launched with, written beside the fixture itself, on
# the volume its containers read. One record rather than the three files
# this used to be -- `bq.project`, `gcp.env` and an environment variable each
# reader had to be handed at the right moment. Required data belongs in the
# fixture: the launch time is a property of the rows that were loaded, not
# of whoever is asking about them. Only the emulator's: what a seed did is
# the seed's own record (`services.seed_record`), one per workspace.
STATE = "fixture.json"


def state() -> dict:
    """The emulator's record.

    Returns:
        dict: the record, or an empty one when the emulator holds no task.
    """
    path = stack_dir() / STATE
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def record(**fields) -> dict:
    """Merge fields into the emulator's record.

    Args:
        **fields: keys to set.

    Returns:
        dict: the record as written.
    """
    merged = {**state(), **fields}
    path = stack_dir() / STATE
    path.parent.mkdir(parents=True, exist_ok=True)
    # By rename, because every draw reads this file as it starts
    # (`load_stack_env`), and one starting while it was half written read
    # a truncated document.
    staged = path.with_name(f".{STATE}.{os.getpid()}")
    staged.write_text(json.dumps(merged, indent=2) + "\n")
    os.replace(staged, path)
    return merged


def compose(*args: str, env: dict | None = None, **kwargs):
    """Run docker compose against this stack's gcp profile.

    `REPO_ROOT` and `STACK_DIR` are passed because compose interpolates
    them into volume paths and refuses the file without them.

    Args:
        *args (str): the compose subcommand and its arguments.
        env (dict | None): extra environment for the interpolation.
        **kwargs: passed to `subprocess.run`.

    Returns:
        subprocess.CompletedProcess: the finished command.
    """
    return subprocess.run(
        ["docker", "compose", "-f",
         str(COMPOSE), "--profile", "gcp", *args],
        env={
            **os.environ, "REPO_ROOT": str(REPO),
            "STACK_DIR": str(stack_dir()),
            **(env or {})
        },
        **kwargs)


def running() -> bool:
    """Whether the emulator is up.

    Returns:
        bool: true when compose reports a container for `bigquery`.
    """
    done = compose("ps", "-q", "bigquery", capture_output=True, text=True)
    return bool(done.stdout.strip())


def answering(proxy: str, project: str, seconds: int = 120) -> bool:
    """Wait for the emulator to serve a dataset listing.

    Args:
        proxy (str): the bq proxy's base URL.
        project (str): the project the fixture was built for.
        seconds (int): how long to wait.

    Returns:
        bool: true if it answered in time.
    """
    url = f"{proxy}/bigquery/v2/projects/{project}/datasets"
    for _ in range(seconds):
        try:
            with urllib.request.urlopen(url, timeout=2) as reply:
                if reply.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    return False


def stop(why: str) -> None:
    """Take the emulators down and forget the endpoints they published.

    Args:
        why (str): printed when something was actually stopped.
    """
    if running():
        compose("stop", *SERVICES, stdout=subprocess.DEVNULL)
        print(f"gcp: stopped, {why}")
    # The whole record: it describes what the emulator was launched with,
    # and the seed that is still running keeps its own.
    (stack_dir() / STATE).unlink(missing_ok=True)


def point_at(task: str, launch: str | None = None) -> None:
    """Point BigQuery and Cloud Storage at one task, or take them down.

    One operation, not two: the task's own `shared/bigquery.json` decides
    which way. A task that declares no fixture must not inherit the last
    one's, so its absence means stop -- the emulator would otherwise still
    hold the previous task's tables and still publish the previous
    `BQ_LAUNCH_TIME`, which is the evaluator's idea of which answer table
    to go looking for.

    Args:
        task (str): the task name.
        launch (str | None): the clock reading a generated fixture is
            named after, defaulting to `BQ_LAUNCH_TIME` or to now.

    Raises:
        SystemExit: no such task, or the emulator never came up.
    """
    if not dataset.local(task).is_dir():
        raise SystemExit(f"no task directory at {dataset.local(task)}")
    manifest_path = dataset.local(task) / "shared" / "bigquery.json"
    if not manifest_path.is_file():
        stop(f"{task} declares no bigquery fixture")
        return

    stack = stack_dir()
    stack.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    project = manifest["project"]
    preprocess = manifest.get("preprocess", "")

    # The emulator takes its fixture as a launch argument, so the seed is
    # written where the container can see it and the services are recreated
    # rather than restarted: compose interpolates `command:` at parse time,
    # and a restart would re-run the previous one.
    if preprocess:
        (stack / "seed.yaml").unlink(missing_ok=True)
        seed_arg = ""
    else:
        seed_bigquery.write(task, stack / "seed.yaml")
        seed_arg = "--data-from-yaml=/fixtures/seed.yaml"

    launch_env = {"BQ_PROJECT": project, "BQ_SEED_ARG": seed_arg}
    compose("up", "-d", "--force-recreate", *SERVICES, env=launch_env)
    compose("ps", "--format", "  {{.Service}}\t{{.Status}}", env=launch_env)

    # One launch time, written once and read back by everything after: a
    # generated fixture names its answer table after it and the evaluator
    # looks for that name, so a second clock reading between the two would
    # grade a table nobody was asked to make.
    #
    # Minted here unless the caller passes one, and deliberately not read
    # from `BQ_LAUNCH_TIME`. That would be the previous task's value:
    # `run_agent.py` loads the last fixture's record into the environment
    # before it
    # seeds, so honouring it here would stamp this task's fresh fixture
    # with the launch time of the one before it. The CLI passes the
    # environment's value explicitly, which is where pinning belongs.
    launch = launch or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    proxy = f"http://127.0.0.1:{os.environ.get('BQ_PROXY_PORT', '9051')}"
    if not answering(proxy, project):
        raise SystemExit(f"gcp: the emulator never answered at {proxy}")

    if preprocess:
        print("seeding by running upstream's own preprocess ...",
              file=sys.stderr)
        # Asked of the seam rather than spelled: this line named
        # `$REPO/Toolathlon` for a while after the checkout moved under
        # `submodule/`, and the failed `cd` aborted the whole command.
        #
        # The key is the stack's, named through upstream's own
        # `--credentials_file`: its default is the checkout's
        # `configs/gcp-service_account.keys.json`, which only the grader's
        # `place_gcp_key` fills, after the seed, so a fresh checkout could
        # not seed at all.
        done = subprocess.run(
            [
                "uv", "run", "python", "-m", preprocess, "--agent_workspace",
                str(stack), "--launch_time", launch, "--credentials_file",
                str(stack / "gcp-service_account.keys.json")
            ],
            cwd=dataset.root(),
            env={
                **os.environ, "BIGQUERY_EMULATOR_HOST": proxy,
                "PYTHONPATH": str(REPO / "redirect" / "bigquery")
            })
        if done.returncode != 0:
            raise SystemExit(f"gcp: {preprocess} failed "
                             f"(exit {done.returncode})")

    # Into the emulator's record, with the task and the time it was seeded
    # at, where its containers and `bin/start.sh env` read them. The
    # endpoints are not here: they are fixed by the stack's ports, not by
    # the fixture, and `bin/start.sh env` publishes those.
    record(task=task, seeded_at=launch, bigquery={"project": project})
    # And into this process, because a seed does not stop here: a task with
    # both fixtures seeds storage next, and the `bq` CLI reads the project
    # from its environment.
    os.environ["BQ_PROJECT"] = project
    os.environ["BQ_LAUNCH_TIME"] = launch


def main() -> int:
    """Point the emulators at one task from the command line.

    Returns:
        int: process exit status.
    """
    parser = argparse.ArgumentParser(
        description="Point the BigQuery and Cloud Storage emulators at one "
        "task, or stop them if it declares no fixture.")
    parser.add_argument("task")
    args = parser.parse_args()
    # Standalone, so there is no seed to take the time from: mint one, and
    # `point_at` writes it. `BQ_LAUNCH_TIME` is honoured here and only here,
    # because an operator who exported it is pinning the fixture on purpose.
    launch = (os.environ.get("BQ_LAUNCH_TIME")
              or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    point_at(args.task, launch)
    print()
    print(json.dumps(state(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
