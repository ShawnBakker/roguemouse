# dispatch-runtime-tools-rag — Spec

## Summary

Sprint 4b provides the runtime layer that Sprint 3's schemas and Sprint 4a's Gemini integration were preparing for: the `dispatchTool` function that the planner uses to invoke tools, the 8 tool implementations that produce the tool result data, the application-layer RAG that backs `runbook:search`, and an `S3 LIST` capability in the audit writer to support `audit:search`. After Sprint 4b, every tool the planner can name has a working body, every tool invocation is hash-chained into the audit log via the writer (not via the `audit:append` tool — that path is recursion-guarded), and the runbook corpus is queryable end-to-end.

Submission scope is **Scope C: Scenario A only, deployed.** Tools 1–5 (`market_data:lookup`, `runbook:search`, `position:snapshot`, `broker:reconcile`, `audit:append`) are critical-path for Scenario A and ship at production quality. Tools 6 (`audit:search`) uses a real implementation against `writer.list` + `writer.read` because the new `writer.list` method exists; tools 7 (`score:explain`) and 8 (`policy:check`) ship as deterministic stubs adequate for schema parity but not exercised by Scenario A. The Scenario A refusal moment is confidence-driven by the Synthesizer voice (Sprint 4c), not policy-driven; `policy:check` always returns `{ allowed: true, violations: [] }` for Sprint 4b. The dispatcher is **serial** (one tool at a time, in invocation order); parallel dispatch with a write-queue is deferred to Sprint 7 polish per a `tasks/todo.md` entry already filed.

The audit chain gains its first multi-record runs in Sprint 4b. Every previous sprint wrote exactly one record per run (Sprint 2's smoke, Sprint 3's verification, Sprint 4a's risk-officer smoke); Sprint 4b's smoke dispatcher exercises a sequence of tool calls and produces a chain of ~6 records (3 tool dispatches × 2 records each — `tool:call` + `tool:result`) plus optional anomaly/agent-voice records if the smoke chooses to write any. Hash-chain integrity carries the same invariants as before: every record's `previousHash` equals the SHA-256 of the canonical prior record. Sprint 4b is the first sprint where chain *continuation* (not just chain *rooting*) is exercised.

## Acceptance criteria

### Dispatcher invocation and envelope behavior

- **AC-01**: `dispatchTool<TName>(name, args)` returns `Promise<ToolResult<DataFor<TName>>>` matching the locked `DispatchTool` type signature from Sprint 3.
- **AC-02**: `dispatchTool` never throws on its public surface. Every error path — including a tool implementation that throws, a writer failure on `tool:call` or `tool:result` write, or an unrecognized tool name — flows through the `ToolResult` envelope.
- **AC-03**: Before executing a tool's implementation, the dispatcher writes a `tool:call` audit record via `RunAuditWriter.append` directly (not via the `audit:append` tool).
- **AC-04**: After the tool's implementation returns, the dispatcher writes a `tool:result` audit record via `RunAuditWriter.append` directly, including the result envelope and a non-negative integer `durationMs` measuring the tool body's execution time.
- **AC-05**: A single `dispatchTool` invocation generates exactly one `invocationId` (UUIDv4) that appears in both its `tool:call` payload and its `tool:result` payload, correlating the two records.
- **AC-06**: The dispatcher is serial. When `dispatchTool` is called sequentially, the second call does not begin its `tool:call` write until the first call's `tool:result` write has committed. Concurrent invocations from the same dispatcher instance produce records in invocation order.
- **AC-07**: If a tool implementation throws (despite the contract that it should not), the dispatcher catches the exception and returns `{ ok: false, error: { code: "tool_threw", message: <error message>, retryable: false } }`. The `tool:result` audit record is still written, with this envelope in its `result` field.

### Audit chain integrity (multi-record chains)

- **AC-08**: Every audit record written by the dispatcher (and by tool implementations that write audit records) has `previousHash` equal to the SHA-256 of the canonical form of the chronologically prior record in the same run.
- **AC-09**: The first record in any run has `previousHash` equal to the genesis constant `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`.
- **AC-10**: A `tool:call` payload contains exactly three fields per Sprint 3's locked schema: `toolName` (one of the 8 locked names), `invocationId` (UUIDv4), `args` (canonicalization-safe value).
- **AC-11**: A `tool:result` payload contains exactly four fields per Sprint 3's locked schema: `toolName`, `invocationId`, `result` (canonicalization-safe value representing the `ToolResult<T>` envelope), `durationMs` (non-negative integer).

### Recursion guard (Decision 2D — architectural + runtime check)

- **AC-12**: The dispatcher does NOT call `dispatchTool("audit:append", ...)` for `tool:call` or `tool:result` records. The recursion guard is enforced architecturally: the dispatcher holds a `RunAuditWriter` reference and writes these records via `writer.append` directly. There is no code path inside the dispatcher that routes tool-flow records through the tool registry.
- **AC-13**: The `audit:append` tool implementation includes a runtime check. When invoked with `args.recordType === "tool:call"` or `args.recordType === "tool:result"`, the tool returns `{ ok: false, error: { code: "recordtype_reserved_for_dispatcher", message: <message naming the rejected recordType and referencing the recursion-guard JSDoc location>, retryable: false, step: "validate" } }`. The audit:append tool never writes a `tool:call` or `tool:result` record.

### Per-tool happy-path behavior

- **AC-14**: `market_data:lookup` accepts `{ symbol }`, returns `{ ok: true, data: { spotPrice, impliedVolatility, realizedVolatility, surfaceTs } }` for any symbol present in the loaded fixture data, all integers in the units and ranges specified by Sprint 3's locked schema.
- **AC-15**: `runbook:search` accepts `{ query, topK }`, returns `{ ok: true, data: { matches: Array<{ path, excerpt, relevanceScore }> } }`. When the query has at least one match, results are ordered by descending `relevanceScore` and limited to `topK`. The Sprint 4a smoke prompt ("IV/RV ratio is 0.42 for AAPL at 09:31:14 UTC; the project's low-bound threshold is 0.45. Diagnose in 2-3 sentences.") used as a query with `topK=3` returns `iv-rv-divergence.md` in the matches array.
- **AC-16**: `position:snapshot` accepts `{ strategy?, symbol? }`, returns `{ ok: true, data: { positions: [...] } }`. With no filters, returns all fixture positions. With filters, returns only matching positions. The positions array may be empty.
- **AC-17**: `broker:reconcile` accepts `{ strategy }`, returns `{ ok: true, data: { brokerPositions: [...] } }` matching that strategy from the broker-side fixture.
- **AC-18**: `audit:append` accepts `{ recordType, payload }`, validates the recordType against Sprint 3's locked 12-name list, and on success writes the record via `RunAuditWriter.append`, returning `{ ok: true, data: { key, hash, previousHash } }`. The runtime guard from AC-13 rejects `tool:call` and `tool:result` recordTypes before the writer is touched.
- **AC-19**: `audit:search` accepts `{ runId?, recordType?, sinceTs?, limit }`, calls `writer.list({ runIdPrefix: runId })` to enumerate keys, then iterates `writer.read(key)` for each result, parses each record, applies the `recordType` and `sinceTs` filters in memory, and returns `{ ok: true, data: { records, hasMore } }`. Single-page only — the tool does not paginate beyond `limit`.
- **AC-20**: `score:explain` (deterministic stub) accepts `{ strategy, scoreValue }`, returns `{ ok: true, data: { components: [<fixture-shaped array>], narrative: <fixture-shaped string> } }`. The output is schema-valid but does not reflect any real scoring model.
- **AC-21**: `policy:check` (always-allow stub) accepts `{ action }`, returns `{ ok: true, data: { allowed: true, violations: [] } }` for any well-formed input.

### Per-tool error envelope behavior

- **AC-22**: A tool implementation that fails (e.g., `market_data:lookup` with an unknown symbol, `audit:search` with a malformed S3 response, `runbook:search` with a corrupt corpus index) returns `{ ok: false, error: { code, message, retryable, step? } }` matching the `ToolError` envelope. The tool does not throw. The dispatcher does NOT runtime-Zod-parse the success-branch `data` against `resultDataSchema`; TypeScript's compile-time narrowing is the source of type safety. The writer's discriminated-union safeParse catches gross shape violations at the audit-write boundary.
- **AC-23**: A tool implementation that depends on a runtime service (writer, S3 LIST) propagates that service's structured errors through the `ToolError` envelope, preserving the underlying `code` field where meaningful.
- **AC-24**: No tool implementation throws on its public dispatch surface. Defensive wrapping (try/catch around the entire impl body) is the implementation's responsibility per the locked `defineTool` contract (Sprint 3 AC-24a).

### RAG correctness (in-memory keyword + frequency for `runbook:search`)

- **AC-25**: At module load, the runbook corpus loader reads all 5 `.md` files from `packages/runbooks/content/` and constructs an in-memory search index. Loading failure (missing file, unreadable file) is a clear error and refuses module initialization.
- **AC-26**: Tokenization lowercases input, splits on whitespace and standard punctuation (`,`, `.`, `:`, `;`, `(`, `)`, `?`, `!`, `"`, `'`, hyphen optional), and applies a 20-word stopword filter to both indexed documents and queries. The stopword list is locked at: `["the", "a", "an", "is", "are", "of", "to", "for", "in", "on", "at", "by", "with", "and", "or", "not", "this", "that", "these", "those"]`.
- **AC-27**: `relevanceScore` is an integer in basis points 0-10000. Scores above 10000 are clamped to 10000.
- **AC-28**: Top-K results are ordered by descending `relevanceScore`. Within the same score, ordering is stable (insertion order from the corpus loader).
- **AC-29**: The `excerpt` field for each match is the full text of the matched runbook's "When this fires" paragraph, extracted via regex matching against the markdown structure (`## When this fires\n\n([^\n]+)`). The excerpt is the same for every query against the same file (query-independent excerpt content).
- **AC-30**: A query with zero matches against the corpus returns `{ ok: true, data: { matches: [] } }`. Not an error; an empty result.

### `writer.list` correctness (new method on `@roguemouse/audit`)

- **AC-31**: `RunAuditWriter.list({ runIdPrefix?, limit? })` returns `Promise<ListResult>` where `ListResult = { ok: true, data: { keys: string[], hasMore: boolean } } | { ok: false, error: AuditError }`. The method follows the existing envelope discipline; it never throws on its public surface.
- **AC-32**: When `runIdPrefix` is provided, the LIST call uses S3 prefix `audit/{runIdPrefix}/`. When absent, the prefix is `audit/` (whole-bucket scan, bounded by `limit`).
- **AC-33**: `hasMore` in the result reflects S3's `IsTruncated` flag from the `ListObjectsV2` response. The single S3 LIST call may return fewer than `limit` records if the bucket is partially populated; the caller does not paginate further.
- **AC-34**: S3 LIST failures (network, auth, 5xx) are classified via `classifyS3Error` into the existing `AuditError` shape, with `step: "s3_list"` to distinguish from `s3_put` / `s3_get` failures.

### Fixtures and Zod validation at boot

- **AC-35**: Scenario A fixture files exist under `fixtures/scenario-a/` as JSON. The set covers at minimum: market data for AAPL (IV/RV ratio approximately 0.42 to match the Scenario A anomaly), positions matching the strategy referenced in the scenario, broker-reported positions for the same strategy (potentially divergent from internal positions to support the reconciliation flow), and any anomaly evidence the smoke or Sprint 4c will need.
- **AC-36**: Fixture files are parsed through Zod schemas at boot. Parse failure on any required fixture (missing field, wrong type, out-of-range value) is a clear error and refuses module initialization. The error names the offending file path and Zod field.
- **AC-37**: A missing fixture file (file not found at the documented path) is a clear error at boot. Tool implementations that depend on a missing fixture do not silently return empty arrays; module initialization fails fast.

### Smoke run against real Vultr

- **AC-38**: `scripts/smoke-dispatch.ts` exists. It is invocable via `pnpm smoke:dispatch`, reads `.env.local` for `S3_ACCESS_KEY` and `S3_SECRET_KEY` only. The smoke does NOT exercise any LLM call paths (no Gemini, no Vultr Nemotron). `GEMINI_API_KEY` and `VULTR_INFERENCE_API_KEY` are not required. Missing env vars produce a clear exit-non-zero error mirroring Sprint 4a's pattern.
- **AC-39**: The smoke executes a sequence of dispatcher invocations against the real Vultr Object Storage bucket. Records written, in order: at least one anomaly:detected record (synthetic, no LLM call required), at least three `tool:call` + `tool:result` pairs (e.g., market_data:lookup, position:snapshot, runbook:search). Total: at least 7 records in a single chain (1 anomaly + 6 tool-flow records). No agent-voice reasoning records are written by this smoke.
- **AC-40**: After all writes complete, the smoke reads back each record in order, verifies each record's `previousHash` equals the SHA-256 of the canonical prior record, and verifies the first record's `previousHash` equals the genesis constant. This is the first multi-record chain integrity check across the project.
- **AC-41**: The smoke exits with code 0 on PASS and prints a structured report including the runId, the count of records written, the final hash in the chain, per-step elapsed times, and any per-tool durations.

### Codebase hygiene

- **AC-42**: `pnpm -r typecheck` passes with zero new errors over the Sprint 4a baseline.
- **AC-43**: `pnpm typecheck:scripts` passes.
- **AC-44**: No new direct dependencies in any `package.json`. Sprint 4b uses only existing deps (`zod`, `openai`, `@aws-sdk/client-s3`, `dotenv`, `tsx`, `vitest`).

---

## Data flow

### Dispatcher tool-call lifecycle

For each `dispatchTool(name, args)` invocation:

1. **Generate `invocationId`** (UUIDv4 via Node's `crypto.randomUUID`).
2. **Build the `tool:call` payload**: `{ toolName: name, invocationId, args }`. The `args` value is the same object the caller passed; it must satisfy the tool's `argsSchema` and be canonicalization-safe.
3. **Write the `tool:call` record** via `RunAuditWriter.append({ ts: <now>, recordType: "tool:call", payload })`. If the write fails, return `{ ok: false, error: { code: "audit_write_failed", message: <writer's error message>, retryable: <writer's retryable>, step: "tool_call_audit" } }` and do not execute the tool.
4. **Execute the tool's implementation**: `await TOOL_IMPLEMENTATIONS[name](args, ctx)`. The implementation is contractually required not to throw; the dispatcher wraps the call in try/catch as defense in depth. A thrown exception produces `{ ok: false, error: { code: "tool_threw", message: <error message>, retryable: false } }`.
5. **Time the execution**: `durationMs = Math.round(performance.now() - start)` where `start` is recorded immediately before step 4.
6. **Build the `tool:result` payload**: `{ toolName: name, invocationId, result: <the envelope from step 4>, durationMs }`. The `result` field is the full `ToolResult<T>` envelope as JSON — both success and failure envelopes are recorded.
7. **Write the `tool:result` record** via `RunAuditWriter.append({ ts: <now>, recordType: "tool:result", payload })`. If this write fails, return the same `audit_write_failed` envelope as in step 3 but with `step: "tool_result_audit"`.
8. **Return the result envelope** from step 4. The caller receives the same envelope that was recorded in `tool:result.payload.result`.

### ToolCtx shape (dependency injection)

The dispatcher constructs and owns a single `ToolCtx` object passed to every tool implementation. Shape:

- **`writer`** — the `RunAuditWriter` instance for the current run. Used by `audit:append` and `audit:search` for direct writer access. NOT used by tool-flow records (those go through the dispatcher's own writer reference, which is the same instance — but the dispatcher's code path is what writes them, not a tool body).
- **`fixtures`** — the loaded Scenario A fixture set (Zod-parsed at boot). Used by `market_data:lookup`, `position:snapshot`, `broker:reconcile`, `score:explain`, `policy:check` for their data sources.
- **`runbookIndex`** — the in-memory keyword index over the runbook corpus (built at boot). Used by `runbook:search` for query/match logic.

Every tool implementation receives the full `ToolCtx` regardless of which fields it uses. The destructure is local to each implementation.

### Audit chain semantics

A "run" is a single planner execution session (typically one Scenario A demo run). Within a run:

- The `RunAuditWriter` is constructed once with a fresh `runId` (UUIDv4) and the initial `lastHash = GENESIS_HASH`.
- Every record written through `writer.append` advances `lastHash` to the new record's hash. The next record's `previousHash` is that hash.
- The chain is rooted at genesis (first record's `previousHash`) and grows linearly. Each record is content-addressed by its own hash; the S3 object key includes the hash, so the key is the chain's identifier for that record.
- A run's complete chain can be reconstructed by listing `audit/{runId}/*.json` objects, sorting by timestamp prefix, and verifying each record's `previousHash` matches the prior record's hash.

For Sprint 4b's smoke: a single run produces ≥7 records, all sharing one `runId`, forming a single chain rooted at genesis. No multi-run chain merging is exercised (each run is its own chain).

### Tool implementation contract

Every tool implementation:

- Has signature `(args: ArgsFor<TName>, ctx: ToolCtx) => Promise<ToolResult<DataFor<TName>>>`.
- Never throws on its public surface. All error paths return `{ ok: false, error: ToolError }`.
- Treats `args` as already-validated (the dispatcher validates against the tool's `argsSchema` before invoking — or relies on TypeScript's compile-time narrowing at the call site).
- Returns a result envelope whose success-branch `data` matches the tool's `resultDataSchema` from Sprint 3. The implementation is responsible for ensuring shape correctness. Per AC-22, the dispatcher does NOT runtime-Zod-parse this shape; TypeScript's compile-time narrowing is the source of type safety. Gross shape violations are caught belt-and-suspenders at the writer's discriminated-union safeParse during the `tool:result` write.

### Fixture schema for Scenario A (Zod-parsed at boot)

The `fixtures/scenario-a/` directory contains JSON files conforming to a set of Zod schemas defined in the loader. The minimum set required for Scenario A:

- **Market data fixtures**: a map from symbol (string) to `{ spotPrice, impliedVolatility, realizedVolatility, surfaceTs }` matching `market_data:lookup`'s `resultDataSchema`. At minimum, an entry for AAPL with an IV/RV ratio around 0.42 (i.e., low-bound breach for Scenario A).
- **Position fixtures**: a list of `{ strategy, symbol, quantity, avgEntryPrice, currentPrice, asOf }` matching `position:snapshot`'s result data shape.
- **Broker position fixtures**: a list of `{ symbol, quantity, brokerAccountId, asOf }` matching `broker:reconcile`'s result data shape, optionally divergent from internal positions to support the reconciliation flow.
- **Anomaly evidence (optional, for the smoke)**: a canonicalization-safe object describing the IV/RV anomaly that the dispatch smoke (or Sprint 4c's planner) records via an `anomaly:detected` audit write.

All fixtures are Zod-parsed at module load. A parse failure raises a clear error naming the file path and the failing field. Missing files raise a similar error at the same boundary.

### Runbook corpus loader and search index

At module load:

1. Read all `.md` files from `packages/runbooks/content/`.
2. For each file, extract the raw content and a precomputed `excerpt` (the "When this fires" paragraph via regex match).
3. Build a frequency-based token index: `Map<token, Map<docPath, frequency>>`. Tokens are lowercased, split on whitespace + punctuation, filtered against the 20-word stopword list.
4. Cache the resulting `RunbookIndex` object in module closure.

At query time (`runbook:search` invocation):

1. Tokenize and stopword-filter the query.
2. For each document, compute `score = Σ (queryToken_frequency_in_doc / doc_total_tokens)` over query tokens.
3. Filter to documents with `score > 0`, sort descending, take top-K.
4. For each match, return `{ path, excerpt: <precomputed>, relevanceScore: clamp(round(score * 10000), 0, 10000) }`.

### Object key format and S3 LIST behavior

Locked from Sprint 2: `audit/{runId}/{ts-safe}-{hash}.json`. Sprint 4b adds `writer.list({ runIdPrefix, limit })`:

- The S3 `ListObjectsV2` call uses prefix `audit/{runIdPrefix}/` if `runIdPrefix` is provided; otherwise `audit/`.
- `MaxKeys` is set to `limit ?? 100` (caps at S3's per-page maximum).
- The response's `Contents` array is mapped to `keys: string[]`; `IsTruncated` becomes `hasMore: boolean`.
- The method returns a `ListResult` envelope; failures are classified via `classifyS3Error` with `step: "s3_list"`.

---

## Edge cases

- **Case**: Tool implementation throws unexpectedly despite the contract.
  **Handling**: Dispatcher catches via try/catch around the impl invocation. Returns `{ ok: false, error: { code: "tool_threw", message: <error message>, retryable: false } }`. The `tool:result` record is still written, with this envelope in its `result` field. The error never propagates to the caller as an exception.

- **Case**: Tool implementation returns an envelope whose `data` shape does not satisfy the tool's `resultDataSchema`.
  **Handling**: Per AC-22, the dispatcher does not runtime-Zod-parse the success-branch `data`. The malformed envelope is included in the `tool:result` payload as-is. The writer's discriminated-union safeParse (existing Sprint 2 behavior) catches gross shape violations at the audit-write step, producing a writer error that the dispatcher surfaces via the `audit_write_failed` envelope with `step: "tool_result_audit"`. In the worst case (where the malformed shape happens to satisfy the union but is semantically wrong), the error surfaces later — at the caller's consumption point or during Sprint 4c's planner reasoning. This is an accepted trade-off: TypeScript compile-time correctness is the primary defense; runtime defense is reserved for the audit boundary, not duplicated at the dispatcher.

- **Case**: `audit:append` tool is called with `recordType: "tool:call"` or `recordType: "tool:result"`.
  **Handling**: The tool's runtime check (AC-13) fires. Returns `{ ok: false, error: { code: "recordtype_reserved_for_dispatcher", message: <descriptive>, retryable: false, step: "validate" } }`. The writer is not touched. The dispatcher records the wrapped error envelope in `tool:result` for the audit:append invocation.

- **Case**: `audit:append` tool is called with a `recordType` not in Sprint 3's locked 12-name list.
  **Handling**: The tool's args validation (the `recordTypeNameSchema` Zod parse) fails before the body executes. The dispatcher's call to the tool implementation is preceded by args validation; on failure, the dispatcher records a `tool_args_validation_failed` envelope in `tool:result`. The writer is not touched.

- **Case**: `writer.append` fails when writing a `tool:call` record (network, S3 error, schema validation failure).
  **Handling**: The dispatcher returns `{ ok: false, error: { code: "audit_write_failed", message: <writer's error>, retryable: <writer's retryable>, step: "tool_call_audit" } }`. The tool's body is NOT executed. Subsequent dispatcher calls proceed normally (the writer's `lastHash` is unchanged on failed appends, per Sprint 2's design).

- **Case**: `writer.append` fails when writing a `tool:result` record (after the tool body has already executed).
  **Handling**: The dispatcher returns `{ ok: false, error: { code: "audit_write_failed", message: <writer's error>, retryable: <writer's retryable>, step: "tool_result_audit" } }`. The tool's result is lost from the audit log perspective — the `tool:call` was recorded but the matching `tool:result` was not. The chain has a dangling unresolved call. Recoverable on retry (the next `tool:result` write succeeds and chains correctly); not recoverable from the lost log entry's perspective. This is the worst-case audit-write failure mode in Sprint 4b.

- **Case**: A fixture file is missing or invalid at boot.
  **Handling**: Module initialization throws a clear error naming the file path and the parse / load failure reason. The dispatcher cannot be constructed; the smoke runner fails fast with a non-zero exit and a structured error pointing at the file path. The error is not silently swallowed (no "tool returns empty array" fallback for missing fixtures).

- **Case**: A runbook file is missing at boot.
  **Handling**: Same as the fixture case — module initialization throws a clear error naming the runbook path. The dispatcher cannot be constructed.

- **Case**: `runbook:search` query has zero matches.
  **Handling**: Returns `{ ok: true, data: { matches: [] } }`. Not an error; an empty result. Distinct from a load-time corpus failure (which is a boot-time error).

- **Case**: `audit:search` returns zero records (e.g., `runId` does not exist, or all records filter out).
  **Handling**: Returns `{ ok: true, data: { records: [], hasMore: false } }`. Not an error.

- **Case**: `audit:search` S3 LIST returns more records than `limit`.
  **Handling**: The tool's result reports `hasMore: true` per S3's `IsTruncated`. No automatic continuation. Caller may re-call with a smaller `runIdPrefix` or accept the partial result.

- **Case**: `audit:search` filtering reduces a non-empty LIST result to zero matching records.
  **Handling**: Returns `{ ok: true, data: { records: [], hasMore: false } }`. The `hasMore` reflects the LIST response, not the post-filter count, so this case may surface as `hasMore: true` with empty `records` if the page was full but nothing matched the filters. This is a known limitation of single-page semantics.

- **Case**: Multiple `dispatchTool` calls in sequence form a chain.
  **Handling**: Each call's `tool:call` references the prior call's `tool:result` (or the prior record more generally) via `previousHash`. Per AC-08, the chain is unbroken: call 1 → result 1 → call 2 → result 2 → ... All records share the same `runId`.

- **Case**: `dispatchTool` is invoked with an unrecognized `ToolName`.
  **Handling**: This is a compile-time error per Sprint 3's type signature (`TName extends ToolName`). Should never reach runtime. If runtime somehow bypasses TypeScript (e.g., a JSON-driven call site), the dispatcher's `TOOL_IMPLEMENTATIONS[name]` lookup returns `undefined`, and the dispatcher returns `{ ok: false, error: { code: "unknown_tool", message: <names tool>, retryable: false } }`. Defensive only; never expected in production.

- **Case**: The dispatcher is called for a tool whose implementation depends on a runtime service that is `undefined` in `ToolCtx` (programming error).
  **Handling**: The tool implementation's destructure fails; the implementation either returns a structured error envelope or (if defensive coding is missing) throws — in which case the dispatcher's tool_threw envelope catches it. Either way, no exception propagates to the caller.

- **Case**: Smoke runner is invoked but `.env.local` is missing or has missing required vars.
  **Handling**: Same pattern as Sprint 4a's smoke: clear exit-non-zero with a structured error naming the file path or var. The smoke does not silently proceed without credentials.

- **Case**: Smoke runner's S3 PUT succeeds for some records but fails for one in the middle of the chain.
  **Handling**: The dispatcher's `audit_write_failed` envelope surfaces. The smoke runner reports the failure with the partial-chain state for forensic inspection. The records that did write are preserved in the bucket per AC-25 carry-over from Sprint 2.

---

## Out of scope

- **Sprint 4c work** — multi-agent debate orchestration, Synthesizer voice prompting, anomaly detector beyond the smoke's synthetic record, the refusal-vs-proposal decision tree, end-to-end Scenario A run with ~120 records. Sprint 4b's deliverable is "the dispatcher works; tools work; RAG works." Sprint 4c composes them.
- **Planner-level concurrent tool dispatch** — Decision 1A (serial) is locked for Sprint 4b. The parallel-with-queue alternative is tracked in `tasks/todo.md` for Sprint 7 polish.
- **Real confidence extraction** — the Sprint 4a synthetic confidence (5000) stays for Sprint 4b. Sprint 4c owns real extraction logic (system-prompt coaching or heuristics from response features).
- **Cost tracking and aggregation** — token counts are recorded in per-record audit payloads where applicable, but no run-level aggregation. Sprint 7 polish can add a cost-aggregator that walks the audit log.
- **Persistent hash-chain HEAD across processes** — `RunAuditWriter` remains in-memory per run. Sprint 4 (any sub-sprint) is not the place to revisit; Sprint 5+ if a persistent-resume use case emerges.
- **Hot-reload of fixtures or runbooks during development** — files are loaded once at module init. Edits require restarting the process. Acceptable for hackathon timeline; out of scope.
- **Circuit breakers around LLM calls** — `.claude/rules/vultr.md:137-146` describes per-call circuit breakers. Sprint 4b doesn't add them; Sprint 7 polish can layer `opossum` (or equivalent) around `chatCompletion` and `geminiChatCompletion` without changing the envelope discipline.
- **`opossum` or other retry/backoff library** — no automatic retries in Sprint 4b. Tool errors propagate to the caller (the Sprint 4c planner) which decides retry policy at that layer.
- **Vector DB or embedding-based RAG** — Decision 3A (keyword + frequency) is locked. Embeddings deferred to Sprint 7 polish if Scenario A reveals ranking shortcomings.
- **Web UI changes** — `apps/web/` is untouched. Sprint 6 (deploy) and any future UI work are separate.
- **CI integration of `smoke-dispatch`** — like `pnpm smoke` and `pnpm smoke:gemini`, the dispatch smoke is operator-invoked only. CI replay-based testing is a post-submission concern.
- **Multi-run chain merging** — each Sprint 4b run is its own chain rooted at genesis. Cross-run chain linking is not exercised.

---

## Rollback plan

Sprint 4b touches more packages than any previous sprint, but every change is additive or strictly extending existing surfaces. The smoke run produces audit records that are immutable and harmless (their own `runId`, chain rooted at genesis like every other run).

- **Phase 1 — Fixtures and runbook loader**. Create `fixtures/scenario-a/*.json` files; create the fixture-loader and runbook-corpus-loader modules. Loaders parse with Zod at module init. Rollback: `git restore` the fixture files and loader code. No runtime state to roll back; module load failures fail fast.

- **Phase 2 — `RunAuditWriter.list`**. Add the `list` method to the audit writer plus the `ListResult` envelope type and any new test fixtures. Rollback: revert the audit package changes. No callers exist yet; Sprint 2/3/4a code paths are unaffected because the new method is additive.

- **Phase 3 — Tool implementations + `TOOL_IMPLEMENTATIONS` registry in `@roguemouse/tools`**. 8 tool implementation files plus a `ToolCtx` type plus the registry. Rollback: revert the tools package. The schemas from Sprint 3 are unaffected.

- **Phase 4 — `dispatchTool` runtime in `@roguemouse/agent`**. The dispatcher class + the `audit:append` runtime guard. Rollback: revert the agent package.

- **Phase 5 — Smoke runner (`scripts/smoke-dispatch.ts`) and root script entry**. Add the script and the `pnpm smoke:dispatch` entry to root `package.json`. Rollback: delete the script and revert `package.json`. No production state affected.

- **Phase 6 — Pre-flight + live smoke run**. Operator confirms `.env.local`. Run `pnpm smoke:dispatch` against real Vultr. Multi-record chain lands in the bucket. Rollback at the code level: revert prior phases. Rollback at the bucket level: nothing to do — the records are immutable and harmless.

- **Phase 7 — Review (`/review-task`)**. Produces only a `review.md` document. Rollback: delete the document; revert the sprint folder.

If the entire sprint must be rolled back: revert every commit on the sprint branch, run `pnpm install`, leave the Phase 6 audit records in the bucket where they are.

---

## Preconditions

The following must be true before Sprint 4b begins:

- Sprint 4a's commits `12174f3` (feat) and `50d7582` (context update) are on `main`. Working tree is clean.
- Node 20.x and pnpm 10.27+ are installed; `pnpm install` runs successfully from a clean checkout.
- `.env.local` is present at the repo root. The Sprint 4b smoke requires `S3_ACCESS_KEY` and `S3_SECRET_KEY` at minimum; if the smoke includes any LLM call paths, `GEMINI_API_KEY` is also required. The exact required set will be locked at `/plan-task` time.
- Vultr Object Storage subscription `roguemouse-audit` is active; bucket `roguemouse-audit-log` (region `ams1`) exists; credentials in `.env.local` have read+write+list permissions on the bucket. (List permission is new for Sprint 4b; if the existing access key lacks List permission, the operator updates the IAM-equivalent settings before the smoke can run.)
- The 5 runbook files exist under `packages/runbooks/content/` at the paths landed in commit `0e7681b`.
- The operator's machine has outbound network access to `https://ams1.vultrobjects.com` (existing) and `https://generativelanguage.googleapis.com` (existing, only if the smoke includes a Gemini call).

---

## Stop gate

When the spec is approved, proceed to `/plan-task`. Do not start implementation before the plan is approved.
