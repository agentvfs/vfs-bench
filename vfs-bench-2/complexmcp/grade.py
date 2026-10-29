"""Grade one ComplexMCP run with upstream's own judge.

Reads ``{"src", "initial", "final", "gt_env"}`` on stdin and prints
``{"total", "recall", "misbehave", "log"}``: upstream's
``benchmark.judge.judge_env`` over the starting environment, the end
environment and the expected one, with its verbose lines as the log and
``trid`` skipped as upstream skips its other drawn ids. A run passes, as
upstream's accuracy counts it, when every expected change was made
(recall == total) and nothing else changed (misbehave == 0).
"""
import contextlib
import io
import json
import sys


def main() -> int:
    data = json.load(sys.stdin)
    sys.path.insert(0, data["src"])
    from benchmark import judge

    # Upstream skips the ids its apps draw from the session's seeded random
    # generator (rid and oid since its 3e45e5d), but not trid, the LightShop
    # and LightStock transaction id. It comes out the same only for a run
    # that draws as often before each checkout or trade (every add_to_cart,
    # wait_payment_password and earlier trade draws), so it is skipped too.
    judge.exclude_keys.add("trid")

    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        result = judge.judge_env(data["initial"],
                                 data["final"],
                                 data["gt_env"],
                                 verbose=True)
    print(json.dumps({**result, "log": log.getvalue()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
