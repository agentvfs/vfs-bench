"""The expense mock's answers to a verifier, from the run's SQLite (vfs-bench-2).

expense-draft-delete's verifier reads the drafts over HTTP (a token, then
``GET /api/drafts``), which it cannot reach on the workspace's Python,
Pyodide, which has no network. Where the request fails, its ``api_call()``
asks ``answer()`` instead, which reads the run's database at the path
upstream's image keeps it, a copy taken before the verifier runs, and
answers as the mock's handlers do (mocks/expense/src/routes/auth.ts and
drafts.ts): the same statements, order and fields. In a microVM the
verifier reaches the mock, and this is never asked.

A token here is the user's id (``offline.<id>``), not a signed one; it is
only ever handed back to ``answer()``. Logging in does not stamp the user's
``last_login_at``, which the copy cannot keep.
"""
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

DB_PATH = "/var/lib/mock-data/expense/expense.db"

DRAFT_FIELDS = ("id", "draft_code", "user_id", "vendor_name", "category",
                "amount", "currency", "invoice_date", "expense_date", "notes",
                "source_type", "status", "attachment_ref", "created_at",
                "updated_at", "submitted_at")
ORDER = {
    "newest": "created_at DESC",
    "oldest": "created_at ASC",
    "amount_desc": "amount DESC",
    "amount_asc": "amount ASC",
}


class Refused(Exception):
    """The mock's error reply, which the verifier's ``api_call()`` raises."""


def _token(conn, data):
    user = conn.execute(
        "SELECT * FROM user WHERE email = ? AND password = ? AND is_active = 1",
        ((data or {}).get("email"), (data or {}).get("password"))).fetchone()
    if user is None:
        raise Refused('HTTP 401: {"error":"Invalid credentials"}')
    return {"token": f"offline.{user['id']}", "expires_in": 3600}


def _drafts(conn, query, user_id):
    first = {k: v[0] for k, v in query.items()}
    page = int(first.get("page", "1"))
    limit = int(first.get("limit", "20"))
    where, params = "WHERE user_id = ?", [user_id]
    if first.get("status"):
        where += " AND status = ?"
        params.append(first["status"])
    if first.get("q"):
        term = "%" + re.sub(r"([\\%_])", r"\\\1", first["q"]) + "%"
        where += (" AND (vendor_name LIKE ? ESCAPE '\\' OR notes LIKE ? "
                  "ESCAPE '\\' OR draft_code LIKE ? ESCAPE '\\')")
        params += [term, term, term]
    total = conn.execute(f"SELECT COUNT(*) FROM expense_draft {where}",
                         params).fetchone()[0]
    rows = conn.execute(
        f"SELECT * FROM expense_draft {where} ORDER BY "
        f"{ORDER[first.get('sort', 'newest')]} LIMIT ? OFFSET ?",
        params + [limit, (page - 1) * limit]).fetchall()
    return {
        "drafts": [{k: row[k] for k in DRAFT_FIELDS} for row in rows],
        "total": total,
        "page": page,
        "total_pages": -(-total // limit) or 1,
    }


def answer(method, path, data=None, token=None, error=None):
    """The mock's reply to a request, or, for one no verifier here makes,
    the failure the verifier met."""
    url = urlsplit(path)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        if method == "POST" and url.path == "/api/auth/token":
            return _token(conn, data)
        match = re.fullmatch(r"offline\.(\d+)", token or "")
        if method == "GET" and url.path == "/api/drafts":
            if match is None:
                raise Refused(
                    'HTTP 401: {"success":false,"message":"Authentication required"}')
            return _drafts(conn, parse_qs(url.query), int(match.group(1)))
    finally:
        conn.close()
    raise error if error is not None else Refused(f"no answer for {path}")
