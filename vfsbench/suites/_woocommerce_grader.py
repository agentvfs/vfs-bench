import asyncio
import importlib
import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace


def module(name):
    result = ModuleType(name)
    sys.modules[name] = result
    return result


def main():
    sys.path.insert(0, str(Path("code").resolve()))
    products = {
        str(p["id"]): p
        for p in json.loads(Path("products.json").read_bytes())
    }

    class Client:

        def __init__(self, *args, **kwargs):
            pass

        def get_product(self, product_id):
            return product_id in products, products.get(product_id)

    api = module("woocommerce_client")
    api.WooCommerceClient = Client
    api.add_woocommerce_extensions = lambda _: None
    module("utils.general.helper").read_json = lambda path: json.loads(
        Path(path).read_bytes())
    module("utils.evaluation.retry").grade_with_retry = lambda check: check()
    module("token_key_session").all_token_key_session = SimpleNamespace(
        woocommerce_site_url="frozen",
        woocommerce_api_key="",
        woocommerce_api_secret="",
        woocommerce_admin_username="",
        woocommerce_admin_password="",
    )
    upstream = importlib.import_module("evaluation.main")
    try:
        asyncio.run(upstream.main(SimpleNamespace()))
    except Exception as exc:
        if str(exc).startswith(
                "❌ Evaluation failed: Not all featured images were updated "
                "correctly\n"):
            return 10
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
