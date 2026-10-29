"""Grade one ComplexMCP run with upstream's own judge.

Reads ``{"src", "initial", "final", "gt_env"}`` on stdin and prints
``{"total", "recall", "misbehave", "log"}``: upstream's
``benchmark.judge.judge_env`` over the starting environment, the end
environment and the expected one, with its verbose lines as the log. Two
things differ: ``trid`` is skipped as upstream skips its other drawn ids,
and every float is rounded to 6 places first. A run passes, as upstream's
accuracy counts it, when every expected change was made (recall == total)
and nothing else changed (misbehave == 0).
"""
import contextlib
import io
import json
import sys
from typing import Any

PLACES = 6


def rounded(value: Any) -> Any:
    """``value`` with every float in it rounded to ``PLACES``; ints and
    everything else are left as they are."""
    if isinstance(value, float):
        return round(value, PLACES)
    if isinstance(value, list):
        return [rounded(item) for item in value]
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    return value


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

    # The judge compares floats exactly, and a balance sums its trades in the
    # order they were made, so the same trades in another order can miss the
    # expected balance by 1e-12. Rounding far below a cent removes that; the
    # starting environment is rounded too, so an unchanged float still
    # equals its expected value.
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        result = judge.judge_env(rounded(data["initial"]),
                                 rounded(data["final"]),
                                 rounded(data["gt_env"]),
                                 verbose=True)
    print(json.dumps({**result, "log": log.getvalue()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
