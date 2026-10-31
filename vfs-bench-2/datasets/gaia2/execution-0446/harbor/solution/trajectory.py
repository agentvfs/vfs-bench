"""Write an oracle's answer as the agent's Harbor trajectory.

    python3 /solution/trajectory.py '<answer>' [/logs/agent/trajectory.json]

Each solved Gaia2 task's ``solution/trajectory.py`` is this file (written by
``generate.py``). Upstream's agent hands in its answer by replying, and
its adapter logs the reply as the turn's ``send_message_to_user``;
the native grader reads that reply from the trajectory's last agent
message. A solution runs the apps' commands itself, then this, with the
answer it found.
"""
import json
import sys
from pathlib import Path


def main() -> int:
    answer = sys.argv[1]
    out = Path(sys.argv[2] if len(sys.argv) >
               2 else "/logs/agent/trajectory.json")
    trajectory = {
        "schema_version": "ATIF-v1.6",
        "session_id": "oracle",
        "agent": {
            "name": "oracle",
            "version": "1"
        },
        "steps": [{
            "step_id": 1,
            "source": "agent",
            "message": answer
        }],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(trajectory, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
