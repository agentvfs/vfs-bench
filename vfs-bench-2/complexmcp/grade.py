"""Grade one ComplexMCP run with upstream's own judge.

Reads ``{"src", "initial", "final", "gt_env"}`` on stdin and prints
``{"total", "recall", "misbehave", "log"}``: upstream's
``benchmark.judge.judge_env`` over the starting environment, the end
environment and the expected one, with its verbose lines as the log. A
run passes, as upstream's accuracy counts it, when every expected change
was made (recall == total) and nothing else changed (misbehave == 0).
"""
import contextlib
import io
import json
import sys


def main() -> int:
    data = json.load(sys.stdin)
    sys.path.insert(0, data["src"])
    from benchmark.judge import judge_env

    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        result = judge_env(data["initial"],
                           data["final"],
                           data["gt_env"],
                           verbose=True)
    print(json.dumps({**result, "log": log.getvalue()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
