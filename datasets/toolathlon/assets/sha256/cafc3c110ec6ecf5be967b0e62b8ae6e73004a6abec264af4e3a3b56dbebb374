#!/usr/bin/env python
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

REPO_ROOT = Path(__file__).resolve().parents[4]
TASK = Path(__file__).resolve().parents[1]
SHIM = str(REPO_ROOT / "redirect" / "gws_sheets")
GWS = os.environ.get("GWS_URL", "http://127.0.0.1:19999")
FOLDER = os.environ.get("DRIVE_FOLDER_ID", "f0001")

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "agent"))

# Where the agent writes, defined once in agent/services.py.
from services import agent_workspace  # noqa: E402

WORKDIR = str(agent_workspace(TASK))
# Toolathlon-GYM vendors the terminal fork. The filesystem package is derived
# from original Toolathlon's package lock.
GYM = REPO_ROOT / "submodule" / "toolathlon_gym"
LOCAL_SERVERS = Path(os.environ.get(
    "TOOLATHLON_GYM_ROOT", GYM)).expanduser().resolve() / "local_servers"
from server.mcp.setup_filesystem import ENTRY as FILESYSTEM_ENTRY  # noqa: E402

SOURCE_TITLE = "NHL 2425 Schedule"
TARGET_TITLE = "NHL-B2B-Analysis"
HEADERS = ["Team", "HA", "AH", "HH", "AA", "Total"]

# Computed inside the sandbox via terminal.run_command, not here.
ANALYSIS = r'''
import json
rows = json.load(open("/DATA/sched.json"))
games = {}
for r in rows[1:]:
    if len(r) < 6 or not r[0]:
        continue
    date, away, home = r[0], r[3], r[5]
    games.setdefault(away, []).append((date, "A"))
    games.setdefault(home, []).append((date, "H"))

from datetime import date as D
def parse(s):
    y, m, d = (int(x) for x in s.split("-"))
    return D(y, m, d)

out = []
for team in sorted(games):
    ev = sorted(set(games[team]))
    c = {"HA": 0, "AH": 0, "HH": 0, "AA": 0}
    for i in range(len(ev) - 1):
        d1, v1 = ev[i]
        d2, v2 = ev[i + 1]
        if (parse(d2) - parse(d1)).days == 1:
            c[v1 + v2] += 1
    out.append([team, c["HA"], c["AH"], c["HH"], c["AA"], sum(c.values())])
json.dump(out, open("/DATA/answer.json", "w"))
print("teams", len(out), "total", sum(r[5] for r in out))
'''


def servers() -> dict:
    """Build the same server set the --tools mcp arm uses."""
    tool_yaml = (REPO_ROOT / "submodule" / "Toolathlon" / "configs" /
                 "mcp_servers" / "terminal.yaml").read_text()
    allowed = tool_yaml.split('ALLOWED_COMMANDS: "')[1].split('"')[0]
    return {
        "google_sheet":
        StdioServerParameters(
            command="uvx",
            args=["--with", "mcp>=1.2,<2", "mcp-google-sheets"],
            env={
                **os.environ, "PYTHONPATH": SHIM,
                "GWS_MOCK_URL": GWS,
                "TOKEN_PATH": f"{SHIM}/fake_token.json",
                "CREDENTIALS_PATH": "/nonexistent.json",
                "SERVICE_ACCOUNT_PATH": "/nonexistent.json",
                "DRIVE_FOLDER_ID": FOLDER
            }),
        "filesystem":
        StdioServerParameters(command="node",
                              args=[str(FILESYSTEM_ENTRY), WORKDIR]),
        "terminal":
        StdioServerParameters(command="uv",
                              args=[
                                  "--directory",
                                  str(LOCAL_SERVERS / "cli-mcp-server"), "run",
                                  "cli-mcp-server"
                              ],
                              env={
                                  **os.environ, "ALLOWED_DIR": WORKDIR,
                                  "ALLOWED_COMMANDS": allowed,
                                  "ALLOWED_FLAGS": "all",
                                  "MAX_COMMAND_LENGTH": "8192",
                                  "COMMAND_TIMEOUT": "120",
                                  "ALLOW_SHELL_OPERATORS": "true"
                              }),
    }


def text_of(result) -> str:
    """Concatenate the text blocks of a CallToolResult."""
    return "\n".join(b.text for b in (result.content or [])
                     if getattr(b, "text", None))


def json_items(result) -> list:
    """Parse a CallToolResult into a flat list of JSON values.

    FastMCP emits one content block per item when a tool returns a list, so
    a list of dicts arrives as N blocks each holding one JSON object.

    Args:
        result: a CallToolResult.

    Returns:
        list: every parsed value, with list-valued blocks flattened in.
    """
    items = []
    for block in result.content or []:
        text = getattr(block, "text", None)
        if not text:
            continue
        value = json.loads(text)
        items.extend(value) if isinstance(value, list) else items.append(value)
    return items


async def main() -> int:
    os.makedirs(WORKDIR, exist_ok=True)
    specs = servers()
    step = 0

    def log(msg: str) -> None:
        nonlocal step
        step += 1
        print(f"  {step}. {msg}")

    async with stdio_client(specs["google_sheet"]) as (r1, w1), \
               stdio_client(specs["filesystem"]) as (r2, w2), \
               stdio_client(specs["terminal"]) as (r3, w3):
        async with ClientSession(r1, w1) as sheets, \
                   ClientSession(r2, w2) as files, \
                   ClientSession(r3, w3) as term:
            for s in (sheets, files, term):
                await s.initialize()
            print("connected: google_sheet, filesystem, terminal")

            listed = json_items(await sheets.call_tool("list_spreadsheets",
                                                       {}))
            src = next(s["id"] for s in listed if s["title"] == SOURCE_TITLE)
            log(f"list_spreadsheets -> source id {src}")

            data = json_items(await sheets.call_tool("get_sheet_data", {
                "spreadsheet_id": src,
                "sheet": "Sheet1"
            }))[0]
            rows = data["valueRanges"][0]["values"] if "valueRanges" in data \
                else data["values"]
            log(f"get_sheet_data -> {len(rows)} rows")

            await files.call_tool("write_file", {
                "path": f"{WORKDIR}/sched.json",
                "content": json.dumps(rows)
            })
            await files.call_tool(
                "write_file", {
                    "path": f"{WORKDIR}/analyze.py",
                    "content": ANALYSIS.replace("/DATA", WORKDIR)
                })
            log("filesystem.write_file -> staged sched.json + analyze.py")

            # Toolathlon's allowlist permits `python`, not `python3`.
            out = text_of(await term.call_tool(
                "run_command", {"command": f"python {WORKDIR}/analyze.py"}))
            log(f"terminal.run_command -> {out.strip().splitlines()[-1]}")

            answer = json.loads(Path(f"{WORKDIR}/answer.json").read_text())
            if len(answer) != 32:
                print(f"FAIL: computed {len(answer)} teams, expected 32")
                return 1

            created = json_items(await
                                 sheets.call_tool("create_spreadsheet", {
                                     "title": TARGET_TITLE,
                                     "folder_id": FOLDER
                                 }))[0]
            tgt = created.get("spreadsheetId") or created.get("id")
            log(f"create_spreadsheet -> {tgt}")

            await sheets.call_tool(
                "update_cells", {
                    "spreadsheet_id": tgt,
                    "sheet": "Sheet1",
                    "range": f"A1:F{len(answer) + 1}",
                    "data": [HEADERS] + [[str(c) for c in row]
                                         for row in answer]
                })
            log(f"update_cells -> wrote {len(answer) + 1} rows")

    print("\nsolve completed; running the task's own verifier:\n")
    verifier = TASK / "shared" / "verify_mock.py"
    proc = await asyncio.create_subprocess_exec(sys.executable,
                                                str(verifier),
                                                env={
                                                    **os.environ, "GWS_URL":
                                                    GWS
                                                })
    return await proc.wait()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
