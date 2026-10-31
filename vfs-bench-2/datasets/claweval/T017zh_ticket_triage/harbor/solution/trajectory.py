"""Write an oracle's run as the agent's Harbor trajectory.

    python3 /solution/trajectory.py <steps dir> <reply.md> \
        /logs/agent/trajectory.json

Each committed Claw-Eval solution's ``solution/trajectory.py`` is this file
(written by ``generate.py``). Upstream's grader reads the model's
turns: its tool calls, what they returned and its final reply. A
solution's ``solve.sh`` runs each of its commands through ``step``, which
keeps the command as ``<n>.cmd`` and its output as ``<n>.out`` in the
steps directory; this writes them as ATIF agent steps, one shell call each
with its output as the call's result, then the reply as the last step's
message, which ``claweval_grade.py`` reads as an agent's.
"""
import json
import sys
from pathlib import Path


def main() -> int:
    steps, reply, out = (Path(p) for p in sys.argv[1:4])
    trajectory = {
        "schema_version": "ATIF-v1.6",
        "session_id": "oracle",
        "agent": {
            "name": "oracle",
            "version": "1"
        },
        "steps": [],
    }
    for n, cmd in enumerate(sorted(steps.glob("*.cmd")), 1):
        call = f"call_{n}"
        output = cmd.with_suffix(".out")
        trajectory["steps"].append({
            "step_id":
            n,
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
    trajectory["steps"].append({
        "step_id": len(trajectory["steps"]) + 1,
        "source": "agent",
        "message": reply.read_text(),
    })
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(trajectory, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
