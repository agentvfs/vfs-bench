FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=true
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
ADD mirage.tar.gz ./
RUN echo '{"type":"module"}' > integ/package.json
RUN INTEG_DB_URL=file:/tmp/unused.db node_modules/.bin/prisma generate --schema integ/prisma/notion.prisma
COPY start.mts bridge.mjs ./
CMD ["node_modules/.bin/tsx","start.mts"]
