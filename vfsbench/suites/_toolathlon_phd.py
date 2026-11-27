"""Toolathlon PhD application with local original email, memory and PDF tool
servers."""

import asyncio
import hashlib
import imaplib
import json
import tarfile
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from pathlib import Path

from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from ._toolathlon_documents import document_tools
from ._toolathlon_email_tools import NODE, service
from ._toolathlon_schedule import memory_session

MANIFEST = "f6f1222af29a01c138f2152abd752fb726552e2b29eca3cfab092e41ec4883eb"
MANAGER = {
    "path":
    "vfs-bench-1/submodule/Toolathlon/utils/app_specific/poste/"
    "local_email_manager.py",
    "url":
    "https://raw.githubusercontent.com/hkust-nlp/Toolathlon/"
    "9be8d8fe07a497b18ee61e3f2ae694e9797f39eb/utils/app_specific/"
    "poste/local_email_manager.py",
    "sha256":
    "a8037b600ff6a498614c710d15fb75a5064054f8af4c8c476427975957a2b55e",
    "size":
    27490
}


def _stage(task, root):
    manifest = task.manifest
    if hashlib.sha256(
            json.dumps(manifest, sort_keys=True,
                       separators=(",",
                                   ":")).encode()).hexdigest() != MANIFEST:
        raise ValueError("Unexpected release manifest for apply-phd-email")
    root.mkdir()
    with tarfile.open(
            task.file("upstream/initial_workspace/files.tar.gz")) as archive:
        archive.extractall(root, filter="data")
    sender, receiver = (json.loads(
        task.file("shared/" + name + ".json").read_bytes())
                        for name in ("emails_config", "receiver_config"))
    backup = json.loads(
        task.file("upstream/files/emails_backup.json").read_bytes())["emails"]
    today = datetime.fromisoformat(
        task.file(
            "upstream/groundtruth_workspace/today.txt").read_text().strip())
    return sender, receiver, backup, today.replace(
        tzinfo=UTC), task.file("vfs/SKILL.md").read_text()


def _seed(settings, sender, emails):
    with imaplib.IMAP4(settings["imap_host"],
                       settings["imap_port"],
                       timeout=20) as client:
        client.login(sender, settings["password"])
        for row in emails:
            message = EmailMessage()
            message["From"], message["To"], message["Subject"] = row[
                "from_addr"], row["to_addr"], row["subject"]
            day = parsedate_to_datetime(row["date"])
            message["Date"] = day
            message.set_content(row["body_text"] or "")
            if row.get("body_html"):
                message.add_alternative(row["body_html"], subtype="html")
            if row.get("attachments"):
                raise ValueError(
                    "Unexpected incoming attachment in pinned PhD mailbox "
                    "capture")
            status, _ = client.append(
                row.get("folder") or "INBOX", None, day, message.as_bytes())
            if status != "OK":
                raise RuntimeError(
                    "Mirage mail could not load the captured message")


async def _grade(task, config, view):

    def inputs():
        files = {
            "driver.py":
            Path(__file__).with_name("_phd_mail_grader.py").read_bytes(),
            "truth/files.tar.gz":
            task.file(
                "upstream/groundtruth_workspace/files.tar.gz").read_bytes(),
            "code/files/receiver_config.json":
            task.file("shared/receiver_config.json").read_bytes(),
            "code/utils/app_specific/poste/local_email_manager.py":
            task._dataset._source_file(MANAGER).read_bytes()
        }
        for name in ("main.py", "check_local_email.py"):
            files["code/evaluation/" +
                  name] = task.file("upstream/evaluation/" +
                                    name).read_bytes()
        return files

    files = await asyncio.to_thread(inputs)
    files["mail.json"] = json.dumps(await view.service_state("mail")).encode()
    async with VerifierGuest(config) as guest:
        result = await guest.run(files, ["python3", "-I", "driver.py"])
    if result.return_code not in (0, 10):
        raise RuntimeError("PhD mailbox grader failed: " +
                           (result.stdout + result.stderr)[-1800:])
    return {
        "reward": int(result.return_code == 0),
        "grader": "toolathlon/evaluation/main.py"
    }


@asynccontextmanager
async def prepare(task, config, run_dir):
    root = run_dir / "workspace"
    sender, receiver, messages, today, skills = await asyncio.to_thread(
        _stage, task, root)
    accounts = {
        sender["email"], receiver["email"], *(m["from_addr"] for m in messages)
    }
    async with (service(task, run_dir, sender, accounts,
                        int(today.timestamp() * 1000)) as
                (settings, emails, state),
                document_tools(task, run_dir, root, skills,
                               ("pdf-tools", )) as (docs, _),
                memory_session(task,
                               run_dir,
                               root / "memory/memory.json",
                               node_image=NODE) as (memory, graph)):
        await asyncio.to_thread(_seed, settings, sender["email"], messages)

        async def install(workspace):
            for name, cli in {
                    **docs, "emails": emails,
                    "memory": memory
            }.items():
                workspace.register_cli(name, cli)

        workspace = {
            "system_time": today.isoformat(),
            "mounts": {
                "/mail": {
                    "vfs": "email",
                    "mode": "read",
                    "config": settings
                }
            },
            "clis": {
                "git": {
                    "cli": "git",
                    "machine": "in_process"
                }
            },
            "network": {
                "allowed_domains": [
                    f"127.0.0.1:{settings[p]}"
                    for p in ("imap_port", "smtp_port")
                ]
            }
        }
        yield TrialEnvironment(
            workspace=workspace,
            verifier=SuiteVerifier(lambda view: _grade(task, config, view)),
            instructions=skills,
            state_readers={
                "mail": state,
                "memory": graph
            },
            install=install)
