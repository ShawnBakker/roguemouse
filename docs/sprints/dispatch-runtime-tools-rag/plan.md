# dispatch-runtime-tools-rag — Plan

## Summary

Sprint 4b lands in seven phases, ordered from least-risk (data layer) to highest-risk (live smoke against Vultr). Each phase produces a self-contained, typecheckable unit of work; the dispatcher in Phase 5 is the cap of the pyramid, sitting on top of fixtures (Phase 1), the runbook search index (Phase 2), the new `writer.list` method (Phase 3), and the 8 tool implementations (Phase 4). The smoke runner in Phase 6 is the integration test: it exercises every prior phase end-to-end against real Vultr Object Storage, producing the project's first multi-record audit chain.

Anti-patterns from `tasks/lessons.md` are listed against the phases where they could plausibly surface. Two of the four lessons (Gemini 403-empty-body, free-tier Pro quota=0) cannot apply because Sprint 4b's smoke is tool-only and exercises no LLM call paths (locked by spec AC-38). The two markdown-wrapper / conditional-exports lessons remain in play and are flagged where relevant.

Phase exit criteria are concrete and operator-verifiable. Rollback for each phase is `git restore` against a tightly-scoped path list; no phase introduces shared mutable state that survives the process, so rollback is purely a code-level concern.

---

## Phase 1 — Fixtures and Zod schemas

### Goal
Create the Scenario A fixture corpus under `fixtures/scenario-a/` and the Zod-validated loader module in `@roguemouse/tools`. After this phase, fixtures load fail-fast at module init and TypeScript narrows fixture access types.

### Files touched

- **NEW**: `fixtures/scenario-a/market-data.json`
- **NEW**: `fixtures/scenario-a/positions.json`
- **NEW**: `fixtures/scenario-a/broker-positions.json`
- **NEW**: `fixtures/scenario-a/anomaly-evidence.json`
- **NEW**: `packages/tools/src/fixtures/scenarioASchema.ts`
- **NEW**: `packages/tools/src/fixtures/loadScenarioA.ts`
- **NEW**: `packages/tools/src/fixtures/__tests__/loadScenarioA.test.ts`
- **MODIFIED**: `packages/tools/src/index.ts` (re-export `ScenarioAFixtures` type and `loadScenarioA` function)
- **MODIFIED**: `packages/tools/package.json` (no new deps; verify `zod` and `node:fs/promises` available; both already direct or built-in)

### Step-by-step

1. Create the fixtures directory at the repo root: `fixtures/scenario-a/`. The location is at the repo root (not under any package) because fixtures cross package boundaries — Phase 6's smoke loads them, Sprint 4c's planner may also load them.

2. Author `fixtures/scenario-a/market-data.json` as a JSON object map keyed by symbol:
   ```json
   {
     "AAPL": {
       "spotPrice": 19450,
       "impliedVolatility": 1680,
       "realizedVolatility": 4000,
       "surfaceTs": "2026-05-16T09:31:14.000Z"
     },
     "MSFT": { "spotPrice": 42100, "impliedVolatility": 2200, "realizedVolatility": 2150, "surfaceTs": "2026-05-16T09:31:14.000Z" },
     "GOOGL": { "spotPrice": 17850, "impliedVolatility": 2380, "realizedVolatility": 2260, "surfaceTs": "2026-05-16T09:31:14.000Z" }
   }
   ```
   AAPL's IV/RV ratio is `1680/4000 = 0.42`, matching the Scenario A anomaly (low-bound breach against the 0.45 threshold). MSFT and GOOGL are happy-path symbols for general lookups. All values are integers per Sprint 3's schema constraints (basis points for prices, basis points × 100 for vols — keep units consistent with Sprint 3's `marketDataResultSchema`).

3. Author `fixtures/scenario-a/positions.json`:
   ```json
   [
     { "strategy": "iv-rv-monitor", "symbol": "AAPL", "quantity": 100, "avgEntryPrice": 19200, "currentPrice": 19450, "asOf": "2026-05-16T09:31:14.000Z" },
     { "strategy": "iv-rv-monitor", "symbol": "MSFT", "quantity": 50, "avgEntryPrice": 42000, "currentPrice": 42100, "asOf": "2026-05-16T09:31:14.000Z" },
     { "strategy": "momentum-baseline", "symbol": "GOOGL", "quantity": 25, "avgEntryPrice": 17500, "currentPrice": 17850, "asOf": "2026-05-16T09:31:14.000Z" }
   ]
   ```
   Two strategies (`iv-rv-monitor`, `momentum-baseline`) to support `strategy` filtering on `position:snapshot`. Three symbols for symbol-level filtering.

4. Author `fixtures/scenario-a/broker-positions.json`:
   ```json
   [
     { "symbol": "AAPL", "quantity": 100, "brokerAccountId": "BROKER-001", "asOf": "2026-05-16T09:31:14.000Z" },
     { "symbol": "MSFT", "quantity": 49, "brokerAccountId": "BROKER-001", "asOf": "2026-05-16T09:31:14.000Z" },
     { "symbol": "GOOGL", "quantity": 25, "brokerAccountId": "BROKER-001", "asOf": "2026-05-16T09:31:14.000Z" }
   ]
   ```
   MSFT shows quantity 49 here vs 50 internal (a 1-share divergence) to support the reconciliation flow without making the demo about reconciliation. Per Phase 6's smoke, this divergence is not directly exercised; Sprint 4c's planner can use it.

5. Author `fixtures/scenario-a/anomaly-evidence.json`:
   ```json
   {
     "anomalyId": "anom-aapl-iv-rv-20260516-093114",
     "symbol": "AAPL",
     "metric": "iv_rv_ratio",
     "observedValue": 4200,
     "lowBoundThreshold": 4500,
     "highBoundThreshold": 9500,
     "detectedAt": "2026-05-16T09:31:14.000Z"
   }
   ```
   All numeric fields are integers (basis points: 4200 = 0.42, 4500 = 0.45). Used by the Phase 6 smoke as the payload for its synthetic `anomaly:detected` record.

6. Create `packages/tools/src/fixtures/scenarioASchema.ts`. Define the following Zod schemas:
   - `marketDataEntrySchema` — reuses Sprint 3's `marketDataLookupResultDataSchema` shape (object with `spotPrice`, `impliedVolatility`, `realizedVolatility`, `surfaceTs`).
   - `marketDataFixtureSchema = z.record(z.string().min(1), marketDataEntrySchema)`.
   - `positionFixtureSchema = z.array(positionShape)` — reuses Sprint 3's position element schema.
   - `brokerPositionFixtureSchema = z.array(brokerPositionShape)` — reuses Sprint 3's broker position element schema.
   - `anomalyEvidenceFixtureSchema` — explicit object schema with the 7 fields above (no Sprint 3 schema exists for this; define here).
   - `scenarioAFixturesSchema = z.object({ marketData, positions, brokerPositions, anomalyEvidence })`.
   - Export `type ScenarioAFixtures = z.infer<typeof scenarioAFixturesSchema>`.

7. Create `packages/tools/src/fixtures/loadScenarioA.ts`. Export `async function loadScenarioA(rootDir: string): Promise<ScenarioAFixtures>`:
   - Read all 4 files via `readFile(path.join(rootDir, "fixtures/scenario-a/<filename>.json"), "utf-8")`.
   - JSON.parse each. On parse failure, throw `new Error("Fixture JSON parse failed: " + filename + " — " + err.message)`.
   - Zod-parse each through its individual schema using `safeParse`. On failure, throw `new Error("Fixture Zod parse failed: " + filename + " — " + ZodError.format())`.
   - Compose into `ScenarioAFixtures` and run the top-level `scenarioAFixturesSchema.parse(combined)` as a final consistency check (catches any cross-fixture invariant we add later).
   - Return the parsed object.
   - On file-not-found (ENOENT), throw with a clear message naming the path.

8. Create unit tests in `packages/tools/src/fixtures/__tests__/loadScenarioA.test.ts`:
   - **Happy path**: temp directory with valid fixtures → returns parsed object.
   - **Missing file**: temp directory with `market-data.json` missing → throws with the path in the message.
   - **Malformed JSON**: temp directory with `positions.json` containing invalid JSON → throws with "parse failed" + filename.
   - **Zod failure**: temp directory with `market-data.json` containing a string where a number is expected → throws with "Zod parse failed" + filename + field path.
   - Use `vi.beforeEach` + `tmpdir` to construct test fixtures; clean up after.

9. Update `packages/tools/src/index.ts` to re-export `loadScenarioA`, `ScenarioAFixtures` type, and `scenarioAFixturesSchema`.

10. Run validation commands:
    - `pnpm --filter @roguemouse/tools typecheck`
    - `pnpm --filter @roguemouse/tools test`
    - `pnpm -r typecheck` to verify no cross-package regression.

### Test strategy

- **Unit**: Vitest tests covering load happy path, file-missing, malformed JSON, Zod parse failure. Per-failure-case message assertions.
- **Typecheck**: `pnpm -r typecheck` passes with zero new errors.
- **No live verification needed in this phase.**

### Anti-patterns to avoid

- **Markdown-wrapper strip (2026-05-14)**: The JSON fixture files contain `:` characters but no leading hashes or asterisks at line starts, so they are not at risk from the chat-relay markdown stripper. The Zod schema files use `*` and `:` in TypeScript syntax — these are inside fenced TypeScript code and not at line starts inside the file. Verify with a character-level diff if pasting through any third-party tool. The operator should not need to retype anything; this lesson is documented here as a hygiene check.

- **Conditional exports (2026-05-14)**: This phase adds new modules to `@roguemouse/tools`. The package's `exports` block in `package.json` must continue to work without custom conditions. Verify by running the unit tests via `tsx`-equivalent (Vitest's default loader) — if the new submodule is not resolvable, the conditional-exports trap has bitten us. Current `@roguemouse/tools/package.json` uses unconditional exports per Sprint 3; new modules import from inside `src/` and re-export through the existing barrel. No exports-block change needed.

### Phase exit criteria

- [ ] All 4 fixture JSON files exist under `fixtures/scenario-a/` and parse as valid JSON
- [ ] `scenarioAFixturesSchema` and `ScenarioAFixtures` type exported from `@roguemouse/tools`
- [ ] `loadScenarioA(rootDir)` returns parsed fixtures or throws with file-path-naming error
- [ ] All Vitest tests in `__tests__/loadScenarioA.test.ts` pass
- [ ] `pnpm --filter @roguemouse/tools test` exit 0
- [ ] `pnpm -r typecheck` exit 0 with zero new errors over Sprint 4a baseline

### Phase rollback

- `git restore fixtures/ packages/tools/src/fixtures/ packages/tools/src/index.ts`
- No on-disk state outside the repo; rollback is purely code-level.

---

## Phase 2 — Runbook corpus loader and in-memory search index

### Goal
Build the application-layer RAG that backs `runbook:search`: a module that reads all 5 runbook `.md` files at init, tokenizes content with stopword filtering, builds a frequency-based keyword index, and exposes a `search(query, topK)` function returning ranked matches.

### Files touched

- **NEW**: `packages/runbooks/src/stopwords.ts`
- **NEW**: `packages/runbooks/src/tokenize.ts`
- **NEW**: `packages/runbooks/src/loader.ts`
- **NEW**: `packages/runbooks/src/searchIndex.ts`
- **NEW**: `packages/runbooks/src/__tests__/tokenize.test.ts`
- **NEW**: `packages/runbooks/src/__tests__/loader.test.ts`
- **NEW**: `packages/runbooks/src/__tests__/searchIndex.test.ts`
- **MODIFIED**: `packages/runbooks/src/index.ts` (barrel — export `tokenize`, `STOPWORDS`, `loadRunbookCorpus`, `buildSearchIndex`, `searchRunbookIndex`, `RunbookIndex`, `RunbookMatch`)
- **MODIFIED**: `packages/runbooks/package.json` (no new deps)

### Step-by-step

1. Create `packages/runbooks/src/stopwords.ts`:
   ```typescript
   export const STOPWORDS: ReadonlySet<string> = new Set([
     "the", "a", "an", "is", "are", "of", "to", "for",
     "in", "on", "at", "by", "with", "and", "or", "not",
     "this", "that", "these", "those",
   ]);
   ```
   Export as a `ReadonlySet<string>` for O(1) lookup. The 20-word list is locked per spec AC-26.

2. Create `packages/runbooks/src/tokenize.ts`. Export `tokenize(input: string): string[]`:
   - Lowercase input.
   - Split on regex `/[\s,.\:;()?!"']+/` (whitespace + locked punctuation set). Hyphen is NOT a split character (a hyphenated term like "low-bound" becomes one token `"low-bound"`).
   - Filter empty strings (from leading/trailing splits).
   - Filter tokens present in `STOPWORDS`.
   - Return the resulting array (preserves order; allows frequency counting downstream).

3. Create `packages/runbooks/src/loader.ts`. Export `type LoadedRunbook = { path: string; rawContent: string; excerpt: string }` and `async function loadRunbookCorpus(contentDir: string): Promise<LoadedRunbook[]>`:
   - Use `node:fs/promises.readdir(contentDir)` to list files. Filter to `.md` extension.
   - For each file, `readFile(path, "utf-8")`.
   - Extract the excerpt via regex match against the markdown structure: pattern `/## When this fires\s*\n+([\s\S]+?)(?=\n## |$)/`. Capture group 1 is the section body. Trim whitespace. Collapse internal newlines to spaces. The excerpt is the multi-line "When this fires" paragraph squashed to a single line.
   - If a runbook lacks the "When this fires" section, throw `new Error("Runbook missing 'When this fires' section: " + filename)`. This is a corpus-quality invariant; we fail at boot rather than producing matches with empty excerpts.
   - Sort the resulting array by `path` (alphabetical) for stable insertion order (relied on by AC-28).
   - Return the array.

4. Create `packages/runbooks/src/searchIndex.ts`. Define types and functions:
   - `type RunbookDoc = { path: string; excerpt: string; totalTokens: number; freq: Map<string, number> }`.
   - `type RunbookIndex = { docs: RunbookDoc[] }`.
   - `type RunbookMatch = { path: string; excerpt: string; relevanceScore: number }`.
   - `function buildSearchIndex(corpus: LoadedRunbook[]): RunbookIndex`:
     - For each `LoadedRunbook`, tokenize `rawContent` (via the same `tokenize` function — stopword-filtered).
     - Build `freq: Map<string, number>` counting occurrences.
     - Compute `totalTokens = sum of freq.values()`. If `totalTokens === 0`, throw `new Error("Runbook has zero indexable tokens after stopword filtering: " + path)` (impossible in practice but defensive).
     - Push `{ path, excerpt, totalTokens, freq }` to `docs`.
     - Return `{ docs }`.
   - `function searchRunbookIndex(index: RunbookIndex, query: string, topK: number): RunbookMatch[]`:
     - Tokenize the query (returns stopword-filtered array).
     - If the query is empty after filtering, return `[]`.
     - For each `doc`, compute `score = sum over queryTokens of (doc.freq.get(token) ?? 0) / doc.totalTokens`.
     - Filter docs where `score > 0`.
     - Sort by `score` descending. Within tied scores, preserve insertion order (stable sort — JS Array.sort is stable in modern engines).
     - Slice to top-`topK`.
     - For each match, compute `relevanceScore = Math.min(10000, Math.max(0, Math.round(score * 10000)))`.
     - Return `[{ path, excerpt, relevanceScore }, ...]`.

5. Create `packages/runbooks/src/__tests__/tokenize.test.ts`:
   - `tokenize("The IV/RV ratio is 0.42")` → `["iv/rv", "ratio", "0", "42"]` (the `is`, `the` filter; `0.42` splits on `.`). Adjust expected to match actual implementation.
   - `tokenize("low-bound threshold")` → `["low-bound", "threshold"]` (hyphen preserved).
   - `tokenize("of the and or not")` → `[]` (all stopwords).
   - `tokenize("")` → `[]`.
   - `tokenize("  multiple    spaces  ")` → `["multiple", "spaces"]`.

6. Create `packages/runbooks/src/__tests__/loader.test.ts`:
   - **Happy path**: tmpdir with 2 minimal `.md` files containing valid `## When this fires` sections → returns 2 LoadedRunbooks with correct excerpts.
   - **Missing section**: tmpdir with one `.md` file lacking `## When this fires` → throws with the filename.
   - **Multi-line excerpt**: file with a 3-line "When this fires" paragraph → returns single-line excerpt with whitespace normalized.
   - **Stable order**: tmpdir with files named `b.md`, `a.md`, `c.md` → returns in alphabetical order.

7. Create `packages/runbooks/src/__tests__/searchIndex.test.ts`:
   - **Empty query**: returns `[]`.
   - **No matches**: query with zero overlapping tokens → returns `[]`.
   - **Single match, single token**: corpus of 2 docs, query token appears in 1 → returns that doc.
   - **Ranking**: corpus of 2 docs where doc-A contains query token 5 times in 100 tokens (score 0.05) and doc-B contains it 2 times in 50 tokens (score 0.04) → returns A before B.
   - **Top-K limit**: corpus of 5 docs all matching, topK=3 → returns 3 results.
   - **Stable tie-break**: corpus of 2 docs with identical scores → returns in insertion order (path-sorted from loader).
   - **relevanceScore clamping**: synthetic case where score > 1 (corpus token vs query) → clamps to 10000.

8. Update `packages/runbooks/src/index.ts` to re-export the public API.

9. Run validation:
    - `pnpm --filter @roguemouse/runbooks typecheck`
    - `pnpm --filter @roguemouse/runbooks test`

10. Manual verification: load the real corpus (`packages/runbooks/content/`), build the index, query with the Sprint 4a smoke prompt ("IV/RV ratio is 0.42 for AAPL at 09:31:14 UTC; the project's low-bound threshold is 0.45. Diagnose in 2-3 sentences.") with `topK=3`, and confirm `iv-rv-divergence.md` is in the results. Per spec AC-15, the AC bar is "appears in results"; the operator should verify rank-1 empirically during Phase 7 review and note any ranking surprises in `tasks/todo.md` for Sprint 7 polish.

### Test strategy

- **Unit**: 3 test files covering tokenize, loader, searchIndex.
- **Typecheck**: `pnpm -r typecheck` zero new errors.
- **Manual verification (Phase 6 will exercise)**: real corpus query against `iv-rv-divergence.md`.

### Anti-patterns to avoid

- **Markdown-wrapper strip (2026-05-14)**: TypeScript files contain `*` (in JSDoc) and `#` (rare in TS but possible in comments). Risk is low because these are not at line starts inside the test fixtures used by the loader. If you ever paste a multi-line `## When this fires` section into a prompt for me to write, verify the `##` is preserved on-disk.

- **Conditional exports (2026-05-14)**: `@roguemouse/runbooks` package.json may need its `exports` block extended for the new modules. Verify by running `pnpm test` from the package root after the changes — if any module resolves via the wrong condition, tests will fail with "Cannot find module."

### Phase exit criteria

- [ ] `STOPWORDS` exported as a 20-element `ReadonlySet<string>` from `@roguemouse/runbooks`
- [ ] `tokenize(input)` lowercases, splits on locked punctuation, filters stopwords
- [ ] `loadRunbookCorpus(dir)` loads all `.md` files, extracts excerpts, throws on missing section
- [ ] `buildSearchIndex(corpus)` returns `RunbookIndex` with per-doc frequency maps
- [ ] `searchRunbookIndex(index, query, topK)` returns ranked `RunbookMatch[]`
- [ ] All 3 Vitest test files pass
- [ ] Real-corpus manual query returns `iv-rv-divergence.md` in results (AC-15 verification)
- [ ] `pnpm -r typecheck` exit 0 with zero new errors

### Phase rollback

- `git restore packages/runbooks/src/`
- No on-disk state outside the repo.

---

## Phase 3 — `RunAuditWriter.list` extension

### Goal
Add a `list` method to `RunAuditWriter` that issues an S3 `ListObjectsV2` against the audit bucket, returning a structured envelope of keys + `hasMore`. Add the `"s3_list"` step variant to `classifyS3Error`. Sprint 4b's `audit:search` tool (Phase 4) and the Phase 6 smoke's chain-verification step depend on this method.

### Files touched

- **MODIFIED**: `packages/audit/src/runAuditWriter.ts` (add `list` method + injection plumbing)
- **MODIFIED**: `packages/audit/src/errors.ts` (add `"s3_list"` step to `AuditError` step union; extend `classifyS3Error` to accept the step)
- **MODIFIED**: `packages/audit/src/types.ts` (or whatever file holds the envelope types — add `ListResult` and `AuditListData`)
- **MODIFIED**: `packages/audit/src/index.ts` (barrel — re-export `ListResult`, `AuditListData`)
- **NEW**: `packages/audit/src/__tests__/list.test.ts`
- **MODIFIED**: `packages/audit/package.json` (no new deps; `@aws-sdk/client-s3` already direct)

### Step-by-step

1. Open `packages/audit/src/errors.ts`. Locate the `step` enum/union currently containing `"s3_put"` and `"s3_get"`. Add `"s3_list"` as a third variant. Update any exhaustive switch or schema literal accordingly.

2. Open `packages/audit/src/types.ts` (or the file currently holding `AppendResult` / envelope types). Add:
   ```typescript
   export type AuditListData = {
     keys: readonly string[];
     hasMore: boolean;
   };

   export type ListResult =
     | { ok: true; data: AuditListData }
     | { ok: false; error: AuditError };
   ```
   Mirror the existing envelope discipline used by `AppendResult` / `ReadResult` (whatever the current naming is).

3. Open `packages/audit/src/runAuditWriter.ts`. Add the `list` method to the `RunAuditWriter` class:
   ```typescript
   async list({ runIdPrefix, limit }: { runIdPrefix?: string; limit?: number }): Promise<ListResult> {
     const prefix = runIdPrefix ? `audit/${runIdPrefix}/` : "audit/";
     try {
       const resp = await this.s3.send(new ListObjectsV2Command({
         Bucket: this.bucket,
         Prefix: prefix,
         MaxKeys: limit ?? 100,
       }));
       const keys = (resp.Contents ?? []).map(o => o.Key).filter((k): k is string => typeof k === "string");
       return { ok: true, data: { keys, hasMore: resp.IsTruncated === true } };
     } catch (err) {
       return { ok: false, error: classifyS3Error(err, "s3_list") };
     }
   }
   ```
   - Import `ListObjectsV2Command` from `@aws-sdk/client-s3` at the top of the file.
   - The `this.s3`, `this.bucket` references already exist on the class (from Sprint 2's `append` and `read` methods).
   - The method is purely additive; no existing append/read code is touched.

4. Update `packages/audit/src/index.ts` to re-export the new `AuditListData` and `ListResult` types alongside the existing exports.

5. Create `packages/audit/src/__tests__/list.test.ts` using `@aws-sdk/client-mock`:
   - **Happy path with runIdPrefix**: mock S3 returns `Contents: [{Key: "audit/abc/123-hash.json"}, ...]`, `IsTruncated: false`. Verify `list({runIdPrefix: "abc"})` issues a `ListObjectsV2Command` with `Prefix: "audit/abc/"` and returns `{ok: true, data: {keys: [...], hasMore: false}}`.
   - **Happy path without runIdPrefix**: verify `Prefix: "audit/"`.
   - **Empty bucket**: mock returns `Contents: undefined`. Verify `keys: []` and `hasMore: false`.
   - **Truncated response**: mock returns `IsTruncated: true`. Verify `hasMore: true`.
   - **Custom limit**: `list({limit: 50})` issues command with `MaxKeys: 50`.
   - **Default limit**: `list({})` issues command with `MaxKeys: 100`.
   - **S3 error (403)**: mock rejects with `{name: "AccessDenied", $metadata: {httpStatusCode: 403}}`. Verify `{ok: false, error: {step: "s3_list", code: <whatever classifyS3Error produces for 403>, retryable: false}}`.
   - **Network error**: mock rejects with a generic Error. Verify `{ok: false, error: {step: "s3_list", retryable: true}}` (per existing classifyS3Error behavior for unclassifiable errors — confirm in Phase 4a's pattern).

6. Run validation:
    - `pnpm --filter @roguemouse/audit typecheck`
    - `pnpm --filter @roguemouse/audit test`
    - Verify existing tests in `@roguemouse/audit` still pass (regression check on `append` and `read`).

### Test strategy

- **Unit**: `@aws-sdk/client-mock`-based tests. 7 cases listed in step 5.
- **Typecheck**: `pnpm -r typecheck` zero new errors.
- **No live verification needed in this phase** (Phase 6 smoke exercises `list` end-to-end against real Vultr).

### Anti-patterns to avoid

- **Conditional exports (2026-05-14)**: `@roguemouse/audit` exports must continue to resolve. Verify by running both unit tests and any cross-package smoke that imports from `@roguemouse/audit` (Sprint 2's smoke remains in the repo).

### Phase exit criteria

- [ ] `ListResult` envelope and `AuditListData` type exported from `@roguemouse/audit`
- [ ] `RunAuditWriter.list({ runIdPrefix?, limit? })` returns a `ListResult` per envelope contract
- [ ] `classifyS3Error` handles `step: "s3_list"` correctly
- [ ] All 7+ Vitest cases in `list.test.ts` pass
- [ ] Existing `append` and `read` tests still pass (regression check)
- [ ] `pnpm -r typecheck` exit 0 with zero new errors

### Phase rollback

- `git restore packages/audit/src/runAuditWriter.ts packages/audit/src/errors.ts packages/audit/src/types.ts packages/audit/src/index.ts packages/audit/src/__tests__/list.test.ts`
- `@aws-sdk/client-mock` is already a dev dependency from prior sprints; no install/uninstall needed.

---

## Phase 4 — Tool implementations + `TOOL_IMPLEMENTATIONS` registry

### Goal
Implement the 8 tool functions in `@roguemouse/tools`, with the `audit:append` runtime recursion guard (AC-13) at the implementation level. Build the type-safe `TOOL_IMPLEMENTATIONS` registry that mirrors Sprint 3's `TOOLS` schema registry.

### Files touched

- **NEW**: `packages/tools/src/toolCtx.ts`
- **NEW**: `packages/tools/src/implementations/marketDataLookup.ts`
- **NEW**: `packages/tools/src/implementations/runbookSearch.ts`
- **NEW**: `packages/tools/src/implementations/positionSnapshot.ts`
- **NEW**: `packages/tools/src/implementations/brokerReconcile.ts`
- **NEW**: `packages/tools/src/implementations/auditAppend.ts`
- **NEW**: `packages/tools/src/implementations/auditSearch.ts`
- **NEW**: `packages/tools/src/implementations/scoreExplain.ts`
- **NEW**: `packages/tools/src/implementations/policyCheck.ts`
- **NEW**: `packages/tools/src/implementations/registry.ts`
- **NEW**: `packages/tools/src/implementations/__tests__/*.test.ts` (one per impl, 8 files)
- **MODIFIED**: `packages/tools/src/index.ts` (barrel: re-export `TOOL_IMPLEMENTATIONS`, `ToolCtx`, individual implementation functions for testability)

### Step-by-step

1. Create `packages/tools/src/toolCtx.ts`:
   ```typescript
   import type { RunAuditWriter } from "@roguemouse/audit";
   import type { RunbookIndex } from "@roguemouse/runbooks";
   import type { ScenarioAFixtures } from "../fixtures/scenarioASchema.js";

   export type ToolCtx = {
     writer: RunAuditWriter;
     fixtures: ScenarioAFixtures;
     runbookIndex: RunbookIndex;
   };
   ```

2. Implement `marketDataLookup` in `implementations/marketDataLookup.ts`:
   ```typescript
   export async function marketDataLookup(
     args: ArgsFor<"market_data:lookup">,
     ctx: ToolCtx,
   ): Promise<ToolResult<DataFor<"market_data:lookup">>> {
     try {
       const entry = ctx.fixtures.marketData[args.symbol];
       if (!entry) {
         return { ok: false, error: { code: "unknown_symbol", message: `No fixture data for symbol: ${args.symbol}`, retryable: false } };
       }
       return { ok: true, data: entry };
     } catch (err) {
       return { ok: false, error: { code: "tool_threw_internal", message: err instanceof Error ? err.message : String(err), retryable: false } };
     }
   }
   ```
   Wrap the entire body in try/catch (defensive — implements Sprint 3's `defineTool` contract; never throws).

3. Implement `runbookSearch` in `implementations/runbookSearch.ts`:
   ```typescript
   export async function runbookSearch(
     args: ArgsFor<"runbook:search">,
     ctx: ToolCtx,
   ): Promise<ToolResult<DataFor<"runbook:search">>> {
     try {
       const matches = searchRunbookIndex(ctx.runbookIndex, args.query, args.topK);
       return { ok: true, data: { matches } };
     } catch (err) {
       return { ok: false, error: { code: "tool_threw_internal", message: err instanceof Error ? err.message : String(err), retryable: false } };
     }
   }
   ```

4. Implement `positionSnapshot` in `implementations/positionSnapshot.ts`:
   - Read `ctx.fixtures.positions`.
   - Apply `args.strategy` filter if present.
   - Apply `args.symbol` filter if present.
   - Return `{ ok: true, data: { positions: filtered } }`.
   - No error path (filter to empty array is success, not error).

5. Implement `brokerReconcile` in `implementations/brokerReconcile.ts`:
   - Read `ctx.fixtures.brokerPositions`.
   - The Sprint 3 `broker:reconcile` schema accepts `{ strategy }`. The fixture has no `strategy` field per-record (broker positions are reported per-symbol per-account). The implementation maps `strategy` to the symbols associated with that strategy via `ctx.fixtures.positions`. Pseudocode:
     ```typescript
     const symbolsForStrategy = ctx.fixtures.positions.filter(p => p.strategy === args.strategy).map(p => p.symbol);
     const brokerPositions = ctx.fixtures.brokerPositions.filter(b => symbolsForStrategy.includes(b.symbol));
     return { ok: true, data: { brokerPositions } };
     ```
   - If `args.strategy` matches no positions, returns `brokerPositions: []` (not an error).

6. Implement `auditAppend` in `implementations/auditAppend.ts`:
   ```typescript
   const RESERVED_RECORDTYPES: ReadonlySet<string> = new Set(["tool:call", "tool:result"]);

   export async function auditAppend(
     args: ArgsFor<"audit:append">,
     ctx: ToolCtx,
   ): Promise<ToolResult<DataFor<"audit:append">>> {
     try {
       if (RESERVED_RECORDTYPES.has(args.recordType)) {
         return {
           ok: false,
           error: {
             code: "recordtype_reserved_for_dispatcher",
             message: `recordType '${args.recordType}' is reserved for the dispatcher's tool-call lifecycle. See packages/schemas/src/tools/auditAppend.ts JSDoc (lines 11-18). Tool implementations must not write these record types.`,
             retryable: false,
             step: "validate",
           },
         };
       }
       const writerResult = await ctx.writer.append({
         ts: new Date().toISOString(),
         recordType: args.recordType,
         payload: args.payload,
       });
       if (!writerResult.ok) {
         return { ok: false, error: { code: writerResult.error.code, message: writerResult.error.message, retryable: writerResult.error.retryable, step: writerResult.error.step } };
       }
       return { ok: true, data: { key: writerResult.data.key, hash: writerResult.data.hash, previousHash: writerResult.data.previousHash } };
     } catch (err) {
       return { ok: false, error: { code: "tool_threw_internal", message: err instanceof Error ? err.message : String(err), retryable: false } };
     }
   }
   ```
   - The reserved set is local to this module (not exported); it's a defensive runtime check, not a general-purpose constant.
   - The runtime guard fires BEFORE the writer is touched. The writer would also reject `tool:call`/`tool:result` via its discriminated-union safeParse if we got past this check (the schemas validate recordType against the locked 12-name list which DOES contain `tool:call`/`tool:result` for the dispatcher's own use — but the runtime check here is at the tool layer, blocking the path before any writer interaction).
   - Note: `args.recordType` is already constrained at compile time to the 12 valid names (Sprint 3's schema). The runtime check on the two reserved ones is the additional discipline this tool enforces.

7. Implement `auditSearch` in `implementations/auditSearch.ts`:
   ```typescript
   export async function auditSearch(
     args: ArgsFor<"audit:search">,
     ctx: ToolCtx,
   ): Promise<ToolResult<DataFor<"audit:search">>> {
     try {
       const listResult = await ctx.writer.list({ runIdPrefix: args.runId, limit: args.limit });
       if (!listResult.ok) {
         return { ok: false, error: { code: listResult.error.code, message: listResult.error.message, retryable: listResult.error.retryable, step: listResult.error.step } };
       }
       const records: AuditRecord[] = [];
       for (const key of listResult.data.keys) {
         const readResult = await ctx.writer.read(key);
         if (!readResult.ok) {
           // Skip unreadable keys; do not abort the whole search.
           continue;
         }
         const record = readResult.data.record;
         if (args.recordType && record.recordType !== args.recordType) continue;
         if (args.sinceTs && record.ts < args.sinceTs) continue;
         records.push(record);
       }
       return { ok: true, data: { records, hasMore: listResult.data.hasMore } };
     } catch (err) {
       return { ok: false, error: { code: "tool_threw_internal", message: err instanceof Error ? err.message : String(err), retryable: false } };
     }
   }
   ```
   - Single-page semantics per AC-19, AC-33: `hasMore` reflects the LIST response's `IsTruncated`, NOT the post-filter count.
   - Unreadable individual keys are skipped, not aborted. This matches the spec's edge-case for partial-bucket states.
   - The audit record from `writer.read` is already Zod-parsed and discriminated-union-validated.

8. Implement `scoreExplain` in `implementations/scoreExplain.ts`:
   ```typescript
   export async function scoreExplain(
     args: ArgsFor<"score:explain">,
     ctx: ToolCtx,
   ): Promise<ToolResult<DataFor<"score:explain">>> {
     try {
       return {
         ok: true,
         data: {
           components: [
             { name: "iv_rv_breach", contributionBp: 6000 },
             { name: "position_size", contributionBp: 2500 },
             { name: "historical_pattern", contributionBp: 1500 },
           ],
           narrative: `Stub explanation for strategy ${args.strategy} with score ${args.scoreValue}. Components are deterministic fixture values; this tool is a Sprint 4b stub adequate for schema parity. Real scoring logic is deferred to post-submission work.`,
         },
       };
     } catch (err) {
       return { ok: false, error: { code: "tool_threw_internal", message: err instanceof Error ? err.message : String(err), retryable: false } };
     }
   }
   ```
   - Components and narrative are constants; no fixture lookup needed. (Or — if the spec's `data: { components: [<fixture-shaped array>], narrative: <fixture-shaped string> }` was intended to mean "load from a fixture file," update by loading from a new optional fixture file. Default to inline constants for this phase; review with operator if a fixture file is needed.)
   - The components and narrative must satisfy Sprint 3's `scoreExplainResultDataSchema`. Verify by typechecking after the implementation lands.

9. Implement `policyCheck` in `implementations/policyCheck.ts`:
   ```typescript
   export async function policyCheck(
     args: ArgsFor<"policy:check">,
     ctx: ToolCtx,
   ): Promise<ToolResult<DataFor<"policy:check">>> {
     try {
       return { ok: true, data: { allowed: true, violations: [] } };
     } catch (err) {
       return { ok: false, error: { code: "tool_threw_internal", message: err instanceof Error ? err.message : String(err), retryable: false } };
     }
   }
   ```

10. Create `packages/tools/src/implementations/registry.ts`:
    ```typescript
    import type { ToolName, ArgsFor, DataFor, ToolResult } from "@roguemouse/schemas";
    import type { ToolCtx } from "../toolCtx.js";
    import { marketDataLookup } from "./marketDataLookup.js";
    // ... 7 more imports

    export type ToolImplementation<TName extends ToolName> =
      (args: ArgsFor<TName>, ctx: ToolCtx) => Promise<ToolResult<DataFor<TName>>>;

    export type ToolImplementationsRegistry = {
      [K in ToolName]: ToolImplementation<K>;
    };

    export const TOOL_IMPLEMENTATIONS: ToolImplementationsRegistry = {
      "market_data:lookup": marketDataLookup,
      "runbook:search": runbookSearch,
      "position:snapshot": positionSnapshot,
      "broker:reconcile": brokerReconcile,
      "audit:append": auditAppend,
      "audit:search": auditSearch,
      "score:explain": scoreExplain,
      "policy:check": policyCheck,
    };
    ```
    The mapped type `{[K in ToolName]: ToolImplementation<K>}` ensures every name has a typed implementation. Missing a tool produces a TypeScript error at the registry declaration line.

11. Create per-impl Vitest tests in `__tests__/*.test.ts`:
    - **marketDataLookup**: known symbol → success; unknown symbol → `unknown_symbol` error; thrown impl → caught as `tool_threw_internal`.
    - **runbookSearch**: happy path with mock RunbookIndex; empty result; error propagation from searchRunbookIndex.
    - **positionSnapshot**: no filters → all positions; strategy filter; symbol filter; both filters; no matches → empty array.
    - **brokerReconcile**: known strategy → matching positions; unknown strategy → empty array.
    - **auditAppend**: happy path → writer.append called → success envelope; reserved recordType → `recordtype_reserved_for_dispatcher` error, writer NOT called; writer failure → error envelope propagates.
    - **auditSearch**: happy path → writer.list + writer.read calls → records returned; LIST failure → error envelope; READ failure on a single key → skipped, others returned; filter by recordType; filter by sinceTs.
    - **scoreExplain**: returns deterministic stub envelope; always success.
    - **policyCheck**: returns `{allowed: true, violations: []}` for any input.
    - Use in-memory writer fakes (mock the methods, not the network).

12. Update `packages/tools/src/index.ts` to re-export:
    - `TOOL_IMPLEMENTATIONS`
    - `ToolCtx` type
    - Individual implementation functions (for testability and Phase 5's dispatcher)
    - Sprint 1 / Sprint 3 exports remain unchanged

13. Run validation:
    - `pnpm --filter @roguemouse/tools typecheck`
    - `pnpm --filter @roguemouse/tools test`
    - `pnpm -r typecheck` (cross-package regression)

### Test strategy

- **Unit**: 8 test files, one per implementation. Mock writer for audit:append / audit:search; use in-memory fixtures and mock RunbookIndex elsewhere.
- **Typecheck**: The registry's mapped type enforces completeness — if any of the 8 names is missing, TypeScript fails.
- **No live verification needed in this phase** (Phase 6 smoke exercises the registry against real Vultr).

### Anti-patterns to avoid

- **Markdown-wrapper strip (2026-05-14)**: code files contain `#` only in template literals and comments; `*` only in JSDoc and type intersections. Risk is low; no operator-paste of code planned for this phase.

- **Conditional exports (2026-05-14)**: 9 new modules added to `@roguemouse/tools`. The barrel `src/index.ts` re-exports them; the package's `exports` block currently uses unconditional `"./src/index.ts"`. No change needed. Verify the test runner resolves all 9 modules by running `pnpm --filter @roguemouse/tools test` — a missing export will surface as "Cannot find module."

- **`audit:append` recursion**: Phase 4's biggest semantic risk. The dispatcher (Phase 5) MUST NOT route `tool:call` / `tool:result` records through this tool. The `RESERVED_RECORDTYPES` runtime guard here is the architectural backstop. If the dispatcher were ever to mistakenly invoke `audit:append` for these record types, this guard fires and prevents the recursion. Sprint 4b's spec AC-12 (architectural) + AC-13 (runtime) together codify this.

### Phase exit criteria

- [ ] `ToolCtx` type exported from `@roguemouse/tools`
- [ ] 8 implementation files exist; each exports a single `async function` matching `ToolImplementation<TName>`
- [ ] `TOOL_IMPLEMENTATIONS` registry exists, typed as `ToolImplementationsRegistry` (mapped type enforces coverage)
- [ ] `auditAppend` runtime guard rejects `tool:call` and `tool:result` recordTypes BEFORE touching the writer
- [ ] All 8 Vitest test files pass
- [ ] `pnpm --filter @roguemouse/tools test` exit 0
- [ ] `pnpm -r typecheck` exit 0 with zero new errors

### Phase rollback

- `git restore packages/tools/src/implementations/ packages/tools/src/toolCtx.ts packages/tools/src/index.ts`
- No mutable state outside the repo.

---

## Phase 5 — `dispatchTool` runtime in `@roguemouse/agent`

### Goal
Implement the dispatcher: the function that the planner (Sprint 4c) calls to invoke a tool. The dispatcher writes a `tool:call` audit record, invokes the implementation, times the body, writes a `tool:result` record, and returns the result envelope. Serial dispatch (Decision 1A) is enforced via a per-dispatcher async mutex.

### Files touched

- **NEW**: `packages/agent/src/dispatcher.ts` (the factory function `createDispatcher`)
- **NEW**: `packages/agent/src/dispatchTool.ts` (the `DispatchTool` re-export from schemas + any agent-side type aliases)
- **NEW**: `packages/agent/src/__tests__/dispatcher.test.ts`
- **MODIFIED**: `packages/agent/src/index.ts` (barrel — re-export `createDispatcher`, `DispatchTool` type)
- **MODIFIED**: `packages/agent/package.json` (no new deps; `@roguemouse/schemas`, `@roguemouse/tools`, `@roguemouse/audit` already workspace deps)

### Step-by-step

1. Open `packages/agent/src/dispatchTool.ts`. Re-export the `DispatchTool` type from `@roguemouse/schemas` for caller convenience. No runtime code here — this file is type-only.

2. Create `packages/agent/src/dispatcher.ts`. Define:
   ```typescript
   import { randomUUID } from "node:crypto";
   import { performance } from "node:perf_hooks";
   import type { ToolName, ArgsFor, DataFor, ToolResult, DispatchTool } from "@roguemouse/schemas";
   import { TOOL_IMPLEMENTATIONS, type ToolCtx } from "@roguemouse/tools";

   export type CreateDispatcherArgs = {
     writer: ToolCtx["writer"];
     fixtures: ToolCtx["fixtures"];
     runbookIndex: ToolCtx["runbookIndex"];
   };

   export function createDispatcher(args: CreateDispatcherArgs): DispatchTool {
     const ctx: ToolCtx = { writer: args.writer, fixtures: args.fixtures, runbookIndex: args.runbookIndex };
     let mutex: Promise<unknown> = Promise.resolve();

     const dispatchTool: DispatchTool = async <TName extends ToolName>(
       name: TName,
       a: ArgsFor<TName>,
     ): Promise<ToolResult<DataFor<TName>>> => {
       const prior = mutex;
       let release: () => void = () => {};
       mutex = new Promise(r => { release = r; });
       try {
         await prior;
         return await runOne(name, a, ctx);
       } finally {
         release();
       }
     };

     return dispatchTool;
   }

   async function runOne<TName extends ToolName>(
     name: TName,
     a: ArgsFor<TName>,
     ctx: ToolCtx,
   ): Promise<ToolResult<DataFor<TName>>> {
     const invocationId = randomUUID();

     // tool:call audit write
     const callPayload = { toolName: name, invocationId, args: a as unknown };
     const callWrite = await ctx.writer.append({
       ts: new Date().toISOString(),
       recordType: "tool:call",
       payload: callPayload,
     });
     if (!callWrite.ok) {
       return {
         ok: false,
         error: {
           code: "audit_write_failed",
           message: callWrite.error.message,
           retryable: callWrite.error.retryable,
           step: "tool_call_audit",
         },
       } as ToolResult<DataFor<TName>>;
     }

     // Execute the tool body with defensive try/catch
     const start = performance.now();
     let result: ToolResult<DataFor<TName>>;
     try {
       const impl = TOOL_IMPLEMENTATIONS[name];
       if (!impl) {
         result = {
           ok: false,
           error: { code: "unknown_tool", message: `No implementation registered for tool name: ${name}`, retryable: false },
         } as ToolResult<DataFor<TName>>;
       } else {
         // The mapped type guarantees impl signature matches (args, ctx) -> Promise<ToolResult<DataFor<TName>>>.
         result = await (impl as ToolImplementation<TName>)(a, ctx);
       }
     } catch (err) {
       result = {
         ok: false,
         error: {
           code: "tool_threw",
           message: err instanceof Error ? err.message : String(err),
           retryable: false,
         },
       } as ToolResult<DataFor<TName>>;
     }
     const durationMs = Math.max(0, Math.round(performance.now() - start));

     // tool:result audit write
     const resultPayload = { toolName: name, invocationId, result: result as unknown, durationMs };
     const resultWrite = await ctx.writer.append({
       ts: new Date().toISOString(),
       recordType: "tool:result",
       payload: resultPayload,
     });
     if (!resultWrite.ok) {
       return {
         ok: false,
         error: {
           code: "audit_write_failed",
           message: resultWrite.error.message,
           retryable: resultWrite.error.retryable,
           step: "tool_result_audit",
         },
       } as ToolResult<DataFor<TName>>;
     }

     return result;
   }
   ```
   Key points:
   - **Serial mutex**: each invocation chains onto the previous one's release. The pattern guarantees no two `runOne` calls execute concurrently within a single dispatcher instance. If `dispatchTool` is called twice rapidly, the second call's `runOne` starts only after the first call's release. This satisfies AC-06.
   - **Architectural recursion guard (AC-12)**: the dispatcher writes `tool:call` and `tool:result` records DIRECTLY via `ctx.writer.append`. It does NOT call `dispatchTool("audit:append", ...)`. No code path in this file routes tool-flow records through the tool registry. Visible by inspection.
   - **Defensive try/catch around the impl**: even though `defineTool` contracts that the impl does not throw, the dispatcher wraps the call. A thrown error produces the `tool_threw` envelope (AC-07) and STILL writes a `tool:result` record with the wrapped error.
   - **Timing**: `performance.now()` is used (not `Date.now()`) for sub-millisecond accuracy. Result is rounded to a non-negative integer.
   - **`as unknown` casts**: needed because Zod's `canonicalSafe` constraint is structural and the call-site narrowing makes TypeScript see the `args`/`result` as the specific `TName`'s shape, not the canonical-safe shape the audit payload expects. The cast is safe because the schemas constrain both shapes to JSON-canonical-safe values.

3. Update `packages/agent/src/index.ts` to re-export `createDispatcher`, `CreateDispatcherArgs`, and the `DispatchTool` type.

4. Create `packages/agent/src/__tests__/dispatcher.test.ts`. Use in-memory writer fake (a class implementing the `RunAuditWriter` surface but storing records in an array). Use mock fixtures and mock RunbookIndex. Cases:
   - **Happy path single dispatch**: `dispatchTool("market_data:lookup", {symbol: "AAPL"})` → writer.append called twice (tool:call, tool:result); returned envelope is success; durationMs is a non-negative integer.
   - **invocationId correlation**: the `invocationId` in the tool:call record equals the one in the tool:result record. The two are UUIDs (regex match `[0-9a-f-]{36}`).
   - **Serial mutex**: dispatch 3 calls via `Promise.all([dispatchTool(...), dispatchTool(...), dispatchTool(...)])`. Verify the writer.append call order is `call1, result1, call2, result2, call3, result3` — never `call1, call2, ...`. This validates AC-06.
   - **tool:call audit write failure**: fake writer rejects the first append with `{ok: false, error: {code: "s3_error", ...}}`. Dispatcher returns `audit_write_failed` envelope with `step: "tool_call_audit"`. Tool impl was NOT invoked.
   - **tool:result audit write failure**: fake writer accepts call but rejects result. Dispatcher returns `audit_write_failed` envelope with `step: "tool_result_audit"`. Tool impl WAS invoked.
   - **Tool impl throws**: stub `TOOL_IMPLEMENTATIONS["market_data:lookup"]` to throw. Dispatcher catches, returns `tool_threw` envelope, AND writes a `tool:result` record containing that wrapped envelope. (Test uses module mocking via Vitest's `vi.mock`.)
   - **Unknown tool name (defensive)**: cast-and-pass a name not in the registry. Returns `unknown_tool` envelope. (Requires bypassing TS via `as any`; documented in test.)
   - **No architectural recursion**: inspect dispatcher source visually + via grep — assert by AST or string match that no `dispatchTool("audit:append"...)` call exists in the file.

5. Run validation:
    - `pnpm --filter @roguemouse/agent typecheck`
    - `pnpm --filter @roguemouse/agent test`
    - `pnpm -r typecheck` (cross-package regression)

### Test strategy

- **Unit**: 8+ Vitest cases in `dispatcher.test.ts` using in-memory writer fake.
- **Typecheck**: Mapped-type registry from Phase 4 ensures `TOOL_IMPLEMENTATIONS[name]` is correctly typed.
- **No live verification needed in this phase** (Phase 6 smoke exercises the dispatcher against real Vultr).

### Anti-patterns to avoid

- **Recursion guard architectural enforcement**: The dispatcher MUST call `ctx.writer.append` directly, NOT `dispatchTool("audit:append", ...)`. Visual inspection: the file `packages/agent/src/dispatcher.ts` should contain `ctx.writer.append(...)` exactly twice (for `tool:call` and `tool:result` records) and zero occurrences of `dispatchTool("audit:append")`. Test case 8 in step 4 enforces this.

- **Conditional exports (2026-05-14)**: `@roguemouse/agent` is a new package boundary for the dispatcher. Verify the dispatcher is importable from outside the package (Phase 6's smoke script imports `createDispatcher` from `@roguemouse/agent`). If exports resolution fails, tsx will refuse to load the module.

- **Markdown-wrapper strip (2026-05-14)**: Not applicable; no operator paste of file content in this phase.

### Phase exit criteria

- [ ] `createDispatcher({writer, fixtures, runbookIndex})` returns a `DispatchTool` function
- [ ] Serial mutex prevents concurrent writer calls within a single dispatcher (verified by test case 3)
- [ ] `tool:call` and `tool:result` records emitted for every dispatch (via direct `ctx.writer.append`, not via `audit:append` tool)
- [ ] All 5 error paths return correct envelope (`audit_write_failed` × 2, `tool_threw`, `unknown_tool`, tool-side failures pass through)
- [ ] All 8+ Vitest test cases pass
- [ ] `pnpm --filter @roguemouse/agent test` exit 0
- [ ] `pnpm -r typecheck` exit 0 with zero new errors

### Phase rollback

- `git restore packages/agent/src/dispatcher.ts packages/agent/src/dispatchTool.ts packages/agent/src/index.ts packages/agent/src/__tests__/dispatcher.test.ts`
- No mutable state outside the repo.

---

## Phase 6 — `scripts/smoke-dispatch.ts` (tool-only) with pre-flight List permission check

### Goal
Wire all five prior phases into a single executable that runs against real Vultr Object Storage. Produces the project's first multi-record audit chain (≥7 records). Verifies chain integrity end-to-end. Operator-supervised.

### Files touched

- **NEW**: `scripts/smoke-dispatch.ts`
- **MODIFIED**: `package.json` (root) — add `"smoke:dispatch": "tsx scripts/smoke-dispatch.ts"` to the `scripts` block.
- **MODIFIED**: `tsconfig.scripts.json` (if it exists per Sprint 4a's pattern) — include the new script in the typecheck scope.

### Step-by-step

1. Create `scripts/smoke-dispatch.ts` with the following structure (high-level outline; full source written during Phase 6 execution):

   ```typescript
   import "dotenv/config";
   import { randomUUID } from "node:crypto";
   import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

   import { loadScenarioA } from "@roguemouse/tools";
   import { loadRunbookCorpus, buildSearchIndex } from "@roguemouse/runbooks";
   import { RunAuditWriter, GENESIS_HASH } from "@roguemouse/audit";
   import { canonicalize, sha256Hex } from "@roguemouse/audit"; // or wherever they live
   import { createDispatcher } from "@roguemouse/agent";

   async function main(): Promise<void> {
     // 1. Validate env vars
     const accessKey = process.env.S3_ACCESS_KEY;
     const secretKey = process.env.S3_SECRET_KEY;
     if (!accessKey || !secretKey) {
       console.error("ERROR: Missing S3_ACCESS_KEY or S3_SECRET_KEY in .env.local");
       process.exit(1);
     }

     // 2. Pre-flight List permission check
     const s3 = new S3Client({
       endpoint: "https://ams1.vultrobjects.com",
       region: "ams1",
       credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
     });
     try {
       const resp = await s3.send(new ListObjectsV2Command({ Bucket: "roguemouse-audit-log", MaxKeys: 1 }));
       console.log(`[pre-flight] List permission OK (bucket has ${resp.Contents?.length ?? 0} item(s) on first page).`);
     } catch (err: any) {
       const status = err.$metadata?.httpStatusCode;
       if (status === 403) {
         console.error("ERROR: List permission denied (HTTP 403). The access key needs ListBucket permission on roguemouse-audit-log.");
         console.error("Remediation: in Vultr Object Storage settings, update the access key's permissions to include 'List' on the bucket.");
         console.error("Until this is granted, audit:search and chain verification cannot work.");
         process.exit(1);
       }
       console.error(`ERROR: List permission pre-flight failed with unexpected error: ${err.message ?? String(err)}`);
       process.exit(1);
     }

     // 3. Load fixtures
     const fixtures = await loadScenarioA(process.cwd());
     console.log("[boot] Fixtures loaded.");

     // 4. Load runbook corpus + build index
     const corpus = await loadRunbookCorpus("packages/runbooks/content");
     const runbookIndex = buildSearchIndex(corpus);
     console.log(`[boot] Runbook index built (${corpus.length} runbooks).`);

     // 5. Construct writer
     const runId = randomUUID();
     const writer = new RunAuditWriter({
       runId,
       bucket: "roguemouse-audit-log",
       s3,
       canonicalize,
       sha256Hex,
     });
     console.log(`[boot] Writer constructed for runId ${runId}.`);

     // 6. Synthetic anomaly:detected record (direct writer call, not via dispatcher — this is smoke setup)
     const anomalyWrite = await writer.append({
       ts: new Date().toISOString(),
       recordType: "anomaly:detected",
       payload: fixtures.anomalyEvidence,
     });
     if (!anomalyWrite.ok) {
       console.error(`ERROR: anomaly:detected write failed: ${anomalyWrite.error.message}`);
       process.exit(1);
     }
     console.log(`[step 1] anomaly:detected written → hash ${anomalyWrite.data.hash}`);

     // 7. Construct dispatcher
     const dispatchTool = createDispatcher({ writer, fixtures, runbookIndex });

     // 8. Three sequential tool calls
     const calls = [
       { name: "market_data:lookup" as const, args: { symbol: "AAPL" } },
       { name: "position:snapshot" as const, args: {} },
       { name: "runbook:search" as const, args: { query: "IV RV ratio low-bound threshold divergence diagnose", topK: 3 } },
     ];
     const perToolTimings: Array<{ name: string; durationMs: number }> = [];
     for (const c of calls) {
       const t0 = Date.now();
       const result = await dispatchTool(c.name, c.args as any);
       const elapsedMs = Date.now() - t0;
       perToolTimings.push({ name: c.name, durationMs: elapsedMs });
       if (!result.ok) {
         console.error(`ERROR: dispatch ${c.name} failed: ${result.error.code} — ${result.error.message}`);
         process.exit(1);
       }
       console.log(`[step] ${c.name} dispatched (${elapsedMs}ms)`);
     }

     // 9. List all records for this run
     const listResult = await writer.list({ runIdPrefix: runId });
     if (!listResult.ok) {
       console.error(`ERROR: list for chain verification failed: ${listResult.error.message}`);
       process.exit(1);
     }
     console.log(`[verify] Listed ${listResult.data.keys.length} records for run ${runId}.`);
     if (listResult.data.keys.length < 7) {
       console.error(`ERROR: expected ≥7 records, got ${listResult.data.keys.length}`);
       process.exit(1);
     }

     // 10. Read each record and verify chain integrity
     const sortedKeys = [...listResult.data.keys].sort(); // keys are sortable by embedded ts prefix
     let prevHash = GENESIS_HASH;
     for (const key of sortedKeys) {
       const readResult = await writer.read(key);
       if (!readResult.ok) {
         console.error(`ERROR: read failed for key ${key}: ${readResult.error.message}`);
         process.exit(1);
       }
       const { record, canonicalBody, computedHash } = readResult.data;
       if (record.previousHash !== prevHash) {
         console.error(`ERROR: chain break at key ${key} — record.previousHash=${record.previousHash}, expected=${prevHash}`);
         process.exit(1);
       }
       prevHash = computedHash;
     }
     console.log(`[verify] Chain integrity OK. Final hash: ${prevHash}`);

     // 11. Structured report
     console.log("");
     console.log("=== SMOKE PASS ===");
     console.log(JSON.stringify({
       runId,
       recordCount: sortedKeys.length,
       finalHash: prevHash,
       genesisHash: GENESIS_HASH,
       perTool: perToolTimings,
     }, null, 2));
     process.exit(0);
   }

   main().catch(err => {
     console.error("FATAL:", err instanceof Error ? err.stack : String(err));
     process.exit(1);
   });
   ```

2. Add the `smoke:dispatch` entry to the root `package.json` scripts block. Confirm `tsx` is available as a dev dep (it should be from Sprint 4a's smoke).

3. Update `tsconfig.scripts.json` (if it exists per Sprint 4a's pattern) to include the new script. If not, the script is typechecked under the main tsconfig.

4. Run `pnpm typecheck:scripts` (or equivalent) to confirm the smoke compiles.

5. **Operator pre-flight blocker**: before invoking the smoke, the operator must confirm:
   - `.env.local` exists at the repo root and contains `S3_ACCESS_KEY` and `S3_SECRET_KEY` (operator does this via a masked check — first 4 + last 4 chars, never printing the full value).
   - Vultr Object Storage access key has List permission on `roguemouse-audit-log`. If the operator does not know, the smoke's pre-flight check will tell us (with a clear remediation message).

6. **Invoke**: `pnpm smoke:dispatch`. Operator-supervised; do not run autonomously without confirmation.

7. **Expected output**: PASS report with runId, recordCount ≥7, finalHash, perTool timings. Exit code 0.

8. **On failure modes**:
   - **List permission 403**: clear message + remediation. Operator updates IAM-equivalent settings; re-run.
   - **Network error**: same as Sprint 4a's pattern; verify network access to ams1.vultrobjects.com.
   - **Chain break**: rare; would indicate a bug in writer.append's `lastHash` tracking. Halt and report runId + key + expected-vs-actual hashes for forensic analysis.
   - **Fixture / runbook load failure**: pre-dispatch; clear error from Phase 1 or Phase 2 boundary.

### Test strategy

- **Pre-execution**: typecheck via `pnpm typecheck:scripts`.
- **Live execution**: operator-supervised against real Vultr.
- **Verification**: PASS report on stdout, ≥7 records in bucket, chain verifies, exit 0.
- **Post-run**: optionally use the `aws` CLI or AWS SDK probe (operator's choice) to spot-check that the records exist in the bucket and have content-addressed keys.

### Anti-patterns to avoid

- **Markdown-wrapper strip (2026-05-14)**: this is a code file with `#` only in template literals and string content. Risk low.

- **Conditional exports (2026-05-14)**: the smoke imports from 4 workspace packages (`@roguemouse/tools`, `@roguemouse/runbooks`, `@roguemouse/audit`, `@roguemouse/agent`). All must resolve under `tsx`'s default condition set (no custom `development`/`production` flags). Verify by attempting `pnpm smoke:dispatch` and watching for "Cannot find module" — Sprint 4a's smoke is a working precedent (loads `@roguemouse/inference`, `@roguemouse/audit`, `@roguemouse/schemas`).

- **Gemini-related lessons (2026-05-16 × 2)**: NOT APPLICABLE to this phase. The smoke is tool-only; no Gemini calls, no Vultr Inference calls.

- **Recursion**: visually verify the smoke does not call `dispatchTool("audit:append", {recordType: "tool:call", ...})`. The dispatcher itself bypasses the tool registry for these records; the smoke also bypasses by writing the `anomaly:detected` record directly via `writer.append` (step 6 of the outline).

- **Hash chain verification correctness**: the verifier in step 10 sorts keys lexicographically. The key format is `audit/{runId}/{ts-safe}-{hash}.json`; sorting by string places earlier-timestamp records first. This works IF the `ts-safe` portion preserves ordering. Verify by inspecting the recorded keys in a manual `pnpm smoke` run from Sprint 2 — if ordering is broken, the verifier must instead sort by parsed `ts` field after reading each record. Defensive note: if Phase 6 verification surfaces ordering bugs, fall back to a two-pass read (first pass to gather all `ts` fields, second pass to validate in `ts` order).

### Phase exit criteria

- [ ] `scripts/smoke-dispatch.ts` exists and typechecks
- [ ] `pnpm smoke:dispatch` script entry added to root `package.json`
- [ ] Operator pre-flight: `.env.local` confirmed with `S3_ACCESS_KEY` + `S3_SECRET_KEY` (masked check)
- [ ] Smoke's pre-flight List permission check returns 200 or aborts with remediation
- [ ] Live run produces ≥7 records on real Vultr bucket, all under the same `runId`
- [ ] Chain integrity verification passes: first record's `previousHash` = `GENESIS_HASH`; subsequent records chain unbroken
- [ ] Smoke exits 0 with structured PASS report on stdout
- [ ] PASS report includes `runId`, `recordCount`, `finalHash`, `perTool` timings

### Phase rollback

- Code-level: `git restore scripts/smoke-dispatch.ts package.json tsconfig.scripts.json`
- Bucket-level: audit records left in `roguemouse-audit-log`. Records are content-addressed, immutable, and harmless. Each has its own `runId` and chains only to records in the same run. They contribute to the running log history (which is the intent for the demo's audit log viewer in Sprint 6).

---

## Phase 7 — `/review-task` + `ROGUEMOUSE_CONTEXT.md` update + commit

### Goal
Audit Sprint 4b against the spec's 44 ACs, capture deviations and follow-ups, update `ROGUEMOUSE_CONTEXT.md` to reflect Sprint 4b completion, append any new lessons to `tasks/lessons.md`, and commit in the two-commit pattern established by Sprints 3 and 4a.

### Files touched

- **NEW**: `docs/sprints/dispatch-runtime-tools-rag/review.md`
- **MODIFIED**: `ROGUEMOUSE_CONTEXT.md` (sprint state, artifact pin for the new runId, architectural decisions appended)
- **MODIFIED**: `tasks/lessons.md` (only if Sprint 4b surfaces new anti-patterns — e.g., Vultr List permission gotchas, async mutex pitfalls, RAG corpus edge cases)
- **MODIFIED**: `tasks/todo.md` (only if Sprint 4b surfaces deferred follow-ups beyond the Sprint 7 polish entry already filed)

### Step-by-step

1. Run final typecheck and test sweeps:
   - `pnpm -r typecheck` — zero new errors
   - `pnpm -r test` — all pass
   - `pnpm typecheck:scripts` — zero errors
   - `pnpm smoke` (Sprint 2) — still passes (regression check)
   - `pnpm smoke:gemini` (Sprint 4a) — still passes IF the operator has Gemini quota and chooses to re-run; optional
   - `pnpm smoke:dispatch` (Phase 6) — confirmed PASS

2. Verify the 7+ Sprint 4b smoke records exist in the Vultr bucket. Either via the `audit:search` tool (manual invocation) or via an operator probe with the `aws s3 ls` CLI.

3. AC-by-AC review: walk through the 44 ACs in `spec.md` and mark each as VERIFIED, PARTIAL, or DEVIATION. Methods of verification:
   - **AC-01 to AC-13**: code inspection + unit test results
   - **AC-14 to AC-24**: unit test results per implementation
   - **AC-25 to AC-30**: unit test results in `@roguemouse/runbooks`
   - **AC-31 to AC-34**: unit test results in `@roguemouse/audit` + Phase 6 live verification
   - **AC-35 to AC-37**: fixture file inspection + Phase 1 unit test results
   - **AC-38 to AC-41**: Phase 6 live smoke report
   - **AC-42 to AC-44**: `pnpm -r typecheck` exit code + `package.json` diff inspection

4. Write `docs/sprints/dispatch-runtime-tools-rag/review.md`:
   - **Summary**: 1-2 paragraphs on what shipped and verdict (PASS/FAIL/PASS WITH CAVEATS).
   - **AC coverage table**: 44 rows, columns `AC#`, `verdict`, `verification method`, `notes`.
   - **Deviations from plan**: any phase-level changes (e.g., if Phase 2's regex needed adjustment, if Phase 6's pre-flight check found an unexpected permission issue).
   - **Decisions made during implementation**: any in-flight calls that operator approved.
   - **Follow-ups**: items added to `tasks/todo.md`.
   - **Demo readiness**: what's working for the eventual Scenario A demo (Sprint 4c will consume this).
   - **Final commit reference**: filled in after the commit lands.

5. Update `ROGUEMOUSE_CONTEXT.md`:
   - Mark Sprint 4b complete (date: 2026-05-16 or later, depending on when the phase actually completes).
   - Queue Sprint 4c with a one-line note on next-sprint focus (multi-agent orchestration + Synthesizer + Scenario A end-to-end).
   - Add an "Artifact" entry pinning the Sprint 4b smoke's `runId`, record count, and final hash.
   - Append any new architectural decisions (e.g., "Decision N: dispatcher serial mutex via promise-chain; parallel deferred to Sprint 7" — already in todo.md; mention as a decision in CONTEXT).

6. If Sprint 4b surfaced any anti-patterns (rare; this is a well-scoped sprint with clear dependencies), append to `tasks/lessons.md` using the template format.

7. Two-commit pattern (precedent from Sprint 3, Sprint 4a):
   - **Commit 1 — feat**: code changes from Phases 1-6 + spec.md + plan.md + review.md.
     - Subject: `feat(agent): land dispatchTool runtime, 8 tool impls, RAG index, writer.list`
     - Body explains the WHY: enables Sprint 4c's planner to compose tools end-to-end; first multi-record audit chain in the project.
     - Co-authored-by line per CLAUDE.md commit convention.
   - **Commit 2 — docs**: `ROGUEMOUSE_CONTEXT.md`, `tasks/todo.md` (already updated for Sprint 7 polish; may have additions), `tasks/lessons.md` (if new entries).
     - Subject: `docs(context): mark Sprint 4b complete, queue Sprint 4c, pin artifacts`
     - Body lists artifact runId and high-level changes.

8. Push only if operator authorizes explicitly. Per CLAUDE.md and prior sprints' precedent, never push without operator request.

### Test strategy

- Re-run the full validation suite as listed in step 1. Any failure halts the review.
- Manual operator sign-off on the review.md verdict before committing.

### Anti-patterns to avoid

- **Markdown-wrapper strip (2026-05-14)**: the review.md is a markdown file that may contain code snippets, file paths, and percent symbols. Triple-backtick fences are used; verify they survive the relay if the operator wants to paste a code block back to me for inclusion. Most likely I author the file directly via the Write tool; risk is low.

- **Sprint state drift**: `ROGUEMOUSE_CONTEXT.md` must be updated in the same session as the implementation, not deferred. Sprint 3 and Sprint 4a precedent: context update is a separate commit that lands immediately after the feat commit.

- **Opportunistic refactoring**: do not "clean up" anything noticed during review. Add to `tasks/todo.md` if worth fixing; otherwise leave alone. Sprint 4b's scope is sealed at the spec.

### Phase exit criteria

- [ ] `pnpm -r typecheck` exit 0
- [ ] `pnpm -r test` exit 0
- [ ] Phase 6 smoke PASS verified in operator console + bucket
- [ ] `review.md` written with 44-row AC coverage table and PASS verdict (or PASS WITH CAVEATS if any AC is partial)
- [ ] `ROGUEMOUSE_CONTEXT.md` updated: Sprint 4b marked complete, Sprint 4c queued, runId pinned
- [ ] Two commits authored per the precedent pattern: feat + docs
- [ ] Operator authorizes push (separate gate)

### Phase rollback

- `git restore docs/sprints/dispatch-runtime-tools-rag/review.md ROGUEMOUSE_CONTEXT.md tasks/lessons.md tasks/todo.md`
- If the two commits have been authored but not pushed, soft-reset: `git reset HEAD~2` (preserves working tree). Re-author after correction.
- If the commits have been pushed, do not force-push without operator confirmation. Most likely scenario: a follow-up commit corrects the issue.

---

## Cross-phase notes

### Lessons applied (per `tasks/lessons.md`)

- **2026-05-14 — Markdown wrappers strip leading hash and asterisk**: flagged against Phases 1, 4, 5, 6 (any phase where the operator might paste file content for me to write verbatim). Mitigation: verify on-disk content after Write tool returns; the Write tool itself is not at risk (it writes my output directly), but any operator paste through a chat relay is.

- **2026-05-14 — Conditional package exports require invocation discipline**: flagged against Phases 1, 2, 3, 4, 5, 6 (every phase that adds modules to a workspace package). Mitigation: ensure `package.json` `exports` blocks remain unconditional (or that any conditional blocks resolve correctly under tsx/Vitest default conditions). Verify by running the per-package test command after each phase.

- **2026-05-16 — Gemini OpenAI-compat shim translates RESOURCE_EXHAUSTED to HTTP 403-with-empty-body**: NOT APPLICABLE to Sprint 4b. The smoke is tool-only.

- **2026-05-16 — Free-tier gemini-2.5-pro has limit: 0 quota**: NOT APPLICABLE to Sprint 4b. The smoke is tool-only.

### Workflow gates

- After Phase 1: operator approval before Phase 2 begins.
- After Phase 2: operator approval before Phase 3 begins.
- ... and so on through Phase 7. Each phase's exit criteria are verifiable in isolation.
- Phases CAN be batched in a single Claude Code session if the operator approves a phase plan upfront, but each phase's deliverable should be verifiable before moving on. Recommended cadence: Phases 1-3 in one session (data layer), Phases 4-5 in another (tool + dispatcher layer), Phases 6-7 in a third (live + review).

### What "complete" means for Sprint 4b

When all 44 ACs are verified, the 7+ records are in the Vultr bucket, the two-commit pattern lands on `main`, and Sprint 4c can begin building on top of the dispatcher. The dispatcher is the "agent's hands"; Sprint 4c is "the agent's voice and brain." Both are needed for the Scenario A demo. Sprint 4b is the larger sprint; Sprint 4c is the wiring + the demo's narrative.

---

## Stop gate

When the plan is approved, proceed to `/implement-task` starting with Phase 1. Do not skip phases. Do not implement Phase 5 before Phase 4. Each phase has explicit operator approval gates per the workflow rules.
