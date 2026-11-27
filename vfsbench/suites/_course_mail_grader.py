"""Rebind the original course grader's IMAP reads to the frozen mailboxes
inside the verifier VM."""

import base64
import email
import imaplib
import json
from pathlib import Path


def install():
    mailboxes = json.loads(Path("mail.json").read_bytes())

    class Mailbox:

        def __init__(self, host, port):
            self.messages = None

        def login(self, address, password):
            self.folders = mailboxes[address.split("@")[0]]
            return "OK", []

        def select(self, folder):
            self.messages = [
                base64.b64decode(item["rfc822"])
                for item in self.folders[folder]
            ]
            return "OK", [str(len(self.messages)).encode()]

        def search(self, charset, key, value):
            if charset is not None or key != "SUBJECT":
                raise ValueError(f"Unexpected IMAP search {key}")
            phrase = value.strip('"').casefold()
            matches = [
                str(n) for n, raw in enumerate(self.messages, 1)
                if phrase in str(
                    email.message_from_bytes(raw).get("Subject",
                                                      "")).casefold()
            ]
            return "OK", [" ".join(matches).encode()]

        def fetch(self, number, selector):
            if selector != "(RFC822)":
                raise ValueError(f"Unexpected IMAP fetch {selector}")
            return "OK", [(b"RFC822", self.messages[int(number) - 1])]

        def logout(self):
            return "BYE", []

    imaplib.IMAP4 = Mailbox
