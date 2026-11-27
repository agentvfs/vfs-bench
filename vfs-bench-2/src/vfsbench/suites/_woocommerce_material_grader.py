"""Run the unmodified material checks on a detached view of the trial's live
APIs."""

import importlib
import json
import re
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace


def module(name):
    obj = ModuleType(name)
    sys.modules[name] = obj
    return obj


def main():
    sys.path.insert(0, str(Path("code").resolve()))
    state = json.loads(Path("state.json").read_bytes())
    drive = state["drive"]
    items = {f["id"]: f for f in drive["files"]}

    def response(body):
        return SimpleNamespace(execute=lambda: body)

    class HttpError(Exception):
        pass

    class Files:

        def get(self, fileId, **_):
            if fileId not in items:
                raise HttpError(fileId)
            return response(items[fileId])

        def list(self, q, **_):
            parent = re.search(r"'([^']+)' in parents", q).group(1)
            return response({
                "files": [
                    f for f in items.values() if parent in f["parents"]
                    and not f["trashed"] and f["id"] in drive["spreadsheets"]
                ]
            })

    class Values:

        def get(self, spreadsheetId, range):
            tabs = drive["spreadsheets"].get(spreadsheetId, [])
            return response({
                "values":
                next((t["values"]
                      for t in tabs if t["properties"]["title"] == range), [])
            })

    class WooCommerceClient:

        def __init__(self, *args):
            pass

        def get_all_products(self):
            return state["products"]

    sheets = SimpleNamespace(
        spreadsheets=lambda: SimpleNamespace(values=Values))
    module("googleapiclient.errors").HttpError = HttpError
    helper = module("utils.app_specific.googlesheet.drive_helper")
    helper.get_google_service = lambda: (SimpleNamespace(files=Files), sheets)
    module("woocommerce_client").WooCommerceClient = WooCommerceClient
    module("utils.evaluation.retry").grade_with_retry = lambda check: check()
    module("token_key_session").all_token_key_session = SimpleNamespace(
        woocommerce_site_url="frozen",
        woocommerce_api_key="local",
        woocommerce_api_secret="local",
    )
    upstream = importlib.import_module("evaluation.main")
    passed, details = upstream.run_complete_evaluation(
        "agent", "code/groundtruth_workspace", "")
    print(details)
    return 0 if passed else 10


if __name__ == "__main__":
    sys.exit(main())
