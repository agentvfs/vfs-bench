"""Write a dataset's agent-env bundle from its tasks.

    uv run --project formats/agentenv \
      python -I formats/agentenv/bundle.py <dataset> [--check]

``datasets/<dataset>/agentenv/``:

    envs/mirage/              the env: vfsbench_agentenv.server, deployed by
                              the mirage topology on this machine
    artifacts/<task>/         the task, the environment artifact data/add loads
    artifacts/grade/          verify.py, the env_outcome_verifier's script
    tasks/<task>.json         deploy_env, deploy_agent, prompt_agent,
                              env_outcome_verifier, reset_env
    evals/agent.toml          every task

``--check`` compares the bundle with what it would write.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "datasets"

ENV_TOML = 'environment_name = "mirage"\nenv_provider_type = "mirage"\n'
DOCKERFILE = """\
# agent-env's env folder takes a Dockerfile. The mirage topology
# (vfsbench_agentenv.topology) runs this env's server on this machine
# instead, so no image is built or run.
FROM scratch
"""
ARTIFACT_TOML = 'type = "environment"\nenvironment_name = "mirage"\n'
VERIFY = '''\
"""The task's grade, by its dataset's own grader (vfsbench_agentenv.grade)."""
from vfsbench_agentenv.grade import verify  # noqa: F401
'''


def task_json(task: str, instruction: str) -> str:
    steps = [
        {
            "id": "env",
            "type": "deploy_env",
            "env_id": "mirage",
            "artifact_id": task
        },
        {
            # agent-env's default agent (Claude Code), or --agent <name>,
            # its own tools off: the env's shell is its one tool.
            "id": "agent",
            "type": "deploy_agent",
            "env_ids": ["mirage"],
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
            "type": "env_outcome_verifier",
            "env_id": "mirage",
            "file_artifact_id": "grade",
            "verifier_id": "reward",
            "depends_on": ["solve"]
        },
        {
            # data/reset closes the workspace once it's graded; the env's
            # server, outside agent-env's sandboxes, ends with the run.
            "id": "close",
            "type": "reset_env",
            "env_id": "mirage",
            "depends_on": ["grade"]
        },
    ]
    return json.dumps(steps, indent=2) + "\n"


def bundle(dataset: str) -> dict[str, str]:
    """Each file of the bundle, by its path in it."""
    files = {
        "bundle.toml": 'requires = ["vfsbench-agentenv"]\n',
        "envs/mirage/env.toml": ENV_TOML,
        "envs/mirage/Dockerfile": DOCKERFILE,
        "artifacts/grade/verify.py": VERIFY,
    }
    tasks = []
    for workspace in sorted((DATASETS / dataset).glob("*/workspace")):
        task = workspace.parent.name
        instruction = (workspace.parent / "harbor" /
                       "instruction.md").read_text()
        files[f"artifacts/{task}/artifact.toml"] = ARTIFACT_TOML
        files[f"artifacts/{task}/task.json"] = json.dumps(
            {"task": f"{dataset}/{task}"}) + "\n"
        files[f"tasks/{task}.json"] = task_json(task, instruction)
        tasks.append(task)
    files["evals/agent.toml"] = "tasks = [\n" + "".join(
        f'  "{task}",\n' for task in tasks) + "]\n"
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dataset")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    out = DATASETS / args.dataset / "agentenv"
    files = bundle(args.dataset)
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
