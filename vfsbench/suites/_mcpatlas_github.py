import re
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from aiohttp import ClientSession, ClientTimeout, web

# The four v1 tasks whose GitHub server reads public data. All other GitHub
# tasks use a seeded empty tenant. Limit public reads to benchmark repositories
# from the image and the published parity cases.
LIVE_TASKS = {
    "serpent-repo-first-pr-branch", "snake-repo-commit-count",
    "storyteller-creator-first-commit", "storyteller-last-commit"
}
REPOSITORIES = {
    "mikechao/balldontlie-mcp",
    "githejie/mcp-server-calculator",
    "mikechao/metmuseum-mcp",
    "mongodb-js/mongodb-mcp-server",
    "mrkaye97/slackr",
    "atamyrat2005/snake-game",
    "lgrammel/storyteller",
    "the-mikedavis/tree-sitter-diff",
    "theonion/fartscroll.js",
}
ROUTES = {
    "": "get_repository",
    "branches": "list_branches",
    "tags": "list_tags",
    "commits": "list_commits",
    "issues": "list_issues",
    "pulls": "list_pull_requests",
    r"commits/[a-fA-F0-9]{4,40}": "get_commit",
    r"issues/\d+": "get_issue",
    r"issues/\d+/comments": "get_issue_comments",
    r"pulls/\d+": "get_pull_request",
    r"pulls/\d+/files": "get_pull_request_files",
    r"commits/[a-fA-F0-9]{4,40}/status": "get_pull_request_status",
}
SEARCHES = {
    "issues": "search_issues",
    "code": "search_code",
    "repositories": "search_repositories",
    "users": "search_users"
}
QUERY_KEYS = {
    "q", "page", "per_page", "sort", "order", "direction", "state", "since",
    "until", "sha", "author", "path", "labels", "milestone", "assignee",
    "creator", "mentioned", "base", "head"
}


def _allowed(path, query, tools, live):
    if (len(query) != len(set(query))
            or any(k not in QUERY_KEYS or len(v) > 512
                   for k, v in query.items())):
        return False
    if match := re.fullmatch(
            r"/repos/([A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_"
            r".-]*)(?:/([A-Za-z0-9_/.-]+))?", path):
        repo, resource = match.groups()
        if live and repo.lower() not in REPOSITORIES:
            return False
        return any(tool in tools and re.fullmatch(pattern, resource or "")
                   for pattern, tool in ROUTES.items())
    if match := re.fullmatch(r"/search/(issues|code|repositories|users)",
                             path):
        kind = match[1]
        if SEARCHES[kind] not in tools:
            return False
        if not live:
            return True
        q = query.get("q", "").lower().split()
        # Require an explicit in-benchmark repository on public search calls.
        # The author of the storyteller and snake repos may be searched by
        # login.
        if kind == "users":
            return len(q) == 1 and q[0] in {"lgrammel", "atamyrat2005"}
        scopes = {term[5:] for term in q if term.startswith("repo:")}
        return bool(scopes) and scopes <= REPOSITORIES and "or" not in q
    return False


def _empty_tenant(path, query):
    """Read routes on the empty tenant returned by v1's github_workspace()."""
    docs = "https://docs.github.com/rest"
    if path.startswith("/repos/"):
        return web.json_response(
            {
                "message": "Not Found",
                "documentation_url": docs
            }, status=404)
    value = query.get("q", "").strip()
    if (any(not re.fullmatch(r"-?[0-9]+", query.get(k, "1"))
            for k in ("page", "per_page"))
            or path in {"/search/code", "/search/users"} and not value):
        return web.json_response(
            {
                "message": "Validation Failed",
                "documentation_url": docs
            },
            status=422)
    if path == "/search/issues" and re.search(r"(?:^|\s)(?:org|user|repo):\S",
                                              value, re.I):
        return web.json_response(
            {
                "message":
                "Validation Failed",
                "status":
                "422",
                "documentation_url":
                "https://docs.github.com/v3/search/",
                "errors": [{
                    "resource":
                    "Search",
                    "field":
                    "q",
                    "code":
                    "invalid",
                    "message":
                    "The listed users and repositories cannot be searched "
                    "either because "
                    "the resources do not exist or you do not have "
                    "permission to view them."
                }],
            },
            status=422)
    return web.json_response({
        "total_count": 0,
        "incomplete_results": False,
        "items": []
    })


@asynccontextmanager
async def github_api(tools, *, origin=None, live=False):
    if live:
        origin = "https://api.github.com"
    elif origin is not None:
        parts = urlsplit(origin)
        if (parts.scheme != "http" or parts.hostname != "127.0.0.1"
                or not parts.port or parts.username or parts.password
                or parts.path or parts.query or parts.fragment):
            raise ValueError("The GitHub mock must announce a per-trial "
                             "http://127.0.0.1:PORT origin")
    async with ClientSession(trust_env=False,
                             timeout=ClientTimeout(total=60)) as client:

        async def read(request):
            path = request.path
            if request.method != "GET" or not _allowed(path, request.query,
                                                       tools, live):
                return web.json_response(
                    {
                        "message":
                        "GitHub route outside the task tool allowlist"
                    },
                    status=403)
            if origin is None:
                return _empty_tenant(path, request.query)
            headers = {
                "Accept": "application/vnd.github+json",
                "User-Agent": "vfsbench-atlas"
            }
            if not live:
                headers["Authorization"] = "Bearer atlas"
            async with client.get(origin + path,
                                  params=request.query,
                                  allow_redirects=False,
                                  headers=headers) as reply:
                if 300 <= reply.status < 400:
                    return web.json_response(
                        {"message": "GitHub redirect refused"}, status=403)
                response_headers = {}
                if link := reply.headers.get("Link"):
                    response_headers["Link"] = link.replace(
                        f"<{origin}/", f"<http://{request.host}/")
                return web.Response(status=reply.status,
                                    body=await reply.read(),
                                    headers=response_headers,
                                    content_type="application/json")

        app = web.Application()
        app.router.add_route("*", "/{path:.*}", read)
        runner = web.AppRunner(app)
        await runner.setup()
        try:
            site = web.TCPSite(runner, "127.0.0.1", 0)
            await site.start()
            yield f"http://127.0.0.1:{runner.addresses[0][1]}"
        finally:
            await runner.cleanup()
