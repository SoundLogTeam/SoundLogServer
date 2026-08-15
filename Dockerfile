# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY prisma ./prisma
RUN pnpm db:generate

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM base AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/src/data ./src/data
COPY --chown=node:node openapi ./openapi
COPY --chown=node:node public ./public
COPY --chown=node:node scripts/check-public-api-contract.mjs ./scripts/check-public-api-contract.mjs
COPY --chown=node:node scripts/check-production-env.mjs ./scripts/check-production-env.mjs
COPY --chown=node:node scripts/start-container.sh ./scripts/start-container.sh

RUN mkdir -p uploads && chown -R node:node /app

USER node

EXPOSE 4000

CMD ["sh", "scripts/start-container.sh"]
