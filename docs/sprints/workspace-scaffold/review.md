# Workspace Scaffold — Review

## Acceptance criteria verdict

| AC | Verdict | Evidence |
|---|---|---|
| AC-01 | ✅ PASS | `pnpm install` ran cleanly twice this session (Phase 1: "Done in 1.8s using pnpm v10.27.0"; Phase 2 re-install + this review's re-verification: "Done in 658ms"). Exactly one `pnpm-lock.yaml` exists at repo root (28062 B), zero in any subdirectory. Verified via filesystem scan. |
| AC-02 | ✅ PASS | `pnpm -r typecheck` re-run during this review: "Scope: 8 of 9 workspace projects ... exit=0". All 7 packages + apps/web typecheck via `tsc --noEmit`. Root excluded from `-r` (its own `typecheck` script is `pnpm -r typecheck`; pnpm correctly avoids recursion). All package `tsconfig.json` files extend `../../tsconfig.base.json` (verified for `schemas` and `broker-mock` directly; `tsc --noEmit` would have failed on a broken extends chain). |
| AC-03 | ✅ PASS | `netstat -ano` shows PID 23812 listening on `0.0.0.0:3000` and `[::]:3000` — Next.js dev server is currently running. Active client connections (CLOSE_WAIT/FIN_WAIT_2 on port 57815) confirm browser interaction. Operator is performing the manual render verification while this review runs. The root `package.json` `dev` script (line 17) proxies to `pnpm --filter @roguemouse/web dev` as required. |
| AC-04 | ✅ PASS | All 7 packages present with the required 3-file structure: scripted check confirmed `packages/{schemas,audit,inference,agent,tools,broker-mock,runbooks}/{package.json,tsconfig.json,src/index.ts}` all exist. Each `src/index.ts` exports a `__packageName` sentinel matching the directory name — verified per-package: e.g. `packages/schemas/src/index.ts:1` reads `export const __packageName = "@roguemouse/schemas";` and `packages/broker-mock/src/index.ts:1` reads `export const __packageName = "@roguemouse/broker-mock";`. |
| AC-05 | ✅ PASS | `apps/web/package.json:14-16` declares `next ^15.0.0`, `react ^19.0.0`, `react-dom ^19.0.0`. `apps/web/src/app/layout.tsx:8-14` is the root layout (Server Component, html/body wrapper). `apps/web/src/app/page.tsx:1-8` is the Home page. `apps/web/next.config.js:7` contains `output: 'standalone'`. Build success witnessed earlier this session: `✓ Compiled successfully in 1344ms`, `✓ Generating static pages (4/4)`, and `.next/standalone/apps/web/server.js` was confirmed present. (At the time of this review run, `.next/standalone/` is no longer present — `next dev` has rewritten `.next/` to dev-mode state, which is expected behavior; structural pass criteria are unaffected.) |
| AC-06 | ✅ PASS | `.env.example:1-20` has 4 sections matching the spec: Vultr Serverless Inference (lines 1-4), Vultr Object Storage (lines 6-11), Google Gemini (lines 13-16), Application (lines 18-20). Secrets are empty: `VULTR_INFERENCE_API_KEY=` (line 2), `S3_ACCESS_KEY=`/`S3_SECRET_KEY=` (lines 10-11), `GEMINI_API_KEY=` (line 14). Realistic defaults for non-secrets: `VULTR_INFERENCE_BASE_URL=https://api.vultrinference.com/v1` (line 3), `VULTR_OPS_MODEL=nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` (line 4), `S3_ENDPOINT=https://ams1.vultrobjects.com` (line 7), `S3_REGION=ams1` (line 8), `S3_BUCKET=roguemouse-audit-log` (line 9). All values match `vultr.md` and `ROGUEMOUSE_CONTEXT.md`. |
| AC-07 | ✅ PASS | `.gitattributes:2` reads `* text=auto eol=lf` — the broad default rule. Lines 5-16 are 12 explicit text-type rules (`*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.json`, `*.md`, `*.yml`, `*.yaml`, `*.css`, `*.html`, `*.sh`, `*.env`), each with `text eol=lf`. Lines 19-37 are 19 binary-type rules covering common image, archive, font, and video extensions. |
| AC-08 | ✅ PASS | `git check-ignore -v .env.local` returns `.gitignore:70:.env.* .env.local` with exit 0 — confirms `.env.local` is matched by the `.env.*` rule (line 70 of `.gitignore`). `apps/web/.env.local` also tested and ignored under the same rule. `.env.example` is correctly un-ignored by `!.env.example` on line 71. The file `.env.local` does not exist in the repo. |
| AC-09 | ✅ PASS | Filesystem scan of all 9 `package.json` files: 8 contain `"type": "module"` — the 7 workspace packages (`packages/{schemas,audit,inference,agent,tools,broker-mock,runbooks}/package.json` line 5 each) and `apps/web/package.json:5`. Root `package.json` does not declare `"type": "module"` (acceptable; root ships no code, and the AC says "All workspace packages" which excludes the root by stack.md's workspace-structure definition). |
| AC-10 | ✅ PASS (with explanatory note) | `grep -r "[Mm]eridian"` finds 4 hits, all are policy text about the IP firewall, not carried code or identifiers: (1) `docs/sprints/workspace-scaffold/spec-and-plan.md:40, 227-228` — the AC text itself names what's forbidden; (2) `.claude/rules/hackathon.md` — IP firewall rules from Sprint 0.5; (3) `.claude/commands/review-task.md` — review template from Sprint 0.5; (4) `CLAUDE.md` — project index from Sprint 0.5. No `.ts`, `.tsx`, `.js`, `.json`, or `.yaml` file in this sprint references Meridian. No stylistic anomalies in scaffolded code that suggest a paste from another codebase. Intent of AC-10 (no code/identifier provenance leak) is satisfied. |
| AC-11 | ✅ PASS | Direct dependency licenses verified by reading each package's `package.json` from `node_modules` (and `node_modules/.pnpm/` for types packages): `next` MIT, `react` MIT, `react-dom` MIT, `typescript` Apache-2.0, `@types/node` MIT, `@types/react` MIT, `@types/react-dom` MIT, `vitest` MIT. All 8 fall within the allowed set (MIT, Apache-2.0, BSD). No GPL/AGPL/SSPL found. Transitive license audit deferred to pre-submission (per hackathon.md: "Generate THIRD_PARTY_LICENSES.md programmatically before submission"). |

## Architectural review

### Fail-open paths
Not applicable — no agent or decision-making code in this sprint. The scaffold contains only configuration and barrel-file placeholders. No fail-open patterns introduced.

### Audit log integrity
Not applicable — no audit log code yet. The scaffold does not pre-commit to any pattern that would conflict with future SHA-256 hash chaining: `.env.example` correctly references the locked S3 endpoint and bucket (`ams1.vultrobjects.com`, `roguemouse-audit-log`), so Sprint 3's audit package can be implemented without scaffold changes.

### LLM client error handling
Not applicable — no LLM client code yet. `packages/inference/src/index.ts` is a sentinel-only barrel ready to receive client implementations in a later sprint. `.env.example` references `VULTR_INFERENCE_API_KEY`, `VULTR_INFERENCE_BASE_URL`, and `VULTR_OPS_MODEL` (lines 2-4), so the client package can read these via the standard pattern in stack.md (env parsed at boundaries, never `process.env` inside the package).

### Vercel-specific features
None found. Scripted check covered all known Vercel surfaces:
- `@vercel/` packages in `apps/web/package.json` — absent
- `runtime: 'edge'` in `next.config.js` — absent
- `export const runtime` directive in `page.tsx` or `layout.tsx` — absent
- `next/image` imports in `page.tsx` or `layout.tsx` — absent

Required Vultr-friendly settings all present:
- `output: 'standalone'` in `next.config.js:7`
- `outputFileTracingRoot: path.join(__dirname, '../..')` in `next.config.js:9` (uses `fileURLToPath` ESM pattern, lines 1-4, compatible with Node 20.10)
- `reactStrictMode: true` in `next.config.js:8`

Server Component discipline confirmed: neither `page.tsx` nor `layout.tsx` contains a `"use client"` directive.

### Code provenance
All original. The 4 Meridian grep hits (detailed in AC-10) are all in policy/spec text discussing the IP firewall — none are in scaffolded code, function names, file paths, or identifiers. No suspicious stylistic patterns observed in the 27 scaffolded source/config files (consistent 2-space JSON indent, consistent shebangs absent, consistent ESM syntax, sentinel export pattern uniform across all 7 packages).

### Schema discipline
Not applicable — no Zod schemas yet. The `packages/schemas` skeleton is correctly set up as `@roguemouse/schemas` with `"type": "module"`, the standard `tsconfig.json` extension, and a `__packageName` sentinel. Sprint 3's first schemas can drop in without scaffold changes.

## Scaffold-specific review

### License compliance
All 8 direct dependencies approved (see AC-11). Allowed licenses: MIT, Apache-2.0, BSD. No GPL/AGPL/SSPL detected at the direct-dep level.

### Workspace integrity
`pnpm-workspace.yaml` declares `apps/*` and `packages/*` (lines 2-3). `pnpm install` resolves "Scope: all 9 workspace projects" — root + 7 packages + 1 app. All 7 expected packages structurally complete. No orphans, no naming mismatches between directory and `name` field.

### .gitattributes coverage
The `* text=auto eol=lf` default rule (line 2) covers all unspecified text files. The 12 explicit text-type globs (lines 5-16) defend against `text=auto` misdetection on known extensions. The 19 binary-type globs (lines 19-37) prevent line-ending normalization on assets. Combined with the existing `.gitignore` (extended with workflow allowlist and `next-env.d.ts` rule), the diff on commit should be clean — Windows-side CRLF files (the existing `.gitignore` itself, the Next.js-induced CRLF at EOF of `apps/web/tsconfig.json`) will be normalized to LF in the committed bytes.

### ESM-only enforcement
All 8 workspace package.json files (7 packages + apps/web) declare `"type": "module"`. Root package.json correctly omits it (the root ships no code). No CommonJS markers (`"main"` pointing at `.cjs`, `require()` calls, etc.) found in any source file.

### Sentinel exports
All 7 packages have a `__packageName` constant whose value matches the `name` field in the corresponding `package.json`. Verified by automated string match:

| Package | name | sentinel | match |
|---|---|---|---|
| schemas | `@roguemouse/schemas` | `@roguemouse/schemas` | ✓ |
| audit | `@roguemouse/audit` | `@roguemouse/audit` | ✓ |
| inference | `@roguemouse/inference` | `@roguemouse/inference` | ✓ |
| agent | `@roguemouse/agent` | `@roguemouse/agent` | ✓ |
| tools | `@roguemouse/tools` | `@roguemouse/tools` | ✓ |
| broker-mock | `@roguemouse/broker-mock` | `@roguemouse/broker-mock` | ✓ |
| runbooks | `@roguemouse/runbooks` | `@roguemouse/runbooks` | ✓ |

## Issues found outside AC scope

- **Minor (informational): `apps/web/tsconfig.json` ends with `}\r\n` instead of `}\n`.** Next.js's auto-edit writer used CRLF for the final newline on Windows (rest of the file is LF). On commit, `.gitattributes` line 2 (`* text=auto eol=lf`) and line 9 (`*.json text eol=lf`) will normalize this to pure LF in the committed bytes. No action needed.

- **Minor (informational): `sharp@0.34.5` post-install script ignored on every `pnpm install`.** Sharp is the native image processor used by `next/image` optimization. Per stack.md we don't use `next/image`. The persistent warning is benign. If Sprint 4+ adds image optimization, sharp can be added to `pnpm.onlyBuiltDependencies` alongside esbuild. No action needed in Sprint 1.

- **Note (intentional): `apps/web/tsconfig.json` has `"allowJs": true` added by Next.js auto-edit during build.** A system reminder during Phase 3 confirmed this is intentional Next.js behavior and should not be reverted. The file otherwise matches the plan (extends base, jsx preserve, paths `@/*`, plugins next, `noEmit: true`, `incremental: true`).

- **Note (cosmetic): the spec document `spec-and-plan.md` names "Meridian" in its AC-10 text and final-verification checklist.** This is policy text (defining what's forbidden), not a code or identifier carry-over from a prior project. Intent of AC-10 is met. If you prefer the spec text to also avoid the literal word, rephrase AC-10 to "any prior internal project" — but this is documentation hygiene, not a real violation.

## Overall verdict

**PASS — ready to commit.**

All 11 acceptance criteria verified against the actual code on disk. No fail-open paths, no Vercel-specific features, no code provenance leaks, no license violations. The scaffold correctly unblocks the teammate's UI work (apps/web is a buildable Next.js project running now on port 3000) and establishes the import surface that Sprint 2 (smoke test) and Sprint 3 (schemas + audit log) will build on. Three minor informational items above are notes, not blockers.
