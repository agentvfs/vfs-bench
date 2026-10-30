"""Write the committed Claw-Eval tasks from upstream, or check them.

    uv run --project harbor python -I harbor/claweval.py [--check] [task ...]
    uv run --project harbor python -I harbor/claweval.py --site

Each task under ``harbor/tasks/claweval/<task id>/`` is a Harbor task made
from upstream's ``tasks/<task id>/task.yaml`` (claw-eval/claw-eval, pinned
by ``claweval/setup.py``, MIT). Its files are generated from upstream but
for the solutions of ``SOLVED``, which are ours:

- ``instruction.md``: upstream's prompt, verbatim, after ``Current date:
  <mock_today>`` where the task sets one (upstream's system prompt gives
  it), then where the mailbox and calendar are mounted and what the gws CLI
  does, and a list of the task's tools as the CLIs that carry them, since
  upstream hands the model their schemas and Harbor only an instruction.
- ``task.toml``: upstream's metadata, its time limit, and the judge's
  variables for the verifier.
- ``environment/mirage.yaml``: each service as its kit fake
  (``mocks/claweval_<service>``) at upstream's port; gmail and calendar as
  Mirage's gws fake, the ``/gmail`` and ``/calendar`` mounts and the gws
  CLI, but for gmail's drafts, a fake of their own; the task's
  ``sandbox_files`` copied into ``/workspace``; the tools as CLIs; and what
  the verifier's VM gets: upstream's ``claw_eval``, the task's directory
  and its peer's, the packages they import (``--site`` builds them) and the
  judge's host.
- ``environment/kit/<fake>.json``: each fake's fixture, the task's fixtures
  as the service loads them; ``gws.json``, gmail's and calendar's as Gmail
  messages and Calendar events under upstream's ids.
- ``environment/tools.json``: the tools, by CLI (harbor/tools.ts).
- ``environment/workspace/``: the task's ``sandbox_files``; its PDFs are
  written but not committed (``tasks/claweval/.gitignore``: 250 MB), as
  are the config-audit fixtures, whose planted keys GitHub refuses.
- ``tests/test.sh`` and ``tests/grade.py`` (``claweval_grade.py``): the
  task's ``grader.py``, run as upstream's runner runs it, over the agent's
  Harbor trajectory; ``tests/gws_seed.json``, a gws task's gmail and
  calendar fixtures, from which ``grade.py`` builds their calls. It needs
  ``MicrosandboxVerifier`` (claweval-msb.yaml) for reference runs. The
  default ``MirageVerifier`` reads frozen JSON and pinned upstream sources
  in a separate Pyodide workspace; it does not use the VM copies or site.
- ``solution/trajectory.py`` (``claweval_trajectory.py``), for a task with
  a solution: writes the solution's run as the agent's trajectory.

``--check`` writes nothing and exits 1 if a generated file differs from what
upstream gives, if a solved task's ``solve.sh`` or ``reply.md`` is missing,
or if a file is unaccounted for. ``--site`` installs the grader's packages
for the VM's Linux, into ``state/harbor/site/claweval``.
"""
import argparse
import json
import platform
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

import yaml

HARBOR = Path(__file__).resolve().parent
ROOT = HARBOR.parent
UPSTREAM = ROOT / "state" / "claweval" / "src"
OUT = HARBOR / "tasks" / "claweval"
SITE = ROOT / "state" / "harbor" / "site" / "claweval"
GRADE = HARBOR / "claweval_grade.py"
COMMIT = "5680b8b"
# The packages upstream's graders import, beyond the standard library
# (claweval/pyproject.toml's, less the services' own).
PACKAGES = ["httpx>=0.27", "openai>=1.0", "pydantic>=2.0", "pyyaml>=6.0"]
# The epoch a run's clock starts at where the task gives no mock_today:
# upstream's services read the wall clock, and only stamp their audit logs.
EPOCH = "2026-04-03T09:00:00Z"

# The general split's tasks left out of those that use services, and why.
SKIPPED = {
    "T097_pinbench_eli5_model_summary":
    "its sandbox file, fixtures/docs/GPT4.pdf, is not in upstream's repo",
    "T098_pinbench_openclaw_facts":
    "its sandbox files, PDFs under fixtures/docs/, are not in upstream's repo",
}


def in_scope() -> list[str]:
    """The general split's tasks whose agent works through mock services,
    but those that browse the live web (`web_real*`) and `SKIPPED`."""
    out = []
    for path in sorted((UPSTREAM / "tasks").glob("T*/task.yaml")):
        task = yaml.safe_load(path.read_text())
        names = [s["name"] for s in task.get("services") or []]
        if not names or any(n.startswith("web_real") for n in names):
            continue
        if task["task_id"] not in SKIPPED:
            out.append(task["task_id"])
    return out


TASKS = in_scope() if UPSTREAM.is_dir() else []
# The tasks with a solution of ours: `solve.sh`, and `reply.md`, the reply
# its trajectory ends with (`solution/trajectory.py`, ORACLE).
SOLVED = [
    "T017zh_ticket_triage",
    "T037zh_incident_postmortem",
    "T075_email_phishing_injection",
    "T085_officeqa_army_expenditures",
    "T086_pinbench_calendar_event_creation",
    "T110_complaint_investigation",
    "T149zh_project_progress_report",
    "T152_supply_chain_investigation",
    "T154_market_research_report",
    "T156_onsite_support_dispatch",
    "T158_month_end_reconciliation",
    "T161zh_automation_failure_recovery",
    "T163zh_quarterly_customer_review",
]
OURS = ["solution/solve.sh", "solution/reply.md"]
ORACLE = HARBOR / "claweval_trajectory.py"

# Each service with a kit fake, by its fake: for each fixture file it
# loads, the variable naming it, the task file it loads when that is unset,
# and the list upstream keeps it as (`_load_fixtures` in its server.py).
SERVICES = {
    "helpdesk":
    [("HELPDESK_FIXTURES",
      "T017zh_ticket_triage/fixtures/helpdesk/tickets.json", "tickets")],
    "crm": [("CRM_FIXTURES",
             "T023zh_crm_data_export/fixtures/crm/customers.json", "customers")
            ],
    "contacts":
    [("CONTACTS_FIXTURES",
      "T009zh_contact_lookup/fixtures/contacts/contacts.json", "contacts")],
    "kb": [("KB_FIXTURES", "T015zh_kb_search/fixtures/kb/articles.json",
            "articles")],
    "finance": [("FINANCE_FIXTURES",
                 "T011zh_expense_report/fixtures/finance/transactions.json",
                 "transactions")],
    "inventory":
    [("INVENTORY_FIXTURES",
      "T019zh_inventory_check/fixtures/inventory/products.json", "products")],
    "config": [("CONFIG_FIXTURES",
                "T027zh_api_config_audit/fixtures/config/integrations.json",
                "integrations")],
    "scheduler":
    [("SCHEDULER_FIXTURES",
      "T041zh_scheduled_task_management/fixtures/scheduler/jobs.json", "jobs")
     ],
    "rss": [
        ("RSS_FIXTURES",
         "T021zh_newsletter_curation/fixtures/rss/articles.json", "articles")
    ],
    "todo": [("TODO_FIXTURES",
              "T007zh_todo_management/fixtures/todo/tasks.json", "tasks")],
    "notes": [("NOTES_FIXTURES",
               "T013zh_meeting_notes/fixtures/notes/meetings.json", "notes")],
    "web": [("WEB_SEARCH_FIXTURES",
             "T043zh_service_outage_research/fixtures/web/search_results.json",
             "search_items"),
            ("WEB_FETCH_FIXTURES",
             "T043zh_service_outage_research/fixtures/web/pages.json", "pages")
            ],
}


def fake(service: str) -> str:
    """A service's kit fake: `claweval_helpdesk`; every `ocr_*` service is
    the one OCR server with fixtures of its own."""
    return "claweval_ocr" if service.startswith(
        "ocr") else f"claweval_{service}"


def ocr_text(env: dict) -> str:
    """The text upstream's OCR service answers with (`_load_fixtures` in
    mock_services/ocr/server.py): the named files, each under a document
    heading, or the one file."""
    root = UPSTREAM / env["OCR_FIXTURES"] / "ocr"
    if env.get("OCR_FILENAMES"):
        parts = [
            f"--- Document {i}: {name.strip()} ---\n" +
            (root / name.strip()).read_text(encoding="utf-8")
            for i, name in enumerate(env["OCR_FILENAMES"].split(","), 1)
            if (root / name.strip()).exists()
        ]
        if parts:
            return "\n\n".join(parts)
    return (root / env.get("OCR_FILENAME", "menu_ocr.txt")).read_text(
        encoding="utf-8")


def fixture(task: dict, service: dict) -> bytes:
    """A service's kit fixture: its lists as upstream's service loads
    them for the task, each dict a `doc` row of its list's kind."""
    env = service.get("env") or {}
    if service["name"].startswith("ocr"):
        lists = {"ocr": [{"text": ocr_text(env)}]}
    elif service["name"] == "gmail":
        lists = {}
    else:
        lists = {}
        for var, default, kind in SERVICES[service["name"]]:
            path = UPSTREAM / env.get(var, f"tasks/{default}")
            lists[kind] = json.loads(path.read_text())
    # Notes reads MOCK_TODAY from its environment (`list_notes`'s
    # `days_back`), which a fake the job shares cannot: the run's own.
    today = (task.get("environment") or {}).get("mock_today")
    if service["name"] == "notes" and today:
        lists["env"] = [{"MOCK_TODAY": today}]
    rows = [{
        "kind": kind,
        "doc": json.dumps(doc, ensure_ascii=False)
    } for kind, docs in lists.items() for doc in docs]
    return (json.dumps({"doc": rows}, ensure_ascii=False, indent=1) +
            "\n").encode()


def flag(param: str, schema: dict, required: bool) -> str:
    kind = schema.get("type", "string")
    value = {"array": "<value> ...", "object": "<JSON>"}.get(kind, f"<{kind}>")
    text = f"--{param.replace('_', '-')} {value}"
    return text if required else f"[{text}]"


# Upstream's gmail and calendar services, which are Mirage's gws fake here,
# but for gmail's drafts.
GWS = {"gmail", "calendar"}
# The one gmail tool gws has no counterpart of: a fake of its own
# (mocks/claweval_gmail), at upstream's gmail port.
DRAFT = "gmail_save_draft"
# The gws fake's own credential and the primary calendar's id
# (integ/server/gws/fake.ts, store/state.ts).
GWS_TOKEN = "gws-integ-token"
PRIMARY = "integ@example.com"
GWS_STATE = "/var/lib/mock-data/gws/gws.db"
DISPATCHES = "/var/lib/mock-data/claweval/dispatches.jsonl"


def service_of(task: dict, tool: str) -> dict:
    """The service whose port a tool's endpoint is on."""
    endpoint = next(e for e in task["tool_endpoints"]
                    if e["tool_name"] == tool)
    port = int(re.search(r":(\d+)/", endpoint["url"])[1])
    return next(s for s in task["services"] if s["port"] == port)


def uses(task: dict) -> set[str]:
    """Which of gmail and calendar the task runs."""
    return {s["name"] for s in task["services"]} & GWS


def has_draft(task: dict) -> bool:
    return any(t["name"] == DRAFT for t in task["tools"])


def tools(task: dict) -> list[dict]:
    """The task's tools, by the CLI of the service whose endpoint each
    posts to, as harbor/tools.ts reads them: all but gmail's and calendar's,
    which are the gws mounts and CLI, and for gmail's drafts."""
    endpoints = {e["tool_name"]: e for e in task["tool_endpoints"]}
    clis: dict[str, list] = {}
    for tool in task["tools"]:
        service = service_of(task, tool["name"])["name"]
        if service in GWS and tool["name"] != DRAFT:
            continue
        name = tool["name"].removeprefix(f"{service}_")
        endpoint = endpoints[tool["name"]]
        clis.setdefault(service, []).append({
            "name":
            name,
            "call":
            tool["name"],
            "description":
            tool.get("description"),
            "parameters":
            tool.get("input_schema") or {},
            "endpoint": {
                "url": endpoint["url"],
                "method": endpoint.get("method", "POST")
            },
        })
    return [{
        "name": service.replace("_", "-"),
        "service": service,
        "description": f"The {service} service's tools.",
        "tools": list_
    } for service, list_ in clis.items()]


def gws_note(task: dict) -> list[str]:
    """How the task reaches its mail and calendar: Mirage's way."""
    used = uses(task)
    if not used:
        return []
    where = {
        frozenset({"gmail"}):
        "The mailbox is mounted at /gmail.",
        frozenset({"calendar"}):
        "The calendar is mounted at /calendar.",
        frozenset({"gmail", "calendar"}):
        "The mailbox is mounted at /gmail and the calendar at /calendar.",
    }[frozenset(used)]
    what = {
        frozenset({"gmail"}):
        "reads and sends mail",
        frozenset({"calendar"}):
        "reads, creates and deletes events",
        frozenset({"gmail", "calendar"}):
        "reads and sends mail and reads, creates and deletes events",
    }[frozenset(used)]
    help_ = " and ".join(f"`gws {s} --help`" for s in ("gmail", "calendar")
                         if s in used)
    return [f"{where} The `gws` CLI {what} ({help_}).", ""]


def instruction(task: dict) -> str:
    """Upstream's prompt, with the date its system prompt gives, then the
    tools the model gets, as the CLIs that carry them."""
    lines = []
    today = (task.get("environment") or {}).get("mock_today")
    if today:
        lines += [f"Current date: {today}", ""]
    lines += [task["prompt"]["text"].rstrip("\n"), "", "## Tools", ""]
    lines += gws_note(task)
    clis = tools(task)
    if clis:
        lines += [
            "Each tool is a shell command; `<command> --help` says more.", ""
        ]
    for cli in clis:
        for tool in cli["tools"]:
            params = tool["parameters"].get("properties") or {}
            required = set(tool["parameters"].get("required") or [])
            usage = " ".join(
                [cli["name"], tool["name"].replace("_", "-")] +
                [flag(p, s, p in required) for p, s in params.items()])
            lines.append(f"- `{usage}`: {tool['description'] or ''}".rstrip())
    return "\n".join(lines).rstrip("\n") + "\n"


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def task_toml(task: dict) -> str:
    tags = ", ".join(toml_string(t) for t in task.get("tags") or [])
    timeout = float((task.get("environment")
                     or {}).get("timeout_seconds", 600))
    return f"""version = "1.0"

[metadata]
difficulty = {toml_string(task.get("difficulty", ""))}
category = {toml_string(task.get("category", ""))}
tags = [{tags}]
upstream = "claw-eval/claw-eval@{COMMIT} tasks/{task["task_id"]}"

[verifier]
timeout_sec = 900.0

# Upstream's LLM judge, over the chat completions API.
[verifier.env]
OPENAI_API_KEY = "${{OPENAI_API_KEY}}"
OPENAI_BASE_URL = "${{OPENAI_BASE_URL:-https://api.openai.com/v1}}"
JUDGE_MODEL = "${{JUDGE_MODEL:-google/gemini-3-flash-preview}}"

[agent]
timeout_sec = {timeout}

[environment]
build_timeout_sec = 300.0
cpus = 1
memory_mb = 2048
storage_mb = 4096
# The trial's routes to its services, which the verifier fetches each
# service's audit log over; the agent's curl and wget are off
# (environment/mirage.yaml), so it reaches them through their tools alone.
allow_internet = true
"""


def upstream_list(task: dict, name: str, var: str, default: str) -> list:
    """A gmail or calendar fixture list, as upstream's service loads it."""
    service = next((s for s in task["services"] if s["name"] == name), None)
    if service is None:
        return []
    env = service.get("env") or {}
    return json.loads(
        (UPSTREAM / env.get(var, f"tasks/{default}")).read_text())


def gws_seed(task: dict) -> dict:
    """The task's gmail and calendar fixtures, as upstream's services load
    them (the verifier reads them, tests/gws_seed.json)."""
    return {
        "gmail":
        upstream_list(task, "gmail", "GMAIL_FIXTURES",
                      "T001zh_email_triage/fixtures/gmail/inbox.json"),
        "calendar":
        upstream_list(
            task, "calendar", "CALENDAR_FIXTURES",
            "T003zh_calendar_scheduling/fixtures/calendar/events.json"),
    }


def iso(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def epoch(task: dict) -> str:
    """The run's clock. A task's `mock_today`, at nine in the morning UTC.
    Without one, upstream shifts its mail so the newest is a day old and
    its events so the first is a day ahead, from the wall clock; here the
    fixtures keep their dates and the clock is set that far from them. A
    task with neither starts at `EPOCH`."""
    today = (task.get("environment") or {}).get("mock_today")
    if today:
        return f"{today}T09:00:00Z"
    seed = gws_seed(task)
    if seed["gmail"]:
        at = max(iso(e["date"]) for e in seed["gmail"]) + timedelta(days=1)
    elif seed["calendar"]:
        at = min(iso(e["start_time"])
                 for e in seed["calendar"]) - timedelta(days=1)
    else:
        return EPOCH
    return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Upstream's labels that are Gmail's system labels, by upstream's spelling.
SYSTEM_LABELS = {
    "inbox": "INBOX",
    "important": "IMPORTANT",
    "spam": "SPAM",
    "category_updates": "CATEGORY_UPDATES"
}
LABELS = [
    "INBOX", "SENT", "DRAFT", "UNREAD", "IMPORTANT", "STARRED", "TRASH",
    "SPAM", "CATEGORY_UPDATES"
]


def attendee(name: str) -> dict:
    """An upstream attendee, a name or an address, as a Calendar attendee."""
    return {"email": name} if "@" in name else {"displayName": name}


def calendar_zone(events: list) -> str:
    """The calendar's zone: China's where upstream's times are at +08:00,
    so its day directories are the days the times name; else UTC."""
    offsets = {e["start_time"][19:] for e in events}
    return "Asia/Shanghai" if offsets == {"+08:00"} else "UTC"


def gws_fixture(task: dict) -> bytes:
    """Mirage's gws fake's fixture: upstream's gmail fixture as Gmail
    messages and its calendar fixture as the primary calendar's events,
    each under upstream's id."""
    seed = gws_seed(task)
    labels = [{
        "id": label_id,
        "name": label_id,
        "type": "system"
    } for label_id in LABELS]
    names = {label_id.lower(): label_id for label_id in LABELS}
    messages = []
    for email in seed["gmail"]:
        ids = []
        for label in email["labels"]:
            key = SYSTEM_LABELS.get(label.lower())
            if key is None:
                key = names.get(label.lower())
            if key is None:
                key = f"Label_{len(labels) - len(LABELS) + 1}"
                labels.append({"id": key, "name": label, "type": "user"})
                names[label.lower()] = key
            ids.append(key)
        if not email["is_read"]:
            ids.append("UNREAD")
        at = iso(email["date"])
        messages.append({
            "id":
            email["message_id"],
            "threadId":
            email["message_id"],
            "internalDate":
            int(at.timestamp() * 1000),
            "bodyText":
            email["body"],
            "headers": [
                {
                    "name": "From",
                    "value": email["from"]
                },
                {
                    "name": "To",
                    "value": email["to"]
                },
                {
                    "name": "Subject",
                    "value": email["subject"]
                },
                {
                    "name": "Date",
                    "value": format_datetime(at)
                },
            ],
            "labels": [{
                "labelId": i
            } for i in dict.fromkeys(ids)],
        })
    out: dict = {
        "labels": labels,
        "messages": messages,
        "counters": [{
            "kind": "msg",
            "n": len(messages)
        }]
    }
    if "calendar" in uses(task):
        zone = calendar_zone(seed["calendar"])
        created = epoch(task).replace("Z", ".000Z")
        events = []
        for e in seed["calendar"]:
            people = [attendee(a) for a in e["attendees"]]
            organizer = e.get("organizer")
            if organizer:
                match = [p for p in people if organizer in p.values()]
                if match:
                    match[0]["organizer"] = True
                else:
                    people.insert(0, {
                        **attendee(organizer), "organizer": True
                    })
            event = {
                "id":
                e["event_id"],
                "status":
                "tentative" if e.get("status") == "tentative" else "confirmed",
                "summary":
                e["title"],
                **({
                    "description": e["description"]
                } if e.get("description") else {}),
                **({
                    "location": e["location"]
                } if e.get("location") else {}),
                "startDateTime":
                e["start_time"],
                "startTimeZone":
                zone,
                "endDateTime":
                e["end_time"],
                "endTimeZone":
                zone,
                **({
                    "attendees": json.dumps(people, ensure_ascii=False)
                } if people else {}),
                "created":
                created,
                "updated":
                created,
            }
            events.append(event)
        out["calendars"] = [{
            "id": PRIMARY,
            "summary": "me@company.com",
            "timeZone": zone,
            "accessRole": "owner",
            "primary": True,
            "events": events
        }]
        out["counters"].append({"kind": "event", "n": len(events)})
    return (json.dumps(out, ensure_ascii=False, indent=1) + "\n").encode()


def kit_fakes(task: dict) -> list[tuple[str, dict]]:
    """Each kit fake the task runs, with the service upstream runs for it."""
    out = []
    for service in task["services"]:
        if service["name"] in GWS:
            if service["name"] == "gmail" and has_draft(task):
                out.append(("claweval_gmail", service))
        else:
            out.append((fake(service["name"]), service))
    return out


def mirage_yaml(task: dict) -> str:
    at = epoch(task)
    spec: dict = {"fakes": {}}
    for name, service in kit_fakes(task):
        spec["fakes"][name] = {
            "fixture": f"kit/{name}.json",
            "epoch": at,
            "ports": [service["port"]],
        }
    used = uses(task)
    if used:
        spec["fakes"]["gws"] = {
            "fixture": "kit/gws.json",
            "epoch": at,
            "state": GWS_STATE
        }
    if task.get("sandbox_files"):
        spec["copy"] = {"/workspace": "workspace/"}
    clis = tools(task)
    if clis:
        spec["tools"] = {"file": "tools.json", "dispatches": DISPATCHES}
    # Upstream's model reaches the services through their tools alone.
    workspace: dict = {
        "profiles": {
            "default": {
                "commands": {
                    "deny": [{
                        "commands": ["curl", "wget"],
                        "reason":
                        "the services are reached through their tools",
                    }]
                }
            }
        }
    }
    gws = {"accessToken": GWS_TOKEN, "apiBase": "${GWS_URL}"}
    if used:
        workspace["mounts"] = {}
        if "gmail" in used:
            workspace["mounts"]["/gmail"] = {
                "vfs": "gmail",
                "mode": "read",
                "config": dict(gws)
            }
        if "calendar" in used:
            workspace["mounts"]["/calendar"] = {
                "vfs": "gcal",
                "mode": "read",
                "config": {
                    **gws, "today": at[:10]
                }
            }
    workspace["clis"] = {
        cli["name"]: {
            "cli": cli["name"],
            "config": {
                "url": "${" + fake(cli["service"]).upper() + "_URL}"
            }
        }
        for cli in clis
    }
    if used:
        workspace["clis"]["gws"] = {"cli": "gws", "config": dict(gws)}
    if not workspace["clis"]:
        del workspace["clis"]
    spec["workspace"] = workspace
    copy = {
        "/opt/claweval/src": "${STATE}/claweval/src/src",
        "/opt/claweval/site": "${STATE}/harbor/site/claweval",
    }
    for task_id in [task["task_id"], *peers(task["task_id"])]:
        source = f"${{STATE}}/claweval/src/tasks/{task_id}"
        copy[f"/opt/claweval/tasks/{task_id}"] = source
    spec["verifier"] = {"copy": copy, "egress": ["OPENAI_BASE_URL"]}
    head = [
        f"# {task['task_id']}, on vfsbench_harbor's mirage environment "
        "(harbor/claweval.py writes it).", "#",
        "# Each service is its kit fake at upstream's port, its tools CLIs",
        "# (harbor/tools.ts), and the verifier's VM gets upstream's grader "
        "and", "# the judge's host (claweval_grade.py)."
    ]
    if used:
        head += [
            "#", "# Gmail and calendar are Mirage's gws fake: the /gmail and "
            "/calendar",
            "# mounts and the gws CLI, at this trial's run of it, with "
            "upstream's",
            "# fixtures under upstream's ids; gws-integ-token is the fake's "
            "own",
            "# credential. Its SQLite is what the verifier reads them from."
        ]
        if has_draft(task):
            head += [
                "# gws has no drafts, so gmail_save_draft is upstream's tool, "
                "at", "# upstream's gmail port (mocks/claweval_gmail)."
            ]
    return "\n".join(head) + "\n" + yaml.safe_dump(
        spec, sort_keys=False, allow_unicode=True)


def peers(task_id: str) -> list[str]:
    """The tasks whose grader the task's grader loads (`load_peer_grader`)."""
    text = (UPSTREAM / "tasks" / task_id / "grader.py").read_text()
    return re.findall(r'load_peer_grader\(\s*"([^"]+)"', text)


TEST_SH = """#!/usr/bin/env bash
# The task's grader, as upstream's runner runs it (grade.py).
set -euo pipefail
mkdir -p /logs/verifier
python3 /tests/grade.py {task_id}
"""


def expected(task_id: str) -> dict[str, bytes]:
    """Every file this writes for a task, by path in its directory."""
    source = UPSTREAM / "tasks" / task_id
    task = yaml.safe_load((source / "task.yaml").read_text())
    for service in task["services"]:
        name = service["name"]
        if name not in SERVICES and name not in GWS and not name.startswith(
                "ocr"):
            raise ValueError(f"{task_id}: no kit fake for {name}")
    out = {
        "instruction.md": instruction(task).encode(),
        "task.toml": task_toml(task).encode(),
        "environment/mirage.yaml": mirage_yaml(task).encode(),
        "tests/test.sh": TEST_SH.format(task_id=task_id).encode(),
        "tests/grade.py": GRADE.read_bytes(),
    }
    clis = tools(task)
    if clis:
        listed = [{
            k: v
            for k, v in cli.items() if k != "service"
        } for cli in clis]
        out["environment/tools.json"] = (
            json.dumps(listed, ensure_ascii=False, indent=1) + "\n").encode()
    for name, service in kit_fakes(task):
        out[f"environment/kit/{name}.json"] = fixture(task, service)
    if uses(task):
        out["environment/kit/gws.json"] = gws_fixture(task)
        out["tests/gws_seed.json"] = (
            json.dumps({
                **gws_seed(task), "epoch": epoch(task)
            },
                       ensure_ascii=False,
                       indent=1) + "\n").encode()
    for path in task.get("sandbox_files") or []:
        found = [p for p in (source / path, UPSTREAM / path) if p.is_file()]
        if not found:
            raise ValueError(f"{task_id}: sandbox file {path} not found")
        out[f"environment/workspace/{path}"] = found[0].read_bytes()
    if task_id in SOLVED:
        out["solution/trajectory.py"] = ORACLE.read_bytes()
    return out


def site() -> int:
    """The grader's packages for the VM: CPython 3.12 on Linux, the host's
    architecture, as msb boots its image."""
    arch = {
        "arm64": "aarch64",
        "aarch64": "aarch64"
    }.get(platform.machine(), "x86_64")
    return subprocess.run([
        "uv", "pip", "install", "--quiet", "--target",
        str(SITE), "--python-version", "3.12", "--python-platform",
        f"{arch}-manylinux_2_28", "--only-binary", ":all:", *PACKAGES
    ]).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--site", action="store_true")
    parser.add_argument("tasks", nargs="*", default=TASKS)
    args = parser.parse_args()
    if args.site:
        return site()
    failed = 0
    for task_id in args.tasks:
        target = OUT / task_id
        problems = []
        files = expected(task_id)
        ours = OURS if task_id in SOLVED else []
        for rel in ours:
            if not (target / rel).is_file():
                problems.append(f"{rel} (ours) is missing")
        for rel, data in files.items():
            path = target / rel
            if args.check:
                if not path.is_file():
                    problems.append(f"{rel} is missing")
                elif path.read_bytes() != data:
                    problems.append(f"{rel} differs from upstream's")
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        for path in sorted(target.rglob("*")):
            rel = path.relative_to(target).as_posix()
            if path.is_file() and rel not in files and rel not in ours:
                problems.append(f"{rel} is not generated or ours")
        failed += bool(problems)
        status = "FAIL" if problems else ("ok" if args.check else "written")
        print(f"{status} {task_id}")
        for problem in problems:
            print(f"    {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
