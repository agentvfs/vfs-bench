"""Grade one EnterpriseOps-Gym trial with upstream's verifiers, in the verifier's VM.

    python3 /tests/grade.py

Each committed EnterpriseOps-Gym task's ``tests/grade.py``
(harbor/enterpriseops.py writes it). It runs in the trial's workspace, on
its Python (Pyodide), under ``WorkspaceVerifier``, beside
``verifiers.json`` (the task's ``verifiers``, as upstream's dataset gives
them) and ``databases.json`` (where each server's database is: its run's
SQLite, which the agent never sees, revealed for the verifier).

Every verifier is a ``database_state`` check, which this runs as upstream's
``benchmark/verifier.py`` does (ServiceNow/EnterpriseOps-Gym, Apache-2.0):
the query runs as the server's ``/api/sql-runner`` runs it (one read-only
SELECT, ``LIMIT 100`` unless it has a LIMIT, each row a dict), its value is
taken from the result as ``_extract_value_from_sql_result`` takes it, and
compared with the expected one as ``_compare_values`` compares them. The trial passes, as
upstream's ``overall_success_rate`` counts a run, when every verifier
passes: ``reward.json``'s ``reward`` is 1 or 0, beside the verifiers'
pass rate, and ``verifiers.json`` in the logs each one's result.
"""
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
LOGS = Path("/logs/verifier")


FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|VACUUM|"
    r"ATTACH|DETACH|PRAGMA|REINDEX|ANALYZE|BEGIN|END|COMMIT|ROLLBACK)\b",
    re.IGNORECASE)
STRING_OR_COMMENT = re.compile(
    r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|--[^\n]*|/\*[^*]*\*+(?:[^/*][^*]*\*+)*/",
    re.DOTALL)


def sql(path: str, query: str, limit: int = 100) -> dict:
    """Upstream's ``_execute_sql_query``, over the SQL runner's own rules:
    the result as the runner returns it, or its error."""
    q = query.strip().rstrip(";").strip()
    if ";" in q:
        return {"success": False,
                "error": "Only a single SELECT statement is allowed"}
    head = q.lstrip().upper()
    if not head.startswith(("SELECT", "WITH", "EXPLAIN")) or FORBIDDEN.search(
            STRING_OR_COMMENT.sub(" ", q)):
        return {"success": False,
                "error": "Only read-only SELECT queries are allowed"}
    if " LIMIT " not in q.upper():
        q = f"{q} LIMIT {limit}"
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as error:
        return {"success": False, "error": str(error)}
    conn.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in conn.execute(q).fetchall()]
    except sqlite3.Error as error:
        return {"success": False, "error": f"Query failed: {error}"}
    finally:
        conn.close()
    return {"success": True, "result": {"success": True, "data": rows,
                                        "row_count": len(rows), "query": q}}


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
    databases = json.loads((HERE / "databases.json").read_text())
    results = []
    for verifier in verifiers:
        if verifier.get("verifier_type") != "database_state":
            results.append({"name": verifier.get("name"), "passed": False,
                            "error": "not a database_state verifier"})
            continue
        config = verifier["validation_config"]
        reply = sql(databases[verifier["gym_name"]], config["query"])
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
