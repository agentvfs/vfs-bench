"""Grade one Gaia2 trial with upstream's judge, in the verifier's VM.

    python3 /tests/grade.py

Each Gaia2 task's ``tests/grade.py`` is this file (written by
``harbor/gaia2.py``). It runs where ``MicrosandboxVerifier`` runs a test,
with what the task's ``mirage.yaml`` gives that VM: gaia2-cli and gaia2-core
at upstream's commit (``/opt/gaia2/site``), the scenario
(``/opt/gaia2/task/scenario.json``) and the judge's API host.

Upstream judges a trial in its container, with gaia2-eventd and
``GAIA2_JUDGE_FINAL_TURN``: the daemon reads ``events.jsonl``, each app
call its CLIs logged and the agent's reply, logged as
``send_message_to_user``, and once the turn ends it runs gaia2-core's judge
on the turn's write calls against the scenario's oracle events. This lays
out the state directory the daemon reads, then runs that daemon, unchanged:
- each app's state file, from the ``state`` doc of its fake's run (the
  SQLite each fake keeps at ``/var/lib/mock-data/gaia2/<service>.db``);
  the daemon reads the user's name and address from ``contacts.json``;
- ``events.jsonl``: every app's logged calls, from each run's ``event``
  rows, in the order they were made (their wall-clock times), then the
  agent's reply as upstream's channel logs it (``FileChannelAdapter``): the
  last message of the agent's Harbor trajectory
  (``/logs/agent/trajectory.json``). An agent with no reply hands in no
  turn, as upstream's never ends one: no judgment, a fail.

The judge's LLM checks go through upstream's ``create_litellm_engine``
contract, an engine of messages to text, here over the chat completions API
(``OPENAI_BASE_URL``, ``OPENAI_API_KEY``, ``JUDGE_MODEL``,
``JUDGE_EXTRA_BODY``) with urllib, where upstream uses litellm, which the VM
does not have; the model is named as given. Without a key the engine
answers nothing, so a check gaia2-core's equality does not settle is
inconclusive, which fails it. ``reward.json`` gets 1 or 0 as upstream's
runner scores a judgment; ``reward_details.json`` the judgment, the daemon's
judgments log and each model call.
"""
import json
import logging
import os
import socket
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

GAIA2 = Path("/opt/gaia2")
SCENARIO = GAIA2 / "task" / "scenario.json"
RUNS = Path("/var/lib/mock-data/gaia2")
TRAJECTORY = Path("/logs/agent/trajectory.json")
VERIFIER = Path("/logs/verifier")
# The host's name in the VM, where a stand-in judge may listen.
HOST = "host.microsandbox.internal"
# Each fake's app, by the state file upstream keeps it in.
STATE_FILES = {
    "gaia2_calendar": "calendar.json",
    "gaia2_contacts": "contacts.json",
    "gaia2_emails": "email_client_v2.json",
    "gaia2_messages": "messages.json",
    "gaia2_chats": "chats.json",
    "gaia2_rent_a_flat": "rent_a_flat.json",
    "gaia2_shopping": "shopping.json",
    "gaia2_cabs": "cab_app.json",
    "gaia2_city": "city_app.json",
}
CALLS: list[dict] = []


def ipv4(url: str) -> str:
    """A judge on the host (``host.microsandbox.internal``) at the host's
    IPv4 address in the VM, as guest.py dials the proxies: the name
    resolves to IPv6 first, where a port the host serves on 127.0.0.1
    alone resets or hangs rather than refuses."""
    parts = urlsplit(url)
    if parts.hostname != HOST:
        return url
    address = socket.getaddrinfo(HOST, None, socket.AF_INET)[0][4][0]
    netloc = address + (f":{parts.port}" if parts.port else "")
    return urlunsplit(parts._replace(netloc=netloc))


def engine_factory(model,
                   provider=None,
                   base_url=None,
                   max_retries=12,
                   validate=True,
                   api_key=None,
                   extra_body=None):
    """``create_litellm_engine``'s contract over the chat completions API."""
    key = os.environ.get("OPENAI_API_KEY", "")
    url = ipv4(
        os.environ.get("OPENAI_BASE_URL",
                       "https://api.openai.com/v1").rstrip("/"))
    body_extra = json.loads(os.environ.get("JUDGE_EXTRA_BODY") or "{}")

    def engine(messages, **kwargs):
        if not key:
            CALLS.append({
                "messages": messages,
                "error": "no judge: OPENAI_API_KEY is unset"
            })
            return None, {"error": "no judge configured"}
        body = {
            "model": model,
            "messages": messages,
            "temperature": 0,
            **body_extra
        }
        error = None
        for attempt in range(6):
            request = urllib.request.Request(f"{url}/chat/completions",
                                             data=json.dumps(body).encode(),
                                             headers={
                                                 "content-type":
                                                 "application/json",
                                                 "authorization":
                                                 f"Bearer {key}"
                                             })
            try:
                with urllib.request.urlopen(request, timeout=300) as reply:
                    data = json.load(reply)
                content = data["choices"][0]["message"].get("content")
                CALLS.append({"messages": messages, "reply": content})
                return content, {"model": model}
            # A failed call is no answer (inconclusive), as litellm's would
            # be once its retries run out, never the daemon's crash.
            except (OSError, KeyError, IndexError, TypeError,
                    ValueError) as exc:
                error = str(exc)
                time.sleep(min(2**attempt, 30))
        CALLS.append({"messages": messages, "error": error})
        return None, {"error": error}

    return engine


def reply_text() -> str | None:
    """The agent's reply: its trajectory's last agent message, as text."""
    if not TRAJECTORY.is_file():
        print(f"no trajectory at {TRAJECTORY}: the agent wrote none")
        return None
    for step in reversed(json.loads(TRAJECTORY.read_text()).get("steps", [])):
        if step.get("source") != "agent":
            continue
        message = step.get("message")
        if isinstance(message, list):
            message = "\n".join(
                p.get("text", "") for p in message if p.get("type") == "text")
        if isinstance(message, str) and message.strip():
            return message
    return None


def lay_out(state_dir: Path, start: float, reply: str | None) -> int:
    """The state directory upstream's daemon reads; the number of calls."""
    entries = []
    for service, name in STATE_FILES.items():
        db = RUNS / f"{service}.db"
        if not db.is_file():
            continue
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            row = conn.execute(
                "select doc from doc where name = 'state'").fetchone()
            if row:
                (state_dir / name
                 ).write_text(json.dumps(json.loads(row[0]), indent=2) + "\n")
            entries += conn.execute(
                "select wall, seq, entry from event").fetchall()
        finally:
            conn.close()
    lines = [entry for _wall, _seq, entry in sorted(entries)]
    if reply is not None:
        lines.append(
            json.dumps({
                "t": start,
                "app": "AgentUserInterface",
                "fn": "send_message_to_user",
                "args": {
                    "content": reply
                },
                "w": True,
                "ret": None
            }))
    (state_dir / "events.jsonl").write_text("".join(f"{line}\n"
                                                    for line in lines))
    return len(entries)


def main() -> int:
    sys.path.insert(0, str(GAIA2 / "site"))
    os.environ["GAIA2_JUDGE_FINAL_TURN"] = "1"
    import gaia2_cli.judge
    gaia2_cli.judge.create_litellm_engine = engine_factory
    from gaia2_cli.daemon.eventd import Gaia2EventDaemon

    logging.basicConfig(level=logging.INFO,
                        format="%(name)s %(levelname)s %(message)s")
    scenario = json.loads(SCENARIO.read_text())
    start = float(scenario["metadata"]["definition"]["start_time"])
    reply = reply_text()
    VERIFIER.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="gaia2-state-") as tmp:
        state_dir = Path(tmp)
        calls = lay_out(state_dir, start, reply)
        daemon = Gaia2EventDaemon(
            scenario_path=str(SCENARIO),
            state_dir=str(state_dir),
            judge_model=os.environ.get("JUDGE_MODEL") or "gpt-oss-120b",
            judge_provider="openai-compat",
            judge_base_url=os.environ.get("OPENAI_BASE_URL"),
            judge_api_key=os.environ.get("OPENAI_API_KEY") or None,
            poll_interval=0.05,
            idle_timeout=5.0)
        daemon.setup()
        daemon.run()
        judgment = daemon._final_judgment
        status_file = state_dir / "daemon_status.json"
        status = json.loads(
            status_file.read_text()) if status_file.exists() else {}
        judgments_file = state_dir / "judgments.jsonl"
        judgments = ([
            json.loads(line)
            for line in judgments_file.read_text().splitlines() if line
        ] if judgments_file.exists() else [])
    success = bool(judgment is not None and judgment.success)
    reason = None if judgment is None else (judgment.failure_reason or None)
    if judgment is None:
        reason = f"daemon status: {status.get('status')}" + ("" if reply else
                                                             " (no reply)")
    (VERIFIER / "reward.json").write_text(
        json.dumps({"reward": 1.0 if success else 0.0}))
    (VERIFIER / "reward_details.json").write_text(
        json.dumps(
            {
                "success": success,
                "failure_reason": reason,
                "reply": reply,
                "app_calls": calls,
                "daemon_status": status,
                "judgments": judgments,
                "judge_calls": CALLS,
            },
            ensure_ascii=False,
            indent=1,
            default=str))
    print(f"{'PASS' if success else 'FAIL'}" +
          (f": {reason}" if reason else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
