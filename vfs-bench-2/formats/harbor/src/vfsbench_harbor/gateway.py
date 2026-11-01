"""A trial's gateway to its agent's model: the run's date in place of the
host's.

The agent runs on the host (agents.py), so the date its CLI tells the model
is the host's: Codex sends ``<current_date>`` and Claude Code "Today's date
is" in each request. The trial's services and workspace are at the run's
date instead (the task's epoch, moving on since the trial started:
``MirageEnvironment.now``), as a container's mocks and clock agree. The
CLIs take no date to tell the model, and run under the hardened runtime,
which a faked clock cannot reach, so the gateway stands between the CLI and
its model: in each request to a model's endpoint, the date the CLI states
(Codex's ``<current_date>``, Claude Code's "Today's date is") becomes the
run's where it is the host's (today, in UTC or in local time), as does the
time zone Codex names (``<timezone>``), and the request is sent on; the
reply comes back as it is, streamed. Nothing else in a request changes: a
date in the task's data, a tool's result or the conversation is the
model's to read as it is.

The gateway is the CLI's HTTPS proxy (``HTTPS_PROXY``), so the CLI keeps
its own endpoints, which Codex on a ChatGPT login requires: its workspace
routing takes only ChatGPT's own HTTPS origin. A ``CONNECT`` to an HTTPS
model endpoint is answered with TLS from a certificate for its host,
minted from a CA of the Harbor process's (``Authority``), which the CLI is
told to trust with the usual roots (``CODEX_CA_CERTIFICATE``,
``NODE_EXTRA_CA_CERTS``); one to a plain-HTTP model endpoint is served as
HTTP. Every other ``CONNECT`` is a plain tunnel, and a plain-HTTP request
in absolute form is forwarded as it comes.

    gateway = Gateway({("chatgpt.com", 443, True)}, environment, log)
    proxy = await gateway.start()      # http://127.0.0.1:<port>
    await gateway.close()

A body the CLI compressed (gzip or zstd) is read whole and sent on
uncompressed. A websocket upgrade is refused (404), so a CLI that tries one
first (Codex) falls back to HTTP, whose bodies the gateway can read.
"""
import asyncio
import atexit
import contextlib
import functools
import gzip
import os
import re
import shutil
import ssl
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import certifi
import h11
from aiohttp import ClientSession, ClientTimeout
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from vfsbench_harbor.environment import MirageEnvironment

# What a hop takes for itself, never forwarded.
HOP = {
    "connection", "content-encoding", "content-length", "host", "keep-alive",
    "proxy-connection", "proxy-authorization", "te", "trailer",
    "transfer-encoding", "upgrade"
}
READ = 1 << 16

# Where each CLI states the date, the date itself the second group: Codex's
# environment context, and Claude Code's line, whose apostrophe varies
# (``'``, ``’``, or the JSON escape of either), "now" when it has moved on.
DATED = (rb"(<current_date>)(\d{4}-\d{2}-\d{2})(?=</current_date>)",
         rb"(Today\S{1,6}s date is (?:now )?)(\d{4}-\d{2}-\d{2})")


class Authority:
    """The Harbor process's CA, minted once and removed when it exits: a
    server context for each model host, and a bundle of the CA with
    certifi's roots for a CLI to trust."""

    def __init__(self) -> None:
        self.directory = Path(tempfile.mkdtemp(prefix="vfsbench-gateway-"))
        atexit.register(shutil.rmtree, self.directory, ignore_errors=True)
        self._key = ec.generate_private_key(ec.SECP256R1())
        self._name = x509.Name(
            [x509.NameAttribute(NameOID.COMMON_NAME, "vfsbench gateway CA")])
        ca = self._certificate(self._name, self._key, True, None)
        self.bundle = self.directory / "trust.pem"
        self.bundle.write_bytes(
            Path(certifi.where()).read_bytes() +
            ca.public_bytes(serialization.Encoding.PEM))

    def _certificate(self, subject: x509.Name, key, ca: bool,
                     host: str | None) -> x509.Certificate:
        now = datetime.now(timezone.utc)
        builder = (x509.CertificateBuilder().subject_name(subject).issuer_name(
            self._name).public_key(key.public_key()).serial_number(
                x509.random_serial_number()).not_valid_before(now - timedelta(
                    days=1)).not_valid_after(now +
                                             timedelta(days=30)).add_extension(
                                                 x509.BasicConstraints(
                                                     ca=ca, path_length=None),
                                                 critical=True))
        # Key identifiers and usages, which strict verifiers (Python's since
        # 3.13) require of a chain.
        builder = builder.add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()),
            critical=False).add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(
                    self._key.public_key()),
                critical=False).add_extension(x509.KeyUsage(
                    digital_signature=not ca,
                    content_commitment=False,
                    key_encipherment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=ca,
                    crl_sign=ca,
                    encipher_only=False,
                    decipher_only=False),
                                              critical=True)
        if not ca:
            builder = builder.add_extension(x509.ExtendedKeyUsage(
                [x509.ExtendedKeyUsageOID.SERVER_AUTH]),
                                            critical=False)
        if host is not None:
            builder = builder.add_extension(x509.SubjectAlternativeName(
                [x509.DNSName(host)]),
                                            critical=False)
        return builder.sign(self._key, hashes.SHA256())

    @functools.cache
    def context(self, host: str) -> ssl.SSLContext:
        """A server context with a certificate for ``host``."""
        key = ec.generate_private_key(ec.SECP256R1())
        cert = self._certificate(
            x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)]), key,
            False, host)
        pem = serialization.Encoding.PEM
        cert_file = self.directory / f"{host}.pem"
        key_file = self.directory / f"{host}.key"
        cert_file.write_bytes(cert.public_bytes(pem))
        key_file.write_bytes(
            key.private_bytes(pem, serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption()))
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(cert_file, key_file)
        context.set_alpn_protocols(["http/1.1"])
        return context


@functools.cache
def authority() -> Authority:
    return Authority()


@functools.cache
def _host_zone() -> str | None:
    """The host's time zone, as an IANA name (``America/Los_Angeles``)."""
    if os.environ.get("TZ"):
        return os.environ["TZ"].removeprefix(":")
    with contextlib.suppress(OSError):
        target = os.readlink("/etc/localtime")
        if "zoneinfo/" in target:
            return target.split("zoneinfo/", 1)[1]
    return None


def _plain(body: bytes, encoding: str) -> bytes:
    if encoding in ("", "identity"):
        return body
    if encoding == "gzip":
        return gzip.decompress(body)
    if encoding == "zstd":
        from compression import zstd
        return zstd.decompress(body)
    raise ValueError(f"a request body in {encoding!r} cannot be read")


class Gateway:
    """One trial's gateway: an HTTPS proxy that puts the trial's date in
    each request to the model endpoints ``endpoints``.

    Args:
        endpoints: each endpoint whose requests carry the date to the
            model, as ``(host, port, tls)``.
        environment: the trial's, whose clock is the run's.
        log: where each request's method, host, path and status go when
            the gateway closes.
    """

    def __init__(self, endpoints: set[tuple[str, int, bool]],
                 environment: MirageEnvironment, log: Path):
        self._tls = {(host, port) for host, port, tls in endpoints if tls}
        self._plain = {(host, port)
                       for host, port, tls in endpoints if not tls}
        self._environment = environment
        self._log_path = log
        self._log: list[str] = []
        self._server: asyncio.Server | None = None
        self._session: ClientSession | None = None

    def redate(self, body: bytes) -> tuple[bytes, bool]:
        """``body`` with the date its CLI states, where it is the host's,
        the trial's instead, and the time zone Codex names
        (``<timezone>``) the trial's, UTC, as its workspace and services
        keep time; and whether anything changed."""
        run = self._environment.now().date().isoformat().encode()
        host = {
            d.isoformat().encode()
            for d in (datetime.now().date(), datetime.now(timezone.utc).date())
        }

        def swap(m: re.Match) -> bytes:
            return m[1] + (run if m[2] in host else m[2])

        out = body
        for pattern in DATED:
            out = re.sub(pattern, swap, out)
        zone = _host_zone()
        if zone not in (None, "UTC"):
            out = out.replace(f"<timezone>{zone}</timezone>".encode(),
                              b"<timezone>UTC</timezone>")
        return out, out != body

    async def start(self) -> str:
        self._session = ClientSession(timeout=ClientTimeout(total=None),
                                      auto_decompress=False)
        self._server = await asyncio.start_server(self._client, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}"

    async def close(self) -> None:
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        self._log_path.write_text("".join(f"{line}\n" for line in self._log))
        if self._server is not None:
            self._server.close()
        if self._session is not None:
            await self._session.close()

    async def _client(self, reader: asyncio.StreamReader,
                      writer: asyncio.StreamWriter) -> None:
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            line = head.split(b"\r\n", 1)[0].decode("latin-1")
            method, target, _ = line.split(" ", 2)
            if method != "CONNECT":
                # A plain-HTTP request, in absolute form, to a model host.
                await self._serve(reader, writer, None, head)
                return
            host, _, port = target.rpartition(":")
            endpoint = (host, int(port or 443))
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            if endpoint in self._tls:
                await writer.start_tls(authority().context(host))
                await self._serve(reader, writer, f"https://{target}", b"")
            elif endpoint in self._plain:
                # A plain-HTTP endpoint's tunnel (a websocket to one).
                await self._serve(reader, writer, f"http://{target}", b"")
            else:
                await self._tunnel(reader, writer, *endpoint)
        except Exception as e:
            # The CLI sees the connection close, as a proxy's failing would.
            self._log.append(f"connection ended: {type(e).__name__}: {e}")
        finally:
            with contextlib.suppress(Exception):
                writer.close()

    async def _tunnel(self, reader: asyncio.StreamReader,
                      writer: asyncio.StreamWriter, host: str,
                      port: int) -> None:
        """A host that is not a model's, passed through as it is."""
        far_reader, far_writer = await asyncio.open_connection(host, port)
        self._log.append(f"CONNECT {host}:{port} (tunnel)")

        async def pipe(src: asyncio.StreamReader,
                       dst: asyncio.StreamWriter) -> None:
            with contextlib.suppress(ConnectionError):
                while data := await src.read(READ):
                    dst.write(data)
                    await dst.drain()
            with contextlib.suppress(Exception):
                dst.close()

        await asyncio.gather(pipe(reader, far_writer),
                             pipe(far_reader, writer))

    async def _serve(self, reader: asyncio.StreamReader,
                     writer: asyncio.StreamWriter, origin: str | None,
                     data: bytes) -> None:
        """Each request on a connection to a model host, in turn: ``origin``
        for a TLS one, None for a plain proxy request in absolute form."""
        conn = h11.Connection(h11.SERVER)
        # Empty data would tell h11 the connection closed.
        if data:
            conn.receive_data(data)
        while True:
            event = conn.next_event()
            if event is h11.NEED_DATA:
                conn.receive_data(await reader.read(READ))
                continue
            if isinstance(event, h11.ConnectionClosed) or event is h11.PAUSED:
                return
            assert isinstance(event, h11.Request)
            body = b""
            while not isinstance(part := conn.next_event(), h11.EndOfMessage):
                if part is h11.NEED_DATA:
                    conn.receive_data(await reader.read(READ))
                elif isinstance(part, h11.Data):
                    body += part.data
            await self._answer(conn, writer, origin, event, body)
            if conn.our_state is h11.MUST_CLOSE:
                return
            conn.start_next_cycle()

    async def _answer(self, conn: h11.Connection, writer: asyncio.StreamWriter,
                      origin: str | None, request: h11.Request,
                      body: bytes) -> None:
        headers = {k.decode().lower(): v.decode() for k, v in request.headers}
        target = request.target.decode()
        url = f"{origin}{target}" if origin else target
        if headers.get("upgrade", "").lower() == "websocket":
            self._log.append(f"{request.method.decode()} {url} -> 404 here")
            await self._send(conn, writer, 404, [], [b""])
            return
        body = _plain(body, headers.get("content-encoding", "").lower())
        body, dated = self.redate(body)
        # The host's date left elsewhere in a request, as a task's data or
        # a tool's result may carry it, is the model's to read; noted, so
        # a date the CLI states in a new way shows up here.
        left = any(d.isoformat().encode() in body
                   for d in (datetime.now().date(),
                             datetime.now(timezone.utc).date()))
        forward = {k: v for k, v in headers.items() if k not in HOP}
        # The reply goes back as it comes, so only in an encoding the CLI
        # asked for: the client library would otherwise ask for its own.
        forward.setdefault("accept-encoding", "identity")
        assert self._session is not None
        async with self._session.request(request.method.decode(),
                                         url,
                                         headers=forward,
                                         data=body) as reply:
            self._log.append(f"{request.method.decode()} {url} -> "
                             f"{reply.status}" + (" (date)" if dated else "") +
                             (" (host's date left)" if left else ""))
            out = [(k, v) for k, v in reply.headers.items()
                   if k.lower() not in HOP or k.lower() == "content-encoding"]
            await self._send(conn, writer, reply.status, out,
                             reply.content.iter_any())

    async def _send(self, conn: h11.Connection, writer: asyncio.StreamWriter,
                    status: int, headers: list[tuple[str,
                                                     str]], chunks) -> None:
        writer.write(
            conn.send(
                h11.Response(status_code=status,
                             headers=headers +
                             [("transfer-encoding", "chunked")])))
        if hasattr(chunks, "__aiter__"):
            async for chunk in chunks:
                if chunk:
                    writer.write(conn.send(h11.Data(data=chunk)))
                    await writer.drain()
        else:
            for chunk in chunks:
                if chunk:
                    writer.write(conn.send(h11.Data(data=chunk)))
        writer.write(conn.send(h11.EndOfMessage()))
        await writer.drain()
