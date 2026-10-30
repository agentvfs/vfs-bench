"""Build-time extraction of literal reference data; never runs during grading.

No Python code is evaluated. Generated data is committed alongside the ports.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def serializable(value):
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    raise TypeError(type(value).__name__)


def extract():
    result = {}
    tasks = HERE.parent / "tasks/liveclawbench"
    for path in sorted(tasks.glob("*/tests/verify.py")):
        constants = {}
        for node in ast.parse(path.read_text()).body:
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            name = node.targets[0]
            if not isinstance(name, ast.Name) or not name.id.isupper():
                continue
            try:
                value = ast.literal_eval(node.value)
                json.dumps(value, default=serializable)
            except (ValueError, TypeError, SyntaxError):
                continue
            constants[name.id] = value
        if "_ORIGINAL_TEMPLATE_TEXT" in constants:
            constants["ORIGINAL_TEMPLATE_HASH"] = hashlib.sha256(
                constants.pop("_ORIGINAL_TEMPLATE_TEXT").encode()).hexdigest()
        result[path.parent.parent.name] = constants
    return json.dumps(
        result, ensure_ascii=False, indent=2, default=serializable) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = HERE / "reference-data.json"
    content = extract()
    if args.check:
        if path.read_text() != content:
            raise SystemExit("reference-data.json is stale; "
                             "review the ports before regenerating")
    else:
        path.write_text(content)
