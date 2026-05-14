# Stack rules

## Language and runtime

- **TypeScript 5.6+** throughout. No JavaScript files except where mandated by tooling (e.g., `next.config.js`).
- **Node 20 LTS** as the runtime target. Use `node:` prefix imports for Node built-ins (`import { readFile } from "node:fs/promises"`).
- **Strict TypeScript settings** inherited from `tsconfig.base.json`:
  - `strict: true`
  - `noUncheckedIndexedAccess: true` — array indexing returns `T | undefined`. Handle the `undefined` case explicitly.
  - `noImplicitOverride: true` — class method overrides must use the `override` keyword.
  - `isolatedModules: true` — required for esbuild/SWC compatibility.

## Package manager

- **pnpm 10.27+** with workspaces. Not npm. Not yarn. Not Turborepo.
- Use `pnpm -r <script>` to run a script in every workspace package.
- Use `pnpm --filter @roguemouse/<package> <script>` to run a script in one package.
- Lockfile is `pnpm-lock.yaml`. Always commit lockfile changes.
- Adding a dependency: run `pnpm add <package>` inside the target workspace package directory, never at the root unless the dependency is genuinely root-level (TypeScript itself, for example).

## Workspace structure
roguemouse/
apps/
web/                    # @roguemouse/web — Next.js app, frontend + API routes
packages/
schemas/                # @roguemouse/schemas — Zod schemas, single source of truth for types
agent/                  # @roguemouse/agent — planner loop, voices, prompts
tools/                  # @roguemouse/tools — tool implementations
inference/              # @roguemouse/inference — LLM clients with circuit breakers
audit/                  # @roguemouse/audit — Vultr Object Storage client with hash chain
broker-mock/            # @roguemouse/broker-mock — deterministic fixture replay
runbooks/               # @roguemouse/runbooks — synthetic runbook corpus + ingest

Workspace package names are scoped: `@roguemouse/<directory-name>`. This namespacing prevents accidental npm-registry collisions and makes imports unambiguous.

## TypeScript module conventions

- **ESM only.** All packages use `"type": "module"` in their `package.json`.
- **Explicit `.js` extensions in relative imports**, even when importing `.ts` files. This is the ESM contract: `import { foo } from "./bar.js"` even though the source is `bar.ts`. TypeScript's `moduleResolution: "Bundler"` resolves the extension correctly.
- **Workspace imports** use the package name: `import { auditRecordSchema } from "@roguemouse/schemas"`. No relative paths across package boundaries.
- **Barrel files** are allowed but should be shallow. Each package's `src/index.ts` re-exports the public API. Internal modules are not re-exported.

## Frontend (Next.js)

- **Next.js 15+** with App Router. Not Pages Router.
- **`output: 'standalone'`** in `next.config.js`. This produces a self-contained Docker image that doesn't depend on Vercel.
- **No Edge runtime.** Every API route and Server Component runs on Node runtime. Edge runtime depends on Vercel infrastructure and won't work on our VPS.
- **No `next/image` with default loader.** Use plain `<img>` tags or configure a custom loader pointing at a static path. The default loader requires Vercel's image CDN.
- **No `@vercel/*` packages.** Anywhere.
- **Tailwind CSS** for styling. No CSS-in-JS, no styled-components.
- **Server Components by default.** Mark Client Components with `"use client"` only when necessary (interactive UI, state hooks, browser APIs).

## Validation and schemas

- **Zod 3+** for all runtime validation.
- **Schemas live in `@roguemouse/schemas`.** A schema is defined once and imported everywhere — in the tool that produces the value, in the consumer that uses it, and in the test that validates it.
- **Inferred types over hand-written types.** `type AuditRecord = z.infer<typeof auditRecordSchema>` rather than writing the type separately.
- **Parse at boundaries.** Every value crossing a trust boundary (HTTP request, LLM response, file read, environment variable) must be parsed through a Zod schema. Internal-only values can use the inferred type directly.

## Testing

- **Vitest** as the test runner.
- **Smoke tests are the top of the testing pyramid.** One end-to-end smoke test per major capability, replayed against deterministic fixtures, run in CI on every push.
- **Unit tests** for pure logic (hash chain construction, schema validation, prompt formatting). No unit tests for LLM outputs — those are non-deterministic.
- **Fixture-based replay** for LLM-dependent code paths. VCR-style recording of real LLM responses, replayed in tests.

## CI

- **GitHub Actions** for CI.
- Pipeline: `pnpm install --frozen-lockfile` → `pnpm -r typecheck` → `pnpm -r lint` → `pnpm smoke` → `pnpm -r build`.
- Target total CI time: under 90 seconds on a warm cache.
- No coverage reporting tools. No Sentry. No Datadog. No dependency scanning. Time-to-value doesn't justify them for a 6-day project.

## Environment variables

- **Never commit secrets.** `.env.local` is gitignored. `.env.example` is committed with placeholder values.
- **Parse env vars through Zod at module load time.** Fail fast on missing or malformed env vars.
- **Workspace packages do not read `process.env` directly.** They receive configuration through constructor arguments. Only the entry point (Next.js API route, smoke test script) reads `process.env`.

## Imports — order convention

Within each file, imports go in this order, with blank lines between groups:

```typescript
// 1. Node built-ins
import { readFile } from "node:fs/promises";

// 2. Third-party packages
import { z } from "zod";
import { OpenAI } from "openai";

// 3. Workspace packages
import { auditRecordSchema } from "@roguemouse/schemas";
import { writeAuditRecord } from "@roguemouse/audit";

// 4. Relative imports
import { localHelper } from "./helper.js";
```
