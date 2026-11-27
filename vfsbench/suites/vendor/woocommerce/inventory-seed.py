"""Execute Toolathlon's original preprocessor inside the store's private setup container."""

import os
from pathlib import Path
import runpy
import sys
from types import ModuleType, SimpleNamespace
from urllib.parse import urlsplit, urlunsplit

# These are pure-Python wheels at the versions and checksums in Toolathlon's uv.lock.
sys.path[:0] = [str(path) for path in sorted(Path("/seed/wheels").glob("*.whl"))]
import requests

send = requests.Session.send


def local_request(session, request, **kwargs):
    url = urlsplit(request.url)
    if url.hostname != "localhost" or url.port != 10003:
        raise ValueError("Inventory initialization requested an unknown service")
    if kwargs.get("timeout") is None:
        kwargs["timeout"] = 40
    request.headers["Host"] = url.netloc
    request.url = urlunsplit((url.scheme, "shop", url.path, url.query, ""))
    return send(session, request, **kwargs)


requests.Session.send = local_request
config = ModuleType("token_key_session")
config.all_token_key_session = SimpleNamespace(
    woocommerce_site_url="http://localhost:10003/store81",
    woocommerce_api_key=os.environ["WOO_KEY"], woocommerce_api_secret=os.environ["WOO_SECRET"],
    woocommerce_config_file="/seed/woocommerce_config.json",
)
sys.modules[config.__name__] = config
sys.argv = ["/seed/preprocess/main.py", "--agent_workspace", "/seed/work"]
runpy.run_path(sys.argv[0], run_name="__main__")
