"""Write the oracle's run as the agent's Harbor trajectory.

    python3 /solution/trajectory.py <steps dir> /logs/agent/trajectory.json

Each task's ``solution/trajectory.py`` is this file (written by
``convert.py``). ``solve.sh`` runs each of its steps through ``step``,
which keeps the command as ``<n>.cmd``, the workspace's time in ms as
``<n>.at`` and the output as ``<n>.out``; this writes them as ATIF agent
steps, in order, one shell call each, stamped with that time. The grader
counts a mount read the step that issued it shows (graders/seen.ts); an
``oracle`` trajectory is on the trial's clock, which the grader moves to the
host's.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    steps, out = (Path(p) for p in sys.argv[1:3])
    trajectory = {
        "schema_version": "ATIF-v1.6",
        "session_id": "oracle",
        "agent": {
            "name": "oracle",
            "version": "1"
        },
        "steps": [],
    }
    for cmd in sorted(steps.glob("*.cmd"), key=lambda p: int(p.stem)):
        n = int(cmd.stem)
        call = f"call_{n}"
        at = int(cmd.with_suffix(".at").read_text())
        output = cmd.with_suffix(".out")
        trajectory["steps"].append({
            "step_id":
            n,
            "timestamp":
            datetime.fromtimestamp(at / 1000, timezone.utc).isoformat(
                timespec="milliseconds").replace("+00:00", "Z"),
            "source":
            "agent",
            "message":
            "",
            "tool_calls": [{
                "tool_call_id": call,
                "function_name": "shell",
                "arguments": {
                    "command": cmd.read_text()
                }
            }],
            "observation": {
                "results": [{
                    "source_call_id":
                    call,
                    "content":
                    output.read_text() if output.exists() else ""
                }]
            },
        })
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(trajectory, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
