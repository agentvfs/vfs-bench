"""Grade one ComplexMCP trial with upstream's judge, in the verifier's VM.

    python3 /tests/grade.py <row>

Each committed ComplexMCP task's ``tests/grade.py`` (harbor/complexmcp.py
writes it). It runs where ``MicrosandboxVerifier`` runs a test, with what
the task's ``mirage.yaml`` gives that VM: upstream's checkout and rows under
``/opt/complexmcp`` (``state/complexmcp``: ``src/`` and ``tasks.json``), the
judge's package (python-Levenshtein) under ``/opt/complexmcp-site``, and each
app's fake at upstream's port.

It judges the run as upstream's ``run_benchmark.py`` does:
``benchmark.judge.judge_env`` over the starting environment (what each
app's login answered), the end environment (what its logout answers) and the
row's expected one (``gt_env``). The run passes, as upstream's accuracy
counts it, when every expected change was made (recall == total) and
nothing else changed (misbehave == 0): ``reward.json``'s ``reward`` is 1
or 0, beside the judge's counts, and ``judge.log`` its verbose lines.

Two things differ from upstream's judge, each as small as it can be:
- ``trid``, the LightShop and LightStock transaction id, is skipped, as
  upstream skips the other ids its apps draw from the session's seeded
  generator (``rid`` and ``oid`` since its 3e45e5d). It comes out the same
  only for a run that draws as often before each checkout or trade.
- Every float is rounded to 6 places in all three environments: a balance
  sums its trades in the order they were made, so the same trades in
  another order can miss the expected one by 1e-12.
"""
import contextlib
import io
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

COMPLEXMCP = Path("/opt/complexmcp")
SITE = Path("/opt/complexmcp-site")
LOGS = Path("/logs/verifier")
PORTS = {"LightSystem": 9000, "LightTalk": 9001, "LightShop": 9002,
         "LightWeather": 9003, "LightFlight": 9004, "LightStock": 9005,
         "LightNews": 9006}
PLACES = 6


def env(app: str, which: str) -> Any:
    """What an app's login answered, or what its logout answers now."""
    request = urllib.request.Request(f"http://localhost:{PORTS[app]}/{which}",
                                     data=b"", method="POST")
    with urllib.request.urlopen(request, timeout=60) as reply:
        return json.load(reply)


def rounded(value: Any) -> Any:
    """``value`` with every float in it rounded to ``PLACES``."""
    if isinstance(value, float):
        return round(value, PLACES)
    if isinstance(value, list):
        return [rounded(item) for item in value]
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    return value


def judged(row: dict, initial: dict, final: dict) -> tuple[dict, str]:
    """Upstream's judge over the two environments and the row's expected
    one, as above: its counts and its verbose lines."""
    from benchmark import judge

    judge.exclude_keys.add("trid")
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        result = judge.judge_env(rounded(initial), rounded(final),
                                 rounded(row["gt_env"]), verbose=True)
    return result, log.getvalue()


def main() -> int:
    index = int(sys.argv[1])
    if not (COMPLEXMCP / "tasks.json").is_file():
        print(f"{COMPLEXMCP} is missing: upstream's judge and rows reach "
              "MicrosandboxVerifier's VM alone "
              "(--verifier vfsbench_harbor:MicrosandboxVerifier)")
        return 1
    sys.path[:0] = [str(SITE), str(COMPLEXMCP / "src")]
    row = json.loads((COMPLEXMCP / "tasks.json").read_text())[index]
    apps = ["LightSystem", *row["apps"]]
    initial = {app: env(app, "login") for app in apps}
    final = {app: env(app, "logout") for app in apps}
    result, log = judged(row, initial, final)
    passed = result["recall"] == result["total"] and result["misbehave"] == 0
    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / "reward.json").write_text(json.dumps({
        "reward": int(passed), "total": result["total"],
        "recall": result["recall"], "misbehave": result["misbehave"]}))
    (LOGS / "judge.log").write_text(log)
    print(log)
    print(f"total {result['total']}, recall {result['recall']}, "
          f"misbehave {result['misbehave']}: {'pass' if passed else 'fail'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
