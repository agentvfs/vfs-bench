import imaplib
import json
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
TASK = "git-bug-hunt"
INITIAL = (REPO_ROOT / "submodule" / "Toolathlon" / "tasks" / "finalpool" /
           TASK / "initial_workspace")

sys.path.insert(0, str(REPO_ROOT / "agent"))

# Where the agent writes, defined once in agent/services.py.
from services import agent_workspace  # noqa: E402

MAIL_API = os.environ.get("MAIL_API", "http://localhost:8081").rstrip("/")


def workspace_dir() -> Path:
    """Return the agent workspace, matching run_agent.py's choice.

    Returns:
        Path: directory the agent sees as its workspace.
    """
    return agent_workspace(HERE.parent)


def reset_mail(*accounts: dict) -> None:
    """Purge every GreenMail mailbox and restore the standard folders.

    Reset leaves each account with INBOX alone, so anything that files a
    copy of what it sends fails: emails-mcp's send_email logs
    "APPEND failed. No such folder : Sent" and then reports success anyway,
    and a mirage arm reading /mail/Sent sees nothing. Real mail servers have
    these, so create them rather than let the difference show up as a result.

    Args:
        *accounts (dict): mailbox configs, Toolathlon's spelling.
    """
    req = urllib.request.Request(f"{MAIL_API}/api/service/reset",
                                 method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()

    for account in accounts:
        imap = imaplib.IMAP4(account["imap_server"], account["imap_port"])
        imap.login(account["email"], account["password"])
        for folder in ("Sent", "Drafts", "Trash", "Junk"):
            imap.create(folder)
        imap.logout()


def extract_repo(workspace: Path) -> None:
    """Extract the LUFFY repository into the agent workspace.

    Args:
        workspace (Path): directory to extract into.
    """
    tarball = INITIAL / "files.tar.gz"
    if not tarball.is_file():
        sys.exit(f"missing fixture {tarball}; init the Toolathlon submodule")
    with tarfile.open(tarball, "r:gz") as tar:
        tar.extractall(path=workspace, filter="data")


def main() -> None:
    """Reset the mailbox and lay down the workspace."""
    workspace = workspace_dir()
    workspace.mkdir(parents=True, exist_ok=True)
    extract_repo(workspace)
    shutil.copy2(INITIAL / "template.txt", workspace / "template.txt")

    receiver = json.loads((HERE / "receiver_config.json").read_text())
    sender = json.loads((HERE / "emails_config.json").read_text())
    reset_mail(receiver, sender)

    print(f"workspace={workspace}")
    print(f"repo={workspace / 'LUFFY'}")
    print(f"mailboxes cleared: {receiver['email']}, {sender['email']}")


if __name__ == "__main__":
    main()
