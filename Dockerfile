# syntax=docker/dockerfile:1

# This Dockerfile now only builds the MCP server (and, optionally, a one-shot
# database migration image). The API, worker, and web images were retired
# when the app moved to a Vercel deployment (api/index.ts + vercel.json at
# the repo root) — see README.md's "Deploy to Vercel" section.

FROM oven/bun:1.4.0-slim AS base
WORKDIR /app

FROM base AS pruner
ARG APP_SCOPE
COPY . .
RUN test -n "$APP_SCOPE"
RUN --mount=type=cache,target=/root/.bun/install/cache bunx turbo@2.10.7 prune "$APP_SCOPE" --docker

FROM base AS installer
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/bun.lock ./bun.lock
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

FROM installer AS migrate
ENV NODE_ENV=production
COPY --from=pruner /app/out/full/ ./
CMD ["bun", "run", "--filter", "@spliit/db", "prisma-migrate"]

FROM installer AS mcp-builder
ENV NODE_ENV=production
COPY --from=pruner /app/out/full/ ./
# mcp-use imports the server while compiling widgets. These non-routable
# origins are build-time placeholders only; the runtime MCP image requires
# MCP_PUBLIC_URL, MCP_API_URL, and MCP_WEB_URL from deployment env. Clear
# NODE_ENV so runtime-only widget-domain preparation does not run before
# mcp-use has created the manifest.
RUN NODE_ENV= MCP_API_URL=https://api-build.invalid MCP_PUBLIC_URL=https://mcp-build.invalid MCP_WEB_URL=https://web-build.invalid bun --filter @spliit/mcp build
RUN bun --filter @spliit/mcp bundle:runtime
RUN find apps/mcp/dist -type f -name '*.map' -delete

FROM node:24.12.0-bookworm-slim AS mcp
WORKDIR /app/apps/mcp
ENV NODE_ENV=production
COPY --chown=node:node --from=mcp-builder /app/apps/mcp/dist ./dist
USER node
EXPOSE 3002
CMD ["node", "dist/runtime.mjs"]
