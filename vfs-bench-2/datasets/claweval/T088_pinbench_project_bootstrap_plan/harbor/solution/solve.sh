#!/usr/bin/env bash
# Upstream's reference_solution, through the CLI: four todo tasks, one for
# the package under src/datautils, the tests, pyproject metadata and the
# README, then the plan in the reply. Each step's command and output go to
# the trajectory (trajectory.py), which ends with reply.md.
S=/tmp/oracle
mkdir -p "$S"
n=0
step() {
  n=$((n + 1))
  cat > "$S/$n.cmd"
  sh "$S/$n.cmd" > "$S/$n.out" 2>&1
  cat "$S/$n.out"
}
step <<'STEP'
todo create-task --title "Create the package structure under src/datautils" --description "Add src/datautils/__init__.py with the version and the public API, and one module per feature area (io, transform, validate)." --priority high
STEP
step <<'STEP'
todo create-task --title "Add tests for datautils" --description "Create tests/ with pytest configuration, a conftest.py for shared fixtures and a test module per package module; wire pytest into CI." --priority high
STEP
step <<'STEP'
todo create-task --title "Write pyproject metadata for datautils" --description "Add pyproject.toml with the build system, project name, version, description, Python requirement, dependencies and the src layout for the package." --priority medium
STEP
step <<'STEP'
todo create-task --title "Write the README for datautils" --description "Add README.md with the purpose of the library, installation, a quick-start example, how to run the tests and how to contribute." --priority medium
STEP
step <<'STEP'
todo list-tasks
STEP
python3 /solution/trajectory.py "$S" /solution/reply.md /logs/agent/trajectory.json
