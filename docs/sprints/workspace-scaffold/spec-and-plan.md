# Workspace Scaffold — Spec + Plan

## Workflow note
This sprint uses the compressed workflow per .claude/rules/workflow.md.
Brainstorm omitted: workspace scaffolding has one correct shape (pnpm
workspaces, no Turborepo, strict TypeScript, ESM-only) and no design tradeoffs
worth exploring. Spec and plan combined in this document. Review is still
required after implementation.

## Spec

### Summary
Sprint 1 stands up the pnpm-workspace monorepo skeleton that all subsequent application code will hang off: a root configuration (package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitattributes, .env.example), seven empty workspace packages under packages/* matching the locked agent architecture (schemas, audit, inference, agent, tools, broker-mock, runbooks), and a minimal Next.js 15 App Router app under apps/web that renders Hello World on `pnpm dev`. This is mechanical: the shape is dictated entirely by stack.md and by package boundaries already locked in prior sprints, so no design decisions are at stake. The sprint unblocks the teammate's UI work — which can begin once apps/web is a buildable Next.js project — and establishes the import surface that Sprint 2 (smoke test) and Sprint 3 (schemas + audit log) build on. No application logic ships in this sprint; every file is configuration, type declarations, or barrel placeholders.

### Acceptance criteria
- **AC-01**: `pnpm install` from the repo root succeeds with no errors and
  produces a single root-level pnpm-lock.yaml.
- **AC-02**: `pnpm -r typecheck` succeeds with zero errors. All workspace
  packages have a working tsconfig.json extending tsconfig.base.json.
- **AC-03**: `pnpm dev` (which proxies to `pnpm --filter @roguemouse/web dev`)
  starts the Next.js dev server on http://localhost:3000 and renders a Hello
  World page.
- **AC-04**: Seven workspace packages exist under packages/* with valid
  package.json files: schemas, audit, inference, agent, tools, broker-mock,
  runbooks. Each has a minimal src/index.ts barrel file.
- **AC-05**: One workspace app exists under apps/web with a minimal Next.js
  15 App Router structure (page.tsx, layout.tsx, next.config.js with
  output: 'standalone').
- **AC-06**: .env.example is committed with all environment variables Roguemouse
  needs (Vultr inference, S3, Gemini), with empty values for secrets and
  realistic defaults for non-secrets (endpoint URLs, region, bucket name,
  model name).
- **AC-07**: .gitattributes enforces LF line endings for text files and marks
  common binary extensions as binary.
- **AC-08**: .env.local does not exist in the repo (created locally per
  developer; gitignored). The .gitignore rules already in place must be
  verified to exclude it.
- **AC-09**: All workspace packages declare "type": "module" and use ESM
  conventions (no CommonJS).
- **AC-10**: No file in the scaffold contains references to Meridian, prior
  internal projects, or any company name. The IP firewall is intact.
- **AC-11**: All third-party dependencies added are MIT, Apache-2.0, or
  BSD-licensed. No GPL, AGPL, or SSPL anywhere.

### Data flow
No new audit records, schemas, or runtime data flow in this sprint. This
is pure infrastructure.

### Edge cases
- **Case**: pnpm install fails because of corepack/Node version mismatch
  **Handling**: The root package.json declares engines (Node >=20, pnpm >=10)
  and packageManager (pnpm@10.27.0). If these fail, the operator's Node
  install is wrong — not a scaffold issue.
- **Case**: Next.js 15+ default scaffold includes Vercel-specific features
  (Edge runtime, next/image with default loader)
  **Handling**: The apps/web/next.config.js explicitly sets output: 'standalone'
  and the Hello World page uses plain HTML rather than next/image. No
  Vercel SDK packages anywhere.
- **Case**: Windows-vs-Unix line ending differences cause spurious diffs
  **Handling**: .gitattributes with `* text=auto eol=lf` enforces LF on
  commit regardless of OS.
- **Case**: A packages/* skeleton fails typecheck because its empty
  src/index.ts has no exports
  **Handling**: Each barrel file exports an explicit empty object or sentinel
  to satisfy TypeScript's isolatedModules requirement.

### Out of scope
- Smoke test logic (Sprint 2)
- Tool schemas (Sprint 3)
- Any audit log implementation
- Any LLM client implementation
- Dockerfile or deployment config (Sprint 6)
- CI workflow (deferred)
- Tailwind setup beyond the Next.js default (a future polish pass)

### Rollback plan
Single-commit sprint. If the scaffold breaks something, `git revert
<sprint-commit-hash>` returns the repo to its pre-Sprint-1 state cleanly.
No data migrations, no audit log entries, no state outside Git.

## Plan

### Anti-patterns from tasks/lessons.md to avoid
- **Markdown-fenced-block character stripping**: This plan creates several
  files (.gitattributes, .env.example, package.json files, tsconfig.json
  files, next.config.js) that contain # comments, * globs, or other characters
  that the lessons.md entry identifies as vulnerable to relay corruption.
  The implementation must verify each created file character-by-character
  against intent. Specifically: after each file is created, read it back and
  confirm that # and * characters appear where expected. If any are missing,
  stop and report.

### Phase 1 — Root-level scaffolding
Files touched (all new):
- `package.json` (repo root)
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.gitattributes`
- `.env.example`
- `.editorconfig`
- `.nvmrc`

Steps:
1. Create `.gitattributes` with text=auto eol=lf and binary file markers.
2. Create `.nvmrc` containing just the text `20.10.0` (matches the operator's
   Node version).
3. Create `.editorconfig` with sensible defaults (LF, UTF-8, 2-space indent,
   final newline).
4. Create `tsconfig.base.json` with the strict settings from stack.md:
   target ES2022, module ESNext, moduleResolution Bundler, strict, plus
   noUncheckedIndexedAccess, noImplicitOverride, esModuleInterop,
   isolatedModules, declaration, declarationMap, sourceMap.
5. Create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*` as
   workspace roots.
6. Create root `package.json` with:
   - name: "roguemouse", version: "0.0.1", private: true, license: MIT
   - repository URL pointing at the GitHub repo
   - engines: node >=20, pnpm >=10
   - packageManager: pnpm@10.27.0
   - Scripts: build, dev, test, typecheck, lint (use pnpm -r where appropriate)
   - devDependencies: typescript ^5.6, @types/node ^20
7. Create `.env.example` with sections for Vultr Inference, Vultr Object
   Storage, Gemini, and application config. Empty values for secrets;
   realistic defaults for non-secrets (the endpoint URL, model name, region,
   bucket name we've already locked).

Test strategy:
- Run `pnpm install` at the root. Expected: no errors. Lockfile created.
- Run `pnpm -r typecheck`. Expected: no packages to typecheck yet (no
  workspace packages exist until Phase 2), so this should succeed trivially.

Phase exit:
- [ ] `pnpm install` succeeds
- [ ] No workspace packages declared yet, so pnpm -r typecheck is a no-op pass

Rollback: `git restore .` to discard all uncommitted changes.

### Phase 2 — packages/ skeletons
Files touched (all new): for each of the seven packages (schemas, audit,
inference, agent, tools, broker-mock, runbooks), create:
- `packages/<name>/package.json`
- `packages/<name>/tsconfig.json` (extends ../../tsconfig.base.json)
- `packages/<name>/src/index.ts` (minimal export to satisfy isolatedModules)

Steps:
1. For each package, package.json declares:
   - name: "@roguemouse/<name>"
   - version: "0.0.1"
   - private: true
   - type: "module"
   - main: "./dist/index.js"
   - types: "./dist/index.d.ts"
   - scripts: typecheck, build (using tsc), test (using vitest, even though
     no tests exist yet)
2. For each package, tsconfig.json extends ../../tsconfig.base.json,
   sets rootDir to ./src, outDir to ./dist, includes ./src/**/*.
3. For each package, src/index.ts exports an explicit sentinel:
   `export const __packageName = "@roguemouse/<name>";` — satisfies
   isolatedModules and provides a debuggable marker.

Test strategy:
- Run `pnpm install`. Expected: pnpm recognizes the new workspace packages
  and links them. No external dependency changes yet.
- Run `pnpm -r typecheck`. Expected: all seven packages typecheck cleanly.

Phase exit:
- [ ] All seven packages have valid package.json, tsconfig.json, src/index.ts
- [ ] `pnpm -r typecheck` returns clean across all seven

Rollback: `git restore .` plus delete packages/ directory.

### Phase 3 — apps/web (Next.js Hello World)
Files touched (all new):
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/next.config.js`
- `apps/web/next-env.d.ts` (auto-generated by Next, but committed for
  determinism)
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/layout.tsx`

Steps:
1. Create apps/web/package.json:
   - name: "@roguemouse/web"
   - private: true, type: "module"
   - scripts: dev (next dev), build (next build), start (next start),
     typecheck (tsc --noEmit), lint (next lint)
   - dependencies: next ^15, react ^19, react-dom ^19
   - devDependencies: @types/react ^19, @types/react-dom ^19
2. Create apps/web/tsconfig.json extending ../../tsconfig.base.json with
   Next.js-specific settings: jsx "preserve", plugins next, paths "@/*"
   mapping to "./src/*".
3. Create apps/web/next.config.js (ESM .js with export default):
   - output: 'standalone'
   - reactStrictMode: true
   - no images config (we don't use next/image)
4. Create apps/web/src/app/layout.tsx — minimal root layout with html/body
   wrapper.
5. Create apps/web/src/app/page.tsx — Hello World server component. Include
   the disclaimer text "Roguemouse — AI Operations Officer for algorithmic
   trading platforms (no live trading)" so the placeholder is informative.

Test strategy:
- Run `pnpm install`. Expected: Next.js and React install.
- Run `pnpm -r typecheck`. Expected: apps/web typechecks cleanly along with
  the seven packages.
- Run `pnpm --filter @roguemouse/web build`. Expected: Next.js builds the
  standalone output successfully.
- Manual: run `pnpm dev`, open http://localhost:3000, confirm Hello World
  + disclaimer renders.

Phase exit:
- [ ] `pnpm install` clean
- [ ] `pnpm -r typecheck` clean
- [ ] `pnpm --filter @roguemouse/web build` clean
- [ ] Hello World renders in browser (manual verification by operator)

Rollback: `git restore .` plus delete apps/ directory.

### Final verification
After all phases complete:
- [ ] `pnpm install` runs clean from a fresh state (delete node_modules and
      pnpm-lock.yaml, re-run, confirm)
- [ ] `pnpm -r typecheck` returns zero errors
- [ ] `pnpm --filter @roguemouse/web build` succeeds
- [ ] All 11 acceptance criteria mapped to verification steps above
- [ ] No file in the scaffold mentions Meridian or any prior project name
      (grep -r "Meridian" . returns nothing)
- [ ] All committed dependencies are MIT, Apache-2.0, or BSD-licensed
      (manual spot check on the dependency tree)
- [ ] On-disk verification: each created file's content matches intent
      character-by-character (anti-pattern from lessons.md)
