"""Compare native ports against saved, unchanged Harbor reference trials.

Run reference jobs with --no-delete, then pass their directories here.
This never runs an agent or changes a saved trial. A mismatch exits nonzero.
"""
import argparse
import asyncio
import importlib.util
import json
import time
from pathlib import Path

from harbor.models.task.task import Task
from harbor.models.trial.paths import TrialPaths
from vfsbench_harbor.environment import HARBOR, MirageEnvironment
from vfsbench_harbor.parity import differences

spec = importlib.util.spec_from_file_location("reference_state",
                                              HARBOR / "reference_state.py")
reference_state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference_state)
SavedVerifier = reference_state.SavedVerifier


def saved_environment(task, paths, plan, node):
    env = MirageEnvironment(environment_dir=task.paths.environment_dir,
                            environment_name=task.name,
                            session_id="replay",
                            trial_paths=paths,
                            task_env_config=task.config.environment,
                            node=node)
    env._mounts = plan["mounts"]
    config = plan["config"]
    if isinstance(config, str):
        import yaml
        config = yaml.safe_load(config)
    env._env = config.get("env", {})
    from datetime import datetime
    env._epoch = datetime.fromisoformat(plan["epoch"].replace(
        "Z", "+00:00")).timestamp() * 1000
    env._started = time.time() * 1000

    async def snapshot(definitions):
        return {
            alias:
            reference_state.reference_tables(env.host_path(alias),
                                             item["tables"])
            for alias, item in definitions.items()
        }

    env.snapshot_verifier_states = snapshot
    return env


async def run(args):
    gate = asyncio.Semaphore(args.parallel)
    reports = []

    async def trial(path):
        async with gate:
            original = json.loads((path / "result.json").read_text())
            if original.get("exception_info"):
                return {"trial": str(path), "status": "reference_error"}
            task = Task(HARBOR / "tasks/liveclawbench" / original["task_name"])
            plan = json.loads((path / "mirage/plan.json").read_text())
            paths = TrialPaths(path)
            env = saved_environment(task, paths, plan, args.node)
            native = SavedVerifier(task=task,
                                   environment=env,
                                   trial_paths=paths)
            try:
                result = await native.evaluate(refresh=False)
                expected = original["verifier_result"]["rewards"]
                actual = result.get("rewards", {"reward": result["score"]})
                delta = differences(expected, actual)
                return {
                    "trial": str(path),
                    "task": task.name,
                    "status": "mismatch" if delta else "matched",
                    "reference_rewards": expected,
                    "native_rewards": actual,
                    "differences": delta,
                    "timings": result["timings"],
                    "input_sha256": result["input_sha256"]
                }
            except Exception as exc:
                return {
                    "trial": str(path),
                    "task": task.name,
                    "status": "native_error",
                    "error": f"{type(exc).__name__}: {exc}"
                }

    tasks = [
        trial(path.parent) for job in args.jobs
        for path in sorted(job.glob("*/result.json"))
    ]
    for pending in asyncio.as_completed(tasks):
        report = await pending
        reports.append(report)
        if report["status"] != "matched":
            print(json.dumps(report), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(reports, indent=2) + "\n")
    failures = sum(r["status"] != "matched" for r in reports)
    print(f"{len(reports) - failures}/{len(reports)} matched; "
          f"{failures} failures; {args.output}")
    return int(failures > 0 or not reports)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", nargs="+", type=Path)
    parser.add_argument("--node", default="node")
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument("--output",
                        type=Path,
                        default=Path("state/harbor/native-all/replay.json"))
    raise SystemExit(asyncio.run(run(parser.parse_args())))
