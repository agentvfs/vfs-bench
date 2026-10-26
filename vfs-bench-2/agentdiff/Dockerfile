# Agent-Diff's backend, as upstream's ops/docker-compose.yml builds it
# (backend/Dockerfile.local), but from requirements.txt: upstream's
# pyproject resolved as of its pinned commit (2026-07-02), with hashes,
# since its uv.lock lags its pyproject. Built with the pinned checkout's
# backend/ as the context.
FROM python:3.14-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=vfsbench requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt

COPY . .

EXPOSE 8000
