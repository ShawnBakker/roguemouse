# gemini-integration-smoke-test — Review

Independent verification of Sprint 4a against the spec's 27 acceptance criteria, the project's hard rules in `.claude/rules/*.md` and `CLAUDE.md`, and the live `pnpm smoke:gemini` PASS report from Phase 4. Every AC was checked by reading the actual code on disk; per-phase implementation reports were not trusted. The Phase 4 live run produced the third audit record overall (runId `0ca812ef-3214-4e98-ad43-9b1fddbdd4aa`) and the first-ever `risk_officer:reasoning` record in `roguemouse-audit-log`.

## Acceptance criteria verdict

| AC | Verdict | Evidence |
|---|---|---|
| AC-01 | ✅ PASS | Root `package.json:22-23` exposes both `"smoke": "tsx scripts/smoke-vultr.ts"` (unchanged from Sprint 2) and `"smoke:gemini": "tsx scripts/smoke-gemini.ts"` (new). `git diff HEAD -- scripts/smoke-vultr.ts` returns empty — Sprint 2's runner is byte-unchanged. |
| AC-02 | ✅ PASS | `scripts/smoke-gemini.ts:32-43` — when `.env.local` is missing, the runner prints `=== FAIL === step: env_load` with the missing file path and exits 1 (`process.exit(1)` at line 42). |
| AC-03 | ✅ PASS | `scripts/smoke-gemini.ts:88-104` — when any required var is missing, the runner prints `=== FAIL === step: env_validation` and exits 1. The hint loop on line 98 emits `GEMINI_API_KEY → generate at https://aistudio.google.com/apikey` per the spec's special-cased Google-AI-Studio URL. |
| AC-04 | ✅ PASS | `scripts/smoke-gemini.ts:72` lists `S3_ACCESS_KEY` in `REQUIRED_VARS`; the missing-var loop at line 99 emits the password-manager hint. Same code path as AC-03. |
| AC-05 | ✅ PASS | `scripts/smoke-gemini.ts:73` lists `S3_SECRET_KEY` in `REQUIRED_VARS`; hint at line 100. Same code path as AC-03/04. |
| AC-06 | ✅ PASS | `scripts/smoke-gemini.ts:115` pins `GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"`. Lines 121-123 implement env-driven model with `DEFAULT_RISK_MODEL = "gemini-2.5-pro"`. Lines 197-208 make exactly one call via `geminiChatCompletion(geminiClient, ...)`. Phase 4 live PASS shows `model : gemini-2.5-flash` (env-driven override worked). |
| AC-07 | ✅ PASS | `packages/inference/src/geminiChatCompletion.ts:62-72` returns `{ ok: false, error: { code: "empty_response", retryable: true } }` if `choice?.message?.content` is not a non-empty string. Phase 4 live PASS continued past this check (the smoke prompt got a non-empty completion; `completionTokens: 40`). |
| AC-08 | ✅ PASS | `packages/inference/src/geminiChatCompletion.ts:74-93` validates `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens` are non-negative integers; returns `{ code: "malformed_response", retryable: false }` if not. Phase 4 live PASS reports `promptTokens: 49, completionTokens: 40, totalTokens: 1045` — all non-negative integers. |
| AC-09 | ✅ PASS | `scripts/smoke-gemini.ts:202-208` captures `inferenceStart = performance.now()` before the call and `inferenceMs = Math.round(performance.now() - inferenceStart)` after. `Math.round` produces an integer. Phase 4 live PASS reports `inferenceMs : 5059ms`. |
| AC-10 | ✅ PASS | The writer's `safeParse` against `auditRecordBodySchema` (Sprint 3 `runAuditWriter.ts:112`) enforces `.strict()` on every union branch via `defineAuditRecord`'s schema (Sprint 3 `auditRecord.ts:100`). The smoke runner constructs only `ts`, `recordType`, `payload` in its `AppendInput` (`scripts/smoke-gemini.ts:257-261`); the writer adds `runId` and `previousHash`. Exactly five envelope fields, no extras. |
| AC-11 | ✅ PASS | `scripts/smoke-gemini.ts:258` uses `new Date().toISOString()`. The schema validates against `ISO_TIMESTAMP_MS_REGEX` (Sprint 3 `auditRecord.ts:89`). Phase 4 live PASS s3-key timestamp portion (`2026-05-16T21-42-34.772Z`, with colons converted to dashes per the locked `ts-safe` form) confirms valid ISO ms format. |
| AC-12 | ✅ PASS | `scripts/smoke-gemini.ts:191` calls `randomUUID()` (Node's `node:crypto`). Phase 4 live PASS `runId : 0ca812ef-3214-4e98-ad43-9b1fddbdd4aa` — version digit `4` at position 14 (the start of the third hyphen-separated group), confirming UUIDv4. |
| AC-13 | ✅ PASS | `scripts/smoke-gemini.ts:128` — `const RECORD_TYPE = "risk_officer:reasoning" as const`. Passed to `writer.append` at line 259. The writer's discriminated-union `safeParse` accepts only literals from `RECORD_TYPES`; `risk_officer:reasoning` is line 33 of `packages/schemas/src/auditRecord.ts`. |
| AC-14 | ✅ PASS | `packages/audit/src/runAuditWriter.ts:73` (Sprint 2) sets `this.lastHash = GENESIS_HASH` in the constructor. The first (and only) `append` uses this as `previousHash` (line 108). Phase 4 live PASS reports `previousHash : b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc` (the locked genesis) and `matches genesis : true`. |
| AC-15 | ✅ PASS | `packages/audit/src/runAuditWriter.ts:112` calls `auditRecordBodySchema.safeParse(record)`. The Sprint 3 discriminated union includes `defineAuditRecord("risk_officer:reasoning", riskOfficerReasoningPayload)` at `auditRecord.ts:129`. The `riskOfficerReasoningPayload` is at `auditPayloads.ts:105-113` (5 strict fields: input, reasoning, confidence, durationMs, tokens). The Phase 4 PASS proves validation succeeded. |
| AC-16 | ✅ PASS | `scripts/smoke-gemini.ts:225-228` constructs `payload.input = { prompt: SMOKE_PROMPT, model: inferenceResult.data.model }`. `SMOKE_PROMPT` is the locked IV/RV anomaly string (non-empty). `inferenceResult.data.model` is non-empty (Phase 4 PASS reports a model identifier echo). |
| AC-17 | ✅ PASS | `scripts/smoke-gemini.ts:138` — `const SMOKE_CONFIDENCE = 5000;` with JSDoc on lines 130-137 documenting the synthetic value. Line 230 — `confidence: SMOKE_CONFIDENCE`. |
| AC-18 | ✅ PASS | `packages/audit/src/runAuditWriter.ts:127` (Sprint 2) calls `this.canonicalize(parseResult.data)`; line 141 calls `this.sha256Hex(canonicalJson)`. The smoke runner injects `canonicalize` (from `@roguemouse/schemas`) and `sha256Hex` (from `@roguemouse/audit`) at `smoke-gemini.ts:251-252`. Phase 4 live PASS reports `recordHash : a02091694720ccd80831f2283315a1ee89c1efa07eb47635d4ab225f2a9303dc` (64-char lowercase hex). |
| AC-19 | ✅ PASS | `packages/audit/src/runAuditWriter.ts:32-34` builds the key as `audit/{runId}/{tsSafe(ts)}-{hash}.json`. Phase 4 live PASS s3 key matches this exactly: `audit/0ca812ef-3214-4e98-ad43-9b1fddbdd4aa/2026-05-16T21-42-34.772Z-a020...json`. The read-back happens at `smoke-gemini.ts:276` — `writer.read(appendResult.data.key)`. PASS report shows both `s3 put complete` and `s3 get complete`. |
| AC-20 | ✅ PASS | `scripts/smoke-gemini.ts:298-322` re-canonicalizes the read-back parsed body and recomputes the hash, then asserts `recomputedHash === appendResult.data.hash`. Phase 4 live PASS line "Round-trip integrity verified." confirms the equality held. |
| AC-21 | ✅ PASS | `scripts/smoke-gemini.ts:324-340` extracts `previousHash` from the read-back parsed body and asserts equality with `GENESIS_HASH`. Phase 4 live PASS line "previousHash matches the audit-log genesis." confirms. |
| AC-22 | ✅ PASS | `scripts/smoke-gemini.ts:369` — `process.exit(0)` after the PASS report. Phase 4 live run returned exit code 0. |
| AC-23 | ✅ PASS | `scripts/smoke-gemini.ts:347-367` prints the structured PASS report with all required fields. Phase 4 live PASS verified each field: runId, s3 key, recordHash, previousHash, `matches genesis` boolean, promptTokens, completionTokens, totalTokens, inferenceMs, s3PutMs, s3GetMs, hashVerifyMs, totalMs (all `Nms` integers via `Math.round`). |
| AC-24 | ✅ PASS | `scripts/smoke-gemini.ts:152-164` (`failNoState`) and `:166-183` (`failWithState`) both print `=== FAIL ===`, the step, the error code/message, and call `process.exit(1)`. Confirmed in the Phase 4 first attempt (the `gemini-2.5-pro` quota 403): exit 1, `step : inference`, `code : http_403`, `retryable: false` printed to stderr. |
| AC-25 | ✅ PASS | `packages/audit/src/runAuditWriter.ts` (Sprint 2) class exposes only `append` and `read` methods — no `delete`, no `list`. `scripts/smoke-gemini.ts:175` includes the `(PRESERVED — not deleted per AC-25)` annotation in the `failWithState` output, mirroring Sprint 2's posture. By construction, the runner cannot delete the record. |
| AC-26 | ✅ PASS | `pnpm -r typecheck` clean across all 8 workspace projects (verified at the end of every phase + just now during review). `pnpm typecheck:scripts` clean. Sprint 3 baseline was 0 errors; Sprint 4a maintains 0 errors. |
| AC-27 | ✅ PASS | Root `package.json:23` — `"smoke:gemini": "tsx scripts/smoke-gemini.ts"`. Line 22 — `"smoke": "tsx scripts/smoke-vultr.ts"` unchanged (verified by `git diff` returning empty for that file). |

**27 of 27 ACs PASS.**

---

## Architectural review

### Fail-open paths

**None found.** Every failure mode in `scripts/smoke-gemini.ts` flows through `failNoState` or `failWithState`, both of which `process.exit(1)`. No code path silently accepts a malformed response, a hash mismatch, a missing env var, or an S3 failure. The runner's exit code is the canonical PASS/FAIL signal; the structured stdout report carries the diagnostic detail.

### Audit log integrity

**Preserved.** Specific evidence:

- **Chain invariant**: `RunAuditWriter` (Sprint 2 code, unchanged) initializes `lastHash = GENESIS_HASH` per construction. The Phase 4 live record's `previousHash` equals `b44adada...` — the same genesis constant as Sprint 2's first record and Sprint 3's second record. All three records are one-record chains rooted at the same genesis seed.
- **No delete or list API**: Sprint 4a added zero methods to `RunAuditWriter`. The writer's surface remains `append` + `read` only.
- **No overwrite paths**: keys are content-addressed (`audit/{runId}/{ts-safe}-{hash}.json`). The same record content produces the same key; modified content produces a different key. Smoke-runner code never reuses a `runId` (`randomUUID()` per invocation at `smoke-gemini.ts:191`).
- **Canonicalization unchanged**: the new audit record went through the same `canonicalize` function from `@roguemouse/schemas` (Sprint 3 relocation, byte-stable per AC-27 of Sprint 3). No drift.

### LLM client error handling

**Envelope discipline maintained.** Grep for top-of-line `throw` statements in `packages/inference/src`: **no matches.**

The new `geminiChatCompletion.ts` mirrors `chatCompletion.ts`'s envelope discipline:
- `try { ... } catch (err: unknown) { return { ok: false, error: classifyInferenceError(err) }; }` at lines 53-110 — every thrown error from the SDK is caught and classified.
- Empty content → structured `empty_response` error (line 62-71).
- Malformed token usage → structured `malformed_response` error (line 74-93).
- HTTP, network, timeout errors → classified by the shared `classifyInferenceError` in `errors.ts`.

The shared classifier is used by both `chatCompletion.ts:3` and `geminiChatCompletion.ts:3` — same call path, same return shape.

### Vercel-specific features

**None found.** Grep for `vercel`, `@vercel`, `next/image` (case-insensitive) across `packages/inference`: no matches. Sprint 4a did not touch `apps/web/` or introduce any frontend code.

### Code provenance (no Meridian references in source)

**Verified.** Grep for `Meridian|meridian` across `packages/inference` and `scripts`: no matches. All Sprint 4a source is original. The carry-over Meridian references in `.claude/rules/hackathon.md` are policy text describing what is forbidden, tracked in `tasks/todo.md` for pre-submission sweep.

### Schema discipline

**No new Zod schemas in Sprint 4a.** The runner reuses Sprint 3's locked `riskOfficerReasoningPayload` via the writer's internal `safeParse`. `scripts/smoke-gemini.ts` constructs a plain object literal at lines 224-237 matching that schema's 5-field shape; validation happens inside `RunAuditWriter.append` (Sprint 2 code).

`@roguemouse/inference` has no Zod dependency and adds no schemas. The provider clients (`createInferenceClient`, `createGeminiClient`) are factory wrappers around the `openai` SDK; the chat-completion functions return `InferenceResult<ChatCompletionData>` types whose runtime validation is implicit in the SDK's response parsing plus the wrapper's explicit shape checks (non-empty content, integer token usage).

### License compliance

**No new direct dependencies.** `git diff --stat 0e61f0a..HEAD -- 'packages/**/package.json' 'package.json'` returns empty output — zero `package.json` files changed since Sprint 3's commit. The dependency closure for `@roguemouse/inference` remains `openai ^4.104.0` only. No GPL/AGPL/SSPL additions; no Gemini SDK pulled in (Decision 1B's whole point).

### Workspace integrity

**All 9 typecheck targets clean** (8 workspace projects + the root `tsconfig.scripts.json`):

```
packages/agent typecheck: Done
packages/audit typecheck: Done
packages/broker-mock typecheck: Done
packages/inference typecheck: Done
packages/runbooks typecheck: Done
packages/schemas typecheck: Done
packages/tools typecheck: Done
apps/web typecheck: Done
pnpm typecheck:scripts (root) — clean
```

`pnpm test`: 149 tests pass (145 schemas + 4 audit). No regression from the Sprint 3 baseline.

### Character-level integrity

Spot-checked the JSDoc-dense new files for hash/asterisk corruption per `tasks/lessons.md` 2026-05-14 entry:

- `packages/inference/src/errors.ts`: 33-line JSDoc header on `classifyInferenceError`; ` *  - ` bullets at lines 28-32 all intact; no `#` characters.
- `packages/inference/src/geminiClient.ts`: 25-line JSDoc; URL line 11 preserved with backticks; bullet structure intact.
- `packages/inference/src/geminiChatCompletion.ts`: 28-line JSDoc on the exported function; numbered list at lines 32-36 intact; no asterisks lost.
- `scripts/smoke-gemini.ts`: JSDoc on `SMOKE_CONFIDENCE` (lines 130-137) and the helpers (lines 141-150) — all line-prefix `*` characters intact.

All files authored via `Write` / `Edit` tools (no operator-paste relay), so the strip-prefix path that affected Sprint 0.5 does not apply here.

### Sprint 2 code byte-unchanged (where required)

- `scripts/smoke-vultr.ts`: byte-unchanged (verified by `git diff HEAD -- scripts/smoke-vultr.ts` returning empty).
- `packages/inference/src/client.ts`: byte-unchanged.
- `packages/inference/src/types.ts`: byte-unchanged.
- `packages/inference/src/chatCompletion.ts`: **modified** — but only to extract `classifyInferenceError` to `errors.ts`. The exported `chatCompletion` function body (lines 33-95 in the new file) is byte-identical to lines 33-94 of the Sprint 3 version. Only the file-local `classifyInferenceError` (Sprint 3 lines 110-163) was removed and replaced with `import { classifyInferenceError } from "./errors.js";` (line 3). Runtime behavior of `chatCompletion` is byte-identical — same SDK call, same response handling, same error classifier (now resolved through import rather than file-local).

### classifyInferenceError extraction (symmetric application)

Grep for `classifyInferenceError`:
- `packages/inference/src/errors.ts:35` — definition + export (the single source of truth).
- `packages/inference/src/chatCompletion.ts:3` — import; line 93 — call site.
- `packages/inference/src/geminiChatCompletion.ts:3` — import; line 109 — call site.
- `packages/inference/src/index.ts` — **not re-exported** (matches `packages/audit/src/errors.ts:20-21`'s precedent for `classifyS3Error`).

Both wrappers use the same classifier from the same file. No duplication. Symmetric application of the cross-provider envelope discipline.

---

## Sprint 4a-specific architectural notes

### Decision 1B (OpenAI-compat shim) validation

The brainstorm's Decision 1B locked the use of Gemini's OpenAI-compatibility endpoint through the existing `openai` package, on the rationale that the same shim works for both Vultr Nemotron (Sprint 2) and Gemini (Sprint 4a). Phase 4's live run **validated this empirically**: a chat-completion call routed through `client.chat.completions.create` against `https://generativelanguage.googleapis.com/v1beta/openai/` returned a well-formed response with OpenAI-shaped fields (`choices[0].message.content`, `usage.prompt_tokens` / `completion_tokens` / `total_tokens`, `finish_reason`). Token re-keying and content extraction worked identically to Sprint 2. Decision 1B was correct.

The `classifyInferenceError` extraction (Phase 2) is the structural payoff: one classifier serves both providers because their errors flow through the same SDK type system. This is the brainstorm's "cross-provider envelope discipline" made concrete at the file level. If a third LLM provider (Anthropic, Cohere, etc.) is ever added through this SDK, no classifier changes are needed.

### Decision 3C (env-driven model) value demonstrated

The brainstorm's Decision 3C made `GEMINI_RISK_MODEL` an env-driven variable with `gemini-2.5-pro` as the default. This decision paid off immediately when the Phase 4 first attempt hit a free-tier quota issue on Pro: a single `.env.local` edit (changing `GEMINI_RISK_MODEL=gemini-2.5-pro` to `gemini-2.5-pro` → `gemini-2.5-flash`) unblocked Sprint 4a without any code change. The runner's env-fallback logic at `smoke-gemini.ts:121-123` honored the override. Zero code touched; zero compile/typecheck cycle; zero risk to the rest of the integration. The pivot took less than 30 seconds once the cause was diagnosed.

### `classifyInferenceError` extraction (file relocation)

Moved from `packages/inference/src/chatCompletion.ts` (file-local, file-private) to `packages/inference/src/errors.ts` (file-public, package-private). Behavior is byte-identical. The function is now imported by both `chatCompletion.ts` and `geminiChatCompletion.ts`. The barrel does NOT re-export the function — it remains package-internal, consistent with `packages/audit/src/errors.ts`'s `classifyS3Error` precedent. The JSDoc on the function explicitly references the audit-package precedent at lines 8-13 of `errors.ts`.

### `truncate500` not duplicated

Sprint 2's `smoke-vultr.ts` includes a `truncate500` helper for capping `smoke_test:chat_completion`'s 530-character payload fields. Sprint 4a's `smoke-gemini.ts` deliberately does NOT duplicate this helper — the `risk_officer:reasoning` payload schema has no max-length constraint on `input.prompt` or `reasoning`, so truncation logic would be dead code. A JSDoc note at `smoke-gemini.ts:146-149` documents the omission.

### Live Gemini Flash thinking-mode observation

Phase 4's PASS report shows `promptTokens: 49`, `completionTokens: 40`, `totalTokens: 1045`. The 956-token gap (1045 − 89) reflects Gemini 2.5 Flash's "thinking" tokens — Flash has thinking mode enabled by default through the OpenAI-compat endpoint. The spec's amendment (line 119: "Sprint 4a accepts whatever the compat endpoint's default is") covered this; no Sprint 4a code change is warranted. Cost accounting for Sprint 7 polish may want to explicitly disable thinking via `extra_body` if the smoke or production paths become cost-sensitive.

---

## Issues found outside AC scope

Three observations from Sprint 4a's discovery process. Items 1 and 2 are genuinely generalizable patterns that future Gemini work will benefit from — recommended `tasks/lessons.md` additions. Item 3 is a documentation note that doesn't warrant a full lessons entry.

### Item 1 — Gemini OpenAI-compat shim translates `RESOURCE_EXHAUSTED` to HTTP 403-with-empty-body

**Recommend adding to `tasks/lessons.md`.**

When a Gemini API key has zero quota for a model (e.g., free-tier `gemini-2.5-pro` whose quota is `limit: 0`), the **native** Gemini endpoint (`/v1beta/models/.../generateContent`) returns HTTP 429 with a JSON error body detailing the quota violation. The **OpenAI-compat** endpoint (`/v1beta/openai/chat/completions`) returns HTTP **403 with no response body** for the same condition. The `classifyInferenceError` correctly handles a 403-empty as `{ code: "http_403", retryable: false }`, but the message field is uninformative because the body is empty.

Diagnosis path that worked in Phase 4: when the compat endpoint returns 403-empty, probe the native endpoint with the same key+model to extract the real error code (`RESOURCE_EXHAUSTED`, with quota details, retry-after seconds, etc.). The native endpoint is fail-loud; the compat endpoint is fail-silent.

Detection rule: any 403-empty inference error from a Gemini compat call should be cross-checked against the native endpoint before concluding "auth failure." It's likely a quota issue masquerading as auth.

### Item 2 — Free-tier `gemini-2.5-pro` has `limit: 0` quota

**Recommend adding to `tasks/lessons.md`.**

`gemini-2.5-pro` is visible in Google AI Studio's model catalog (`/v1beta/models?pageSize=10` returns it). It is callable through the OpenAI-compat surface (200 if quota allows). However, free-tier API keys are explicitly assigned **zero** quota for Pro models — both `generate_content_free_tier_input_token_count` and `generate_content_free_tier_requests` have `limit: 0`. Every request immediately hits `RESOURCE_EXHAUSTED` regardless of usage history.

Mitigation paths: (a) enable billing on the Google Cloud project the key is tied to (turns on paid-tier quota), (b) switch to `gemini-2.5-flash` which has non-zero free-tier quota. Sprint 4a chose (b) to ship; Sprint 7 polish may revisit (a) for demo-time Pro upgrade.

Detection rule: before pinning a Gemini model in production code, verify the model's free-tier quota with `curl -H "x-goog-api-key: $KEY" "https://generativelanguage.googleapis.com/v1beta/tunedModels"` or a small test call. Don't assume model visibility in the catalog implies callability.

### Item 3 — Gemini Flash thinking-mode default through compat endpoint

**Note only; not a lessons entry yet.**

Phase 4's live PASS reported `totalTokens=1045` against `completionTokens=40` and `promptTokens=49`. The gap (956 tokens) is Gemini Flash's "thinking" allocation. Thinking mode appears to be enabled by default through the OpenAI-compat endpoint. This affects cost accounting: a smoke run that visually produces ~89 tokens actually consumes ~1045 tokens of billable output.

This isn't a lesson because we don't have a generalizable rule to encode — Google's thinking-mode policy may change, the compat endpoint may add explicit control, etc. A more useful artifact would be a JSDoc note in `geminiChatCompletion.ts` mentioning that `usage.total_tokens` may significantly exceed `prompt_tokens + completion_tokens` due to thinking-mode billing. Future Sprint 4b/4c/7 work can decide whether to surface this in the audit log or attempt to disable thinking via `extra_body`.

For Sprint 4a closure: nothing to do. Document in `review.md` (here), revisit in Sprint 7 cost-polish if needed.

---

## Overall verdict

**PASS — ready to commit.**

All 27 acceptance criteria are independently verified against the code on disk and the Phase 4 live run output. Every architectural rule from `CLAUDE.md` and `.claude/rules/*.md` holds: audit log integrity preserved (chain rooted at genesis, no delete API, no overwrite paths), envelope discipline maintained on `@roguemouse/inference`'s public surfaces (no throws, `InferenceResult` envelope on every code path), no Vercel features, no Meridian references in source, no new Zod schemas (locked Sprint 3 schemas reused), zero new direct dependencies, workspace typecheck clean across all 9 targets, all tests pass, and the live `pnpm smoke:gemini` run produced a genesis-rooted `risk_officer:reasoning` record (`0ca812ef-3214-4e98-ad43-9b1fddbdd4aa`) with round-trip integrity verified.

The Sprint 4a commit is ready to land per Sprint 4a's plan-stage commit policy (single commit per sprint after `/review-task` passes, mirroring Sprint 2/3's pattern). The two recommended `tasks/lessons.md` additions (Item 1 + Item 2 above) can land as part of the same feat commit OR as a separate follow-up commit — operator's choice.

### Operator decisions needed before commit

1. **Lessons.md additions — same commit or separate?** Items 1 (Gemini compat 403-empty-body) and 2 (free-tier Pro quota = 0) are recommended additions to `tasks/lessons.md`. Two options:
   - **(a)** Include both lessons in the Sprint 4a feat commit. Single coherent unit ("Sprint 4a closed, here's what we learned").
   - **(b)** Land lessons in a separate `docs(lessons)` commit after the feat. Cleaner separation between code change and learning capture.
   Sprint 2's lesson (markdown-strip) was captured in a separate Sprint 0.5 commit before the Sprint 2 code work began; Sprint 3's lesson (conditional-exports) was committed alongside the Sprint 2 code. Both patterns precedented.

2. **`ROGUEMOUSE_CONTEXT.md` update timing.** Per Sprint 3's pattern, the context update is a separate doc commit *after* the feat commit (Sprint 3 used `0e61f0a` for the feat + `dff0161` for the context). Sprint 4a should follow the same two-commit pattern. The context update adds: Sprint 4a ✅ Complete, the third audit record's identifiers as an artifact, the Sprint 4a architectural-decisions entry (cross-provider envelope discipline validated), Sprint 4 queue update (4a complete, 4b queued).

3. **Item 3 (thinking-mode default) treatment.** I've left it as a `review.md`-only note. If you'd prefer a JSDoc addition in `geminiChatCompletion.ts` now (rather than deferring to Sprint 7), it's a 3-line edit to add to the function's existing JSDoc. I'd lean: defer — it's not actionable yet and Sprint 7 will have more context.
