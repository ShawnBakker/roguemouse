# gemini-integration-smoke-test — Spec

## Summary

Sprint 4a is the first of three sub-sprints inside Sprint 4. Its job is to verify end-to-end that Roguemouse can make a chat completion call against Google's Gemini API and write the result to Vultr Object Storage as a hash-chained audit record — the same shape as Sprint 2's Vultr smoke test, but with Gemini as the provider and `risk_officer:reasoning` as the audit `recordType`. The Gemini integration uses Gemini's OpenAI-compatibility endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`) through the existing `openai` npm package, so the Sprint 2 `chatCompletion` wrapper and `InferenceError` envelope are reused unchanged. This sprint unblocks Sprint 4b (dispatch runtime + 8 tool implementations) and Sprint 4c (Scenario A assembly with the multi-agent debate), both of which depend on the Risk Officer voice working. The audit log gains its third record overall and its first-ever `risk_officer:reasoning` record.

## Acceptance criteria

### Invocation and env-var handling

- **AC-01**: A single root command (`pnpm smoke:gemini`) invokes the Gemini smoke runner from a fresh clone after `pnpm install`. Sprint 2's `pnpm smoke` continues to work unchanged.
- **AC-02**: When invoked with no `.env.local` file at the repo root, the runner exits non-zero and prints an error naming the missing file path.
- **AC-03**: When `.env.local` is present but `GEMINI_API_KEY` is missing or empty, the runner exits non-zero and prints an error naming that variable and pointing the operator to `https://aistudio.google.com/apikey`.
- **AC-04**: When `.env.local` is present but `S3_ACCESS_KEY` is missing or empty, the runner exits non-zero and prints an error naming that variable.
- **AC-05**: When `.env.local` is present but `S3_SECRET_KEY` is missing or empty, the runner exits non-zero and prints an error naming that variable.

### Gemini chat completion (happy path)

- **AC-06**: On the happy path, the runner makes exactly one chat completion call to Gemini using the model specified in `GEMINI_RISK_MODEL`; default `gemini-2.5-pro` if the env var is empty or unset. The call goes to Gemini's OpenAI-compatibility endpoint `https://generativelanguage.googleapis.com/v1beta/openai/`.
- **AC-07**: The chat completion response content is a non-empty string.
- **AC-08**: The chat completion response carries token-usage data — `prompt_tokens`, `completion_tokens`, `total_tokens` — each a non-negative integer.
- **AC-09**: The runner captures the elapsed wall-clock time for the chat completion call in integer milliseconds.

### Audit record construction

- **AC-10**: The runner builds exactly one audit record whose JSON body contains exactly the five envelope fields specified in **Data flow** below, and no other top-level fields.
- **AC-11**: The audit record's `ts` field is an ISO-8601 UTC timestamp at millisecond precision (matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`).
- **AC-12**: The audit record's `runId` field is a UUIDv4 string unique to this run (re-running produces a different `runId`).
- **AC-13**: The audit record's `recordType` field is the literal string `risk_officer:reasoning`.
- **AC-14**: The audit record's `previousHash` field equals the genesis constant `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`.
- **AC-15**: The record validates against the locked `auditRecordBodySchema`'s `risk_officer:reasoning` branch from Sprint 3 — that is, `payload` matches the `riskOfficerReasoningPayload` schema (5 strict fields: `input`, `reasoning`, `confidence`, `durationMs`, `tokens`).
- **AC-16**: The `payload.input` field is a strict object with exactly two fields: `prompt` (the literal text sent to Gemini, non-empty string) and `model` (the model identifier used for the call, non-empty string).
- **AC-17**: The `payload.confidence` field is the literal integer `5000` (synthetic for the smoke test — see **Data flow** for rationale).

### Hash chain and round-trip verification

- **AC-18**: The audit record is canonicalized via `canonicalize` from `@roguemouse/schemas`, then hashed via `sha256Hex` from `@roguemouse/audit`. The resulting hash is a 64-character lowercase hexadecimal string.
- **AC-19**: The record is written to Vultr Object Storage under bucket `roguemouse-audit-log` at the locked key `audit/{runId}/{ts-safe}-{hash}.json`, then read back from the same key.
- **AC-20**: The SHA-256 of the canonicalized read-back body equals the hash computed before the write (round-trip lossless).
- **AC-21**: The `previousHash` field parsed from the read-back body equals the genesis constant.

### PASS/FAIL semantics

- **AC-22**: On PASS, the runner exits with code 0.
- **AC-23**: On PASS, the runner prints a structured report containing at minimum: the runId, the S3 object key, the record hash, the previousHash (with a `matches genesis` boolean), prompt/completion/total token counts, and per-step + total elapsed times (all elapsed times as integer milliseconds in the `Nms` format).
- **AC-24**: On FAIL (any assertion or any error during the flow), the runner exits with a non-zero code and prints which step failed and the relevant error code/message.
- **AC-25**: On FAIL after a successful S3 write, the runner does not delete or modify the written audit record. Forensic state in the bucket is preserved for operator inspection.

### Codebase hygiene

- **AC-26**: `pnpm -r typecheck` passes with zero new errors over the Sprint 3 baseline after all Sprint 4a code is in place.
- **AC-27**: The root `package.json` scripts section gains a `smoke:gemini` entry pointing at `tsx scripts/smoke-gemini.ts`. The existing `smoke` entry pointing at `scripts/smoke-vultr.ts` is unchanged.

---

## Data flow

### Provider and endpoint

The smoke runner calls Google's Gemini API via its OpenAI-compatibility endpoint:

- **Base URL**: `https://generativelanguage.googleapis.com/v1beta/openai/`
- **Auth**: bearer token from `GEMINI_API_KEY` env var
- **SDK**: the existing `openai` npm package, the same instance type used for Vultr Serverless Inference. No new direct dependency is introduced.

The OpenAI SDK's `chat.completions.create` is called with a `model` parameter set to the value of `GEMINI_RISK_MODEL` (default `gemini-2.5-pro`), `messages` as a single-element array `[{ role: "user", content: <prompt> }]`, and `max_tokens` set to a generous bound (~1000) since Gemini's reasoning responses can be longer than Sprint 2's smoke responses.

### Smoke prompt

The runner sends a single synthetic anomaly description as the user message:

> "IV/RV ratio is 0.42 for AAPL at 09:31:14 UTC; the project's low-bound threshold is 0.45. Diagnose in 2-3 sentences."

This prompt exercises Gemini's reasoning behavior on a domain-relevant Risk Officer task (one of the eventual demo scenarios) without depending on the runbook corpus or any retrieval logic — that's Sprint 4b/4c territory.

### Audit record envelope (locked from Sprint 3)

Every audit record's JSON body contains exactly these five top-level fields, validated against `auditRecordBodySchema`'s `risk_officer:reasoning` branch:

- **`ts`** — ISO-8601 UTC timestamp string at millisecond precision.
- **`runId`** — UUIDv4 string, freshly generated per smoke run.
- **`recordType`** — the literal string `risk_officer:reasoning`.
- **`previousHash`** — the genesis constant (64-character lowercase hex). The smoke writes exactly one record, so it always chains to genesis.
- **`payload`** — the `risk_officer:reasoning` payload object, shape locked in Sprint 3 (5 fields, see below).

### Risk Officer reasoning payload (locked from Sprint 3, concrete values for the smoke)

Per `riskOfficerReasoningPayload` in `@roguemouse/schemas`, the payload is a `.strict()` object containing exactly these five fields:

- **`input`** — strict object capturing what the LLM was asked to reason over. For the smoke, exactly two fields:
  - `prompt`: the literal text of the smoke prompt above (non-empty string).
  - `model`: the model identifier used (non-empty string — the value of `GEMINI_RISK_MODEL` or its default).

  Rationale for putting `model` inside `input`: the locked `risk_officer:reasoning` payload shape has no top-level `model` field (unlike `smoke_test:chat_completion`'s payload), so `model` belongs inside `input`. This makes the audit record self-contained — a reader can determine which model produced the reasoning without any external lookup.

- **`reasoning`** — string. The exact content of `choices[0].message.content` from the Gemini response. No truncation enforced at the audit-record layer.

- **`confidence`** — integer basis points 0 to 10000. For Sprint 4a, the literal value `5000` (50%). This is a synthetic placeholder for the smoke test; real confidence-extraction logic is Sprint 4b's responsibility. A code-level JSDoc comment in the runner documents that this value is synthetic.

- **`durationMs`** — non-negative integer. The wall-clock elapsed milliseconds of the Gemini chat completion call.

- **`tokens`** — strict object with exactly three non-negative integer fields:
  - `prompt`: from `response.usage.prompt_tokens`.
  - `completion`: from `response.usage.completion_tokens`.
  - `total`: from `response.usage.total_tokens`.

### Object key format (locked from Sprint 2)

The S3 object key uses the locked layout `audit/{runId}/{ts-safe}-{hash}.json` where `{ts-safe}` is the record's `ts` with each `:` replaced by `-`.

### Hash chain invariant

The Sprint 2 + Sprint 3 hash chain invariant carries forward unchanged: the record's `previousHash` is the genesis constant; the record's own hash is the SHA-256 of its canonical form (sorted keys, no whitespace, validated canonicalization-safe values); the canonical form is what gets hashed, the pretty-printed form is never hashed.

### Cost estimate

A single Sprint 4a smoke run costs roughly $0.001–$0.003 against the `gemini-2.5-pro` model (1.25 USD/M input tokens, 5–10 USD/M output tokens depending on thinking mode). An order of magnitude more expensive than Sprint 2's Vultr Nemotron smoke ($0.0000518) but still well under a cent per run. Not a constraint at smoke-test frequency.

Note: Gemini 2.5 Pro's "thinking mode" behavior through the OpenAI-compatibility endpoint is undocumented; Sprint 4a accepts whatever the compat endpoint's default is. If actual costs significantly exceed the estimate, Sprint 7 polish may explicitly disable thinking via `extra_body` in the SDK call.

---

## Edge cases

- **Case**: `.env.local` does not exist at the repo root.
  **Handling**: Runner aborts before any external call. Exit non-zero. Error names the missing file path.

- **Case**: `.env.local` exists but one or more of `GEMINI_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` is absent or empty.
  **Handling**: Runner aborts before any external call. Exit non-zero. Error names each missing variable in one pass (operator gets the full list, not one at a time). The `GEMINI_API_KEY` error message includes a pointer to `https://aistudio.google.com/apikey`.

- **Case**: Gemini call fails with HTTP 401 or 403 (auth failure).
  **Handling**: Runner aborts before any S3 write. Exit non-zero. The `InferenceError` envelope carries the auth-related code (e.g., `http_401` or whatever Gemini's compat endpoint returns); the runner's error report names the relevant env var so the operator knows which key to check.

- **Case**: Gemini call fails with HTTP 429 (rate limit) or 5xx.
  **Handling**: Runner aborts. Exit non-zero. Error includes the retryable flag set true (per the existing `classifyInferenceError` HTTP convention). Operator may retry the smoke run manually.

- **Case**: Gemini call fails with a network error or timeout (e.g., `ECONNRESET`, `APIConnectionTimeoutError`).
  **Handling**: Same as the rate-limit case: aborts, exits non-zero, error retryable=true.

- **Case**: Gemini blocks the response on safety grounds (`finishReason: "content_filter"` or analog through compat mode).
  **Handling**: The existing `chatCompletion` wrapper detects empty content (`AC-07` requires non-empty); it returns `{ ok: false, error: { code: "empty_response", retryable: true } }`. The runner exits non-zero with that classification. Note: the smoke prompt is a benign IV/RV question, so a safety block is unexpected — if it happens, the smoke prompt may need adjusting (Sprint 4a does not pre-empt this; if it surfaces in the live run, we revise).

- **Case**: Gemini returns content but token usage is missing or malformed.
  **Handling**: The existing `chatCompletion` wrapper returns `{ ok: false, error: { code: "malformed_response", retryable: false } }`. Runner aborts before any S3 write. Exit non-zero.

- **Case**: The constructed audit record fails schema validation against `auditRecordBodySchema`'s `risk_officer:reasoning` branch (e.g., the payload is missing a field or contains an unsafe value).
  **Handling**: `RunAuditWriter.append` returns `{ ok: false, error: { code: "validation_error", step: "validate", retryable: false } }`. Runner aborts before any S3 write. Exit non-zero. Indicates a programming bug, not an integration failure.

- **Case**: S3 PUT fails (network error, 4xx, 5xx, signing error, region mismatch).
  **Handling**: Runner aborts before read-back. Exit non-zero. Error includes the step (`s3_put`), the S3 client error code, and the attempted key. Nothing to clean up.

- **Case**: S3 PUT succeeds but the subsequent GET fails.
  **Handling**: Runner exits non-zero. Error includes the step (`s3_get`) and the S3 client error code. The PUT'd record is preserved in the bucket for operator forensics (per AC-25).

- **Case**: GET succeeds but the read-back body is not parseable as JSON.
  **Handling**: Runner exits non-zero. Error reports the JSON parse failure. The S3 record is preserved.

- **Case**: Read-back body parses but its recomputed hash does not equal the written hash.
  **Handling**: Runner exits non-zero (AC-20 fail). Error reports expected vs actual hash and includes both canonical forms (before-write and after-read) for byte-level comparison. The S3 record is preserved.

- **Case**: Read-back body parses and its hash matches, but `previousHash` does not equal the genesis constant.
  **Handling**: Runner exits non-zero (AC-21 fail). Indicates a programming bug. The S3 record is preserved.

- **Case**: Two `pnpm smoke:gemini` runs are invoked concurrently from different terminals.
  **Handling**: Each generates a fresh `runId`. Each run is its own one-record chain. No locking required.

- **Case**: `GEMINI_RISK_MODEL` is set to a model name Gemini does not recognize (e.g., `foo-bar`).
  **Handling**: Gemini's OpenAI-compat endpoint returns a 404 or 400. The runner aborts on the inference step with a non-retryable error code. Operator updates the env var. (Sprint 4a does not pre-validate model names client-side; this is an acceptable fail-fast posture.)

- **Case**: `pnpm smoke` (the Sprint 2 Vultr smoke) is invoked after Sprint 4a lands.
  **Handling**: Continues to work unchanged. AC-01 explicitly preserves the existing behavior. Sprint 4a is purely additive at the runner-script level.

---

## Out of scope

- **Sprint 4b/4c work** — tool implementations (`@roguemouse/tools`), `dispatchTool` runtime (`@roguemouse/agent`), the multi-agent debate runtime, Scenario A assembly, anomaly detector code, broker mock invocation, application-layer RAG over the runbook corpus. Sprint 4a only verifies the Gemini integration in isolation.
- **Streaming responses** — `client.chat.completions.create` is called in blocking mode. Streaming is a Sprint 4b/4c concern if needed.
- **Vision / multimodal inputs** — the smoke prompt is a single user text message.
- **Function calling through Gemini** — per `.claude/rules/vultr.md:121-125`, our architecture orchestrates tools from planner code, not from the LLM. Sprint 4a does not exercise Gemini's function-calling support.
- **Real confidence extraction** — the smoke uses a synthetic `5000`. Sprint 4b owns the real extraction logic.
- **Gemini-specific error metadata** — `safetyRatings`, `blockReason`, etc. — collapsed into `InferenceError.message` for now (per Decision 6A in the brainstorm). Sprint 4b/4c may revisit if a concrete need arises.
- **CI integration of the Gemini smoke** — `pnpm smoke:gemini` remains operator-invoked only. CI gets a fixture-replay version in a later sprint, same as Sprint 2's `pnpm smoke`.
- **Web UI changes** — `apps/web/` is untouched.
- **Demo-time model upgrade** — the question of whether to flip from `gemini-2.5-pro` to `gemini-3-pro` for the demo is deferred to Sprint 7 polish.
- **Cost ledger** — Sprint 4a logs the smoke's token counts but does not aggregate or persist them across runs.
- **Refactor to a provider-agnostic `chatCompletion`** — Decision 2A is "extend, don't refactor." Sprint 4a keeps the Sprint 2 Vultr wrapper untouched and adds Gemini-specific files alongside.
- **Multi-record chains** — Sprint 4a writes one record. Multi-record chains are a Sprint 4c concern when the full scenario writes ~120 records per run.
- **Persistent hash-chain HEAD across processes** — `RunAuditWriter` remains in-memory per run. Sprint 4 originally planned to reconsider this; Sprint 4a does not.
- **`THIRD_PARTY_LICENSES.md` regeneration** — Sprint 4a adds no new direct dependencies, so the dependency closure doesn't change.

---

## Rollback plan

Sprint 4a is additive — it does not modify Sprint 2's smoke runner or Sprint 3's locked schemas. The only persistent side effect is one additional audit record in the Vultr bucket from the live run. Roll back per natural milestone:

- **Phase 1 — Root script wiring**. Add the `smoke:gemini` entry to root `package.json` scripts. Rollback: revert `package.json`. No code consumes the new script entry yet.

- **Phase 2 — Gemini client + chat completion in `@roguemouse/inference`**. Add new files (client factory, wrapped chat-completion function) alongside the existing Vultr-oriented files. Update the package barrel. Rollback: revert the inference package changes. No callers exist yet.

- **Phase 3 — Smoke runner script**. Create `scripts/smoke-gemini.ts` mirroring `scripts/smoke-vultr.ts`'s structure. Rollback: delete the file and the `package.json` script entry. No production state affected because no record has been written.

- **Phase 4 — Pre-flight checks and live smoke run**. The operator populates `.env.local` with `GEMINI_API_KEY`. Run `pnpm smoke:gemini` once against real Gemini + Vultr. One audit record lands in the bucket. Rollback at the code level: revert the prior phases. Rollback at the bucket level: nothing to do — the record is immutable and harmless (its own `runId`, its own chain rooted at genesis).

- **Phase 5 — Review (`/review-task`)**. Produces only a `review.md` document. Rollback: delete the document; revert the sprint folder.

If the entire sprint must be rolled back: revert every commit on the sprint branch, run `pnpm install`, leave the live audit record in the bucket where it is.

---

## Preconditions

The following must be true before Sprint 4a begins:

- Sprint 3's commits `0e61f0a` (the feat commit) and `dff0161` (the context update) are on `main`. Working tree is clean.
- Node 20.x and pnpm 10.27+ are installed; `pnpm install` runs successfully from a clean checkout.
- `.env.local` is present at the repo root with all five required variables populated:
  - `VULTR_INFERENCE_API_KEY` (from Sprint 2 — still required if `pnpm smoke` is run, but not required for `pnpm smoke:gemini`).
  - `GEMINI_API_KEY` — generated from `https://aistudio.google.com/apikey` (this is new for Sprint 4a; previous sprints did not require it).
  - `S3_ACCESS_KEY` (from Sprint 2 — required for the audit write).
  - `S3_SECRET_KEY` (from Sprint 2 — required for the audit write).
  - `GEMINI_RISK_MODEL` is documented in `.env.example` with default `gemini-2.5-pro`; the env var is optional (the runner falls back to the default if it is empty or unset).
- Vultr Object Storage subscription `roguemouse-audit` is active; bucket `roguemouse-audit-log` (region `ams1`) exists; the credentials in `.env.local` have read+write permission. (Same precondition as Sprint 2 and 3.)
- Google Gemini API access is enabled for the project the `GEMINI_API_KEY` belongs to, and the model named in `GEMINI_RISK_MODEL` (default `gemini-2.5-pro`) is available to that key.
- The operator's machine has outbound network access to `https://generativelanguage.googleapis.com` (new) and `https://ams1.vultrobjects.com` (existing).
- System clock is within ~5 minutes of true UTC (AWS SDK signature requirement).

Note: `GEMINI_API_KEY` is only required for Phases 4 onward (the live run). Phases 1–3 are code work and unit tests; they can be completed without a valid Gemini key. The runner explicitly checks for the key at startup (AC-03) so a missing key fails fast before any external call.

---

## Stop gate

When the spec is approved, proceed to `/plan-task`. Do not start implementation before the plan is approved.
