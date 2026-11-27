"""Seed Toolathlon's calendar and inbox on their published reference date."""

import ast
import asyncio
import hashlib
import json
import sys
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from vfsbench.runtime import TrialEnvironment, VerifierGuest
from vfsbench.verifier import SuiteVerifier

from . import _toolathlon_gws as gws
from ._mcpatlas_services import stdio_service, tool_cli
from ._npm import install_locked
from ._toolathlon_mail import mail_server

HERE = Path(__file__).parent
VENDOR = HERE / "vendor/toolathlon_calendar"
MANIFESTS = {
    "set-conf-cr-ddl":
    "895422ce121f4395baf452be47cef95202e08c6ead3570bb57448409a7a07b4d",
    "student-interview":
    "ba7f8ca88788d1455afbd4d3dab51ba195b4ff54684ece3acc27941dea95c2de",
}
SEED_PATH = "vfs-bench-1/server/seed/seed_mail.py"
MAIL_SEED = {
    "path":
    SEED_PATH,
    "url":
    "https://raw.githubusercontent.com/agentvfs/vfs-bench/"
    "3f45f90f620c8096dd85bbe854b757eae1231392/" + SEED_PATH,
    "size":
    8125,
    "sha256":
    "53d964b24901b6ae471d6f8ca63ff13969214081b07b17bcbf1f9d7bd89c46f1"
}
TOOLS = [
    "create_event", "get_event", "update_event", "delete_event", "list_events"
]


def _inputs(task):
    account = json.loads(
        task.file("upstream/email_config.json").read_bytes())["email"]
    day = datetime.fromisoformat(
        task.file("upstream/groundtruth_workspace/today.txt").read_text().
        strip()).date()
    if task.id == "set-conf-cr-ddl":
        names = ["emails_backup.json"]
        today = datetime.combine(day, time.min, UTC)
        seeder = task._dataset._source_file(MAIL_SEED)
        meetings = []
        start = end = day + timedelta(days=11)
        offset = "-12:00"
    else:
        names = [
            "emails.jsonl", "fake_emails_300_manual.json", "user_list.csv"
        ]
        today = datetime.combine(day, time(9), ZoneInfo("Asia/Hong_Kong"))
        seeder = task.file("upstream/preprocess/main.py")
        script = ast.parse(task.file("shared/seed_db.py").read_bytes())
        meetings = next(
            ast.literal_eval(n.value) for n in script.body
            if isinstance(n, ast.Assign) and isinstance(
                n.targets[0], ast.Name) and n.targets[0].id == "MEETINGS")
        start, end = day + timedelta(days=1), day + timedelta(days=2)
        offset = "+08:00"
    query = {
        "timeMin": f"{start}T00:00:00{offset}",
        "timeMax": f"{end}T23:59:59{offset}",
        "orderBy": "startTime"
    }
    inputs = [str(task.file("upstream/files/" + n)) for n in names]
    if meetings:
        inputs.append(
            str(task.file("upstream/preprocess/inject_fake_emails.py")))
    return account, today, str(seeder), inputs, meetings, query


async def _seed(request):
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        str(HERE / "_calendar_mail_seed.py"),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE)
    try:
        _, error = await proc.communicate(json.dumps(request).encode())
    except BaseException:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise
    if proc.returncode:
        raise RuntimeError(f"Calendar task mailbox import failed: "
                           f"{error.decode(errors='replace')[-1000:]}")


def _seed_calendar(base, today, meetings):
    zone = "Asia/Hong_Kong" if meetings else "UTC"
    gws.call(base, "/reset", {
        "epoch": today.isoformat(),
        "calendarTimeZone": zone
    }, "POST")
    for meeting in meetings:
        day = today.date() + timedelta(days=meeting["day"])
        body = {
            key: meeting[key]
            for key in ("summary", "description", "location")
        }
        for field, stamp in (("start", "from"), ("end", "to")):
            body[field] = {
                "dateTime": f"{day}T{meeting[stamp]}+08:00",
                "timeZone": zone
            }
        gws.call(base, "/calendar/v3/calendars/primary/events", body, "POST")


@asynccontextmanager
async def prepare(task, config, run_dir):
    data = await asyncio.to_thread(lambda: json.dumps(
        task.manifest, sort_keys=True, separators=(",", ":")).encode())
    if hashlib.sha256(data).hexdigest() != MANIFESTS[task.id]:
        raise ValueError("Unexpected Toolathlon calendar execution manifest")
    account, today, seeder, files, meetings, query = await asyncio.to_thread(
        _inputs, task)
    node, modules = await asyncio.to_thread(install_locked, task._dataset,
                                            VENDOR)
    stamp = int(today.timestamp() * 1000)
    async with mail_server(task._dataset, run_dir, [account],
                           stamp) as (settings,
                                      mailbox), gws.serve(run_dir) as base:
        mail_config = {
            "email": account,
            "password": settings["password"],
            "imap_server": settings["imap_host"],
            "imap_port": settings["imap_port"],
            "use_ssl": False,
            "use_starttls": False
        }
        request = {
            "account": mail_config,
            "today": today.isoformat(),
            "seeder": seeder,
            "files": files,
            "task": task.id
        }
        async with asyncio.TaskGroup() as preparing:
            preparing.create_task(_seed(request))
            preparing.create_task(
                asyncio.to_thread(_seed_calendar, base, today, meetings))
        async with gws.agent_api(base,
                                 prefixes=("/calendar/v3/", )) as endpoint:
            env = {
                "GWS_MOCK_URL": endpoint,
                "CALENDAR_OAUTH_PATH": str(VENDOR / "gcp-oauth.keys.json"),
                "CALENDAR_CREDENTIALS_PATH": str(VENDOR / "credentials.json"),
                "HOME": str(run_dir)
            }
            script = modules / ("@gongrzhe/"
                                "server-calendar-autoauth-mcp/build/"
                                "index.js")
            cmd = [
                str(node), "--import", (VENDOR / "calendar_hook.mjs").as_uri(),
                str(script)
            ]
            async with stdio_service(cmd, env, run_dir,
                                     TOOLS) as (session, tools):
                cli = tool_cli("google-calendar", session, tools, TOOLS)
                cli = replace(cli,
                              handlers={
                                  name:
                                  replace(handler,
                                          write=name in {
                                              "create-event", "update-event",
                                              "delete-event"
                                          })
                                  for name, handler in cli.handlers.items()
                              })

                async def state():
                    reply = await session.call_tool("list_events",
                                                    arguments=query)
                    if reply.is_error:
                        raise RuntimeError("Failed to read the trial calendar")
                    raw = await asyncio.to_thread(
                        gws.call, base,
                        "/calendar/v3/calendars/primary/events?maxResults=2500"
                    )
                    return {
                        "events": raw["items"],
                        "query": query,
                        "reply": reply.content[0].text
                    }

                async def install(ws):
                    ws.register_cli("google-calendar", cli)

                async def evaluate(view):
                    frozen = await view.service_state("calendar")
                    code = (await asyncio.to_thread(
                        task.file,
                        "upstream/evaluation/main.py")).read_bytes()
                    evidence = {
                        "driver.py":
                        (HERE / "_toolathlon_grader.py").read_bytes(),
                        "requirements.json":
                        b"[]",
                        "trajectory.json":
                        b"{}",
                        "code/evaluation/main.py":
                        code,
                        "code/evaluation/__init__.py":
                        b"",
                        "code/groundtruth_workspace/today.txt":
                        today.date().isoformat().encode(),
                        "code/utils/mcp/tool_servers.py":
                        (HERE /
                         "_calendar_verifier_transport.py").read_bytes(),
                        "calendar.json":
                        json.dumps({
                            "query": frozen["query"],
                            "reply": frozen["reply"]
                        }).encode()
                    }
                    if task.id == "set-conf-cr-ddl":
                        # The published evaluator imports pytz without using
                        # it.
                        evidence["code/pytz.py"] = b""
                    async with VerifierGuest(config) as guest:
                        verdict = await guest.run(
                            evidence, ["python3", "-I", "driver.py"])
                    if verdict.return_code not in (0, 10):
                        raise RuntimeError(f"Calendar verifier failed: "
                                           f"{verdict.stderr[-1000:]}")
                    return {
                        "reward": float(verdict.return_code == 0),
                        "grader": "toolathlon/evaluation/main.py"
                    }

                access = {**settings, "username": account}
                workspace = {
                    "system_time": today.isoformat(),
                    "env": {
                        "TZ": "Asia/Hong_Kong" if meetings else "UTC"
                    },
                    "mounts": {
                        "/mail": {
                            "vfs": "email",
                            "mode": "read",
                            "config": access
                        }
                    },
                    "clis": {
                        "himalaya": {
                            "cli": "himalaya",
                            "machine": "in_process",
                            "config": access
                        }
                    },
                    "network": {
                        "allowed_domains": [
                            f"127.0.0.1:{settings[k]}"
                            for k in ("imap_port", "smtp_port")
                        ]
                    }
                }
                instructions = (
                    f"The reference date is {today.date().isoformat()}. Read "
                    f"the original messages in "
                    "/mail or with the himalaya CLI. Use google-calendar "
                    "list-events, create-event, "
                    "get-event, update-event and delete-event with one JSON "
                    "argument. Run a verb with "
                    "--help for its original argument schema.")
                yield TrialEnvironment(workspace=workspace,
                                       verifier=SuiteVerifier(evaluate),
                                       install=install,
                                       instructions=instructions,
                                       python=not meetings,
                                       state_readers={
                                           "mail": mailbox,
                                           "calendar": state
                                       })
