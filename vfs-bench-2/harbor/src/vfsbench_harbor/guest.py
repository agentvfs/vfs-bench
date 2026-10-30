"""The verifier's side of a trial's microVM, which ``microsandbox.py`` boots.

    python3 -I /.vfsbench/guest.py [<command>]

It runs in the VM's own Python, on the standard library alone. Its first
line out is ``STARTED``, so the host knows the VM ran it: msb now and then
leaves a command unrun, and the host boots another VM then. Then, until the
command ends, a ``BEAT`` line every second, and ``END`` once it has: a
guest msb hangs later stops beating, which a slow test does not (the host
boots another VM then too). It reads ``/.vfsbench/config.json``:

- ``ports``: each upstream port the verifier reaches on localhost, and the
  host port behind it. Each is listened on at 127.0.0.1 and ::1, and every
  connection is relayed, byte for byte, to that port on the host's loopback
  (``host.microsandbox.internal``'s IPv4 address). That host port is the
  trial's proxy, which routes the request to the trial's own run; the VM's
  network reaches nothing else.
- ``tmp``: where the trial's ``/tmp`` was copied, since the VM's ``/tmp`` is
  a tmpfs that hides anything copied there before boot.
- ``command``, ``cwd`` and ``env``: the test script's command line, run with
  ``/bin/sh -c`` once the ports listen; this exits with its status.
- ``now``: where given, the trial's time (its run's clock, as the
  workspace reads it), to which the VM's clock is set before the command
  runs (``verifier.clock`` in the task's mirage.yaml).
- ``pull``: a directory (``/logs/verifier``) written to stdout as a tar
  after ``END``, its regular files and directories only. The command's own
  output goes to stderr.

A command given as the argument runs in place of the config's, its output
on stdout, with no beats and nothing pulled (``isolation.py``'s probes).
"""
import asyncio
import json
import os
import shutil
import socket
import sys
import tarfile
import threading
import time

CONFIG = "/.vfsbench/config.json"
HOST = "host.microsandbox.internal"
STARTED = b"STARTED\n"
BEAT = b"BEAT\n"
END = b"END\n"


class Heart(threading.Thread):
    """``BEAT`` on stdout every second until stopped, from a thread, so the
    main thread's own blocking work (copying ``/tmp``) beats too."""

    def __init__(self):
        super().__init__(daemon=True)
        self.stopped = threading.Event()

    def run(self) -> None:
        while not self.stopped.wait(1):
            sys.stdout.buffer.write(BEAT)
            sys.stdout.buffer.flush()

    def stop(self) -> None:
        self.stopped.set()
        self.join()


async def pipe(reader: asyncio.StreamReader,
               writer: asyncio.StreamWriter) -> None:
    """Copy one direction of a connection until it ends, then end it."""
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
        if writer.can_write_eof():
            writer.write_eof()
    except (ConnectionError, OSError):
        writer.close()


async def relay(host: str, port: int, reader: asyncio.StreamReader,
                writer: asyncio.StreamWriter) -> None:
    """Relay one connection from localhost to the host's proxy."""
    try:
        up_reader, up_writer = await asyncio.open_connection(host, port)
    except OSError:
        writer.close()
        return
    try:
        await asyncio.gather(pipe(reader, up_writer), pipe(up_reader, writer))
    finally:
        up_writer.close()
        writer.close()


def regular(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    """Regular files and directories; no links, devices or pipes."""
    return info if info.isfile() or info.isdir() else None


async def main() -> int:
    sys.stdout.buffer.write(STARTED)
    sys.stdout.buffer.flush()
    probe = len(sys.argv) > 1
    heart = None if probe else Heart()
    if heart:
        heart.start()
    with open(CONFIG) as f:
        config = json.load(f)
    servers = []
    if config["ports"]:
        host = socket.getaddrinfo(HOST, None, socket.AF_INET)[0][4][0]
        for port, target in config["ports"].items():
            for address in ("127.0.0.1", "::1"):
                try:
                    servers.append(await asyncio.start_server(
                        lambda r, w, t=target: relay(host, t, r, w),
                        address,
                        int(port)))
                except OSError:
                    if address == "127.0.0.1":
                        raise
    if config.get("tmp") and os.path.isdir(config["tmp"]):
        shutil.copytree(config["tmp"],
                        "/tmp",
                        symlinks=True,
                        dirs_exist_ok=True)
    if config.get("now") is not None:
        time.clock_settime(time.CLOCK_REALTIME, config["now"])
    pull = None if probe else config.get("pull")
    process = await asyncio.create_subprocess_exec(
        "/bin/sh",
        "-c",
        sys.argv[1] if probe else config["command"],
        cwd=config["cwd"],
        env={
            **os.environ,
            **config["env"]
        },
        stdin=asyncio.subprocess.DEVNULL,
        stdout=None if probe else sys.stderr,
    )
    code = await process.wait()
    for server in servers:
        server.close()
    if heart:
        heart.stop()
        sys.stdout.buffer.write(END)
        sys.stdout.buffer.flush()
    if pull:
        os.makedirs(pull, exist_ok=True)
        with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as tar:
            tar.add(pull, arcname=".", filter=regular)
        sys.stdout.buffer.flush()
    return code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
