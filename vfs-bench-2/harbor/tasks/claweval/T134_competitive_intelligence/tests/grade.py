"""Grade one Claw-Eval trial with the task's own grader, in the verifier's VM.

    python3 /tests/grade.py <upstream task id>

Each committed Claw-Eval task's ``tests/grade.py`` is this file (written by
``harbor/claweval.py``). It runs where ``MicrosandboxVerifier`` runs a test,
with what the task's ``mirage.yaml`` gives that VM: upstream's ``claw_eval``
package and the task's directory (and its peer's, whose grader it loads)
under ``/opt/claweval``, the packages they import under
``/opt/claweval/site``, and the judge's API host.

It hands the grader the run as upstream's runner does:
- the messages: the task's prompt, then the agent's Harbor trajectory
  (``/logs/agent/trajectory.json``, ATIF), each agent step its text, its
  tool calls and their results, as upstream's trace records a model's turns;
- the dispatches: each tool CLI call, as the trial's daemon logged it;
- the audit: each service's ``/audit``, fetched at its upstream port, which
  the VM reaches as the trial's run of its fake.

A task's gmail and calendar are Mirage's gws fake, reached through the
``/gmail`` and ``/calendar`` mounts and the ``gws`` CLI, not upstream's
tools, so neither their dispatches nor their audit logs exist. They are
built here as upstream's services would have logged them (``gws_trace``),
from the task's fixtures under upstream's ids (``gws_seed.json``), the
trajectory and the gws run's SQLite:
- ``gmail_get_message``: once for each fixture email whose body (its first
  50 characters, whitespace and JSON escapes aside) a tool result showed;
- ``gmail_list_messages``: once for each tool result that showed a fixture
  email's id, with upstream's default arguments;
- ``calendar_list_events``: once for each day a tool result showed a
  fixture event of (its id), as ``{"date": <day>, "days": 1}``, and
  ``calendar_get_user_events`` once for each attendee of those events and
  that day;
- ``gmail_send_message``: each message in the run's SENT that the fixture
  lacks, as ``{to, subject, body}``;
- ``calendar_create_event``: each event in the run the fixture lacks, as
  ``{title, start_time, end_time, attendees, location}``;
- ``calendar_delete_event``: each fixture event gone from the run or
  cancelled.
Each answers as upstream's service would, status 200, and is logged in
the service's audit with upstream's endpoint; gmail's ``sent`` and
calendar's ``created_events`` and ``deleted`` are the writes'. Drafts are
upstream's own tool and service (mocks/claweval_gmail), whose audit these
join. No grader in scope reads the dispatches' order; these follow the
tool CLIs' calls.

The judge is upstream's over the chat completions API, at
``OPENAI_BASE_URL`` with ``OPENAI_API_KEY`` and ``JUDGE_MODEL``, as
vfs-bench-2's Claw-Eval grade.py has it. ``reward.json`` gets the task score
and its parts, all numbers, and ``reward_details.json`` the judge's calls,
the gmail and calendar calls built here and what the grader printed.
"""
import contextlib
import inspect
import io
import json
import os
import re
import socket
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

CLAWEVAL = Path("/opt/claweval")
TRAJECTORY = Path("/logs/agent/trajectory.json")
DISPATCHES = Path("/var/lib/mock-data/claweval/dispatches.jsonl")
GWS_DB = Path("/var/lib/mock-data/gws/gws.db")
GWS_SEED = Path(__file__).resolve().parent / "gws_seed.json"
VERIFIER = Path("/logs/verifier")
JUDGE_MODEL = "google/gemini-3-flash-preview"
# The host's name in the verifier's VM (vfsbench_harbor/guest.py).
HOST = "host.microsandbox.internal"
GWS = ("gmail", "calendar")
# Upstream's endpoints for a gmail or calendar tool the task does not list.
ENDPOINTS = {
    "gmail_list_messages": "http://localhost:9100/gmail/messages",
    "gmail_get_message": "http://localhost:9100/gmail/messages/get",
    "gmail_send_message": "http://localhost:9100/gmail/send",
    "calendar_list_events": "http://localhost:9101/calendar/events",
    "calendar_get_user_events": "http://localhost:9101/calendar/user_events",
    "calendar_create_event": "http://localhost:9101/calendar/events/create",
    "calendar_delete_event": "http://localhost:9101/calendar/events/delete",
}
# How much of an email's body a tool result shows for it to count as read.
BODY_KEY = 50


class Unanswered(BaseException):
    """The judge never answered: a BaseException, so that it passes the
    ``except Exception`` each grader puts around its judge calls."""


def steps() -> list[dict]:
    if not TRAJECTORY.is_file():
        print(f"no trajectory at {TRAJECTORY}: the agent wrote none")
        return []
    return [
        s for s in json.loads(TRAJECTORY.read_text()).get("steps", [])
        if s.get("source") == "agent"
    ]


def messages(prompt: str) -> list[dict]:
    """The run as upstream's trace records it: the prompt, then each agent
    step's text and tool calls, and the results that answer them."""
    out = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    def add(role: str, block: dict) -> None:
        if out[-1]["role"] == role:
            out[-1]["content"].append(block)
        else:
            out.append({"role": role, "content": [block]})

    for step in steps():
        text = text_of(step.get("message"))
        if text:
            add("assistant", {"type": "text", "text": text})
        for call in step.get("tool_calls") or []:
            add(
                "assistant", {
                    "type": "tool_use",
                    "id": call["tool_call_id"],
                    "name": call["function_name"],
                    "input": call.get("arguments") or {}
                })
        for result in (step.get("observation") or {}).get("results", []):
            add(
                "user", {
                    "type":
                    "tool_result",
                    "tool_use_id":
                    result.get("source_call_id") or "",
                    "content": [{
                        "type": "text",
                        "text": text_of(result.get("content"))
                    }],
                    "is_error":
                    False
                })
    return out


def results() -> list[str]:
    """What each of the agent's tool calls returned, in order."""
    return [
        text_of(r.get("content")) for step in steps()
        for r in (step.get("observation") or {}).get("results", [])
    ]


def text_of(content) -> str:
    """An ATIF message or result as text: a string, or its text parts."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    return "\n".join(
        part.get("text", "") for part in content if part.get("type") == "text")


def dispatches() -> list[dict]:
    if not DISPATCHES.is_file():
        return []
    return [
        json.loads(line) for line in DISPATCHES.read_text().splitlines()
        if line
    ]


def flat(text: str) -> str:
    """Text with JSON's escapes read and all whitespace gone, so a body
    matches however a listing printed it."""
    text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1], 16)), text)
    for escape, char in (("\\n", "\n"), ("\\t", "\t"), ('\\"', '"'),
                         ("\\/", "/"), ("\\r", "\r")):
        text = text.replace(escape, char)
    return re.sub(r"\s+", "", text)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Trace:
    """Dispatches and audit calls built for gmail and calendar."""

    def __init__(self, endpoints: dict[str, str]):
        self.endpoints = endpoints
        self.dispatches: list[dict] = []
        self.calls = {"gmail": [], "calendar": []}

    def add(self, tool: str, request: dict, response) -> None:
        url = self.endpoints.get(tool, ENDPOINTS[tool])
        stamp = now()
        self.dispatches.append({
            "tool_use_id": f"gws_{len(self.dispatches) + 1}",
            "tool_name": tool,
            "endpoint_url": url,
            "request_body": request,
            "response_status": 200,
            "response_body": response,
            "timestamp": stamp,
        })
        self.calls[tool.split("_")[0]].append({
            "endpoint":
            re.sub(r"^https?://[^/]+", "", url),
            "request_body":
            request,
            "response_body":
            response,
            "timestamp":
            stamp,
        })


def summary(email: dict) -> dict:
    """An email as upstream's `list_messages` lists it."""
    return {
        k: email[k]
        for k in ("message_id", "from", "subject", "date", "is_read", "labels")
    }


def reads(trace: Trace, seed: dict, shown: list[str]) -> None:
    """The gmail and calendar reads the tool results show."""
    emails, events = seed["gmail"], seed["calendar"]
    got: set[str] = set()
    days: set[str] = set()
    users: set[tuple[str, str]] = set()
    for text in shown:
        body = flat(text)
        listed = [e for e in emails if e["message_id"] in text]
        if listed:
            trace.add("gmail_list_messages", {
                "days_back": 7,
                "max_results": 20
            }, {
                "messages": [summary(e) for e in listed],
                "total": len(listed)
            })
        for email in emails:
            key = flat(email["body"])[:BODY_KEY]
            if email["message_id"] not in got and key and key in body:
                got.add(email["message_id"])
                trace.add("gmail_get_message",
                          {"message_id": email["message_id"]}, email)
        seen = [e for e in events if e["event_id"] in text]
        for day in sorted({e["start_time"][:10] for e in seen}):
            on_day = sorted((e for e in events if e["start_time"][:10] == day),
                            key=lambda e: e["start_time"])
            if day not in days:
                days.add(day)
                trace.add("calendar_list_events", {
                    "date": day,
                    "days": 1
                }, {
                    "events": on_day,
                    "total": len(on_day)
                })
            for user in dict.fromkeys(a for e in seen
                                      if e["start_time"][:10] == day
                                      for a in e.get("attendees", [])):
                if (user, day) in users:
                    continue
                users.add((user, day))
                theirs = [e for e in on_day if user in e.get("attendees", [])]
                trace.add("calendar_get_user_events", {
                    "user": user,
                    "date": day
                }, {
                    "events": theirs,
                    "total": len(theirs),
                    "user": user
                })


def writes(trace: Trace, seed: dict) -> tuple[list, list, list]:
    """The sends, the events created and the events deleted, from the gws
    run's SQLite: what the run holds that the fixture does not, and the
    fixture events it no longer holds."""
    sent: list[dict] = []
    created: list[dict] = []
    deleted: list[dict] = []
    if not GWS_DB.is_file():
        return sent, created, deleted
    db = sqlite3.connect(f"file:{GWS_DB}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        seeded = {e["message_id"] for e in seed["gmail"]}
        labels: dict[str, set] = {}
        for row in db.execute('SELECT messageId, labelId FROM "MessageLabel"'):
            labels.setdefault(row["messageId"], set()).add(row["labelId"])
        headers: dict[str, dict] = {}
        for row in db.execute(
                'SELECT messageId, name, value FROM "MessageHeader" ORDER BY '
                'seq, pk'):
            headers.setdefault(row["messageId"],
                               {}).setdefault(row["name"].lower(),
                                              row["value"])
        for row in db.execute(
                'SELECT id, internalDate, bodyText FROM "Message" ORDER BY '
                'internalDate, seq'):
            mine = labels.get(row["id"], set())
            if row["id"] in seeded or "SENT" not in mine or "DRAFT" in mine:
                continue
            head = headers.get(row["id"], {})
            request = {
                "to": head.get("to", ""),
                "subject": head.get("subject", ""),
                "body": row["bodyText"]
            }
            message = {
                **request, "timestamp":
                datetime.fromtimestamp(
                    int(row["internalDate"]) / 1000, timezone.utc).isoformat()
            }
            sent.append(message)
            trace.add("gmail_send_message", request, {
                "status": "sent",
                "message": message
            })
        live = {}
        if db.execute(
                "SELECT 1 FROM sqlite_master WHERE name = 'Event'").fetchone():
            for row in db.execute(
                    'SELECT * FROM "Event" ORDER BY created, seq'):
                live[row["id"]] = row
        fixture = {e["event_id"]: e for e in seed["calendar"]}
        for event_id, row in live.items():
            if event_id in fixture or row["status"] == "cancelled":
                continue
            people = json.loads(row["attendees"]) if row["attendees"] else []
            request = {
                "title":
                row["summary"] or "",
                "start_time":
                row["startDateTime"] or row["startDate"] or "",
                "end_time":
                row["endDateTime"] or row["endDate"] or "",
                "attendees": [
                    p.get("email") or p.get("displayName") or ""
                    for p in people if isinstance(p, dict)
                ],
                "location":
                row["location"] or "",
            }
            event = {"event_id": event_id, **request, "recurring": False}
            created.append(event)
            trace.add("calendar_create_event", request, {
                "status": "created",
                "event": event
            })
        for event_id, event in fixture.items():
            row = live.get(event_id)
            if row is None or row["status"] == "cancelled":
                deleted.append(event)
                trace.add("calendar_delete_event", {"event_id": event_id}, {
                    "status": "deleted",
                    "event": event
                })
    finally:
        db.close()
    return sent, created, deleted


def gws_trace(task, audit: dict) -> list[dict]:
    """Gmail's and calendar's dispatches, built as upstream's services
    would have logged them, with their audit logs added to ``audit``."""
    used = [s.name for s in task.services if s.name in GWS]
    if not used:
        return []
    seed = json.loads(GWS_SEED.read_text())
    endpoints = {e.tool_name: e.url for e in task.tool_endpoints}
    trace = Trace(endpoints)
    reads(trace, seed, results())
    sent, created, deleted = writes(trace, seed)
    if "gmail" in used:
        drafts = audit.get("gmail", {})
        audit["gmail"] = {
            "calls": drafts.get("calls", []) + trace.calls["gmail"],
            "sent": sent,
            "drafts": drafts.get("drafts", [])
        }
    if "calendar" in used:
        audit["calendar"] = {
            "calls": trace.calls["calendar"],
            "deleted": deleted,
            "created_events": created
        }
    return trace.dispatches


def audit(task) -> dict:
    """Each service's audit log, as upstream's runner fetches it once the
    agent stops: ``/audit`` beside its reset endpoint. Calendar has none
    here, and gmail only for drafts, where the task has that tool."""
    drafts = any(t.name == "gmail_save_draft" for t in task.tools)
    out = {}
    for service in task.services:
        if not service.reset_endpoint or service.name == "calendar":
            continue
        if service.name == "gmail" and not drafts:
            continue
        url = service.reset_endpoint.removesuffix("/reset") + "/audit"
        with urllib.request.urlopen(url, timeout=30) as reply:
            out[service.name] = json.load(reply)
    return out


def ipv4(url: str) -> str:
    """A judge on the host (``host.microsandbox.internal``) at the host's
    IPv4 address in the VM, as guest.py dials the proxies: the name
    resolves to IPv6 first, where a port the host serves on 127.0.0.1
    alone hangs rather than refuses."""
    parts = urlsplit(url)
    if parts.hostname != HOST:
        return url
    address = socket.getaddrinfo(HOST, None, socket.AF_INET)[0][4][0]
    netloc = address + (f":{parts.port}" if parts.port else "")
    return urlunsplit(parts._replace(netloc=netloc))


def main() -> int:
    task_id = sys.argv[1]
    sys.path[:0] = [str(CLAWEVAL / "site"), str(CLAWEVAL / "src")]
    from claw_eval.graders.llm_judge import LLMJudge
    from claw_eval.graders.registry import get_grader
    from claw_eval.models.scoring import compute_task_score, is_pass
    from claw_eval.models.task import TaskDefinition
    from claw_eval.models.trace import ToolDispatch, TraceMessage

    class Judge(LLMJudge):
        """Upstream's judge over the chat completions API, which a gateway
        serves for any model, where upstream calls Gemini natively. When
        it gives up retrying, the grade stops: upstream would score that
        part 0, failing the agent for the judge's outage."""

        def __init__(self) -> None:
            super().__init__(model_id=os.environ.get("JUDGE_MODEL")
                             or JUDGE_MODEL,
                             api_key=os.environ["OPENAI_API_KEY"],
                             base_url=ipv4(
                                 os.environ.get("OPENAI_BASE_URL",
                                                "https://api.openai.com/v1")))
            self._use_gemini = False
            # Record the raw transport, including the two email-triage
            # graders' direct client calls, for deterministic Mirage replay.
            self.recording = []
            create = self.client.chat.completions.create

            def recorded(**request):
                entry = {"request": request}
                try:
                    response = create(**request)
                    entry["response"] = response.model_dump(mode="json")
                    return response
                except Exception as exc:
                    entry["error"] = {
                        "message": "Judge transport failed",
                        "status": getattr(exc, "status_code", None),
                    }
                    raise
                finally:
                    self.recording.append(entry)

            self.client.chat.completions.create = recorded

        def evaluate(self, *args, **kwargs):
            return answered(super().evaluate(*args, **kwargs))

        def evaluate_actions(self, *args, **kwargs):
            return answered(super().evaluate_actions(*args, **kwargs))

        def evaluate_visual(self, *args, **kwargs):
            return answered(super().evaluate_visual(*args, **kwargs))

    def answered(result):
        if result is None:
            raise Unanswered("the judge did not answer")
        return result

    tasks = CLAWEVAL / "tasks"
    task_dir = tasks / task_id
    task = TaskDefinition.from_yaml(str(task_dir / "task.yaml"))
    trace = dict(trace_id=task_id)
    trace_messages = [
        TraceMessage(**trace, message=m) for m in messages(task.prompt.text)
    ]
    audit_data = audit(task)
    built = gws_trace(task, audit_data)
    trace_dispatches = [
        ToolDispatch(**trace, **d) for d in dispatches() + built
    ]
    # Upstream's constructor prints the Gemini route this judge leaves.
    with contextlib.redirect_stdout(io.StringIO()):
        judge = Judge()
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        grader = get_grader(task.task_id, str(tasks), str(task_dir))
        kwargs = dict(audit_data=audit_data, judge=judge)
        if "media_events" in inspect.signature(grader.grade).parameters:
            kwargs["media_events"] = []
        scores = grader.grade(trace_messages, trace_dispatches, task, **kwargs)
    score = compute_task_score(scores)
    parts = scores.model_dump()
    VERIFIER.mkdir(parents=True, exist_ok=True)
    (VERIFIER / "reward.json").write_text(
        json.dumps({
            "reward": score,
            "completion": parts["completion"],
            "robustness": parts["robustness"],
            "safety": parts["safety"],
            "passed": 1 if is_pass(score) else 0,
        }))
    (VERIFIER / "reward_details.json").write_text(
        json.dumps(
            {
                "scores": parts,
                "judge": judge.get_call_log(),
                "gws_dispatches": built,
                "output": printed.getvalue(),
            },
            ensure_ascii=False,
            indent=1))
    (VERIFIER / "judge-recording.json").write_text(
        json.dumps(judge.recording, ensure_ascii=False, indent=1))
    print(printed.getvalue())
    for d in built:
        print(f"gws: {d['tool_name']} "
              f"{json.dumps(d['request_body'], ensure_ascii=False)[:160]}")
    print(f"Score: {score} (pass at 0.75: {is_pass(score)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
