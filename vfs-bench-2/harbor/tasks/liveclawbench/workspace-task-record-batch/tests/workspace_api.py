"""The workspace mock's answers to a verifier, from the run's SQLite
(vfs-bench-2).

The workspace tasks' verifiers read the notes over HTTP (log in, then
``GET /api/notes``, ``.../brief`` and ``.../task-record``), which they
cannot reach on the workspace's Python, Pyodide, which has no network.
Where the request fails, their ``api_request()`` asks ``answer()`` instead,
which reads the run's database, a copy taken before the verifier runs, and
answers what ``api_request()`` returns, as the mock's handlers do
(mocks/workspace/src/routes and data/store.ts): the same statements, order
and fields. In a microVM the verifier reaches the mock, and this is never
asked.

The verifiers log in as demo before anything else, and each later request
is demo's, as the session cookie makes it upstream.
"""
import json
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

# The run's SQLite, where the environment puts it for the verifier
# (environment/mirage.yaml's `state`).
DB_PATH = "/var/lib/mock-data/workspace/workspace.db"

NOTE = ("id", "owner_user_id", "title", "content", "content_type",
        "preview_text", "is_seeded", "save_count", "created_at", "updated_at")
BRIEF = ("id", "note_id", "key_updates", "evidence_bullets", "action_items",
         "citations", "status", "created_at", "updated_at")
RECORD = ("id", "note_id", "record_type", "source_channel", "summary_text",
          "status", "created_at", "updated_at")
JSON_FIELDS = ("evidence_bullets", "action_items", "citations")


class Refused(Exception):
    """The mock's error reply, as ``urlopen`` raises one."""


def _row(row, fields):
    return {
        f: json.loads(row[f]) if f in JSON_FIELDS else row[f]
        for f in fields
    }


def answer(path, method="GET", data=None, error=None):
    """What the verifier's ``api_request()`` returns for a request, or, for
    one no verifier here makes, the failure it met."""
    url = urlsplit(path)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        user = conn.execute("SELECT id FROM user WHERE username = ?",
                            ("demo", )).fetchone()
        if method == "POST" and url.path == "/api/auth/login":
            return {"redirect": "/workspace"}
        if method == "GET" and url.path == "/api/notes":
            seeded = parse_qs(url.query).get("seeded", [""])[0] == "1"
            sql = "SELECT * FROM note WHERE owner_user_id = ?"
            if seeded:
                sql += " AND is_seeded = 1"
            sql += " ORDER BY updated_at DESC"
            return [_row(r, NOTE) for r in conn.execute(sql, (user["id"], ))]
        match = re.fullmatch(r"/api/notes/(\d+)/(brief|task-record)", url.path)
        if method == "GET" and match:
            note = conn.execute("SELECT id FROM note WHERE id = ?",
                                (int(match.group(1)), )).fetchone()
            if note is None:
                raise Refused(f"HTTP 404 for {path}")
            if match.group(2) == "brief":
                row = conn.execute(
                    "SELECT * FROM brief_entry WHERE note_id = ?",
                    (note["id"], )).fetchone()
                # A note with no brief is the mock's 404.
                if row is None:
                    raise Refused(f"HTTP 404 for {path}")
                return _row(row, BRIEF)
            row = conn.execute("SELECT * FROM task_record WHERE note_id = ?",
                               (note["id"], )).fetchone()
            return None if row is None else _row(row, RECORD)
    finally:
        conn.close()
    raise error if error is not None else Refused(f"no answer for {path}")
