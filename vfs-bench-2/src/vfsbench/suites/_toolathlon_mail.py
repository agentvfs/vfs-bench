"""Run Mirage IMAP/SMTP on private loopback ports with one database per
trial."""

import asyncio
import base64
import json
import os
import re
import shutil
import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path
from uuid import uuid4

from ._npm import install_locked

VENDOR = Path(__file__).parent / "vendor/mail"


def read_state(db: Path):
    with closing(sqlite3.connect(f"{db.as_uri()}?mode=ro",
                                 uri=True)) as connection:
        connection.execute("BEGIN")
        folders = {}
        for tenant, folder in connection.execute(
                "SELECT tenant, name FROM MailMailbox ORDER BY tenant, seq"):
            folders.setdefault(tenant, {})[folder] = []
        for tenant, folder, uid, flags, source in connection.execute(
                "SELECT tenant, mailbox, uid, flags, source FROM MailMessage "
                "ORDER BY tenant, mailbox, uid"):
            folders[tenant][folder].append({
                "uid":
                uid,
                "flags":
                flags,
                "rfc822":
                base64.b64encode(source).decode()
            })
    return folders


@asynccontextmanager
async def mail_server(dataset,
                      run_dir,
                      accounts,
                      timestamp,
                      *,
                      domain="mcp.com"):
    node, modules = await asyncio.to_thread(install_locked, dataset, VENDOR)
    root = run_dir / "mail"
    root.mkdir()
    (root / "node_modules").symlink_to(modules, target_is_directory=True)
    for name in ("start.mjs", "arms.mjs", "schema.sql"):
        shutil.copyfile(VENDOR / name, root / name)
    token = uuid4().hex
    tenants = []
    for address in accounts:
        local, at, host = address.partition("@")
        if not at or host != domain or not local:
            raise ValueError(
                f"Mailbox is outside the fixture domain: {address}")
        tenants.append(local)
    seed = {
        "run": token,
        "timestamp": timestamp,
        "accounts": sorted(set(tenants))
    }
    (root / "seed.json").write_text(json.dumps(seed))
    proc = await asyncio.create_subprocess_exec(
        str(node),
        str(root / "start.mjs"),
        cwd=root,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={
            "MIRAGE_MAIL_DOMAIN": domain,
            "MIRAGE_BIND_HOST": "127.0.0.1",
            "MIRAGE_ADVERTISE_HOST": "127.0.0.1",
            "PATH": os.defpath
        },
    )
    try:
        async with asyncio.timeout(30):
            line = await proc.stdout.readline()
            if not line:
                raise RuntimeError("Mirage mail startup failed: " +
                                   (await proc.stderr.read()).decode()[-1500:])
        endpoints = json.loads(line)
        config = {"use_ssl": False, "password": token}
        for protocol in ("imap", "smtp"):
            url = endpoints["MAIL_" + protocol.upper() + "_URL"]
            match = re.fullmatch(protocol + r"://127\.0\.0\.1:([0-9]+)", url)
            if not match:
                raise RuntimeError(f"Unexpected Mirage mail endpoint {url!r}")
            config[protocol + "_host"] = "127.0.0.1"
            config[protocol + "_port"] = int(match[1])

        async def state():
            return await asyncio.to_thread(read_state, root / "mail.sqlite")

        yield config, state
    finally:
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 4)
            except TimeoutError:
                proc.kill()
                await proc.wait()
