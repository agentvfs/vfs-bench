"""The reference grade the TypeScript port is checked against (audit.py).

Upstream's graders, models, judge and scoring, run unchanged under CPython
from the fetched checkout (``state/claweval/src``), over the trace assembly
the Pyodide verifier used before the port (``grade.py`` and ``gws.py`` at
agentvfs/vfs-bench@e2c7e825), copied below as it was. The judge's client
answers from ``respond``; every call and reply goes on the tape the port
then replays.
"""
import contextlib
import inspect
import io
import json
import random
import re
import sys
import tempfile
import time
import types
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
UPSTREAM = ROOT / "state/claweval/src"
TRAJECTORY = DISPATCHES = GWS_SEED = Path("/nonexistent")
STATE = {}


def now():
    return STATE["epoch"]


def writes(trace, seed):
    return gws_writes(trace, seed, STATE["gws"])


GWS = ("gmail", "calendar")

ENDPOINTS = {
    "gmail_list_messages": "http://localhost:9100/gmail/messages",
    "gmail_get_message": "http://localhost:9100/gmail/messages/get",
    "gmail_send_message": "http://localhost:9100/gmail/send",
    "calendar_list_events": "http://localhost:9101/calendar/events",
    "calendar_get_user_events": "http://localhost:9101/calendar/user_events",
    "calendar_create_event": "http://localhost:9101/calendar/events/create",
    "calendar_delete_event": "http://localhost:9101/calendar/events/delete",
}

BODY_KEY = 50


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


def gws_writes(trace, seed, tables):
    sent, created, deleted = [], [], []
    if not tables:
        return sent, created, deleted

    def ordered(name, *keys):
        # SQLite ASC puts NULL before other values. Stable table order
        # preserves ties; the fake exports its insertion order as __order.
        return sorted(tables.get(name, []),
                      key=lambda row: tuple(
                          (row.get(key) is not None, row.get(key))
                          for key in keys))

    seeded = {e["message_id"] for e in seed["gmail"]}
    labels, headers = {}, {}
    for row in tables["MessageLabel"]:
        labels.setdefault(row["messageId"], set()).add(row["labelId"])
    for row in ordered("MessageHeader", "seq", "pk"):
        headers.setdefault(row["messageId"],
                           {}).setdefault(row["name"].lower(), row["value"])
    for row in ordered("Message", "internalDate", "seq"):
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
    live = {row["id"]: row for row in ordered("Event", "created", "seq")}
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
                p.get("email") or p.get("displayName") or "" for p in people
                if isinstance(p, dict)
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
    return sent, created, deleted


class _Unanswered(BaseException):
    pass


def _objects(value):
    if isinstance(value, dict):
        return types.SimpleNamespace(**{
            k: _objects(v)
            for k, v in value.items()
        })
    if isinstance(value, list):
        return [_objects(v) for v in value]
    return value


_loaded = {}


def _upstream():
    """Upstream's package, its judge's client a stub (as main.py had it)."""
    if _loaded:
        return _loaded
    openai = types.ModuleType("openai")
    openai.OpenAI = lambda **kwargs: None
    sys.modules["openai"] = openai
    sys.modules["httpx"] = types.ModuleType("httpx")
    sys.path.insert(0, str(UPSTREAM / "src"))
    import claw_eval.graders.llm_judge as llm_judge
    import claw_eval.models.trace as trace_module
    from claw_eval.graders.registry import get_grader
    from claw_eval.models.scoring import compute_task_score, is_pass
    from claw_eval.models.task import TaskDefinition
    from claw_eval.models.trace import ToolDispatch, TraceMessage
    _loaded.update(llm_judge=llm_judge,
                   trace=trace_module,
                   get_grader=get_grader,
                   compute_task_score=compute_task_score,
                   is_pass=is_pass,
                   TaskDefinition=TaskDefinition,
                   ToolDispatch=ToolDispatch,
                   TraceMessage=TraceMessage)
    return _loaded


def grade(case, respond):
    """Grade ``case`` (``task``, ``audit``, ``gws``, ``epoch``, ``model``,
    and the ``trajectory``, ``dispatches`` and ``seed`` file texts, each
    None for none) as main.py did; ``respond(request, index)`` answers each
    judge call with a reply, or ``{"error": {...}}``."""
    global TRAJECTORY, DISPATCHES, GWS_SEED
    up = _upstream()
    tape = []

    class Client:

        def __init__(self, **kwargs):
            self.chat = self
            self.completions = self

        def create(self, **request):
            entry = {"request": json.loads(json.dumps(request))}
            tape.append(entry)
            reply = respond(entry["request"], len(tape) - 1)
            if "error" in reply:
                entry["error"] = reply["error"]
                error = RuntimeError(reply["error"]["message"])
                error.status_code = reply["error"].get("status")
                raise error
            entry["response"] = reply
            response = json.loads(json.dumps(reply))
            for choice in response.get("choices", []):
                if isinstance(choice.get("message"), dict):
                    choice["message"].setdefault("content", None)
            return _objects(response)

    up["llm_judge"].OpenAI = Client

    class Judge(up["llm_judge"].LLMJudge):

        def __init__(self):
            super().__init__(model_id=case["model"],
                             api_key="unused",
                             base_url="https://judge.invalid/v1")
            self._use_gemini = False

        def answered(self, value):
            if value is None:
                raise _Unanswered("the judge did not answer")
            return value

        def evaluate(self, *args, **kwargs):
            return self.answered(super().evaluate(*args, **kwargs))

        def evaluate_actions(self, *args, **kwargs):
            return self.answered(super().evaluate_actions(*args, **kwargs))

    STATE.clear()
    STATE.update(gws=case["gws"], epoch=case["epoch"])
    up["trace"]._now = lambda: case["epoch"]
    up["llm_judge"]._now = lambda: case["epoch"]
    sleep = time.sleep
    time.sleep = lambda seconds: None
    random.seed(0)
    try:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            TRAJECTORY = root / "trajectory.json"
            DISPATCHES = root / "dispatches.jsonl"
            GWS_SEED = root / "gws_seed.json"
            for path, key in ((TRAJECTORY, "trajectory"),
                              (DISPATCHES, "dispatches"), (GWS_SEED, "seed")):
                if case[key] is not None:
                    path.write_text(case[key])
            task_id = case["task"]
            tasks = UPSTREAM / "tasks"
            task = up["TaskDefinition"].from_yaml(
                str(tasks / task_id / "task.yaml"))
            trace = dict(trace_id=task_id)
            with contextlib.redirect_stdout(io.StringIO()):
                trace_messages = [
                    up["TraceMessage"](**trace, message=m)
                    for m in messages(task.prompt.text)
                ]
                audit_data = json.loads(case["audit"])
                built = gws_trace(task, audit_data)
                trace_dispatches = [
                    up["ToolDispatch"](**trace, **d)
                    for d in dispatches() + built
                ]
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                judge = Judge()
                grader = up["get_grader"](task_id, str(tasks),
                                          str(tasks / task_id))
                kwargs = dict(audit_data=audit_data, judge=judge)
                if "media_events" in inspect.signature(
                        grader.grade).parameters:
                    kwargs["media_events"] = []
                scores = grader.grade(trace_messages, trace_dispatches, task,
                                      **kwargs)
            score = up["compute_task_score"](scores)
            parts = scores.model_dump()
            return {
                "score": score,
                "rewards": {
                    "reward": score,
                    "completion": parts["completion"],
                    "robustness": parts["robustness"],
                    "safety": parts["safety"],
                    "passed": 1 if up["is_pass"](score) else 0
                },
                "details": {
                    "scores": parts,
                    "judge": judge.get_call_log(),
                    "gws_dispatches": built,
                    "output": printed.getvalue()
                },
                "tape": tape
            }
    except BaseException as exc:
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        return {"error": f"{type(exc).__name__}: {exc}", "tape": tape}
    finally:
        time.sleep = sleep
