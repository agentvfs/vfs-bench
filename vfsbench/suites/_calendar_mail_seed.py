"""Run the trusted upstream email builders in a short-lived controller
subprocess."""

import ast
import imaplib
import json
import random
import runpy
import sys
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate
from pathlib import Path
from time import sleep
from types import ModuleType


def main(request):
    config, day = request["account"], datetime.fromisoformat(request["today"])
    if request["task"] == "set-conf-cr-ddl":
        build = runpy.run_path(request["seeder"])["build"]
        entries = json.loads(Path(request["files"][0]).read_bytes())["emails"]
        with imaplib.IMAP4(config["imap_server"],
                           config["imap_port"],
                           timeout=10) as client:
            client.login(config["email"], config["password"])
            for item in entries:
                message, folder = build(item, config["email"])
                status, _ = client.append(folder, None, day,
                                          message.as_bytes())
                if status != "OK":
                    raise RuntimeError(
                        "IMAP rejected a conference fixture message")
        return
    # The rest of this original module configures a real cloud account. Select
    # only the named pure mixer and local IMAP injector from its pinned source.
    path = Path(request["seeder"])
    names = {
        "load_user_emails_mapping", "create_unified_email_list",
        "inject_emails_to_imap"
    }
    tree = ast.parse(path.read_bytes())
    tree.body = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    random.seed(42)
    package = ModuleType("preprocess")
    package.__path__ = []
    sys.modules["preprocess"] = package
    helper = ModuleType("preprocess.inject_fake_emails")
    helper.__dict__.update(runpy.run_path(request["files"][-1]))
    sys.modules["preprocess.inject_fake_emails"] = helper
    namespace = {
        "__package__": "preprocess",
        "datetime": datetime,
        "timedelta": timedelta,
        "json": json,
        "random": random,
        "imaplib": imaplib,
        "MIMEMultipart": MIMEMultipart,
        "MIMEText": MIMEText,
        "formataddr": formataddr,
        "formatdate": formatdate,
        "sleep": sleep,
    }
    exec(compile(tree, str(path), "exec"), namespace)
    messages = namespace["create_unified_email_list"](day,
                                                      *request["files"][:3])
    if not namespace["inject_emails_to_imap"](config, messages):
        raise RuntimeError("The upstream interview mailbox import failed")
    with imaplib.IMAP4(config["imap_server"], config["imap_port"],
                       timeout=10) as client:
        client.login(config["email"], config["password"])
        status, rows = client.select("INBOX", readonly=True)
        if status != "OK" or int(rows[0]) != len(messages):
            raise RuntimeError(
                "The upstream interview import left an incomplete mailbox")


if __name__ == "__main__":
    main(json.load(sys.stdin))
