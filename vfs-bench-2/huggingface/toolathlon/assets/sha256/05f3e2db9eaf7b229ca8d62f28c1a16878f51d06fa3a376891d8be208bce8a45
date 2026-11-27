"""Regenerate mail through the pinned upstream preprocessor's own functions."""
import ast
import importlib.util
import json
import random
import subprocess
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / "submodule/Toolathlon"
TASK = ROOT / "tasks/finalpool/email-paper-homepage"


def build():
    path = ROOT / "utils/app_specific/poste/local_email_manager.py"
    spec = importlib.util.spec_from_file_location("original_mail", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    manager = module.LocalEmailManager.__new__(module.LocalEmailManager)
    manager.verbose = False
    today = TASK / "groundtruth_workspace/today.txt"
    # This checked-in date is upstream's input, not the wall clock.
    datetime.fromisoformat(today.read_text().strip())
    legacy = manager.load_emails_from_jsonl(
        str(TASK / "files/emails.jsonl"),
        str(TASK / "files/placeholder_values.json"), str(today))
    source = subprocess.check_output([
        "git", "-C",
        str(ROOT), "show",
        "HEAD:tasks/finalpool/email-paper-homepage/preprocess/main.py"
    ],
                                     text=True)
    function = next(node for node in ast.parse(source).body
                    if isinstance(node, ast.FunctionDef)
                    and node.name == "to_importable_emails_format")
    namespace = dict(datetime=datetime,
                     timedelta=timedelta,
                     timezone=timezone,
                     random=random,
                     format_datetime=format_datetime)
    exec(
        compile(ast.Module(body=[function], type_ignores=[]),
                "original_mail_preprocessor", "exec"), namespace)
    receiver = json.loads((TASK / "emails_config.json").read_text())["email"]
    result = namespace[function.name](legacy, receiver, str(today))
    # Export time is bookkeeping, never imported as a message. Make the
    # derived artifact deterministic while retaining every imported field.
    result.pop("export_date")
    return result


def main():
    Path(__file__).with_name("importable_emails.json").write_text(
        json.dumps(build(), ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
