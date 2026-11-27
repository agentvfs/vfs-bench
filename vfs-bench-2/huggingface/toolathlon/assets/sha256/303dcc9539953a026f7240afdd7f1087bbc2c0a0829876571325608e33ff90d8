import email
import imaplib
import json
import re
import sys
from email import policy
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUBJECT = "Performance Issue Investigation"
REQUIRED_PHRASES = ("performance issue", "LUFFY repository", "get in touch",
                    "LUFFY Team")


def body_of(raw: bytes) -> str:
    """Return a message's text body.

    Args:
        raw (bytes): RFC822 payload.

    Returns:
        str: the text/plain body, or the whole payload if there is no part.
    """
    msg = email.message_from_bytes(raw, policy=policy.default)
    part = msg.get_body(preferencelist=("plain", "html"))
    return part.get_content() if part else str(msg.get_payload())


def matching_bodies(config: dict) -> list[str]:
    """Fetch the bodies of every message whose subject names the task.

    Args:
        config (dict): receiver mailbox config, Toolathlon's spelling.

    Returns:
        list[str]: message bodies, newest last.
    """
    imap = imaplib.IMAP4(config["imap_server"], config["imap_port"])
    imap.login(config["email"], config["password"])
    imap.select("INBOX")
    _, data = imap.search(None, "ALL")
    bodies = []
    for uid in data[0].split():
        _, payload = imap.fetch(uid, "(RFC822)")
        raw = payload[0][1]
        subject = email.message_from_bytes(raw, policy=policy.default).get(
            "Subject", "")
        if SUBJECT in subject:
            bodies.append(body_of(raw))
    imap.logout()
    return bodies


def check(body: str, expected: dict) -> list[str]:
    """Apply the upstream checks to one message body.

    Args:
        body (str): the message body.
        expected (dict): the ground-truth author, hash and commit message.

    Returns:
        list[str]: one entry per failed check; empty means the message passes.
    """
    errors = []

    name = re.search(r"Dear\s+([^,\n]+)", body, re.IGNORECASE)
    if not name:
        errors.append("author name not found")
    elif name.group(1).strip() != expected["name"]:
        errors.append(f"author name: want {expected['name']!r}, "
                      f"got {name.group(1).strip()!r}")

    sha = re.search(r"Commit\s+Hash:\s*([a-f0-9]+)", body, re.IGNORECASE)
    if not sha:
        errors.append("commit hash not found")
    elif sha.group(1).strip() != expected["commit_hash"]:
        errors.append(f"commit hash: want {expected['commit_hash']}, "
                      f"got {sha.group(1).strip()}")

    message = re.search(
        r"Commit\s+Message:\s*\n(.+?)(?=\n\n|\nPlease|\nThank|$)", body,
        re.IGNORECASE | re.DOTALL)
    if not message:
        errors.append("commit message not found")
    else:
        first = expected["commit_message"].split("\n")[0].strip()
        if first.lower() not in message.group(1).strip().lower():
            errors.append(f"commit message missing {first!r}")

    for phrase in REQUIRED_PHRASES:
        if phrase.lower() not in body.lower():
            errors.append(f"missing phrase {phrase!r}")

    return errors


def main() -> None:
    """Print the verdict and exit non-zero if no message passes."""
    config = json.loads((HERE / "receiver_config.json").read_text())
    expected = json.loads((HERE / "expected.json").read_text())

    bodies = matching_bodies(config)
    if not bodies:
        sys.exit(f"FAIL no message to {config['email']} with {SUBJECT!r} "
                 "in the subject")

    for i, body in enumerate(bodies, 1):
        errors = check(body, expected)
        if not errors:
            print(f"PASS message {i}/{len(bodies)}")
            return
        print(f"message {i}/{len(bodies)}:")
        for err in errors:
            print(f"  - {err}")
    sys.exit("FAIL no message passed every check")


if __name__ == "__main__":
    main()
