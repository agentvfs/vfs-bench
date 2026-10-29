"""The social mock's answers to a verifier, from the run's SQLite
(vfs-bench-2).

Upstream's social verifiers that read the platform over HTTP (login, then
``GET /api/posts`` or ``GET /api/posts/<id>``) cannot reach it on the
workspace's Python, Pyodide, which has no network. Where the request fails,
their ``api()`` asks ``answer()`` instead, which reads the run's database at
the path upstream's image keeps it, a copy taken before the verifier runs,
and answers as the mock's handlers do (mocks/social/src/index.tsx and
access.ts): the same statements, visibility rules, order and fields. In a
microVM the verifier reaches the mock, and this is never asked.

A session here is the account's id (``offline.<id>``), not a signed token;
it is only ever handed back to ``answer()``. The mock publishes a scheduled
post that has come due whenever it lists or reads posts; here such a post
reads as published at the run's latest time, the newest stamp in its
database, since the copy cannot be written.
"""
import json
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

DB_PATH = "/var/lib/mock-data/social/social.db"


def _int(text):
    """JavaScript's ``parseInt(text, 10)``: the leading integer, or None."""
    match = re.match(r"\s*([+-]?\d+)", text or "")
    return int(match.group(1)) if match else None


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now(conn):
    """The run's latest time, as SQLite's ``datetime('now')`` writes it."""
    row = conn.execute(
        "SELECT MAX(t) FROM (SELECT MAX(created_at) AS t FROM post "
        "UNION ALL SELECT MAX(updated_at) FROM post "
        "UNION ALL SELECT MAX(created_at) FROM post_action_log "
        "UNION ALL SELECT MAX(updated_at) FROM comment)").fetchone()
    return row[0]


def _posts(now):
    """The ``post`` table as the mock reads it once it has published what
    is due (db.ts's ``publishDueScheduledPosts``): a CTE that shadows it,
    and its parameters."""
    due = "status = 'scheduled' AND REPLACE(scheduled_for, 'T', ' ') <= ?"
    return ("WITH post AS (SELECT id, author_account_id, content, "
            f"CASE WHEN {due} THEN 'published' ELSE status END AS status, "
            "visibility, moderation_state, scheduled_for, scheduled_timezone, "
            f"CASE WHEN {due} THEN ? ELSE published_at END AS published_at, "
            "deleted_at, is_pinned, has_event_cta, created_at, updated_at "
            "FROM main.post)", [now, now, now])


def _viewer(cookie):
    match = re.search(r"(?:^|;\s*)token=offline\.(\d+)(?:;|$)", cookie or "")
    return int(match.group(1)) if match else None


def _blocked(conn, a, b):
    return conn.execute(
        "SELECT 1 FROM follow_relation WHERE follower_account_id = ? AND "
        "target_account_id = ? AND status = 'blocked'", (a, b)).fetchone()


def _following(conn, a, b):
    return conn.execute(
        "SELECT 1 FROM follow_relation WHERE follower_account_id = ? AND "
        "target_account_id = ? AND status = 'following'", (a, b)).fetchone()


def _visibility(conn, post, viewer):
    """access.ts's ``visibilityCode``: "allow", "403" or "404"."""
    author = post["author_account_id"]
    if viewer and (_blocked(conn, author, viewer)
                   or _blocked(conn, viewer, author)):
        return "404"
    if post["status"] in ("deleted", "draft", "scheduled"):
        return "allow" if viewer == author else "404"
    if post["visibility"] in ("public", "unlisted"):
        return "allow"
    if post["visibility"] == "followers_only":
        if not viewer:
            return "403"
        if viewer == author:
            return "allow"
        return "allow" if _following(conn, viewer, author) else "403"
    return "allow"


def _enriched(conn, post, viewer):
    """A post as the API lists it: its row, tags, assets, metrics and
    counts."""
    pid = post["id"]

    def count(sql):
        return conn.execute(sql, (pid, )).fetchone()[0]

    def liked(table):
        return bool(viewer) and conn.execute(
            f"SELECT 1 FROM {table} WHERE post_id = ? AND account_id = ?",
            (pid, viewer)).fetchone() is not None

    metric = conn.execute("SELECT * FROM post_metric WHERE post_id = ?",
                          (pid, )).fetchone()
    return {
        **dict(post),
        "tags": [
            dict(r) for r in conn.execute(
                "SELECT t.* FROM tag t JOIN post_tag pt ON pt.tag_id = t.id "
                "WHERE pt.post_id = ? ORDER BY pt.sort_order", (pid, ))
        ],
        "assets": [
            dict(r) for r in conn.execute(
                "SELECT * FROM post_asset WHERE post_id = ? ORDER BY "
                "sort_order", (pid, ))
        ],
        "metrics":
        dict(metric) if metric else None,
        "liked":
        liked("post_like"),
        "reposted":
        liked("post_repost"),
        "like_count":
        count("SELECT COUNT(*) FROM post_like WHERE post_id = ?"),
        "repost_count":
        count("SELECT COUNT(*) FROM post_repost WHERE post_id = ?"),
        "reply_count":
        count("SELECT COUNT(*) FROM comment WHERE post_id = ? AND "
              "status = 'visible'"),
    }


def _login(conn, data):
    username = (data or {}).get("username")
    password = (data or {}).get("password")
    if not username or not password:
        return 400, {"error": "username and password required"}
    account = conn.execute("SELECT * FROM account WHERE username = ?",
                           (username, )).fetchone()
    if not account or account["password"] != password:
        return 401, {"error": "Invalid credentials"}
    if account["is_active"] == 0:
        return 401, {"error": "Account is inactive"}
    return 200, {
        "success": True,
        "account": {
            "id": account["id"],
            "username": account["username"],
            "display_name": account["display_name"],
        },
        "session_token": f"offline.{account['id']}",
    }


def _list(conn, query, viewer):
    """``GET /api/posts``."""
    shadow, shadow_params = _posts(_now(conn))
    first = {k: v[0] for k, v in query.items()}
    page = max(1, _int(first.get("page", "1")) or 1)
    limit = min(100, max(1, _int(first.get("limit", "20")) or 20))
    status = first.get("status")
    visibility = first.get("visibility")
    author_param = first.get("author_id")
    include_deleted = first.get("include_deleted") == "true"
    author = _int(author_param) if author_param else None
    if author_param and author is None:
        return 400, {"error": "Invalid author_id"}
    select = ("SELECT p.*, a.username as author_username, a.display_name as "
              "author_display_name FROM post p JOIN account a ON a.id = "
              "p.author_account_id WHERE {where} ORDER BY p.is_pinned DESC, "
              "COALESCE(p.published_at, p.created_at) DESC, p.id DESC LIMIT ? "
              "OFFSET ?")
    if status in ("draft", "scheduled", "deleted"):
        if viewer is None or author != viewer:
            return 401, {"error": "Authentication required"}
        where, params = "p.author_account_id = ? AND p.status = ?", [
            viewer, status
        ]
    else:
        own_deleted = include_deleted and viewer is not None and \
            author == viewer
        if not viewer:
            where = "p.status = 'published' AND p.visibility = 'public'"
            params = []
        else:
            where = (
                "p.visibility != 'unlisted' AND ((p.status = 'published' AND "
                "p.visibility = 'public') OR (p.status = 'published' AND "
                "p.visibility = 'followers_only' AND EXISTS (SELECT 1 FROM "
                "follow_relation fr WHERE fr.follower_account_id = ? AND "
                "fr.target_account_id = p.author_account_id AND fr.status = "
                "'following')) OR (p.author_account_id = ? AND p.status != "
                "'deleted')" + (" OR (p.author_account_id = ? AND p.status = "
                                "'deleted')" if own_deleted else "") + ")")
            params = [viewer] * (3 if own_deleted else 2)
        if viewer:
            blocked = sorted({
                r[0]
                for r in conn.execute(
                    "SELECT target_account_id FROM follow_relation WHERE "
                    "follower_account_id = ? AND status = 'blocked' UNION "
                    "SELECT follower_account_id FROM follow_relation WHERE "
                    "target_account_id = ? AND status = 'blocked'", (viewer,
                                                                     viewer))
            })
            if blocked:
                where += (" AND p.author_account_id NOT IN "
                          f"({','.join(str(b) for b in blocked)})")
        if status:
            where += " AND p.status = ?"
            params.append(status)
        if visibility and not status:
            where += " AND p.visibility = ?"
            params.append(visibility)
        if author is not None:
            where += " AND p.author_account_id = ?"
            params.append(author)
    total = conn.execute(f"{shadow} SELECT COUNT(*) FROM post p WHERE {where}",
                         shadow_params + params).fetchone()[0]
    rows = conn.execute(f"{shadow} {select.format(where=where)}",
                        shadow_params + params +
                        [limit, (page - 1) * limit]).fetchall()
    return 200, {
        "posts": [_enriched(conn, r, viewer) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": -(-total // limit),
    }


def _detail(conn, post_id, viewer):
    """``GET /api/posts/<id>``."""
    shadow, shadow_params = _posts(_now(conn))
    pid = _int(post_id)
    if pid is None:
        return 400, {"error": "Invalid post ID"}
    post = conn.execute(
        f"{shadow} SELECT p.*, a.username as author_username, a.display_name "
        "as author_display_name FROM post p JOIN account a ON a.id = "
        "p.author_account_id WHERE p.id = ?",
        shadow_params + [pid]).fetchone()
    if not post:
        return 404, {"error": "Post not found"}
    code = _visibility(conn, post, viewer)
    if code != "allow":
        return int(code), {"error": "Not authorized to view this post"}
    return 200, _enriched(conn, post, viewer)


def answer(method, path, data=None, cookie=None, error=None):
    """The mock's ``(status, body)`` for a request, or, for a request no
    verifier here makes, the failure the verifier met."""
    url = urlsplit(path)
    query = parse_qs(url.query, keep_blank_values=True)
    viewer = _viewer(cookie)
    detail = re.fullmatch(r"/api/posts/([^/]+)", url.path)
    conn = _connect()
    try:
        if method == "POST" and url.path == "/api/auth/login":
            if isinstance(data, (str, bytes)):
                data = json.loads(data)
            return _login(conn, data)
        if method == "GET" and url.path == "/api/posts":
            return _list(conn, query, viewer)
        if method == "GET" and detail:
            return _detail(conn, detail.group(1), viewer)
    finally:
        conn.close()
    return 0, {"error": f"{type(error).__name__}: {error}"}
