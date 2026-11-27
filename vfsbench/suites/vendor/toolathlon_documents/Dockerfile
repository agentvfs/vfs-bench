FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy UV_NO_CACHE=1
ADD sources.tar.gz /opt/documents/
RUN uv sync --frozen --no-dev --no-editable --project /opt/documents/word
RUN uv sync --frozen --no-dev --no-editable --project /opt/documents/pptx
RUN uv sync --frozen --no-dev --no-editable --project /opt/documents/pdf-tools
WORKDIR /workspace
