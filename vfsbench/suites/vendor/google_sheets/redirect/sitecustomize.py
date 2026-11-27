import os

# How the unmodified `mcp-google-sheets` server is aimed at the mock GWS.
# It builds its clients as `build("sheets", "v4")` / `build("drive", "v3")`
# with the endpoint hardcoded and no env var to move it, so the redirect has
# to happen inside the process. `sitecustomize` is the one hook CPython runs
# before the server's own code, and PYTHONPATH is the one way to place it
# without forking the package -- which is the point: the tools, schemas and
# behaviour being measured have to be upstream's, not a fork's.
#
# One copy for every task, not one per task: four tasks used to carry
# byte-identical copies of this file. Only one `sitecustomize` is ever
# imported, so a task that needs a second redirect cannot simply add its
# own directory to PYTHONPATH -- it would have to extend this file.

_GWS = os.environ.get("GWS_MOCK_URL", "").rstrip("/")

# Service path per API, as the mock server routes them.
_SERVICE_PATHS = {"drive": "/drive/v3/", "sheets": "/"}

if _GWS:
    import googleapiclient.discovery as _discovery
    from google.api_core.client_options import ClientOptions

    _original_build = _discovery.build

    def _build(serviceName, version=None, *args, **kwargs):  # noqa: N803
        """Inject the mock endpoint for services the mock implements."""
        path = _SERVICE_PATHS.get(serviceName)
        if path is not None and not kwargs.get("client_options"):
            kwargs["client_options"] = ClientOptions(api_endpoint=_GWS + path)
        kwargs.setdefault("cache_discovery", False)
        return _original_build(serviceName, version, *args, **kwargs)

    _discovery.build = _build
