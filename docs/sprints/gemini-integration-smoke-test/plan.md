# gemini-integration-smoke-test — Plan

## Reference docs

- Spec: `docs/sprints/gemini-integration-smoke-test/spec.md`
- Brainstorm: `docs/sprints/gemini-integration-smoke-test/brainstorm.md`

## Anti-patterns from tasks/lessons.md to avoid

- **2026-05-14 — Markdown wrappers strip leading hash and asterisk from fenced code blocks**.
  How this plan avoids it: every new file Sprint 4a creates is authored via the `Write` / `Edit` tools directly. The one operator-supplied verbatim string is the smoke prompt (the IV/RV anomaly description), which is locked in this plan and contains no leading `#` or `*` characters. JSDoc blocks in the new files use the standard ` * ` line prefix; not at risk under direct tool authorship.

- **2026-05-14 — Conditional package exports require invocation discipline**.
  How this plan avoids it: Sprint 4a extends `@roguemouse/inference` (existing package) with two new files plus a barrel update. No new workspace packages. The package's `exports` field stays unconditional (`{ ".": "./src/index.ts" }`); the sole change is in `src/index.ts` (the barrel). The conditional-exports trap is sidestepped entirely.

## Pre-existing baseline (locked before any Phase 1 work)

- Git: `main`, working tree clean, HEAD at `dff0161` (the Sprint 3 context-update commit).
- `pnpm -r typecheck`: clean across 8 typecheckable projects.
- `pnpm typecheck:scripts`: clean.
- `pnpm test`: 149 tests pass (145 schemas + 4 audit).
- Sprint 2 smoke and Sprint 3 re-run both PASS on record (`9767863`, `0e61f0a`).
- `tasks/lessons.md`: 2 entries. `tasks/todo.md`: 2 entries.

The plan preserves all of these. Any phase that introduces a typecheck regression or test failure is a phase that does not exit.

---

## Phase 1 — Root script wiring

### Goal

Add the `smoke:gemini` script entry to root `package.json` so `pnpm smoke:gemini` is the invocation surface, without disturbing Sprint 2's existing `pnpm smoke` (which continues to point at `scripts/smoke-vultr.ts`). Pure configuration phase — no TypeScript code changes.

### Files touched

- `package.json` (root, lines 15-23, modified) — add one entry to the `scripts` object.

### Step-by-step

1. Open root `package.json`. Locate the `scripts` object (currently has `build`, `dev`, `test`, `typecheck`, `typecheck:scripts`, `lint`, `smoke`).
2. Add `"smoke:gemini": "tsx scripts/smoke-gemini.ts"` adjacent to the existing `"smoke": "tsx scripts/smoke-vultr.ts"` line. Alphabetical-by-key ordering puts it just below `smoke`; either order is acceptable.
3. Save. No `pnpm install` needed — no dependencies changed.
4. Run `pnpm -r typecheck` and `pnpm typecheck:scripts` to confirm nothing breaks.

### Test strategy

- `pnpm -r typecheck`: clean (no code changes).
- `pnpm typecheck:scripts`: clean.
- `pnpm smoke:gemini`: NOT YET RUN. The runner script doesn't exist until Phase 3.

### Anti-patterns to avoid

- **Markdown-fenced-block corruption**: not applicable (one-line JSON edit via Edit tool).
- **Conditional package exports**: not applicable.

### Phase 1 exit criteria

- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm typecheck:scripts` clean.
- [ ] Root `package.json` has the new `smoke:gemini` script entry.
- [ ] Git working tree shows exactly one modified file (`package.json`).

### Phase 1 rollback

```
git restore package.json
```

No production state affected.

---

## Phase 2 — Gemini client + chat completion in `@roguemouse/inference`

### Goal

Add Gemini-specific factory and wrapper alongside the Vultr-oriented files in `@roguemouse/inference`. Both providers will live as sibling files in the same package, sharing the `InferenceResult<T>` envelope, the `ChatCompletionArgs` / `ChatCompletionData` types from `types.ts`, and (per the Phase 2 amendment) a newly-extracted shared `classifyInferenceError` from `errors.ts`. The Sprint 2 `chatCompletion.ts` gets a minimal-scope refactor: its file-local `classifyInferenceError` is moved out to the new `errors.ts` and re-imported. The Sprint 2 *runtime behavior* is byte-identical pre- and post-extraction.

### Files touched

- `packages/inference/src/errors.ts` (new) — `classifyInferenceError`, extracted from `chatCompletion.ts`. Mirrors the `packages/audit/src/errors.ts` precedent (which holds `classifyS3Error`).
- `packages/inference/src/chatCompletion.ts` (lines 110-163 deleted + 1 import line added, modified) — drops the file-local `classifyInferenceError` and imports it from `./errors.js`. The exported `chatCompletion` function body is unchanged.
- `packages/inference/src/geminiClient.ts` (new) — `createGeminiClient` factory.
- `packages/inference/src/geminiChatCompletion.ts` (new) — wrapped chat completion function with `max_tokens` default 1000; imports `classifyInferenceError` from `./errors.js`.
- `packages/inference/src/index.ts` (lines 1-15, modified) — add re-exports for the new factory and chat completion function.

### Step-by-step

1. **Create `packages/inference/src/errors.ts`**. Move the `classifyInferenceError` function body from `chatCompletion.ts:110-163` verbatim. Add `export` to the function declaration. JSDoc on the file explains the rationale: provider-agnostic error classification for `@roguemouse/inference`, mirroring `packages/audit/src/errors.ts`'s `classifyS3Error` precedent. The function signature, body, and behavior are byte-identical to what existed in `chatCompletion.ts`.

2. **Update `packages/inference/src/chatCompletion.ts`**. Remove lines 110-163 (the `classifyInferenceError` function and its JSDoc). Add an import near the top:

   ```typescript
   import { classifyInferenceError } from "./errors.js";
   ```

   The call site at line 92 (`return { ok: false, error: classifyInferenceError(err) };`) is unchanged — the function is now resolved through the import rather than file-locally.

3. **Create `packages/inference/src/geminiClient.ts`**. Exports `createGeminiClient(config: InferenceClientConfig): OpenAI`. Body constructs an `OpenAI` SDK instance with the supplied `apiKey` and `baseURL`. Structurally near-identical to the existing `createInferenceClient` factory (since the factory already accepts arbitrary `apiKey` + `baseURL`); a separate symbol exists for reader clarity at Gemini call sites and to give future Gemini-specific behavior a natural home (e.g., default `extra_body` for thinking-mode control if Sprint 7 needs it). JSDoc explicitly references Sprint 4a Brainstorm Decision 1B and the Gemini compat endpoint URL.

4. **Create `packages/inference/src/geminiChatCompletion.ts`**. Exports `async function geminiChatCompletion(client: OpenAI, args: ChatCompletionArgs): Promise<InferenceResult<ChatCompletionData>>`. Body is structurally identical to the existing `chatCompletion` function in `chatCompletion.ts:32-94`, with one difference: `const DEFAULT_MAX_TOKENS = 1000` instead of `500` (Gemini reasoning responses are longer than Sprint 2's Vultr smoke responses). Imports `classifyInferenceError` from `./errors.js` rather than declaring its own copy. JSDoc notes the shared classifier and the higher max-tokens default vs the Vultr path.

5. **Update `packages/inference/src/index.ts`**. Append:

   ```typescript
   export { createGeminiClient } from "./geminiClient.js";
   export { geminiChatCompletion } from "./geminiChatCompletion.js";
   ```

   The existing exports (`createInferenceClient`, `chatCompletion`, types) are unchanged. The Gemini exports go below the Vultr ones for source-file readability. The new `classifyInferenceError` is NOT re-exported from the barrel — it's a package-internal helper, same as it was before extraction.

6. Run `pnpm -r typecheck` — must be clean. The Sprint 2 `chatCompletion.ts` still resolves `classifyInferenceError` (now through the import); the new Gemini files resolve their imports cleanly; the barrel adds two symbols.

7. Run `pnpm test`. The `@roguemouse/inference` package has no unit tests (`passWithNoTests` per `package.json:14`); test suites in other packages should pass unchanged. Sprint 2's smoke runtime path is byte-identical (same classifier function, same call site, same behavior); a fresh `pnpm smoke` run would still PASS, though running it is not required for Phase 2 exit.

### Test strategy

- `pnpm -r typecheck` — clean across all 8 workspace projects.
- `pnpm typecheck:scripts` — clean.
- `pnpm test` — 149 tests pass (unchanged from baseline; no new test files added in this phase).
- No live LLM call in Phase 2 (Phase 4 owns the live run).
- Sprint 2 runtime invariant: `chatCompletion`'s public behavior (signature, return shape, error-classification logic) is byte-identical to baseline. The extraction is a relocation, not a rewrite.

### Anti-patterns to avoid

- **Markdown-fenced-block corruption**: not applicable (TypeScript content authored via Write/Edit).
- **Conditional package exports**: not applicable.
- **Behavior drift during extraction**: the `classifyInferenceError` function body moves byte-for-byte. No "while we're at it" cleanup of the function itself. The only allowed deltas are the `export` keyword and the file location.
- **Premature abstraction**: not applicable. Two concrete consumers (`chatCompletion` and `geminiChatCompletion`) plus the audit-package precedent (`classifyS3Error`) make the extraction justified, not speculative.

### Phase 2 exit criteria

- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm typecheck:scripts` clean.
- [ ] `pnpm test` passes (149 tests; no new test files yet).
- [ ] Three new files exist: `errors.ts`, `geminiClient.ts`, `geminiChatCompletion.ts`.
- [ ] `packages/inference/src/chatCompletion.ts` no longer contains the `classifyInferenceError` function body; it imports the symbol from `./errors.js`. The exported `chatCompletion` function is otherwise byte-unchanged.
- [ ] `packages/inference/src/index.ts` exports `createGeminiClient` and `geminiChatCompletion`. It does NOT export `classifyInferenceError` (package-internal helper).
- [ ] `packages/inference/src/client.ts` and `types.ts` are byte-unchanged from baseline.
- [ ] No `tasks/todo.md` entry added (the duplication is resolved by extraction, not deferred).

### Phase 2 rollback

```
git restore packages/inference/src/index.ts packages/inference/src/chatCompletion.ts
git clean -f packages/inference/src/errors.ts packages/inference/src/geminiClient.ts packages/inference/src/geminiChatCompletion.ts
```

No production state affected. No live call yet.

---

## Phase 3 — Smoke runner script (`scripts/smoke-gemini.ts`)

### Goal

Create the smoke runner that orchestrates the live end-to-end test: one Gemini call → build `risk_officer:reasoning` payload → write via `RunAuditWriter.append` → read back → verify hash + genesis. Mirrors the 6-step main flow of `scripts/smoke-vultr.ts` with provider-specific differences for Gemini.

### Files touched

- `scripts/smoke-gemini.ts` (new, ~370 lines based on `smoke-vultr.ts:1-373` structure).

### Step-by-step

1. **Create `scripts/smoke-gemini.ts`**. Copy the overall structure of `scripts/smoke-vultr.ts` (bootstrap → env validation → locked constants → helpers → main flow → catch). Adapt for Gemini.

2. **Bootstrap section** (`scripts/smoke-vultr.ts:1-52` analog): identical — Node built-ins import, dotenv load from `.env.local` at repo root, same `__dirname` / `existsSync` / `loadDotenv` pattern. The error message in the missing-`.env.local` branch enumerates the three required vars **for Sprint 4a** (`GEMINI_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) — note that `VULTR_INFERENCE_API_KEY` is NOT required for the Gemini smoke.

3. **Env validation section** (`smoke-vultr.ts:54-103` analog):
   - `REQUIRED_VARS`: `["GEMINI_API_KEY", "S3_ACCESS_KEY", "S3_SECRET_KEY"]`.
   - One-pass missing-var collection with `missing` list and exit-on-any-missing reporting (identical pattern).
   - The "Populate the missing variables" hint block maps each var to a password-manager entry. For `GEMINI_API_KEY` the message is **special-cased** to include `https://aistudio.google.com/apikey` per spec AC-03, rather than a password-manager entry (operator action: generate the key from Google AI Studio first).

4. **Locked constants section** (`smoke-vultr.ts:104-124` analog):
   ```typescript
   const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
   const S3_ENDPOINT = "https://ams1.vultrobjects.com";
   const S3_REGION = "ams1";
   const S3_BUCKET = "roguemouse-audit-log";

   const DEFAULT_RISK_MODEL = "gemini-2.5-pro";
   const envModel = process.env.GEMINI_RISK_MODEL?.trim();
   const RISK_MODEL = envModel && envModel.length > 0 ? envModel : DEFAULT_RISK_MODEL;

   const SMOKE_PROMPT =
     "IV/RV ratio is 0.42 for AAPL at 09:31:14 UTC; the project's low-bound threshold is 0.45. Diagnose in 2-3 sentences.";

   const RECORD_TYPE = "risk_officer:reasoning";

   /**
    * Synthetic confidence value for the Sprint 4a smoke test. Real
    * confidence-extraction logic is Sprint 4b's responsibility (the
    * Risk Officer voice will derive confidence from the model's response
    * via system-prompt coaching or response-feature heuristics). For the
    * smoke test, this fixed value indicates "the smoke ran; the audit
    * record's confidence is not a real model confidence."
    */
   const SMOKE_CONFIDENCE = 5000;
   ```

5. **Helpers section** (`smoke-vultr.ts:128-176` analog):
   - `failNoState(step, message, details)`: duplicated verbatim from `smoke-vultr.ts:144-157`.
   - `failWithState(step, message, state, details)`: duplicated verbatim from `smoke-vultr.ts:159-176`.
   - **No `truncate500`** — the smoke prompt is ~120 characters and `payload.input.prompt` has no max-length constraint at the schema layer. The Risk Officer reasoning response is captured verbatim into `payload.reasoning`.

6. **Main flow** (`smoke-vultr.ts:181-371` analog):

   **Step 1 — Construct Gemini client:**
   ```typescript
   const geminiClient = createGeminiClient({
     apiKey: env.GEMINI_API_KEY,
     baseURL: GEMINI_BASE_URL,
   });
   ```

   **Step 2 — Gemini chat completion (timed):**
   ```typescript
   const inferenceStart = performance.now();
   const inferenceResult = await geminiChatCompletion(geminiClient, {
     model: RISK_MODEL,
     messages: [{ role: "user", content: SMOKE_PROMPT }],
     maxTokens: 1000,
   });
   const inferenceMs = Math.round(performance.now() - inferenceStart);

   if (!inferenceResult.ok) {
     failNoState("inference", inferenceResult.error.message, {
       code: inferenceResult.error.code,
       retryable: inferenceResult.error.retryable,
     });
   }
   ```

   **Step 3 — Build `risk_officer:reasoning` payload:**
   ```typescript
   const payload = {
     input: {
       prompt: SMOKE_PROMPT,
       model: inferenceResult.data.model,
     },
     reasoning: inferenceResult.data.content,
     confidence: SMOKE_CONFIDENCE,
     durationMs: inferenceMs,
     tokens: {
       prompt: inferenceResult.usage.promptTokens,
       completion: inferenceResult.usage.completionTokens,
       total: inferenceResult.usage.totalTokens,
     },
   };
   ```

   No separate `safeParse` step against the payload schema — the writer's internal `auditRecordBodySchema.safeParse` (per Sprint 3 Phase 4) covers it. If the payload is malformed, `writer.append` returns `{ ok: false, error: { code: "validation_error", step: "validate" } }`.

   **Step 4 — Construct S3 client + RunAuditWriter** (identical to `smoke-vultr.ts:238-253`):
   ```typescript
   const s3Client = createS3Client({
     endpoint: S3_ENDPOINT,
     region: S3_REGION,
     accessKeyId: env.S3_ACCESS_KEY,
     secretAccessKey: env.S3_SECRET_KEY,
   });

   const writer = new RunAuditWriter({
     s3Client,
     bucket: S3_BUCKET,
     runId,
     canonicalize,
     sha256Hex,
   });
   ```

   **Step 5 — Append (S3 PUT)** (identical pattern to `smoke-vultr.ts:255-268`):
   ```typescript
   const putStart = performance.now();
   const appendResult = await writer.append({
     ts: new Date().toISOString(),
     recordType: RECORD_TYPE,
     payload,
   });
   const s3PutMs = Math.round(performance.now() - putStart);

   if (!appendResult.ok) {
     failNoState(appendResult.error.step ?? "s3_put", appendResult.error.message, {
       code: appendResult.error.code,
       retryable: appendResult.error.retryable,
     });
   }
   ```

   **Step 6 — Read back (S3 GET) + round-trip verify** (identical pattern to `smoke-vultr.ts:273-341`): identical to the Vultr smoke verbatim — `writer.read(key)`, re-canonicalize, recompute hash, assert hash equality, assert `previousHash === GENESIS_HASH`.

7. **PASS report** (mirrors `smoke-vultr.ts:343-368`):
   ```
   === PASS ===
   runId           : <UUID>
   s3 key          : audit/<runId>/<ts-safe>-<hash>.json
   recordHash      : <64-char hex>
   previousHash    : <64-char hex>
   matches genesis : true

   promptTokens    : <int>
   completionTokens: <int>
   totalTokens     : <int>

   inferenceMs     : <Nms>
   s3PutMs         : <Nms>
   s3GetMs         : <Nms>
   hashVerifyMs    : <Nms>
   totalMs         : <Nms>

   Round-trip integrity verified.
   previousHash matches the audit-log genesis.
   Token usage recorded in audit payload.
   ```

8. **Top-level catch** (mirrors `smoke-vultr.ts:373-382`): identical — catches unexpected top-level errors, prints `=== FAIL ===` with step `unexpected_top_level`, exits 1.

9. Run `pnpm -r typecheck` and `pnpm typecheck:scripts` — must be clean.

### Test strategy

- `pnpm -r typecheck`: clean.
- `pnpm typecheck:scripts`: clean. The new script imports `createGeminiClient`, `geminiChatCompletion` (Phase 2 exports), and unchanged symbols from `@roguemouse/audit` + `@roguemouse/schemas`.
- `pnpm smoke:gemini`: **NOT RUN IN PHASE 3.** That's Phase 4. Phase 3's exit is "compiles cleanly," not "runs successfully."
- Sprint 2's `pnpm smoke` continues to work — verified by the fact that no file Sprint 2 owns is modified.

### Anti-patterns to avoid

- **Markdown-fenced-block corruption**: the `SMOKE_PROMPT` string is locked in this plan and contains no `#` or `*` characters at line starts. The prompt is the only operator-supplied verbatim content; risk is mitigated.
- **Conditional package exports**: not applicable.
- **Re-introducing `truncate500`**: the payload's `input.prompt` and `reasoning` fields have no max-length constraint. Sprint 2's `truncate500` was for the `smoke_test:chat_completion` payload's 530-char ceiling. The `risk_officer:reasoning` payload has no analog; do not add one.

### Phase 3 exit criteria

- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm typecheck:scripts` clean.
- [ ] `scripts/smoke-gemini.ts` exists and compiles.
- [ ] Sprint 2's `scripts/smoke-vultr.ts` is byte-unchanged.
- [ ] Sprint 2's `pnpm smoke` invocation path still works (verified by typecheck; no need to run live).

### Phase 3 rollback

```
git clean -f scripts/smoke-gemini.ts
```

No live call yet; no production state affected.

---

## Phase 4 — Pre-flight + live run

### Goal

Run `pnpm smoke:gemini` against real Gemini + real Vultr, verify PASS exit 0 + valid audit record, and capture the new record's identifiers as the Sprint 4a verification artifact.

### Files touched

None. This phase is pure execution.

### Step-by-step

1. **Pre-flight — operator action**:
   - Confirm `.env.local` exists at the repo root.
   - Confirm `S3_ACCESS_KEY` and `S3_SECRET_KEY` are populated (from Sprint 2).
   - Populate `GEMINI_API_KEY` with a valid key from `https://aistudio.google.com/apikey`. If a key already exists in the password manager from prior work, reuse it; otherwise generate a new one with API access enabled.
   - `GEMINI_RISK_MODEL` is optional (defaults to `gemini-2.5-pro`); leave unset for the first run.

2. **Run the live smoke**:
   ```
   pnpm smoke:gemini
   ```

   The runner's own env-validation block (per spec AC-02 through AC-05) is the canonical pre-flight check. No external sanity command is needed; if a var is missing, the runner exits non-zero with a structured error before any API call.

3. **Verify the output**:
   - Exit code 0 (`echo $?` on bash, or check `$LASTEXITCODE` on PowerShell).
   - `=== PASS ===` header visible.
   - `runId` is a UUIDv4 (regex `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).
   - `s3 key` matches `audit/<runId>/<ISO-ms-with-dashes>-<64-char-hex>.json`.
   - `recordHash` is 64-char lowercase hex.
   - `previousHash` equals `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc` (the genesis constant, identical to Sprint 2's "patient zero" and Sprint 3's "second patient zero").
   - `matches genesis : true`.
   - Token counts are positive integers.
   - Elapsed times are integer-millisecond strings (`<N>ms` format).
   - `Round-trip integrity verified.` line is present.

4. **Capture the verification artifact**: record the new audit record's `runId`, `s3 key`, `recordHash`, and `previousHash` for inclusion in Phase 5's `review.md` and the subsequent `ROGUEMOUSE_CONTEXT.md` update. This record is the third audit record overall and the **first ever `risk_officer:reasoning` record** in the `roguemouse-audit-log` bucket.

5. **On FAIL** (any non-zero exit, any assertion failure):
   - Capture full stdout/stderr.
   - Identify the `step` field in the FAIL output (e.g., `inference`, `s3_put`, `s3_get`, `hash_verify`).
   - Do **not** retry without operator review. A consistent failure is a Sprint 4a regression; a transient (network, rate-limit) failure may warrant a retry per the spec's edge-case posture.
   - Report the failure analysis with hypothesis about root cause. Possible causes to investigate first:
     - `GEMINI_API_KEY` invalid or not authorized for the model → 401/403 from Gemini, error code `http_401` or similar.
     - `GEMINI_RISK_MODEL` not available to this key → 404, error code `http_404`.
     - Safety block on the IV/RV prompt → `code: "empty_response"`, `retryable: true`. Unexpected; if it fires, the smoke prompt may need a system-prompt prefix or rewording.
     - Vultr S3 transient → standard Sprint 2/3 failure modes, retryable.

### Test strategy

- The live run **is** the test for Phase 4.
- All 27 acceptance criteria that depend on the live run (AC-06 through AC-25) are validated by this single execution + the captured output.

### Anti-patterns to avoid

- **Retrying on the first failure**: don't. Operator review owns retry decisions.
- **Committing `.env.local`**: gitignored; never `git add -f` it.
- **Skipping the verification artifact capture**: the new audit record's identifiers are the durable proof of Sprint 4a's success and must land in `review.md` and `ROGUEMOUSE_CONTEXT.md`.

### Phase 4 exit criteria

- [ ] `pnpm smoke:gemini` exits 0.
- [ ] PASS report visible with all fields populated.
- [ ] New audit record's `previousHash` = `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`.
- [ ] Round-trip integrity verified (the PASS report's "Round-trip integrity verified." line confirms).
- [ ] The new record's `runId`, `s3 key`, `recordHash` captured for review.
- [ ] AC-06 through AC-25 all hold.

### Phase 4 rollback

At the code level: revert prior phases via `git restore` / `git clean`. At the bucket level: nothing to do — the live record is immutable and harmless (own `runId`, own one-record chain rooted at genesis, same model as Sprints 2 and 3).

---

## Phase 5 — Review (`/review-task`)

### Goal

Independently verify every AC against on-disk code + live run output. Produce `docs/sprints/gemini-integration-smoke-test/review.md` mapping each AC to evidence. Identify any partial-PASS or deviation.

### Files touched

- `docs/sprints/gemini-integration-smoke-test/review.md` (new).

### Step-by-step

1. Re-read the spec; confirm the AC count is 27 (AC-01 through AC-27).
2. For each AC, locate evidence:
   - AC-01 through AC-05 (env-var handling): read `scripts/smoke-gemini.ts` env-validation block.
   - AC-06 through AC-09 (Gemini call): cross-reference Phase 4's PASS report + `scripts/smoke-gemini.ts` step-2 implementation.
   - AC-10 through AC-17 (audit record + payload): read `scripts/smoke-gemini.ts` step-3 payload construction; confirm against `packages/schemas/src/auditPayloads.ts:105-113` (the locked `riskOfficerReasoningPayload` schema).
   - AC-18 through AC-21 (hash chain): cross-reference Phase 4's PASS report's `recordHash`, `previousHash`, `matches genesis` lines.
   - AC-22 through AC-25 (PASS/FAIL semantics): inspect `scripts/smoke-gemini.ts` exit codes, error helpers, PASS report format.
   - AC-26 (typecheck): run `pnpm -r typecheck && pnpm typecheck:scripts`.
   - AC-27 (script entry): read root `package.json` scripts section.
3. Write the review document mirroring Sprint 3's `review.md` structure: AC verdict table + architectural review + issues + overall verdict.
4. Note Phase 4's live-run artifact (the third audit record's identifiers) in the review.
5. Identify deviations (expected: just the documented duplication of `classifyInferenceError` — already captured in `tasks/todo.md` per Phase 2).

### Test strategy

No new tests in Phase 5. The verification re-runs typecheck + cross-references the live run output.

### Anti-patterns to avoid

- **Hand-waving on partial PASS**: every AC gets a binary verdict + evidence. "Likely passes" is not acceptable.
- **Skipping the context update**: `ROGUEMOUSE_CONTEXT.md` update for Sprint 4a happens in a follow-up commit (analogous to Sprint 3's commit `dff0161`). Phase 5 itself doesn't modify the context file; that's the follow-up doc-only commit after the feat commit lands.

### Phase 5 exit criteria

- [ ] `review.md` exists and ratifies all 27 ACs (or explicitly flags exceptions).
- [ ] Phase 4's verification artifact (runId, hash, S3 key, recordHash) cited in the review.
- [ ] `pnpm -r typecheck` re-confirmed clean.
- [ ] `pnpm test` re-confirmed passing.
- [ ] Operator approves the review verdict.

### Phase 5 rollback

```
git clean -f docs/sprints/gemini-integration-smoke-test/review.md
```

No runtime impact.

---

## Commit policy

Sprint 4a follows the Sprint 2 + Sprint 3 precedent: **single commit per sprint** after `/review-task` passes. Per-phase commits are NOT used. The commit message follows Conventional Commits:

- First line: `feat(inference): add Gemini integration smoke test` (under 72 chars).
- Body: structured per Sprint 3's commit-message style, including the new audit record's `runId` and `recordHash` from Phase 4 as the verification artifact.

After the feat commit lands, a **separate small commit** updates `ROGUEMOUSE_CONTEXT.md` (analogous to Sprint 3's `dff0161` follow-up): marks Sprint 4a ✅ Complete, adds the third audit record to the Artifacts section, queues Sprint 4b. The two-commit pattern keeps the feat commit clean and the doc update reviewable independently.

---

## Final verification

After all five phases complete:

- [ ] `pnpm -r typecheck` clean across all 8 workspace projects.
- [ ] `pnpm typecheck:scripts` clean.
- [ ] `pnpm test` passes (149 tests; no new tests added in Sprint 4a).
- [ ] `pnpm smoke` (Sprint 2 Vultr smoke) — would still PASS (not required to re-run, but invariant).
- [ ] `pnpm smoke:gemini` — PASSes against real Gemini + real Vultr (Phase 4 ran this once).
- [ ] All 27 ACs documented as PASS in `review.md`.
- [ ] `tasks/todo.md` has the new entry tracking the `classifyInferenceError` duplication.
- [ ] No `package.json` direct-dependency changes (zero new deps).
- [ ] No modifications to `packages/inference/src/chatCompletion.ts`, `client.ts`, `types.ts` (Sprint 2 code untouched).
- [ ] No modifications to `scripts/smoke-vultr.ts` (Sprint 2 runner untouched).
- [ ] No modifications to `packages/schemas/`, `packages/audit/` (Sprint 3 locked artifacts untouched).
- [ ] New audit record landed in `roguemouse-audit-log` bucket with `previousHash` = genesis, `recordType` = `risk_officer:reasoning`.

---

## Stop gate

When the plan is approved, proceed to `/implement-task`. Do not begin writing code before approval.
