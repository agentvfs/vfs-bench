"""Supply the frozen WooCommerce REST reads to the original warehouse sync verifier."""

import importlib
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from urllib.parse import urlsplit


def module(name):
    value = ModuleType(name)
    sys.modules[name] = value
    return value


def main():
    sys.path.insert(0, str(Path("code").resolve()))
    mapping = json.loads(Path("mapping.json").read_bytes())
    Path("shop.json").write_text(json.dumps({"site_url": "http://store", "consumer_key": "frozen",
                                            "consumer_secret": "frozen", "product_mapping": mapping}))
    products = {str(obj["id"]): obj for obj in json.loads(Path("products.json").read_bytes())}

    def get(url, **kwargs):
        prefix = "/wp-json/wc/v3/products/"
        path = urlsplit(url).path
        if not path.startswith(prefix):
            raise ValueError("Unexpected upstream REST path")
        obj = products.get(path.removeprefix(prefix))
        return SimpleNamespace(status_code=200 if obj else 404, text="", json=lambda: obj)

    module("requests").get = get
    module("requests.auth").HTTPBasicAuth = lambda *args: None
    module("utils.evaluation.retry").grade_with_retry = lambda check: check()
    module("token_key_session").all_token_key_session = SimpleNamespace(woocommerce_config_file="shop.json")
    upstream = importlib.import_module("evaluation.main")
    passed, message = upstream.run_complete_evaluation("agent")
    print(message)
    return 0 if passed else 10


if __name__ == "__main__":
    sys.exit(main())
