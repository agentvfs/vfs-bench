"""Grade one EnterpriseOps-Gym trial with upstream's verifiers: the reference.

    python3 /tests/grade.py

Each committed EnterpriseOps-Gym task's ``tests/grade.py``
(harbor/enterpriseops.py writes it), beside ``verifiers.json`` (the task's
``verifiers``, as upstream's dataset gives them) and ``ports.json`` (each
server's port, at which its fake answers for this trial). It runs where
``MicrosandboxVerifier`` runs a test, which reaches those ports; the
native port of it is ``graders/enterpriseops.ts`` (``MirageVerifier``).

Every verifier is a ``database_state`` check, which this runs as upstream's
``benchmark/verifier.py`` does (ServiceNow/EnterpriseOps-Gym, Apache-2.0):
the query goes to the server's ``/api/sql-runner``, its value is taken from
the reply as ``_extract_value_from_sql_result`` takes it, and compared with
the expected one as ``_compare_values`` compares them. The trial passes, as
upstream's ``overall_success_rate`` counts a run, when every verifier
passes: ``reward.json``'s ``reward`` is 1 or 0, beside the verifiers'
pass rate, and ``verifiers.json`` in the logs each one's result.
"""
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
LOGS = Path("/logs/verifier")


def sql(port: int, query: str) -> dict:
    """Upstream's ``_execute_sql_query``: the runner's JSON, or its error."""
    request = urllib.request.Request(
        f"http://localhost:{port}/api/sql-runner",
        data=json.dumps({"query": query}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as reply:
            return {"success": True, "result": json.load(reply)}
    except urllib.error.HTTPError as error:
        text = error.read().decode(errors="replace")
        try:
            body = json.loads(text)
            detail = body.get("detail", body.get("message", text)) if isinstance(
                body, dict) else text
        except json.JSONDecodeError:
            detail = text
        return {"success": False, "error": f"HTTP {error.code}: {detail}"}
    except OSError as error:
        return {"success": False, "error": str(error)}


def extract(result: dict) -> Any:
    """Upstream's ``_extract_value_from_sql_result``, for the runner's reply."""
    if not result.get("success"):
        return None
    data = result.get("result", {})
    if isinstance(data, dict) and "data" in data:
        rows = data["data"]
        if isinstance(rows, list) and rows:
            if len(rows) == 1 and isinstance(rows[0], dict) and len(rows[0]) == 1:
                return list(rows[0].values())[0]
            if len(rows) == 1:
                return rows[0]
            return rows
        return rows
    return data


def compare(actual: Any, expected: Any, kind: str) -> bool:
    """Upstream's ``_compare_values``."""
    try:
        if kind == "equals":
            return actual == expected
        if kind == "greater_than":
            return actual > expected
        if kind == "less_than":
            return actual < expected
        if kind == "contains":
            return expected in str(actual)
    except Exception:  # noqa: BLE001  (upstream counts any error a failure)
        return False
    return False


def main() -> int:
    verifiers = json.loads((HERE / "verifiers.json").read_text())
    ports = json.loads((HERE / "ports.json").read_text())
    results = []
    for verifier in verifiers:
        if verifier.get("verifier_type") != "database_state":
            results.append({"name": verifier.get("name"), "passed": False,
                            "error": "not a database_state verifier"})
            continue
        config = verifier["validation_config"]
        reply = sql(ports[verifier["gym_name"]], config["query"])
        if not reply["success"]:
            results.append({"name": verifier.get("name"), "passed": False,
                            "error": f"SQL query failed: {reply['error']}",
                            "query": config["query"]})
            continue
        actual = extract(reply)
        kind = config.get("comparison_type", "equals")
        results.append({
            "name": verifier.get("name"),
            "passed": compare(actual, config.get("expected_value"), kind),
            "expected": config.get("expected_value"),
            "actual": actual,
            "comparison_type": kind,
            "query": config["query"],
        })
    passed = sum(r["passed"] for r in results)
    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / "reward.json").write_text(json.dumps({
        "reward": int(bool(results) and passed == len(results)),
        "verifiers_passed": passed,
        "verifiers": len(results),
    }))
    (LOGS / "verifiers.json").write_text(json.dumps(results, indent=1))
    for r in results:
        detail = r.get("error") or f"{r.get('actual')!r} vs {r.get('expected')!r}"
        print(f"{'pass' if r['passed'] else 'FAIL'} {r['name']}: {detail}")
    print(f"{passed} of {len(results)} verifiers pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
