import base64
import email
import imaplib
import json
import runpy
import sys
from email import policy
from pathlib import Path, PurePosixPath
from types import ModuleType


def module(name):
    obj = ModuleType(name)
    sys.modules[name] = obj
    return obj


def main():
    boxes = json.loads(Path("mail.json").read_bytes())

    class Mailbox:
        error = imaplib.IMAP4.error

        def __init__(self, *args, **kwargs):
            pass

        def login(self, address, password):
            self.folders = boxes[address.split("@")[0]]
            return "OK", []

        def select(self, folder):
            self.rows = [
                base64.b64decode(m["rfc822"]) for m in self.folders[folder]
            ]
            return "OK", [str(len(self.rows)).encode()]

        def search(self, charset, criterion):
            phrase = criterion.removeprefix('SUBJECT "').removesuffix(
                '"').casefold()
            ids = [
                str(i) for i, raw in enumerate(self.rows, 1)
                if criterion == "ALL" or phrase in str(
                    email.message_from_bytes(raw, policy=policy.default)
                    ["Subject"]).casefold()
            ]
            return "OK", [" ".join(ids).encode()]

        def fetch(self, num, selector):
            if selector != "(RFC822)":
                raise ValueError("Unexpected email message selector")
            return "OK", [(b"RFC822", self.rows[int(num) - 1])]

        def logout(self):
            return "BYE", []

    # The source manager writes received filenames into its temporary grader
    # directory.
    # Confine those writes before handing it the messages from the isolated
    # trial.
    for user in boxes.values():
        for row in user.get("INBOX", []):
            message = email.message_from_bytes(base64.b64decode(row["rfc822"]),
                                               policy=policy.default)
            for part in message.walk():
                name = part.get_filename()
                if name and (PurePosixPath(name).name != name
                             or name in {".", ".."}):
                    return 10

    retries = module("tenacity")
    retries.retry = lambda *args, **kwargs: lambda f: f

    def noop(*args, **kwargs):
        return None

    retries.retry_if_exception_type = noop
    retries.stop_after_attempt = noop
    retries.wait_exponential = noop
    imaplib.IMAP4 = imaplib.IMAP4_SSL = Mailbox
    module("utils.evaluation.retry").grade_with_retry = lambda check: check()
    sys.path.insert(0, str(Path("code").resolve()))
    sys.argv = [
        "evaluation.main", "--agent_workspace", "agent",
        "--groundtruth_workspace", "truth"
    ]
    try:
        runpy.run_module("evaluation.main", run_name="__main__")
    except SystemExit as exc:
        return 10 if exc.code == 1 else exc.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
