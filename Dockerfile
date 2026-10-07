# syntax=docker/dockerfile:1.7
# Multi-target image: `--target web` (Next.js) or `--target indexer` (worker). Node 22 LTS.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/indexer/package.json apps/indexer/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/auth/package.json packages/auth/
COPY packages/solana/package.json packages/solana/
COPY packages/pump/package.json packages/pump/
COPY packages/otc/package.json packages/otc/
COPY packages/market/package.json packages/market/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run db:generate
RUN npm run build -w @app/web

FROM node:22-bookworm-slim AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app && useradd --system --gid app --home /app app
COPY --from=build --chown=app:app /app /app
USER app

FROM runtime-base AS web
EXPOSE 3000
# Apply pending migrations, then serve. Run migrations from a single release job in multi-replica setups.
CMD ["sh", "-c", "npm run db:deploy && npm run start -w @app/web -- -p ${PORT:-3000}"]

FROM runtime-base AS indexer
CMD ["npm", "run", "start", "-w", "@app/indexer"]
