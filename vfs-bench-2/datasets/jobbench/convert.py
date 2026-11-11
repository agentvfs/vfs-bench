"""Write the JobBench tasks from what download.py fetched.

    uv run --project datasets/jobbench python -I datasets/jobbench/convert.py

Each task (``<split>-<occupation>-<n>``) is upstream's Harbor task as its
``render.py`` builds it, on vfsbench_harbor's mirage environment:

- ``harbor/instruction.md``: upstream's instruction, verbatim;
- ``harbor/task.toml``: upstream's timeouts and resources, its judge's
  settings under its own names, from the host's ``OPENAI_API_KEY``,
  ``OPENAI_BASE_URL`` and ``JUDGE_MODEL`` as the other datasets' judges take
  them (upstream's own model the default);
- ``workspace/verifier/RUBRICS.json``: upstream's rubric, which the grader
  reads as ``/tests/RUBRICS.json``;
- ``workspace/workspace.yaml``: in place of upstream's environment.Dockerfile,
  its ``task_folder/`` copied to ``/workspace/task_folder``, an empty
  ``/workspace/output``, and the image itself as a microsandbox machine
  (``download.py`` builds its snapshot) that runs ``python3`` and every
  program Mirage does not have (``@external``);
- ``workspace/files/task_folder/``: the task's files (not committed;
  download.py fetches them).

It also writes ``graders/manifest.json`` (each task's rubric, pinned, and the
output tree its grader reads) and ``harbor/job.yaml``.
"""
import ast
import hashlib
import json
import re
import shlex
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
STATE = ROOT / "state" / "jobbench"
SPLITS = {"dataset": "main", "dataset_easy": "easy"}
REVISION = "d43a665"
COMMIT = "660b33a86e"

TASK_TOML = '''version = "1.0"

[task]
name = "vfs-bench-2/jobbench.{name}"

[metadata]
id = "{task_id}"
split = "{split}"
occupation = "{occupation}"
task_number = "{number}"
upstream = "JobBench/job-bench@{revision}, Job-Bench/job-bench-eval@{commit}"

[verifier]
timeout_sec = 3600.0

[verifier.env]
JUDGE_API_KEY = "${{OPENAI_API_KEY:-}}"
JUDGE_API_BASE = "${{OPENAI_BASE_URL:-https://api.x.ai/v1}}"
JUDGE_MODEL = "${{JUDGE_MODEL:-grok-4.3}}"

[agent]
timeout_sec = 7200.0

[environment]
build_timeout_sec = 1800.0
cpus = 2
memory_mb = 4096
allow_internet = false
'''

WORKSPACE_YAML = '''# {name}, on vfsbench_harbor's mirage environment
# (datasets/jobbench/convert.py writes it).
#
# In place of upstream's environment.Dockerfile: its COPY of task_folder/ and
# its mkdir of /workspace/output, and its image, which download.py builds as
# a microsandbox snapshot. Each trial runs python3 and every program Mirage
# does not have in a sandbox of its own from it. No services.
fakes: {{}}
workdir: /workspace
machines:
  jobbench:
    snapshot: jobbench:{commit}
    env: {env}
workspace:
  runtimes:
    - name: remote
      machine: jobbench
      captures: ["@python", "@external"]
    - workspace
run:
  - mkdir -p /workspace/task_folder /workspace/output
copy:
  /workspace/task_folder: task_folder/
'''

TEST_SH = '''#!/usr/bin/env bash
# vfsbench_harbor:MirageVerifier grades this task; this script is not run.
echo "grade this task with --verifier vfsbench_harbor:MirageVerifier" >&2
exit 1
'''


def instruction() -> str:
    """``INSTRUCTION`` from upstream's render.py, as it gives every task."""
    tree = ast.parse(
        (STATE / "upstream/harbor/jobbench_harbor/render.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and [
                t.id for t in node.targets if isinstance(t, ast.Name)
        ] == ["INSTRUCTION"]:
            return ast.literal_eval(node.value)
    raise SystemExit("render.py has no INSTRUCTION")


def image_env() -> dict[str, str]:
    """The image's ``ENV``, which its snapshot does not keep."""
    text = (STATE / "upstream/harbor/templates/environment.Dockerfile"
            ).read_text().replace("\\\n", " ")
    return dict(
        pair.split("=", 1) for line in re.findall(r"^ENV (.+)$", text, re.M)
        for pair in shlex.split(line))


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def main() -> int:
    text = instruction()
    env = json.dumps(image_env())
    manifest, names = {}, []
    for source in sorted(STATE.glob("dataset*/*/task*")):
        folder, occupation, task = source.relative_to(STATE).parts
        split, number = SPLITS[folder], task.removeprefix("task")
        name = f"{split}-{occupation.replace('_', '-')}-{number}"
        names.append(name)
        out = HERE / name
        write(out / "harbor/instruction.md", text)
        write(
            out / "harbor/task.toml",
            TASK_TOML.format(name=name,
                             task_id=f"{occupation}__{task}",
                             split=split,
                             occupation=occupation,
                             number=number,
                             revision=REVISION,
                             commit=COMMIT))
        write(out / "harbor/environment/mirage.yaml",
              "workspace: ../../workspace\n")
        write(out / "harbor/tests/test.sh", TEST_SH)
        (out / "harbor/tests/test.sh").chmod(0o755)
        rubrics = (source / "RUBRICS.json").read_bytes()
        (out / "harbor/tests/RUBRICS.json").unlink(missing_ok=True)
        (out / "workspace/verifier").mkdir(parents=True, exist_ok=True)
        (out / "workspace/verifier/RUBRICS.json").write_bytes(rubrics)
        write(out / "workspace/workspace.yaml",
              WORKSPACE_YAML.format(name=name, commit=COMMIT, env=env))
        shutil.rmtree(out / "workspace/files", ignore_errors=True)
        shutil.copytree(source / "task_folder",
                        out / "workspace/files/task_folder")
        manifest[name] = {
            "files": {
                "RUBRICS.json": hashlib.sha256(rubrics).hexdigest()
            },
            "inputs": ["/tests/RUBRICS.json"],
            "trees": ["/workspace/output"],
        }
    write(HERE / "graders/manifest.json",
          json.dumps(manifest, indent=1) + "\n")
    write(
        HERE / "harbor/job.yaml", "\n".join([
            f"# The {len(names)} JobBench tasks ported here.",
            "# From vfs-bench-2/, after datasets/jobbench/download.py:",
            "#   uv run --project formats/harbor harbor run \\",
            "#     -c datasets/jobbench/harbor/job.yaml -a nop",
            "environment:",
            "  import_path: vfsbench_harbor:MirageEnvironment",
            "verifier:",
            "  import_path: vfsbench_harbor:MirageVerifier",
            "tasks:",
            *(f"  - path: datasets/jobbench/{n}/harbor" for n in names),
        ]) + "\n")
    print(f"{len(names)} tasks written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
