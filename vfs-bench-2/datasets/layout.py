"""Where a task's files go.

A task is ``datasets/<dataset>/<task>/``: ``workspace/`` holds what Mirage
runs it with, and ``harbor/`` what Harbor reads.

    workspace/workspace.yaml   its fakes, mounts, CLIs, copies and limits
    workspace/tools.json       its tools, as CLIs
    workspace/fixtures/        each fake's seed
    workspace/files/           what workspace.yaml copies or mounts in
    workspace/verifier/        what its grader reads besides the run's state
    harbor/task.toml
    harbor/instruction.md
    harbor/environment/mirage.yaml   the way to ../../workspace
    harbor/solution/
    harbor/tests/test.sh       a stub: MirageVerifier grades the task

A generator writes a task's files by their place in Harbor's own layout
(``environment/mirage.yaml``, ``tests/<file>``), and ``placed`` lays them
out here.
"""
POINTER = "environment/mirage.yaml"
POINTER_TEXT = b"workspace: ../../workspace\n"


def place(rel: str) -> str:
    """A file's path in the task, from its path in Harbor's layout."""
    if rel in ("instruction.md", "task.toml", "tests/test.sh") or rel.startswith(
            "solution/"):
        return f"harbor/{rel}"
    if rel.startswith("tests/"):
        return "workspace/verifier/" + rel.removeprefix("tests/")
    if rel == "environment/mirage.yaml":
        return "workspace/workspace.yaml"
    if rel == "environment/tools.json":
        return "workspace/tools.json"
    for kit in ("environment/kit/", "environment/fixtures/"):
        if rel.startswith(kit):
            return "workspace/fixtures/" + rel.removeprefix(kit)
    if rel.startswith("environment/"):
        return "workspace/files/" + rel.removeprefix("environment/")
    raise ValueError(f"no place for {rel}")


def workspace_yaml(text: bytes) -> bytes:
    """mirage.yaml as workspace.yaml: its fixtures under fixtures/."""
    return text.replace(b"fixture: kit/", b"fixture: fixtures/")


def task_toml(text: bytes, dataset: str, task: str) -> bytes:
    """task.toml with the task's name, ``vfs-bench-2/<dataset>.<task>``,
    which Harbor would otherwise take from its directory, ``harbor``."""
    lines = text.decode().splitlines(keepends=True)
    at = next((i for i, line in enumerate(lines) if line.startswith("[")),
              len(lines))
    section = f'[task]\nname = "vfs-bench-2/{dataset}.{task}"\n\n'
    return "".join(lines[:at] + [section] + lines[at:]).encode()


def placed(files: dict[str, bytes], dataset: str,
           task: str) -> dict[str, bytes]:
    """A task's files, by their path in the task, its name in task.toml,
    and the way to its workspace."""
    out = {}
    for rel, data in files.items():
        if rel == "environment/mirage.yaml":
            data = workspace_yaml(data)
        elif rel == "task.toml":
            data = task_toml(data, dataset, task)
        out[place(rel)] = data
    out["harbor/" + POINTER] = POINTER_TEXT
    return out
