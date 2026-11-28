"""Write a dataset's agent-env bundle from its tasks.

    uv run --project formats/agentenv \
      python -I formats/agentenv/bundle.py <dataset> [--check]

``datasets/<dataset>/agentenv/``:

    bundle.toml               requires vfsbench-agentenv, the mirage sandbox
                              provider
    envs/<task>/              the env: its Dockerfile names the task's
                              workspace.yaml, which the mirage sandbox
                              provider opens; environment mirage, deployed
                              by the server topology
    tasks/<task>.json         deploy_env on the mirage sandbox, deploy_agent,
                              prompt_agent, run_container_unit_tests_verifier
    evals/agent.toml          every task

The verifier runs GRADE in the env (computer-exec/v1 run): a line in the
task's grade workspace, where grade writes the grade, and its score REWARD.

``--check`` compares the bundle with what it would write.
"""
import argparse
import json
import sys
from pathlib import Path

from vfsbench_agentenv.server import GRADE, GRADE_JSON, GRADED, REWARD

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "datasets"

ENV_TOML = 'environment_name = "mirage"\nenv_provider_type = "server"\n'


def dockerfile(dataset: str, task: str) -> str:
    return (
        "# The task's Mirage workspace. The mirage sandbox provider\n"
        "# (vfsbench_agentenv.sandbox) opens it from the workspace.yaml\n"
        "# this names; no image is built or run.\n"
        "FROM scratch\n"
        f"LABEL workspace=datasets/{dataset}/{task}/workspace/workspace.yaml\n"
    )


def task_json(task: str, instruction: str) -> str:
    steps = [
        {
            "id": "env",
            "type": "deploy_env",
            "env_id": task,
            "sandbox_type": "mirage"
        },
        {
            # agent-env's default agent (Claude Code), or --agent <name>,
            # its own tools off: the env's shell is its one tool.
            "id": "agent",
            "type": "deploy_agent",
            "env_ids": [task],
            "builtin_tools": {
                "disable": "*"
            },
            "depends_on": ["env"]
        },
        {
            "id": "solve",
            "type": "prompt_agent",
            "prompt_id": "solve",
            "prompt": instruction,
            "depends_on": ["agent"]
        },
        {
            "id": "grade",
            "type": "run_container_unit_tests_verifier",
            "env_id": task,
            "verifier_id": "reward",
            "command": GRADE,
            "reward_path": REWARD,
            "result_paths": [GRADE_JSON],
            "timeout_sec": 600,
            "depends_on": ["solve"]
        },
    ]
    return json.dumps(steps, indent=2) + "\n"


def bundle(dataset: str) -> dict[str, str]:
    """Each file of the bundle, by its path in it; ValueError for a dataset
    this format doesn't grade, or one with no tasks."""
    if dataset not in GRADED:
        raise ValueError(f"{dataset} isn't graded here yet; this format "
                         f"grades {', '.join(GRADED)}")
    files = {"bundle.toml": 'requires = ["vfsbench-agentenv"]\n'}
    tasks = []
    workspaces = (DATASETS / dataset).glob("*/workspace/workspace.yaml")
    for workspace in sorted(workspaces):
        task = workspace.parent.parent.name
        instruction = (workspace.parent.parent / "harbor" /
                       "instruction.md").read_text()
        files[f"envs/{task}/Dockerfile"] = dockerfile(dataset, task)
        files[f"envs/{task}/env.toml"] = ENV_TOML
        files[f"tasks/{task}.json"] = task_json(task, instruction)
        tasks.append(task)
    if not tasks:
        raise ValueError(f"{dataset} has no tasks under {DATASETS}")
    files["evals/agent.toml"] = "tasks = [\n" + "".join(
        f'  "{task}",\n' for task in tasks) + "]\n"
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dataset")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    out = DATASETS / args.dataset / "agentenv"
    try:
        files = bundle(args.dataset)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    present = {
        str(p.relative_to(out)): p.read_text()
        for p in out.rglob("*") if p.is_file()
    } if out.is_dir() else {}
    if args.check:
        differ = sorted(k for k in files.keys() | present.keys()
                        if files.get(k) != present.get(k))
        for path in differ:
            print(f"differs: {path}", file=sys.stderr)
        return 1 if differ else 0
    for path in present.keys() - files.keys():
        (out / path).unlink()
    for path, text in files.items():
        target = out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    for folder in sorted(out.rglob("*"), reverse=True):
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
    print(f"{len(files)} files in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
