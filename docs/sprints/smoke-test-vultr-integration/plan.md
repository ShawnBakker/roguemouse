# smoke-test-vultr-integration — Plan

## Reference docs

- Spec: `docs/sprints/smoke-test-vultr-integration/spec.md`
- Brainstorm: `docs/sprints/smoke-test-vultr-integration/brainstorm.md`

## Current-state baseline (read fresh at plan time)

- `packages/schemas/src/index.ts:1` — stub: `export const __packageName = "@roguemouse/schemas";`
- `packages/audit/src/index.ts:1` — stub: `export const __packageName = "@roguemouse/audit";`
- `packages/inference/src/index.ts:1` — stub: `export const __packageName = "@roguemouse/inference";`
- `package.json:15-21` — root scripts: `build`, `dev`, `test`, `typecheck`, `lint`. No `smoke`. devDependencies: `typescript`, `@types/node`, `vitest`. No `tsx`, no `dotenv`. No `@roguemouse/*` declared at root.
- `.env.example:1-20` — already documents `VULTR_INFERENCE_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, plus several non-secret constants (`VULTR_INFERENCE_BASE_URL`, `VULTR_OPS_MODEL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `NODE_ENV`, `LOG_LEVEL`, plus unused Gemini placeholders).
- `.gitignore:69-71` — `.env`, `.env.*` ignored with `!.env.example` exception. No change needed.
- `tsconfig.base.json:1-21` — `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`, `moduleResolution: "Bundler"`, `target: ES2022`. No paths config.
- `pnpm-workspace.yaml:1-3` — `apps/*` and `packages/*` are workspaces. The repo root is not itself a workspace package; the smoke runner at root must import workspace packages via packages declared in root's `package.json`.
- `tasks/todo.md:23-37` — contains the deferred Meridian-reference sweep entry. The RFC 8785 migration entry will be appended.
- `tasks/lessons.md:18-32` — one entry: the markdown-fenced-block hash/asterisk stripping anti-pattern.

## Anti-patterns from `tasks/lessons.md` to avoid

- **Markdown-fenced-block strips leading `#` and `*` (2026-05-14)** — applies to any file content this plan asks the implementer to write verbatim that contains leading `#` (hash comments) or leading `*` (glob patterns or JSDoc bullet markers). In Sprint 2 this potentially affects: any new `.gitignore`-style file (none planned — existing `.gitignore` already covers `.env.local`), any JSDoc blocks in TypeScript source (leading `*` continuation lines), and the `tasks/todo.md` entry appended in Phase 5. Mitigation: after any `Write` or `Edit` operation that creates content with leading `#` or `*` characters, the implementer must read the on-disk file back and visually confirm those characters are present. For JSDoc blocks specifically, prefer to write the entire file in one `Write` operation rather than splicing JSDoc into existing files, and confirm the on-disk JSDoc renders as a valid multi-line comment.

## Workspace dev-mode resolution decision

The smoke runner (`scripts/smoke-vultr.ts`) imports from `@roguemouse/schemas`, `@roguemouse/inference`, and `@roguemouse/audit`. Sprint 1 set each package's `package.json` `"main"` to `./dist/index.js`, which would normally require a build step before tsx can resolve workspace imports at runtime. The plan resolves this with a **verification-first** approach: we first test whether tsx natively resolves workspace TypeScript through pnpm's workspace symlinks (recent tsx versions do, by reading the package's `"types"` field or by direct source discovery), and only fall back to per-package `package.json` changes if tsx fails. The `"main"` field is left untouched for downstream tooling that expects the canonical `./dist/index.js` pointer.

The verification step lives at the start of Phase 1's Steps and is documented in detail there. The outcomes:

- **Path A — tsx resolves natively**: no `package.json` changes to the three Sprint 2 packages. The scratch test script `scripts/test-tsx-resolution.ts` is deleted after verification succeeds.
- **Path B — tsx requires hint**: each of the three Sprint 2 packages gains an `"exports"` conditional map:
  ```json
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "default": "./dist/index.js"
    }
  }
  ```
  `"main"` stays as `./dist/index.js` (the canonical fallback). The `"exports"` field is the modern resolution mechanism and is honored by tsx; tools that don't honor exports fall through to `"main"`. If Path B triggers, the implementation report appends a new entry to `tasks/lessons.md` documenting the resolution quirk (subject + symptom + workaround) so future sprints don't re-discover it.

The `"build"` script in each package's `package.json` is preserved unchanged in either path; it currently has no consumers, and Sprint 4 revisits production builds when they become necessary.

---

## Phase 1 — Dependency wiring

### Files touched

- `packages/schemas/package.json` (lines 1-13 currently; adds `dependencies` block with `zod`; may conditionally gain an `"exports"` field — see Path B below)
- `packages/inference/package.json` (lines 1-13 currently; adds `dependencies` with `openai` and `@roguemouse/schemas`; may conditionally gain `"exports"`)
- `packages/audit/package.json` (lines 1-13 currently; adds `dependencies` with `@aws-sdk/client-s3` and `@roguemouse/schemas`; `devDependencies` with `zod`; may conditionally gain `"exports"`)
- `package.json` (lines 22-26 currently; adds `tsx`, `dotenv`, and the three `@roguemouse/*` workspace packages to `devDependencies`)
- `pnpm-lock.yaml` (regenerated)
- `scripts/test-tsx-resolution.ts` (new, transient — deleted after the verification step succeeds)
- `tasks/lessons.md` (conditional — only modified if Path B triggers, to document the tsx resolution quirk for future sprints)

### Steps

1. From repo root, add `tsx` and `dotenv` to root devDeps with version floors: `pnpm add -D -w tsx@^4.19.0 dotenv@^16.4.0`. (These are needed early so the tsx resolution verification can run in Step 8.)
2. From repo root: `pnpm --filter @roguemouse/schemas add zod@^3.23.0` (adds `zod` as a runtime dependency in `packages/schemas/package.json`).
3. From repo root: `pnpm --filter @roguemouse/inference add openai@^4.65.0` (adds `openai` runtime dep in `packages/inference/package.json`).
4. From repo root: `pnpm --filter @roguemouse/inference add @roguemouse/schemas` (adds workspace-protocol dep on schemas; pnpm 10.x writes `workspace:*` automatically when the target is a sibling workspace package).
5. From repo root: `pnpm --filter @roguemouse/audit add @aws-sdk/client-s3@^3.670.0` (adds AWS SDK runtime dep in `packages/audit/package.json`).
6. From repo root: `pnpm --filter @roguemouse/audit add @roguemouse/schemas` (workspace dep on schemas; runtime dep because the writer calls `.parse()` at runtime).
7. From repo root: `pnpm --filter @roguemouse/audit add -D zod@^3.23.0` (zod as a devDep of audit; audit imports zod-typed schemas from `@roguemouse/schemas` at typecheck time, so tsc needs to resolve the `zod` types from within the audit package's typecheck context. At runtime the zod symbols come through the schemas package's module load chain; audit never directly imports zod itself).
8. From repo root: `pnpm add -D -w @roguemouse/schemas @roguemouse/inference @roguemouse/audit` (declares the three workspace packages as root devDependencies so the smoke runner at `scripts/smoke-vultr.ts` can resolve them via `node_modules/@roguemouse/*` at runtime).
9. Verify `pnpm-lock.yaml` updates: `tsx@^4.19.x`, `dotenv@^16.4.x`, `zod@^3.23.x`, `openai@^4.65.x`, `@aws-sdk/client-s3@^3.670.x` all present, all resolved versions within the specified caret ranges. (`Select-String -Path pnpm-lock.yaml -Pattern "tsx@|dotenv@|zod@3\.|openai@4\.|@aws-sdk/client-s3@3\." -SimpleMatch:$false` is a quick sanity grep.)
10. **Verify tsx workspace resolution** (the Path A / Path B decision):
    - Create `scripts/test-tsx-resolution.ts` with exactly this content:
      ```typescript
      import { __packageName } from "@roguemouse/schemas";
      console.log(__packageName);
      ```
    - From repo root, run `npx tsx scripts/test-tsx-resolution.ts` (or `pnpm exec tsx scripts/test-tsx-resolution.ts`).
    - **Path A — success**: if the command prints `@roguemouse/schemas` and exits 0, tsx is resolving workspace TypeScript natively through pnpm's symlinks. **Delete `scripts/test-tsx-resolution.ts`**. No `package.json` changes to the three Sprint 2 packages are required. Skip Step 11.
    - **Path B — failure**: if the command fails with a module-not-found error, a "Cannot find module" diagnostic, a TS error about importing a `.ts` file, or any non-zero exit, proceed to Step 11.
11. **(Conditional, only if Step 10 triggered Path B.)** For each of `packages/schemas/package.json`, `packages/inference/package.json`, `packages/audit/package.json`, add the following `"exports"` block alongside the existing `"main"` and `"types"` fields (do NOT change `"main"` or `"types"`):
    ```json
    "exports": {
      ".": {
        "development": "./src/index.ts",
        "default": "./dist/index.js"
      }
    }
    ```
    Re-run `npx tsx scripts/test-tsx-resolution.ts` to confirm Path B succeeds. Delete the scratch script. Then append a new entry to `tasks/lessons.md` documenting the resolution quirk in the standard format (Date, Wrong assumption, Correction, Where this matters, Detection) so future sprints know why workspace packages need the `"exports"` map.
12. Confirm `pnpm install` is clean (no warnings about unmet peer dependencies) and `pnpm-lock.yaml` reflects the new dependency graph.

### Test strategy

- `pnpm -r typecheck` runs `tsc --noEmit` in every workspace. Must pass with zero new errors over Sprint 1 baseline (which was clean). The new dependencies are not yet imported by any source file, so this is a "dependencies wired correctly" check.
- The tsx resolution verification (Step 10) is itself a test — it confirms that the runner in Phase 5 will be able to import workspace packages.

### Anti-patterns to avoid

- **Markdown-fenced-block stripping (lessons.md)**: not applicable to `package.json` edits (no leading `#` or `*`). Applies if Path B triggers and we append a new `tasks/lessons.md` entry — the appended entry uses the existing file's `## YYYY-MM-DD — Title` heading and prose body, both safe. The implementer still reads the file back after the edit to confirm.
- **Don't add `process.env` reads to workspace packages**: this phase only declares dependencies and conditionally tweaks `package.json` resolution metadata. No code that reads env vars. Stack rule honored by construction.
- **Pin dependencies with caret floors**: per the version-pinning amendment, each new dep is added with an explicit `@^X.Y.Z` floor (rather than letting pnpm pick "latest"). This avoids accidental major bumps mid-sprint.

### Phase exit criteria

- [ ] `pnpm install` runs clean with zero warnings about unmet peer dependencies.
- [ ] `pnpm -r typecheck` exits 0 with no new errors.
- [ ] `pnpm-lock.yaml` contains resolved versions of `zod`, `openai`, `@aws-sdk/client-s3`, `tsx`, and `dotenv` within the caret ranges specified in Steps 1-7.
- [ ] `node_modules/@roguemouse/schemas`, `@roguemouse/inference`, `@roguemouse/audit` exist as symlinks at the repo root.
- [ ] `scripts/test-tsx-resolution.ts` does NOT exist (deleted after Step 10).
- [ ] If Path B triggered: each of the three Sprint 2 packages' `package.json` has an `"exports"` map, AND `tasks/lessons.md` has a new entry documenting the quirk.
- [ ] Git working tree contains only the changes from this phase (the four `package.json` files, `pnpm-lock.yaml`, and conditionally `tasks/lessons.md`).

### Rollback

`git restore packages/schemas/package.json packages/inference/package.json packages/audit/package.json package.json pnpm-lock.yaml tasks/lessons.md` followed by `pnpm install`. Also `rm -f scripts/test-tsx-resolution.ts` if it survived. No persistent state outside the working tree is affected.

---

## Phase 2 — Schema + canonicalizer + genesis constant

### Files touched

- `packages/schemas/src/index.ts` (line 1 currently a stub; replaced wholesale with the audit envelope schema, the Sprint 2 payload schema, and their inferred types)
- `packages/audit/src/index.ts` (line 1 currently a stub; replaced with re-exports of the new submodules)
- `packages/audit/src/canonicalize.ts` (new file; the rolled-own canonicalizer with JSDoc per AC-27)
- `packages/audit/src/genesis.ts` (new file; the genesis seed and the precomputed `GENESIS_HASH`)
- `packages/audit/src/hash.ts` (new file; a thin `sha256Hex(content: string): string` helper)
- `packages/audit/src/canonicalize.test.ts` (new file; Vitest unit tests for the canonicalizer)
- `packages/audit/src/genesis.test.ts` (new file; Vitest unit test pinning `GENESIS_HASH` to a literal expected hex string, computed at implementation time)

### Steps

**Step 0 (one-time bookkeeping, already completed during plan amendment)**: The genesis hash was computed via `node -e "console.log(require('crypto').createHash('sha256').update('roguemouse-audit-genesis-v1', 'utf8').digest('hex'))"` and yielded the value `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`. This 64-character lowercase hex string is the canonical `GENESIS_HASH` value and the source of truth for both the runtime constant (Step 3 below) and the unit test pin (Step 7 below). If `GENESIS_SEED` is ever changed in the future (e.g., to bump `-v1` → `-v2`), this computation must be re-run and the pinned value updated everywhere.

1. In `packages/schemas/src/index.ts`, define and export:
   - `auditRecordBodySchema` — a Zod `z.object({ ... }).strict()` with exactly the five envelope fields from the spec's Data Flow section (`ts`, `runId`, `recordType`, `previousHash`, `payload`). Field constraints per spec:
     - `ts` — `z.string()` constrained by a regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` and a `.refine` that `Date.parse(s)` returns a finite number.
     - `runId` — `z.string().min(1)`.
     - `recordType` — `z.string().min(1)`.
     - `previousHash` — `z.string().regex(/^[0-9a-f]{64}$/)`.
     - `payload` — `z.unknown()` (the schema does not narrow payload shape; the canonicalizer enforces canonicalization-safety at hash time).
   - `smokeTestChatCompletionPayloadSchema` — a Zod `z.object({ ... }).strict()` matching the Sprint 2 payload subsection exactly: `model`, `prompt`, `response`, `tokens: { prompt, completion, total }.strict()`, `durationMs`. All numeric fields use `z.number().int().nonnegative()`. The `prompt` and `response` fields use `z.string().max(530)` to accommodate the 500-char truncated value plus the worst-case truncation suffix length.
   - Inferred types: `export type AuditRecordBody = z.infer<typeof auditRecordBodySchema>` and likewise for the payload.
2. In `packages/audit/src/canonicalize.ts`, implement `canonicalize(value: unknown): string`. The function recursively walks the value: rejects floats, NaN, Infinity, undefined, functions, symbols, Date instances, BigInt, and any non-plain object; sorts object keys in lexicographic order; serializes via `JSON.stringify` with no whitespace. The function's JSDoc must explicitly document (per AC-27) the input constraint (no floats, no NaN/Infinity/undefined, integers within safe-integer range, strings UTF-8, no NFC normalization) and point at the deferred RFC 8785 migration in `tasks/todo.md`.
3. In `packages/audit/src/genesis.ts`, export `GENESIS_SEED = "roguemouse-audit-genesis-v1"` and `GENESIS_HASH = createHash("sha256").update(GENESIS_SEED, "utf8").digest("hex")`, both as `const`. The runtime computation must yield the pinned literal `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc` (from Step 0); the Phase 2 test in `genesis.test.ts` enforces this. JSDoc on the constants explains the version-suffix versioning convention (the `-v1` suffix is the format version handle; bumping to `-v2` produces a structurally distinct chain).
4. In `packages/audit/src/hash.ts`, export `sha256Hex(content: string): string` that returns `createHash("sha256").update(content, "utf8").digest("hex")`.
5. In `packages/audit/src/index.ts`, re-export `canonicalize`, `GENESIS_HASH`, `GENESIS_SEED`, and `sha256Hex` (and the not-yet-existent writer will be added in Phase 4).
6. In `packages/audit/src/canonicalize.test.ts`, write Vitest tests covering: empty object → `"{}"`; single-key object → `'{"a":"x"}'`; two-key object with keys out of order in source → keys present in sorted order in output; nested object also sorted; rejects a float input; rejects `NaN`; rejects `Infinity`; rejects `undefined`; rejects a `Date` instance. Each test uses `expect(canonicalize(input)).toBe(expected)` for happy paths and `expect(() => canonicalize(input)).toThrow()` for rejections.
7. In `packages/audit/src/genesis.test.ts`, write two Vitest assertions: (a) `GENESIS_HASH` matches `/^[0-9a-f]{64}$/`; (b) `GENESIS_HASH` equals the pinned literal `"b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc"` (from Step 0). The literal value is pinned in the test so any accidental change to `GENESIS_SEED` is caught by `pnpm --filter @roguemouse/audit test`.

### Test strategy

- `pnpm --filter @roguemouse/audit test` runs Vitest in the audit package. All canonicalizer tests and the genesis test must pass.
- `pnpm -r typecheck` must pass with zero new errors over baseline.
- No live Vultr calls in this phase.

### Anti-patterns to avoid

- **Markdown-fenced-block stripping (lessons.md)**: the JSDoc blocks in `canonicalize.ts` and `genesis.ts` will contain leading `*` characters (multi-line comment continuation lines). After writing each file, the implementer reads it back and visually confirms all comment continuation lines start with `*` and the block is a valid multi-line comment. If any continuation line is missing its leading `*`, the file is malformed and must be rewritten.
- **Don't read `process.env` from these packages**: the canonicalizer, genesis constant, and hash helper are pure functions / constants. No configuration is consumed. Stack rule honored by construction.
- **Don't use relative imports across package boundaries**: schemas → no cross-package imports. audit → no cross-package imports in Phase 2 (the writer in Phase 4 will import the envelope type from `@roguemouse/schemas`).

### Phase exit criteria

- [ ] `pnpm -r typecheck` exits 0 with no new errors.
- [ ] `pnpm --filter @roguemouse/audit test` exits 0 with all canonicalizer and genesis tests passing.
- [ ] `packages/audit/src/canonicalize.ts` JSDoc contains the literal strings `no floats`, `safe-integer range`, and a pointer to `tasks/todo.md` for the RFC 8785 migration (verifiable via grep).
- [ ] Git working tree contains only the changes from this phase.

### Rollback

`git restore packages/schemas/src/index.ts packages/audit/src/index.ts` and `rm packages/audit/src/canonicalize.ts packages/audit/src/genesis.ts packages/audit/src/hash.ts packages/audit/src/canonicalize.test.ts packages/audit/src/genesis.test.ts`. No external state is affected.

---

## Phase 3 — Inference client wrapper

### Files touched

- `packages/inference/src/index.ts` (line 1 currently a stub; replaced with re-exports of the client + envelope types)
- `packages/inference/src/client.ts` (new file; the OpenAI-against-Vultr wrapper, the `InferenceResult` envelope type, and the `chatCompletion` function that returns the envelope)
- `packages/inference/src/errors.ts` (new file; the error-classification helper that maps `openai`-SDK exceptions into the envelope's `{ code, message, retryable }` shape)

### Steps

1. In `packages/inference/src/errors.ts`, define and export:
   - `type InferenceErrorEnvelope = { code: string; message: string; retryable: boolean }`.
   - `function classifyInferenceError(err: unknown): InferenceErrorEnvelope`. Classification rules:
     - If `err` is an instance of `OpenAI.APIError` (importable from `openai`) with a numeric `status`:
       - 4xx (400, 401, 403, 404, 422, etc.) → `{ code: err.code ?? "http_4xx", message: err.message, retryable: false }`.
       - 5xx (500, 502, 503, 504, etc.) → `{ code: err.code ?? "http_5xx", message: err.message, retryable: true }`.
       - 408 (request timeout) and 429 (rate limit) → `retryable: true` despite being 4xx.
     - If `err` is an instance of `OpenAI.APIConnectionError` or `OpenAI.APIConnectionTimeoutError` → `{ code: "network", message: err.message, retryable: true }`.
     - If `err` is a generic `Error` with a `code` property matching `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND` → `{ code: err.code, message: err.message, retryable: true }`.
     - Otherwise → `{ code: "unknown", message: String((err as { message?: unknown })?.message ?? err), retryable: false }`.
2. In `packages/inference/src/client.ts`, define and export:
   - `type TokenUsage = { promptTokens: number; completionTokens: number; totalTokens: number }` — camelCase per JavaScript convention (the OpenAI SDK exposes `prompt_tokens` / `completion_tokens` / `total_tokens` in snake_case; we re-key at the boundary).
   - `type ChatCompletionData = { content: string; model: string; usage: TokenUsage }` — the canonical happy-path payload returned through the envelope.
   - `type InferenceResult<T> = { ok: true; data: T; usage: TokenUsage } | { ok: false; error: InferenceErrorEnvelope }`. (The `usage` on success is duplicated outside `data` for ergonomic access; this matches the operator's locked envelope shape.)
   - `createInferenceClient(config: { apiKey: string; baseURL: string }): OpenAI` — a factory returning a configured `OpenAI` instance per `.claude/rules/vultr.md:100-107`. No env reads.
   - `async chatCompletion(client: OpenAI, args: { model: string; messages: ChatCompletionMessageParam[] }): Promise<InferenceResult<ChatCompletionData>>` — wraps `client.chat.completions.create({ model, messages })` in `try`/`catch`. On success, extracts `choices[0]?.message?.content`, `usage`, and the model name from the response. If `content` is null/undefined/empty, returns `{ ok: false, error: { code: "empty_response", message: "Vultr Inference returned a response with no content", retryable: true } }`. If `usage` is missing or any of its three token fields is not a non-negative integer, returns `{ ok: false, error: { code: "malformed_response", message: "...", retryable: false } }`. On any thrown error, returns `{ ok: false, error: classifyInferenceError(err) }`. The function **never throws** (per CLAUDE.md hard rule 5).
3. In `packages/inference/src/index.ts`, re-export: `createInferenceClient`, `chatCompletion`, and the types `InferenceResult`, `TokenUsage`, `ChatCompletionData`, `InferenceErrorEnvelope`.

### Test strategy

- `pnpm -r typecheck` must pass with zero new errors. This is the primary gate — the wrapper is too thin to merit a unit test for the success path (Phase 6 integration-verifies it), and error classification is straightforward enough that a unit test would just re-state the implementation. If Sprint 4's circuit breaker integration reveals a classification gap, that sprint adds tests then.
- Optional unit test (not required by any AC, may be skipped without consequence): `packages/inference/src/errors.test.ts` exercising `classifyInferenceError` against a handful of synthesized error objects. Add only if Phase 3 implementation surfaces a classification ambiguity worth pinning.

### Anti-patterns to avoid

- **CLAUDE.md hard rule 5 — LLM client code never throws**: this is the binding constraint that drove the structured envelope amendment. The implementer verifies by inspection that `chatCompletion` contains exactly one `try`/`catch` and that every `catch` branch returns an envelope (no rethrows, no `Promise.reject`).
- **Markdown-fenced-block stripping (lessons.md)**: the source files contain TypeScript `//` comments and possibly JSDoc `/** */` blocks. Implementer reads back any file with JSDoc to confirm leading `*` continuation lines are present.
- **Don't read `process.env`**: the factory takes config as arguments. Stack rule honored.
- **Don't import from `@roguemouse/schemas`**: the inference wrapper stays schema-agnostic per the operator's amendment. The smoke runner does response shape validation against the inference package's exported types directly (which are TypeScript types, not Zod schemas).
- **Don't shadow snake_case at the API boundary**: the `TokenUsage` type uses camelCase (`promptTokens`, `completionTokens`, `totalTokens`). The mapping from the OpenAI SDK's snake_case fields happens once, in `chatCompletion`. Downstream consumers (smoke runner, audit payload) work in camelCase. The audit record's `payload.tokens` object uses the spec's keys (`prompt`, `completion`, `total`) — the smoke runner does the final rename from camelCase to those keys when building the payload.

### Phase exit criteria

- [ ] `pnpm -r typecheck` exits 0 with no new errors.
- [ ] The `openai` package is resolvable from `packages/inference/src/client.ts` (verifiable by typecheck succeeding on the import).
- [ ] Source-grep confirms `chatCompletion` contains no `throw` statements outside of its `try` block (the `try` body may contain SDK calls that themselves throw; the `catch` must always return an envelope). Command: `Select-String -Path packages/inference/src -Pattern "throw " -SimpleMatch:$false` should match only inside test files or comments, never inside `chatCompletion`'s `catch`.
- [ ] Git working tree contains only the changes from this phase.

### Rollback

`git restore packages/inference/src/index.ts` and `rm packages/inference/src/client.ts packages/inference/src/errors.ts`. No external state affected.

---

## Phase 4 — Audit writer

### Files touched

- `packages/audit/src/index.ts` (modified to re-export the writer alongside the Phase 2 exports)
- `packages/audit/src/writer.ts` (new file; the `RunAuditWriter` class and the `appendRecord` / `readRecord` operations)
- `packages/audit/src/s3-client.ts` (new file; the `createS3Client` factory that wraps `@aws-sdk/client-s3`)

### Steps

1. In `packages/audit/src/s3-client.ts`, export `createS3Client(config: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string })` that returns a configured `S3Client` instance per the snippet in `.claude/rules/vultr.md:37-49` (endpoint, region, credentials; `forcePathStyle` left at default). No env reads.
2. In `packages/audit/src/writer.ts`, export:
   - A `class RunAuditWriter` with the constructor `constructor(opts: { s3: S3Client; bucket: string; runId: string })`. Internal state: `private lastHash: string = GENESIS_HASH` (initialized to the genesis constant; advances after each successful append).
   - An `async append(input: { ts: string; recordType: string; payload: unknown }): Promise<{ key: string; recordHash: string; previousHash: string }>` method that:
     1. Builds the body `{ ts, runId: this.runId, recordType, previousHash: this.lastHash, payload }`.
     2. Validates the body against `auditRecordBodySchema.parse(...)` (imported from `@roguemouse/schemas`). A schema failure throws a Zod error; the smoke runner's top-level try/catch formats it for the FAIL output.
     3. Canonicalizes the body via `canonicalize(body)`.
     4. Computes the hash via `sha256Hex(canonical)`.
     5. Constructs the key: `audit/${this.runId}/${tsSafe(ts)}-${hash}.json` where `tsSafe` replaces every `:` in `ts` with `-`. The `tsSafe` helper is defined inside `writer.ts` (not exported).
     6. Sends a `PutObjectCommand` to S3 with `Bucket: this.bucket`, `Key: key`, `Body: canonical`, `ContentType: "application/json"`, `Metadata: { sha256: hash, previousHash: this.lastHash }`.
     7. On success, updates `this.lastHash = hash` and returns `{ key, recordHash: hash, previousHash: <pre-update lastHash> }`.
   - An `async read(key: string): Promise<{ body: string; recordHash: string }>` method that sends a `GetObjectCommand`, reads the response body fully into a string (await `response.Body.transformToString()`), recomputes the canonical hash on the parsed-and-re-canonicalized body, and returns both. The smoke runner uses this to verify round-trip integrity.
3. In `packages/audit/src/index.ts`, add re-exports for `createS3Client`, `RunAuditWriter`.
4. The schemas package is now used by audit (workspace dep added in Phase 1). Verify the import resolves.

### Test strategy

- `pnpm -r typecheck` must pass with zero new errors.
- No unit tests for the writer in Phase 4 — the S3 logic is integration-verified in Phase 6. Pure logic that warranted unit tests was already covered in Phase 2 (canonicalize, genesis).

### Anti-patterns to avoid

- **Markdown-fenced-block stripping**: applies to JSDoc on the `RunAuditWriter` class if added. Read-back confirmation required if JSDoc is included.
- **Don't read `process.env`**: factory and class take config via constructor. Stack rule honored.
- **Never overwrite an audit record (vultr.md:87)**: the writer uses content-addressed keys, so re-writing the same record is a no-op by construction. Writing a *modified* record produces a different key. The writer does NOT call `DeleteObjectCommand` anywhere. Per spec AC-25, FAIL paths must not delete or modify the record — the writer offers no delete API at all.

### Phase exit criteria

- [ ] `pnpm -r typecheck` exits 0 with no new errors.
- [ ] `RunAuditWriter` is exported from `@roguemouse/audit` (verifiable by importing it in a scratch file or by typecheck succeeding when the smoke runner is added in Phase 5).
- [ ] No `delete`-style commands or `DeleteObjectCommand` import anywhere in `packages/audit` (grep check).
- [ ] Git working tree contains only the changes from this phase.

### Rollback

`git restore packages/audit/src/index.ts` and `rm packages/audit/src/writer.ts packages/audit/src/s3-client.ts`. No external state affected (no audit record has yet been written; Phase 6 is the first write).

---

## Phase 5 — Smoke runner + root script + tasks/todo.md update

### Files touched

- `scripts/smoke-vultr.ts` (new file; the standalone smoke runner)
- `package.json` (root; adds `"smoke": "tsx scripts/smoke-vultr.ts"` to the `scripts` block; updates `"typecheck"` to also typecheck the scripts directory)
- `tsconfig.scripts.json` (new file at repo root; tsconfig for typechecking the scripts directory)
- `tasks/todo.md` (appends the RFC 8785 migration entry per AC-28)

### Steps

1. Create `tsconfig.scripts.json` at repo root extending `./tsconfig.base.json`, with `include: ["scripts/**/*"]`, `compilerOptions: { rootDir: ".", noEmit: true, types: ["node"] }`. This tsconfig is used only for typechecking scripts; it does not produce output. (`tsx` does its own per-file resolution at runtime.)
2. Create `scripts/smoke-vultr.ts`. Top-level structure:
   - **dotenv bootstrap** — the locked snippet from the operator's prompt: `import { config } from 'dotenv'; import { fileURLToPath } from 'node:url'; import path from 'node:path'; const __dirname = path.dirname(fileURLToPath(import.meta.url)); config({ path: path.join(__dirname, '..', '.env.local') });`. This runs before any other top-level import or statement that could trigger env reads.
   - **env validation** — a Zod schema parses `process.env` and extracts the three required secrets. The schema requires non-empty strings and produces a structured error listing all missing variables in one pass (per spec edge case "Error names each missing variable"). The runner also detects whether `.env.local` itself exists (using `fs.existsSync` on the resolved path); if not, prints a distinct error per AC-02.
   - **constants** — hardcoded `INFERENCE_BASE_URL = "https://api.vultrinference.com/v1"`, `OPS_MODEL = "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16"`, `S3_ENDPOINT = "https://ams1.vultrobjects.com"`, `S3_REGION = "ams1"`, `S3_BUCKET = "roguemouse-audit-log"`. These are locked per the spec, so they live in the runner, not in env (the `.env.example` over-documents them for future flexibility).
   - **runId** — `crypto.randomUUID()` per AC-33.
   - **prompt** — a short canned smoke prompt: `"Reply with the single word OK and nothing else."`. Kept short so the response excerpt fits inside the 500-char limit comfortably and the smoke test is fast.
   - **flow** — sequentially:
     1. Construct the inference client via `createInferenceClient({ apiKey, baseURL })`.
     2. Time and execute one `chatCompletion(client, { model, messages })` call. The wrapper returns an `InferenceResult<ChatCompletionData>` envelope (per Phase 3) — it never throws. If `result.ok === false`, abort with a structured FAIL report citing `result.error.code` and `result.error.message`; exit non-zero. The wrapper has already enforced non-empty `content` and integer-valued token counts (AC-07, AC-08), so the runner trusts the success branch.
     3. From the success branch capture: `durationMs` (the timed elapsed time around the `chatCompletion` call), `result.data.content` (the response text), and `result.usage` (the camelCase `TokenUsage` with `promptTokens`, `completionTokens`, `totalTokens`).
     4. Build the Sprint 2 payload object using a `truncate500(s)` helper (defined inside the runner) that returns the input if ≤ 500 chars, otherwise `s.slice(0, 500) + "... [truncated; " + s.length + " chars total]"` (ASCII three-dot ellipsis per AC-32; no Unicode `…`). The payload's `tokens` object re-keys `result.usage` from camelCase to the spec's snake-case-adjacent keys: `{ prompt: result.usage.promptTokens, completion: result.usage.completionTokens, total: result.usage.totalTokens }`.
     5. Validate the payload via `smokeTestChatCompletionPayloadSchema.parse(...)`.
     6. Construct the S3 client via `createS3Client({ endpoint, region, accessKeyId, secretAccessKey })` and instantiate `new RunAuditWriter({ s3, bucket, runId })`. Time and execute `writer.append({ ts: new Date().toISOString(), recordType: "smoke_test:chat_completion", payload })`. Capture the resulting `key`, `recordHash`, `previousHash`.
     7. Time and execute `writer.read(key)`. Verify (a) the read-back body, when re-canonicalized, hashes to the same `recordHash`; (b) the parsed `previousHash` equals `GENESIS_HASH`.
   - **PASS output** — print a structured report containing: per-step timings as `Nms` integers (inference, S3 write, S3 read, hash verify); the S3 key; `recordHash`; `previousHash`; `promptTokens`, `completionTokens`, `totalTokens`; total elapsed time. Every elapsed-time value is formatted as `Nms` where N is a non-negative base-10 integer (AC-34). Exit code 0.
   - **FAIL output** — the flow's early-return on inference envelope failure produces a structured FAIL report directly. For non-inference failures (S3 errors, schema validation, hash mismatches), wrap the post-inference portion of the flow in a top-level try/catch. On error, print: which step failed (`env_validation`, `inference`, `s3_put`, `s3_get`, `schema_validation`, `hash_mismatch`, `prev_hash_mismatch`); for inference failures the envelope's `error.code` and `error.message`; for assertion failures expected vs actual values; for thrown errors elsewhere the error message; the partial state collected so far (e.g., the S3 key if PUT succeeded but GET failed, so the operator can inspect the bucket). Exit non-zero. Critically, the runner never issues a `DeleteObjectCommand` and never re-writes the same key with modified content — the writer doesn't expose a delete operation, so this is guaranteed by construction (per AC-25).
3. Edit root `package.json` scripts block:
   - Add `"smoke": "tsx scripts/smoke-vultr.ts"`.
   - Add `"typecheck:scripts": "tsc --noEmit -p tsconfig.scripts.json"` — the standalone scripts typecheck, runnable independently for fast iteration on a single script without re-typechecking every workspace.
   - Update `"typecheck"` to `"pnpm -r typecheck && pnpm typecheck:scripts"` — the composite that chains the workspace typecheck and the scripts typecheck. The composite is what the final verification gate (and any CI integration in a later sprint) invokes.
4. Append a new entry to `tasks/todo.md` (per AC-28) tracking the deferred RFC 8785 migration. The entry uses the existing file's template format: `## 2026-05-14 — Migrate canonicalizer to RFC 8785 if non-integer numbers or non-NFC Unicode enter the audit log` followed by a 1-2 sentence body, file references (`packages/audit/src/canonicalize.ts`), `Priority: medium`, `Surfaced during: Sprint 2 /plan-task`. The entry is plain prose; no leading `#` or `*` characters at line starts inside the body (the heading marker `##` is at line start as expected for the existing file's format).

### Test strategy

- `pnpm typecheck` (the composite that runs `pnpm -r typecheck && pnpm typecheck:scripts`) must pass with zero new errors. This catches type errors in the runner itself and in every workspace package.
- `pnpm typecheck:scripts` can be run on its own for fast iteration while editing the runner.
- `pnpm smoke` is NOT executed in this phase — Phase 6 is its dedicated phase. (Running it here without the operator's go-ahead would consume Vultr credits prematurely and obscure the phase boundary.)
- `grep` confirms `tasks/todo.md` contains the RFC 8785 entry.

### Anti-patterns to avoid

- **Markdown-fenced-block stripping (lessons.md)**: the `tasks/todo.md` entry is appended via `Edit` (not `Write`) to preserve the existing entries. The implementer confirms after the edit that the appended block renders correctly — leading `##` characters on heading lines, no missing characters. Similarly, the smoke runner's JSDoc (if present) is verified after write.
- **Don't read `process.env` from workspace packages**: env reads are confined to `scripts/smoke-vultr.ts`. The inference and audit packages receive configuration via the factory functions defined in Phases 3 and 4.
- **Parse env at module load time (stack.md)**: the runner's env-validation Zod schema runs immediately after the dotenv bootstrap, before any Vultr call. Missing variables produce a single error listing all of them.
- **Workspace imports use the package name**: the runner imports `createInferenceClient`, `chatCompletion` from `@roguemouse/inference`; `createS3Client`, `RunAuditWriter`, `GENESIS_HASH` from `@roguemouse/audit`; `smokeTestChatCompletionPayloadSchema` from `@roguemouse/schemas`. No relative paths into `packages/*`.
- **Explicit `.js` extensions on relative imports**: not applicable for the runner since it doesn't import any relative siblings within `scripts/`.

### Phase exit criteria

- [ ] `pnpm typecheck` exits 0 with no new errors (covers both workspace and scripts).
- [ ] `pnpm smoke --help` or `pnpm smoke <invalid invocation that triggers env-validation failure without making external calls>` produces a sensible error message — quick sanity check that the script is wired up. (This is local testing only; full happy-path verification is Phase 6.)
- [ ] `tasks/todo.md` contains the RFC 8785 migration entry, verifiable via `Select-String -Path tasks/todo.md -Pattern "RFC 8785"`.
- [ ] Git working tree contains only the changes from this phase.

### Rollback

`git restore scripts/ package.json tasks/todo.md` and `rm tsconfig.scripts.json scripts/smoke-vultr.ts` (after restoring `scripts/`, the directory may need to be deleted if empty). No external state affected.

---

## Phase 6 — First smoke run execution (verification phase)

### Files touched

None. This is a verification phase, not a code phase. The only artifacts produced are: (a) console output from the smoke runner, (b) one audit record in the Vultr Object Storage bucket.

### Steps

**Step 0 — Operator-driven precondition gate (mandatory before any `pnpm smoke` invocation)**. The operator verifies, by direct inspection:
   - `.env.local` exists at repo root.
   - `VULTR_INFERENCE_API_KEY` is populated with a valid key (non-empty, sourced from the password manager).
   - `S3_ACCESS_KEY` and `S3_SECRET_KEY` are populated.
   - System clock is within ~5 minutes of true UTC.
   - The operator's machine has outbound network access to `https://api.vultrinference.com` and `https://ams1.vultrobjects.com`.
   - **Optional but recommended**: confirm Vultr resources are still healthy via the Vultr console — the `roguemouse-audit-log` bucket exists in region `ams1`, the Serverless Inference subscription is active, and the locked Ops Engineer model is in the catalog.

   If any of the mandatory items is not true, abort Phase 6 **before** invoking `pnpm smoke`. Running the smoke test against missing credentials or a degraded environment produces a FAIL that's an artifact of the precondition, not a real integration signal.

1. From repo root, invoke `pnpm smoke`.
2. Observe the runner output. Expected outcome: a PASS report with all the fields enumerated in AC-22, exit code 0.
3. Operator verification of side effects:
   - Visit the Vultr Object Storage console and confirm one new object exists under the `audit/{runId}/` prefix (where `{runId}` matches the UUID printed in the PASS report).
   - (Optional) Download the object and confirm the body is a valid canonical JSON containing the five envelope fields with `previousHash` equal to the pinned genesis hex value `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`.
4. If the run fails, the operator captures the FAIL output and the bucket state for diagnosis. Per AC-25, the S3 record (if any) is preserved.

### Test strategy

- The smoke runner IS the test. Its PASS report and exit code are the verification.
- This phase has no separate unit tests — Phase 2's tests already cover the pure logic, and Phases 3 and 4 are integration-only.

### Anti-patterns to avoid

- **Don't re-run on failure without diagnosing first**: if Phase 6 fails, the operator investigates the FAIL output and the bucket state before re-running. Re-running a misconfigured smoke test wastes Vultr credits and clutters the bucket.
- **Don't delete the failed run's audit record manually before diagnosis**: per AC-25, the forensic state is preserved. The operator can delete the record via the Vultr console *after* the issue is understood and a fix is in flight.

### Phase exit criteria

- [ ] `pnpm smoke` exits 0 with a PASS report containing the fields enumerated in AC-22.
- [ ] The PASS report's runId is a valid UUIDv4 string (8-4-4-4-12 hex with `4` in position 14).
- [ ] All elapsed-time values are formatted as `Nms` integers (no decimal points, no trailing fractional seconds).
- [ ] One new audit record visible in the Vultr Object Storage bucket under the printed `audit/{runId}/` prefix.
- [ ] Re-running `pnpm smoke` produces a fresh runId and a second independent PASS (the first run's record is unaffected; the bucket now has two audit records).

### Rollback

There is no rollback at the code level — Phase 6 produces no source-tree changes. If the run produced an audit record in the bucket and the operator wishes to clean it up, the operator deletes the object via the Vultr console (manual; per spec's Out of Scope list, automated cleanup is not in scope). The audit log's integrity story is unaffected by the presence or absence of any particular smoke-test record, since each smoke run is its own chain rooted at the genesis constant.

---

## Final verification

After Phase 6 passes, run these checks before declaring Sprint 2 complete:

- [ ] `pnpm typecheck` exits 0 with no new errors over the Sprint 1 baseline (composite chains `pnpm -r typecheck` and `pnpm typecheck:scripts`). **Maps to AC-29.**
- [ ] `pnpm --filter @roguemouse/audit test` exits 0. **Validates canonicalizer & genesis.**
- [ ] `pnpm smoke` exits 0 with a fresh PASS report. **Validates the full integration path.**
- [ ] Manual review of the runner's PASS report against each AC-22 field.
- [ ] `Select-String -Path tasks/todo.md -Pattern "RFC 8785"` matches. **Maps to AC-28.**
- [ ] `Select-String -Path packages/audit/src/canonicalize.ts -Pattern "no floats|safe-integer|RFC 8785"` matches. **Maps to AC-27.**
- [ ] No `DeleteObjectCommand` references anywhere in the codebase: `Select-String -Path packages,scripts -Pattern "DeleteObjectCommand" -Recurse` must return no matches. **Reinforces AC-25 by construction.**

### AC-to-phase coverage map

| AC | Phase | Verification |
|---|---|---|
| AC-01 | 5 | `pnpm smoke` script exists in root package.json |
| AC-02 to AC-05 | 5 (logic), 6 (manual induce-and-observe) | env validation Zod schema in runner |
| AC-06 to AC-08 | 5 (logic), 6 (live verification) | inference call + response validation in runner |
| AC-09 to AC-13 | 2 (schema), 5 (runner construction), 6 (live verification) | envelope schema + writer behavior |
| AC-14 to AC-16 | 2 (canonicalize + sha256), 5 (runner), 6 (live verification) | canonicalize + hash + schema |
| AC-17 | 4 (writer key format), 6 (live verification) | `tsSafe` helper + key template |
| AC-18 to AC-20 | 4 (read API), 5 (runner verify), 6 (live verification) | writer.read + hash recompute |
| AC-21 to AC-25 | 5 (runner output + error handling), 6 (live verification) | top-level try/catch + structured output |
| AC-26 | 2 (genesis test) | pinned literal in `genesis.test.ts` |
| AC-27 | 2 (JSDoc in canonicalize.ts) | grep check |
| AC-28 | 5 (tasks/todo.md update) | grep check |
| AC-29 | 1-6 (every phase exit gates on typecheck) | `pnpm typecheck` clean |
| AC-30 | 6 (live round-trip) | implicit in AC-19; failure mode is JSON-parse failure |
| AC-31 | 2 (`.strict()` on payload + tokens schemas) | schema parse rejects extra fields |
| AC-32 | 5 (`truncate500` helper) | unit-testable in Phase 5 if desired; verified by AC-22 output inspection |
| AC-33 | 5 (`crypto.randomUUID()`) | format-check in runner; verified in Phase 6 PASS output |
| AC-34 | 5 (output formatter uses integer ms) | verified in Phase 6 PASS output |
