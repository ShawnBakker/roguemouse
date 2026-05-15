# smoke-test-vultr-integration — Spec

## Summary

The smoke test exercises Roguemouse's two Vultr integrations end-to-end from TypeScript for the first time: one chat completion against Vultr Serverless Inference, one audit record describing that call, written to Vultr Object Storage and read back, with cryptographic integrity verified by round-trip hash recompute. The audit record envelope locked in this sprint becomes the permanent shape inherited by every future audit record. The test is a single operator-invoked command that produces a structured PASS report or a forensics-preserving FAIL report, and it does not run in CI during Sprint 2 (CI integration is deferred to a later sprint with fixture replay).

## Acceptance criteria

- **AC-01**: A single root command (`pnpm smoke`) invokes the smoke test runner from a fresh clone after `pnpm install`.
- **AC-02**: When invoked with no `.env.local` file present at the repo root, the runner exits non-zero and prints an error naming the missing file.
- **AC-03**: When invoked with `.env.local` present but `VULTR_INFERENCE_API_KEY` missing or empty, the runner exits non-zero and prints an error naming that variable.
- **AC-04**: When invoked with `.env.local` present but `S3_ACCESS_KEY` missing or empty, the runner exits non-zero and prints an error naming that variable.
- **AC-05**: When invoked with `.env.local` present but `S3_SECRET_KEY` missing or empty, the runner exits non-zero and prints an error naming that variable.
- **AC-06**: On the happy path, the runner makes exactly one chat completion call to Vultr Serverless Inference (`https://api.vultrinference.com/v1`) using the locked Ops Engineer model `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16`.
- **AC-07**: The chat completion response content is a non-empty string.
- **AC-08**: The chat completion response carries token-usage data (`prompt_tokens`, `completion_tokens`, `total_tokens`), each a non-negative integer.
- **AC-09**: The runner builds exactly one audit record whose JSON body contains exactly the envelope fields specified in **Data flow** below, and no other top-level fields.
- **AC-10**: The audit record's `ts` field is an ISO-8601 UTC timestamp at millisecond precision (e.g., `2026-05-14T18:32:11.482Z`).
- **AC-11**: The audit record's `runId` field is a non-empty opaque string unique to this run (re-running the smoke test produces a different `runId`).
- **AC-12**: The audit record's `recordType` field is the literal string `smoke_test:chat_completion`.
- **AC-13**: The audit record's `previousHash` field equals the genesis constant (defined in **Data flow**).
- **AC-14**: The audit record's `payload` is a canonicalization-safe JSON value (per the constraints defined in **Data flow**) and is validated against those constraints before any hashing or writing occurs.
- **AC-15**: The audit record is canonicalized via the rolled-own canonicalizer (recursive object-key sort, no whitespace, JSON-safe values only) prior to hashing.
- **AC-16**: The record's hash is the SHA-256 of the canonical form, encoded as a 64-character lowercase hexadecimal string.
- **AC-17**: The record is written to Vultr Object Storage under bucket `roguemouse-audit-log` at the key `audit/{runId}/{ts-safe}-{hash}.json`, where `{ts-safe}` is the record's `ts` with each `:` replaced by `-`.
- **AC-18**: After the write succeeds, the runner reads back the object at the same key.
- **AC-19**: The SHA-256 of the canonicalized read-back body equals the hash computed before the write (round-trip lossless).
- **AC-20**: The `previousHash` field parsed from the read-back body equals the genesis constant.
- **AC-21**: On PASS, the runner exits with code 0.
- **AC-22**: On PASS, the runner prints a structured report containing, at minimum: per-step elapsed time (chat completion, S3 write, S3 read, hash verify), the S3 object key, the record hash, the genesis (`previousHash`), prompt/completion/total token counts, and total elapsed time.
- **AC-23**: On FAIL (any assertion or any error during the flow), the runner exits with a non-zero code.
- **AC-24**: On FAIL, the runner prints which assertion failed, the expected value, and the actual value (or, for thrown errors not associated with an assertion, the error message and the step in which it occurred).
- **AC-25**: On FAIL after a successful S3 write, the runner does not delete or modify the written audit record. Forensic state in the bucket is preserved for operator inspection.
- **AC-26**: The genesis constant is the SHA-256 of the UTF-8 bytes of the literal string `roguemouse-audit-genesis-v1`, encoded as a 64-character lowercase hexadecimal string.
- **AC-27**: The canonicalization function carries JSDoc documenting the JSON-safe input constraint (no floats, no `NaN`/`Infinity`/`undefined`, integers within JavaScript's safe-integer range, all strings UTF-8) and the deferred RFC 8785 migration path.
- **AC-28**: `tasks/todo.md` gains a new entry tracking the deferred RFC 8785 migration trigger condition.
- **AC-29**: `pnpm -r typecheck` passes with zero new errors over the Sprint 1 baseline after all Sprint 2 code is in place.
- **AC-30**: The audit record's canonical JSON body, when decoded after round-trip from S3, is byte-identical to the canonical JSON written (i.e., Vultr's gzip transport encoding is transparently handled by the SDK).
- **AC-31**: The audit record's `payload` object contains exactly the five fields specified in **Data flow** (`model`, `prompt`, `response`, `tokens`, `durationMs`) and no other fields. The `tokens` object contains exactly three fields (`prompt`, `completion`, `total`) and no other fields.
- **AC-32**: The `payload.prompt` and `payload.response` string fields are at most 500 characters. If the underlying value exceeds 500 characters, the field contains the first 500 characters followed by the literal suffix `... [truncated; N chars total]` where N is the original character count as a base-10 integer.
- **AC-33**: The `runId` is generated via Node's built-in `crypto.randomUUID()` and conforms to UUIDv4 format (8-4-4-4-12 hexadecimal characters separated by hyphens, with version digit `4` in position 14 of the canonical 36-character string).
- **AC-34**: All elapsed-time values in the PASS report are formatted as integer milliseconds (no decimal seconds, no decimal milliseconds). The format is `Nms` where N is a non-negative base-10 integer.

## Data flow

### Audit record envelope (locked in this sprint)

Every audit record's JSON body — the object body written to S3 — contains exactly these five top-level fields:

- **`ts`** — ISO-8601 UTC timestamp string at millisecond precision. Example: `2026-05-14T18:32:11.482Z`. Identifies when the record was minted.
- **`runId`** — non-empty opaque string. Identifies the run this record belongs to. Records sharing a `runId` form one hash chain. The `runId` is opaque to the audit log itself (no parsing required); upstream code chooses its format. For Sprint 2 the smoke test generates a fresh `runId` per invocation.
- **`recordType`** — non-empty string. A free-form discriminator that future sprints will narrow into a literal union (Sprint 3). Sprint 2's only value is `smoke_test:chat_completion`.
- **`previousHash`** — 64-character lowercase hexadecimal string. The SHA-256 of the canonical form of the prior record in this run's chain, or the genesis constant for the chain's first record. The smoke test writes exactly one record, so its `previousHash` is always the genesis constant.
- **`payload`** — a JSON-safe value (object, array, string, integer, boolean, or null). Sprint 2 leaves the payload's interior shape unconstrained at the schema level; Sprint 3 narrows it via a discriminated union keyed on `recordType`. The schema does enforce *canonicalization-safe* constraints (see below).

The **record hash** (SHA-256 of the canonical envelope) is not stored as a field inside the body. It lives in two places: as the suffix of the S3 object key, and in the S3 object's metadata under the key `sha256`. This is the convention from `.claude/rules/vultr.md` line 79. Storing the record's own hash inside its body would create a chicken-and-egg problem (the field would have to be excluded from its own hash); keeping the hash external to the body removes that problem entirely.

#### Audit record payload (Sprint 2 only)

For the smoke test's single `smoke_test:chat_completion` record, the payload object contains exactly these five fields and no others:

- **`model`** — string. The Vultr Inference model identifier used for the chat completion call. For Sprint 2 this is the literal `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16`.
- **`prompt`** — string, at most 500 characters. The exact text sent as the user message. If the underlying value exceeds 500 characters, it is truncated and suffixed with the literal `... [truncated; N chars total]` where N is the original character count as a base-10 integer.
- **`response`** — string, at most 500 characters. The model's response content from `choices[0].message.content`. Same truncation rule as `prompt`.
- **`tokens`** — object containing exactly these three integer fields, each non-negative:
  - `prompt`: integer, the value of `usage.prompt_tokens`
  - `completion`: integer, the value of `usage.completion_tokens`
  - `total`: integer, the value of `usage.total_tokens`
- **`durationMs`** — integer, non-negative. Elapsed wall-clock time for the chat completion call in milliseconds.

Sprint 3 will replace this Sprint-2-specific payload shape with a discriminated-union schema across all recordTypes. This shape is locked only for Sprint 2.

### Genesis constant

The genesis hash is a fixed, project-wide constant:

> The SHA-256 of the UTF-8 bytes of the literal string `roguemouse-audit-genesis-v1`, encoded as 64-character lowercase hexadecimal.

This constant is defined once and used by every chain's first record forever (until intentionally rotated, signalled by bumping the `-v1` suffix). The suffix is the version handle: if we ever need to break the audit log format intentionally, we bump to `-v2` and produce a new, structurally distinct chain.

### Canonicalization constraint

The canonicalization function accepts JSON values restricted to the following:

- Plain objects with string keys.
- Arrays.
- Strings (UTF-8, no requirement of NFC normalization at Sprint 2 — see deferred migration below).
- Integers within JavaScript's safe-integer range (`Number.MIN_SAFE_INTEGER` ≤ n ≤ `Number.MAX_SAFE_INTEGER`).
- Booleans.
- `null`.

The function rejects floats (non-integer numbers), `NaN`, `Infinity`, `-Infinity`, `undefined`, functions, symbols, `Date` objects, `BigInt`, and any other non-plain value. Rejection occurs before any hashing or writing, so a record that would produce an unreproducible hash is never minted.

The canonical form is produced by recursively sorting object keys in lexicographic byte order and serializing the result with no whitespace. For Sprint 2 payloads, this rolled-own implementation is correct. If we ever need to hash a payload containing floats, non-NFC Unicode, or other values where a custom canonicalizer would diverge from the JCS spec, the migration trigger is logged in `tasks/todo.md` (AC-28) and the work is to swap in an MIT-licensed RFC 8785 implementation.

### Hash chain invariant

For any record R with `previousHash = h_prev` and `recordHash = h_curr`:

1. `h_curr` is the SHA-256 of the canonical form of R's body (i.e., the JSON object containing exactly `ts`, `runId`, `recordType`, `previousHash`, `payload`).
2. `h_prev` is either the genesis constant (for the chain's first record) or equal to the `recordHash` of the chronologically prior record in the same `runId`.
3. The S3 object key for R contains `h_curr` as its suffix.
4. The S3 object metadata for R contains `h_curr` under the key `sha256` and `h_prev` under the key `previousHash`.

A chain is tamper-evident: any modification to a record's canonical form changes `h_curr`, which breaks the chain's continuity with the next record (whose `previousHash` no longer matches). For Sprint 2's single-record chain, the invariant reduces to: `h_curr` recomputes correctly from the read-back body, and `h_prev` equals the genesis constant.

### Lifecycle within a smoke run

1. Runner loads environment from `.env.local` (via dotenv). Missing file or missing required variables aborts before any external call.
2. Runner generates a fresh `runId` for this invocation.
3. Runner calls Vultr Inference (one chat completion).
4. Runner builds the audit record body using the locked envelope fields. `payload` carries chat-completion metadata (e.g., model name, prompt and completion token counts, response excerpt). The exact payload shape is a plan-task concern; the spec only requires that it is canonicalization-safe.
5. Runner validates the record body against the schema and canonicalization constraints.
6. Runner canonicalizes, hashes, and writes to S3 under the locked key pattern.
7. Runner reads back the object, recomputes the hash, asserts equality, asserts `previousHash` equals genesis, asserts chat completion response was non-empty.
8. Runner emits a PASS report (exit 0) or a FAIL report (exit non-zero) preserving any S3 record already written.

## Edge cases

- **Case**: `.env.local` does not exist at the repo root.
  **Handling**: Runner aborts before any Vultr call. Exit non-zero. Error names the missing file path.

- **Case**: `.env.local` exists but one or more of `VULTR_INFERENCE_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` is absent or empty.
  **Handling**: Runner aborts before any Vultr call. Exit non-zero. Error names each missing variable (the operator gets the full list in one pass, not one at a time).

- **Case**: Vultr Inference call fails (network error, 4xx, 5xx, timeout).
  **Handling**: Runner aborts before any S3 write. Exit non-zero. Error includes the step (`chat_completion`), the HTTP status if any, and the response body or error message.

- **Case**: Vultr Inference call succeeds but `choices[0].message.content` is empty or absent.
  **Handling**: Treated as an assertion failure (AC-07). Exit non-zero. Error reports expected non-empty content vs actual empty/absent. No S3 write performed.

- **Case**: The audit record fails schema or canonicalization validation (e.g., a payload field is a float).
  **Handling**: Runner aborts before any S3 write. Exit non-zero. Error names the offending field and the constraint violated. Indicates a programming bug in the runner, not an integration failure.

- **Case**: S3 PUT fails (network error, 4xx, 5xx, signing error, region mismatch).
  **Handling**: Runner aborts before the read-back step. Exit non-zero. Error includes the step (`s3_put`), the S3 client error code, and the attempted key. Nothing to clean up because nothing was written.

- **Case**: S3 PUT succeeds but the subsequent GET fails (network error, 4xx, 5xx, key-not-found).
  **Handling**: Runner exits non-zero. Error includes the step (`s3_get`), the S3 client error code, and the key. The PUT'd record is preserved in the bucket (AC-25) for operator forensics.

- **Case**: GET succeeds but the read-back body is not parseable as JSON (e.g., Vultr's gzip transport corrupted the stream).
  **Handling**: Runner exits non-zero. Error reports the JSON parse failure and the first bytes of the body for diagnosis. The S3 record is preserved.

- **Case**: Read-back body parses but its recomputed hash does not equal the written hash.
  **Handling**: Runner exits non-zero (AC-19 fail). Error reports expected hash vs actual recomputed hash and includes the canonical form derived from the read-back, so the operator can compare byte-by-byte. The S3 record is preserved.

- **Case**: Read-back body parses and its hash matches, but `previousHash` does not equal the genesis constant.
  **Handling**: Runner exits non-zero (AC-20 fail). Indicates a programming bug in the runner. The S3 record is preserved.

- **Case**: Two smoke runs are invoked concurrently from different terminals.
  **Handling**: Each generates a fresh `runId`, so the runs do not share a chain. Both can succeed independently. No locking required.

- **Case**: The same smoke run is invoked twice serially (e.g., operator re-runs after a transient Vultr hiccup).
  **Handling**: Each run is a distinct `runId` with a distinct S3 key namespace. Both records persist in the bucket. The bucket accumulates one audit record per successful run; manual cleanup (Vultr console) is the operator's call.

- **Case**: Vultr Inference returns a 401/403 (auth failure).
  **Handling**: Same as the general Vultr Inference failure case. Error message should make the auth nature evident so the operator knows to check the API key in `.env.local`.

- **Case**: S3 returns a 403 (auth failure on PUT or GET).
  **Handling**: Same as the general S3 failure case. Error message names the access-key and secret-key environment variable names so the operator can verify them.

- **Case**: System clock is significantly skewed (e.g., > 5 minutes from real time).
  **Handling**: Out of scope for the runner's logic. AWS SDK may reject the request with a signature/skew error, which surfaces as a normal S3 failure with the SDK's error code. Operator interprets and fixes their clock.

## Out of scope

- **Circuit breaker on the inference client** — deferred to Sprint 3 when the inference client gets its first multi-call use case. Sprint 2 makes one call and either it works or the smoke test fails.
- **Retry/backoff logic** — deferred. Smoke test failure on a transient Vultr error is acceptable; the operator re-runs.
- **Multi-record chains** — Sprint 2 writes one record. Verifying chain continuity across two or more records is a Sprint 3 concern.
- **Listing/walking the chain from S3** — no list-objects-v2 call in Sprint 2.
- **Persisting chain HEAD across processes** — in-memory only for the smoke test (single-process, single-run). Sprint 4 reconsiders for the Next.js API-route lifetime.
- **Cost aggregation across calls** — token usage is reported in the PASS output for visibility, but no aggregation, no persistence to a cost ledger.
- **Vector Store / RAG / retrieval** — entirely out of scope.
- **Gemini integration (Risk Officer, Synthesizer)** — out of scope; Sprint 2 exercises only the Ops Engineer voice path.
- **CI integration of the smoke test** — `pnpm smoke` is operator-invoked only. CI gets a fixture-replay version in a later sprint (per stack rule on testing pyramid).
- **Tool-call audit records, human-approval audit records, refusal records** — Sprint 3 / Sprint 4.
- **UI display of the audit log** — Sprint 4+.
- **Encryption at rest or in transit beyond what Vultr provides natively** — Vultr Object Storage has no SSE; payload encryption is out of scope for the synthetic demo data.
- **`THIRD_PARTY_LICENSES.md` regeneration** — deferred to pre-submission polish.
- **Deletion or rotation of smoke-test audit records from the bucket** — manual operator task via the Vultr console if desired.

## Rollback plan

The smoke test is additive — it does not modify any existing production system, and its only persistent side effect is appending one immutable object per successful run to the Vultr Object Storage bucket. Roll back per natural milestone:

- **Phase 1 — Dependency wiring** (root and per-package dependencies added: zod in schemas; AWS SDK for S3 in audit; openai in inference; tsx and dotenv as root dev dependencies). Rollback: revert the affected `package.json` files and `pnpm-lock.yaml`, re-run `pnpm install`. No production state is affected because no code yet consumes these dependencies.

- **Phase 2 — Schema and canonicalizer locked** (envelope schema, genesis constant, canonicalization function in the schemas package; or split between schemas and audit as the plan decides). Rollback: revert the package changes. No data in any bucket depends on these definitions yet, because the runner does not exist.

- **Phase 3 — Inference client wrapper** (OpenAI-compatible client configured against the Vultr base URL; one exported function for chat completion). Rollback: revert the inference package changes. No callers exist until the runner is in place.

- **Phase 4 — Audit writer** (S3 client configured against the Vultr endpoint; in-memory `RunAuditWriter` exposing append/read primitives). Rollback: revert the audit package changes. No callers exist until the runner is in place. No production bucket data is affected because no record has been written.

- **Phase 5 — Smoke runner and root script wiring** (the runner script at the repo root, the `pnpm smoke` entry in root `package.json`, the `.env.example` file documenting required variables, any `.gitignore` updates to ensure `.env.local` is not committed). Rollback: revert the script, the root `package.json` entry, and any docs changes. The `.env.local` file is gitignored either way, so reverting does not expose secrets.

- **Phase 6 — First smoke run executed** (one or more audit records have been written to the bucket). Rollback: nothing to do at the code level. The records in the bucket are immutable by design and belong to a unique `runId`, so they cannot corrupt any future chain. If the operator wishes to clean the bucket of smoke-test records, they can do so manually via the Vultr console — but this is cosmetic, not a rollback requirement. Critically, the audit log's tamper-evidence story does not depend on any particular record being present or absent; it depends only on the integrity of each chain that *is* present.

If the entire sprint must be rolled back: revert every commit on the sprint branch, run `pnpm install`, leave any audit records in the bucket where they are (they are valid records in their own right and harm nothing).

## Preconditions

The following must be true before `pnpm smoke` is invoked:

- The Sprint 1 workspace is checked out and `pnpm install` has been run successfully (lockfile up to date, all workspace packages typecheck).
- The repo root contains a `.env.local` file (gitignored) with the variables `VULTR_INFERENCE_API_KEY`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` set to valid non-empty values. Source: the password-manager entries listed in `ROGUEMOUSE_CONTEXT.md` (`roguemouse-vultr-inference-key`, `roguemouse-s3-access-key`, `roguemouse-s3-secret-key`).
- Vultr Object Storage subscription `roguemouse-audit` is active, region `ams1`, bucket `roguemouse-audit-log` exists, the access key and secret key in `.env.local` have read+write permission on that bucket.
- Vultr Serverless Inference subscription is active and the model `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` is available on the catalog (verify via `GET /v1/models` if in doubt — recorded as available on 2026-05-14).
- The operator's machine has outbound network access to `https://api.vultrinference.com` and `https://ams1.vultrobjects.com`.
- System clock is within ~5 minutes of true UTC (AWS SDK signature requirement).
- The repo root's `.env.example` (committed in Sprint 1) documents the required variable names. A new contributor populates `.env.local` by copying `.env.example` and filling in values from the password manager.
