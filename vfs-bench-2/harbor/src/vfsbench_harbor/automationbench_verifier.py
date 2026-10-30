"""Freeze private fake JSON; every grading operation runs in Mirage/Monty."""
import hashlib
import json

from vfsbench_harbor.environment import HARBOR

MANIFEST = HARBOR / "graders/automationbench/manifest.json"


def definitions():
    return json.loads(MANIFEST.read_text())["tasks"]


async def freeze(verifier, definition, stage, budget):
    tests = verifier._resolve_tests()[1]

    def task_input(budget):
        source = tests / "task.json"
        verifier.task.file_filter.require_included(source)
        target = stage / "task.json"
        budget.copy(source, target)
        if hashlib.sha256(target.read_bytes()).hexdigest(
        ) != definition["files"]["task.json"]:
            raise ValueError("AutomationBench task changed while staging")
        return target

    task = await verifier._background(task_input, budget=budget)
    snapshots = await verifier.environment.snapshot_verifier_states(
        definition["native_state"])
    snapshot = snapshots["automationbench"]

    def store(budget):
        target = stage / "state.json"
        budget.write_json(target, snapshot)
        target.chmod(0o400)
        # Preserve input for independent CPython replay after the fake
        # is dropped. It is never mounted into the agent's workspace.
        verifier._log(
            verifier.trial_paths.verifier_dir / "automationbench-inputs.json",
            target.read_text())
        return {
            "states": {},
            "files": {
                "/input/task.json": str(task),
                "/input/state.json": str(target)
            }
        }

    return await verifier._background(store, budget=budget)
