# syntax=docker/dockerfile:1.7

# Two-stage build for the Roguemouse demo web app.
# Per .claude/rules/stack.md: Next.js 15 with output: 'standalone'.
# Per .claude/rules/vultr.md: build runs in CI (memory-hungry); the VPS
# only pulls the image. Local validation also works on a dev machine.
#
# Single build stage (deps + build) avoids the pnpm-workspace symlink
# loss that occurs when COPYing /app/node_modules across stages —
# pnpm wires per-package node_modules with symlinks that don't carry
# cleanly across stage boundaries.

# -----------------------------------------------------------------------------
# Stage 1: build. Install workspace deps then compile Next.js standalone.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable

# Copy workspace metadata first so the install layer is cacheable
# across source-only changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/agent/package.json packages/agent/
COPY packages/audit/package.json packages/audit/
COPY packages/broker-mock/package.json packages/broker-mock/
COPY packages/inference/package.json packages/inference/
COPY packages/runbooks/package.json packages/runbooks/
COPY packages/schemas/package.json packages/schemas/
COPY packages/tools/package.json packages/tools/

RUN pnpm install --frozen-lockfile

# Copy full source (this layer invalidates on any code change, but
# the install layer above remains cached).
COPY . .

# Build the standalone Next.js app. Workspace packages export src
# TS files directly (per Sprint 1's exports: { ".": "./src/index.ts" }
# pattern); Next.js 15 with outputFileTracingRoot handles workspace
# resolution into the standalone bundle.
RUN pnpm --filter @roguemouse/web build

# -----------------------------------------------------------------------------
# Stage 2: runner. Minimal Node runtime image with just the standalone
# output, public/, and the fixtures + runbook content the orchestrator
# reads at request time.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone output: a self-contained server bundle from Next.js plus
# its dependency closure under node_modules.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Runtime data the orchestrator reads at request time
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/packages/runbooks/content ./packages/runbooks/content

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
