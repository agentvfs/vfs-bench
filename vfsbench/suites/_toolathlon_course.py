import ast
import asyncio
import hashlib
import imaplib
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from email import policy
from email.message import EmailMessage
from email.utils import format_datetime, formataddr
from pathlib import Path

from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from ._toolathlon_mail import mail_server

HERE = Path(__file__).parent
MANIFEST = "8152c4ca6e543e093f4d70e584632897310c5defd0415afbdf1a8906d908ca56"
OPS = {
    "url":
    "https://raw.githubusercontent.com/hkust-nlp/Toolathlon/"
    "9be8d8fe07a497b18ee61e3f2ae694e9797f39eb/utils/app_specific/"
    "poste/ops.py",
    "sha256":
    "4d782d28208a04ec4b8640cfd44550a5e2121c462400ca051d0e16bd94fbdae6",
    "size":
    16993,
}


def seed_inbox(task, account, settings, today):
    # Upstream's preprocessor groups the original messages by sender account in
    # temp_send.
    with imaplib.IMAP4(settings["imap_host"],
                       settings["imap_port"],
                       timeout=15) as mailbox:
        mailbox.login(account, settings["password"])
        for asset in task.manifest["source_assets"]:
            name = asset["target"]
            if not name.startswith("upstream/temp_send/") or not name.endswith(
                    ".jsonl"):
                continue
            sender = Path(name).stem.replace("_at_", "@")
            for line in task.file(name).read_text().splitlines():
                row = json.loads(line)
                message = EmailMessage(policy=policy.SMTP)
                message["From"] = formataddr((row["sender_name"], sender))
                message["To"], message["Subject"], message[
                    "Date"] = account, row["subject"], format_datetime(today)
                message.set_content(row["content"],
                                    subtype=row["content_type"])
                status, response = mailbox.append("INBOX", None, today,
                                                  message.as_bytes())
                if status != "OK":
                    raise RuntimeError(
                        f"IMAP rejected course inbox seed: {response!r}")


def verifier_files(task):
    source = task._dataset._source_file(OPS).read_text()
    function = next(
        n for n in ast.parse(source).body
        if isinstance(n, ast.FunctionDef) and n.name == "extract_email_body")
    decoder = ast.get_source_segment(source, function)
    files = {
        "driver.py": (HERE / "_toolathlon_grader.py").read_bytes(),
        "requirements.json":
        b"[]",
        "trajectory.json":
        b"{}",
        "code/evaluation/__init__.py":
        b"",
        "code/mail_replay.py": (HERE / "_course_mail_grader.py").read_bytes(),
        "code/utils/app_specific/poste/ops.py":
        ("import re\n\n" + decoder + "\n").encode()
    }
    for name in ("check_local.py", "main.py", "email_student.json"):
        files["code/evaluation/" + name] = task.file("upstream/evaluation/" +
                                                     name).read_bytes()
    return files


@asynccontextmanager
async def prepare(task, config, run_dir):
    manifest = await asyncio.to_thread(lambda: task.manifest)
    if hashlib.sha256(
            json.dumps(manifest, sort_keys=True,
                       separators=(",",
                                   ":")).encode()).hexdigest() != MANIFEST:
        raise ValueError("Unexpected Course Assistant release manifest")

    def inputs():
        files = task.files([
            "upstream/emails_config.json", "upstream/emails_all_config.json",
            "upstream/groundtruth_workspace/today.txt",
            "upstream/initial_workspace/nlp_statistics.xlsx"
        ])
        account = json.loads(
            files["upstream/emails_config.json"].read_bytes())["email"]
        accounts = [
            row["email"] for row in json.loads(
                files["upstream/emails_all_config.json"].read_bytes())
        ]
        day = datetime.fromisoformat(
            files["upstream/groundtruth_workspace/today.txt"].read_text(
            ).strip())
        workspace = run_dir / "workspace"
        workspace.mkdir()
        (workspace / "nlp_statistics.xlsx").write_bytes(
            files["upstream/initial_workspace/nlp_statistics.xlsx"].read_bytes(
            ))
        return account, accounts, day.replace(tzinfo=UTC)

    account, accounts, today = await asyncio.to_thread(inputs)
    async with mail_server(task._dataset, run_dir, accounts,
                           int(today.timestamp() * 1000)) as (settings, state):
        await asyncio.to_thread(seed_inbox, task, account, settings, today)
        access = {**settings, "username": account}
        workspace = {
            "system_time": today.isoformat(),
            "mounts": {
                "/mail": {
                    "vfs": "email",
                    "mode": "read",
                    "config": access
                }
            },
            "clis": {
                "himalaya": {
                    "config": access
                }
            },
            "network": {
                "allowed_domains": [
                    f"127.0.0.1:{settings[p]}"
                    for p in ("imap_port", "smtp_port")
                ]
            },
        }

        async def evaluate(view):
            staged = await asyncio.to_thread(verifier_files, task)
            staged["mail.json"] = json.dumps(
                await view.service_state("mail")).encode()
            async with VerifierGuest(config) as guest:
                result = await guest.run(staged,
                                         ["python3", "-I", "driver.py"])
            if result.return_code not in (0, 10):
                raise RuntimeError(
                    f"Course Assistant grader failed: {result.stderr[-1200:]}")
            return {
                "reward": int(result.return_code == 0),
                "grader": "toolathlon/evaluation/main.py"
            }

        instructions = (
            f"Today is {today.date()}. Your teaching assistant account is "
            f"{account}. "
            "Read the simulated mailbox under /mail and the original "
            "gradebook under /workspace. "
            "Use the himalaya CLI to read and send mail and office or "
            "Python to work with the gradebook.")
        yield TrialEnvironment(workspace,
                               SuiteVerifier(evaluate),
                               instructions,
                               state_readers={"mail": state})
