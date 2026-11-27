FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy UV_NO_CACHE=1
COPY pyproject.toml uv.lock /opt/emails/
RUN uv sync --frozen --no-dev --no-editable --project /opt/emails
# The locked client checks server capabilities before the first EHLO.
RUN cd /opt/emails/.venv/lib/python3.12/site-packages && \
    echo '04ae386d39f33eed43be6ceab0cb1b3d7f18b6a8c72162a9c7310bb23c42daf9  emails_mcp/backends/smtp_backend.py' | sha256sum -c - && \
    sed -i "/if 'auth' in self.connection.esmtp_features:/i\                    self.connection.ehlo_or_helo_if_needed()" emails_mcp/backends/smtp_backend.py
WORKDIR /workspace
