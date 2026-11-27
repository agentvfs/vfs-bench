import json
import runpy
import sys
from pathlib import Path
from types import ModuleType
from urllib.parse import urlsplit


class ReplayError(Exception):
    pass


class Response:

    def __init__(self, saved):
        self.status_code = saved["status"]
        self.body = saved["body"]

    def json(self):
        return json.loads(self.body)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise ReplayError(f"Notion returned {self.status_code}")


def main():
    replies = json.loads(Path("notion.json").read_bytes())

    def request(method, url, **_):
        parts = urlsplit(url)
        if method != "GET" or parts.netloc != "api.notion.com":
            raise ValueError("Unexpected Notion verifier request")
        path = parts.path + ("?" + parts.query if parts.query else "")
        return Response(replies[path])

    # Only the requests transport and its transient network retry are replaced.
    # The original ops.py runs its pagination and Markdown rendering unchanged.
    requests = sys.modules["requests"] = ModuleType("requests")
    errors = sys.modules["requests.exceptions"] = ModuleType(
        "requests.exceptions")
    errors.ConnectionError = ReplayError
    errors.Timeout = ReplayError
    errors.RequestException = ReplayError
    requests.request = request
    requests.exceptions = errors
    requests.Response = Response
    retry = sys.modules["tenacity"] = ModuleType("tenacity")
    retry.retry = lambda **_: lambda function: function

    def noop(*args, **kwargs):
        return None

    retry.stop_after_attempt = noop
    retry.wait_exponential = noop
    retry.retry_if_exception_type = noop
    runpy.run_path("common.py", run_name="__main__")


if __name__ == "__main__":
    main()
