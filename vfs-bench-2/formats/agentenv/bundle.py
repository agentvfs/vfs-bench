"""Write a dataset's agent-env bundle from its Harbor tasks.

    uv run --project formats/agentenv \
      python -I formats/agentenv/bundle.py <dataset> [--check]

``datasets/<dataset>/agentenv/`` holds, for each task:

    envs/<task>/env.toml       type = "mirage", the task's workspace
    tasks/<task>.json          deploy it, an agent solves it, grade
    tasks/<task>-oracle.json   deploy it, solve.sh solves it, grade

and ``evals/agent.toml`` and ``evals/oracle.toml``, which list them.
``--check`` compares the bundle with what it would write.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "datasets"


def env_toml(dataset: str, task: str) -> str:
    return f'type = "mirage"\ntask = "{dataset}/{task}"\n'


def steps(task: str, solve: list[dict]) -> str:
    grade = {
        "id": "grade",
        "type": "mirage_grade",
        "env_id": task,
        "verifier_id": "reward",
        "depends_on": [solve[-1]["id"]],
    }
    return json.dumps([{
        "id": "env",
        "type": "deploy_env",
        "env_id": task
    }, *solve, grade],
                      indent=2) + "\n"


def agent_task(task: str, instruction: str) -> str:
    # deploy_agent naming no agent deploys agent-env's default, Claude
    # Code; `agent-env run --agent <name>` runs another.
    return steps(task, [{
        "id": "agent",
        "type": "deploy_agent",
        "env_ids": [task],
        "depends_on": ["env"],
    }, {
        "id": "solve",
        "type": "prompt_agent",
        "prompt_id": "solve",
        "prompt": instruction,
        "depends_on": ["agent"],
    }])


def oracle_task(task: str) -> str:
    return steps(task, [{
        "id": "solve",
        "type": "mirage_oracle",
        "env_id": task,
        "depends_on": ["env"],
    }])


def eval_toml(names: list[str]) -> str:
    lines = "".join(f'  "{name}",\n' for name in names)
    return f"tasks = [\n{lines}]\n"


def bundle(dataset: str) -> dict[str, str]:
    """Each file of the bundle, by its path in it."""
    files = {"bundle.toml": 'requires = ["vfsbench-agentenv"]\n'}
    agents, oracles = [], []
    for harbor in sorted((DATASETS / dataset).glob("*/harbor")):
        task = harbor.parent.name
        instruction = (harbor / "instruction.md").read_text()
        files[f"envs/{task}/env.toml"] = env_toml(dataset, task)
        files[f"tasks/{task}.json"] = agent_task(task, instruction)
        agents.append(task)
        if (harbor / "solution" / "solve.sh").is_file():
            files[f"tasks/{task}-oracle.json"] = oracle_task(task)
            oracles.append(f"{task}-oracle")
    files["evals/agent.toml"] = eval_toml(agents)
    if oracles:
        files["evals/oracle.toml"] = eval_toml(oracles)
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
    print(f"{len(files)} files in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
