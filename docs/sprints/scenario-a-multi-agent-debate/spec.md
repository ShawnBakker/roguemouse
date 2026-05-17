# scenario-a-multi-agent-debate — Spec

## Summary

Sprint 4c is the demo. It composes Sprint 4b's dispatch runtime, Sprint 4a's Gemini integration, and Sprint 2's Vultr Nemotron path into a single Scenario A run: anomaly detection → multi-agent deliberation (Risk Officer → Ops Engineer → Synthesizer) → proposal-or-refusal terminal. Every step is hash-chained into the audit log via the existing writer. The default invocation produces a structured proposal recommending action against the AAPL IV/RV anomaly; an alternate invocation via the `--degraded` flag swaps in semantically uncertain (but schema-valid) fixtures and produces a refusal record instead. Both runs traverse the same code path; only the input fixture set differs.

The default Scenario A path proceeds as follows. The runner loads the canonical Scenario A fixtures (AAPL IV/RV ratio 0.42, ratio below the 0.45 low-bound threshold, clean position state, clean broker reconciliation). A small anomaly detector scans the market data and emits the AAPL IV/RV breach as the run's seed `anomaly:detected` record. The Risk Officer voice (Gemini Flash) dispatches `market_data:lookup` + `runbook:search`, then produces a free-text reasoning record framed in governance-officer language. The Ops Engineer voice (Vultr Nemotron) dispatches `position:snapshot` + `broker:reconcile` + `audit:search` (historical lookback), then produces its own reasoning record. The Synthesizer voice (Gemini Flash) reads both upstream reasoning records, produces a `synthesizer:reasoning` record, and then a `synthesizer:proposal` record containing a recommendation TO a human operator. Total: ~15-20 records per run, single chain, terminating at the proposal.

The `--degraded` invocation swaps four fixture values to produce semantically uncertain inputs: AAPL IV/RV ratio is 0.43 (just barely below the threshold; not clearly an anomaly), AAPL position is 200 shares (double the clean baseline), broker reconciliation reports a 25-share divergence (a clear reconciliation problem), and the runbook is unchanged. The anomaly detector still fires (0.43 < 0.45), but the downstream voices reason over inconsistent signals — Risk and Ops produce hedged reasoning, the Synthesizer's structured-JSON confidence falls below the 4500 basis-point threshold, and the run terminates at `synthesizer:refusal` instead. Same code path, same orchestrator, same audit chain shape (modulo the terminal record type) — only the inputs differ. This is the demo's high-trust moment per `.claude/rules/hackathon.md`: the audit log proves the system refuses to act when uncertain, not just that it acts when confident.

The competitive narrative — **external governance layer over a trader, not a trader** — is enforced at the prompt level. Every voice's system prompt explicitly states "you do not execute trades, you advise a human operator, every reasoning step is cryptographically audit-logged." The Synthesizer's structured response distinguishes `proposal_text` (a recommendation TO a human) from `refusal_reason_code` (an explicit decision NOT to recommend). The chain terminates at the Synthesizer's terminal record; Sprint 4c does NOT emit synthetic `human:approval` records, preserving the honest narrative that the system is awaiting human action at the end of every run.

## Acceptance criteria

### Anomaly detector

- **AC-01**: A `detectAnomalies(fixtures)` function exists in `@roguemouse/agent`. It scans `fixtures.marketData` and returns an array of detected anomalies. Each anomaly's payload satisfies the locked `anomalyDetectedPayload` schema (`anomalyType`, `severity`, `evidence`, `detectedAt`).
- **AC-02**: The detector flags any symbol whose IV/RV ratio falls outside the band `[4500, 9500]` (basis points; equivalent to ratio 0.45 to 0.95). For the clean Scenario A fixtures, the detector returns exactly one anomaly (AAPL at IV/RV ratio 0.42 / 4200 bp); for the degraded fixtures, the detector returns exactly one anomaly (AAPL at 0.43 / 4300 bp).
- **AC-03**: For a fixture set with no breaches (synthetic test case), the detector returns an empty array. The detector itself never throws; if `fixtures.marketData` is empty, it returns `[]`.

### Voice sequencing

- **AC-04**: Within one Scenario A run, the audit log records the three voice-reasoning records in strict order: `risk_officer:reasoning` first, `ops_engineer:reasoning` second, `synthesizer:reasoning` third. The records' lex-sorted `ts-safe` portions reflect this order.
- **AC-05**: The Synthesizer voice runs only after both Risk Officer and Ops Engineer voices have completed (success or error). It is never called in parallel with either upstream voice.
- **AC-06**: For each voice, the voice's tool dispatches (per Decision 2A) complete BEFORE the voice's LLM call. The reasoning record is written AFTER the LLM call returns. Audit chain order within one voice's segment: `tool:call` → `tool:result` (× N for the voice's dispatches) → `<voice>:reasoning`.

### Per-voice tool dispatch sequences (locked at brainstorm Decision 2A)

- **AC-07**: The Risk Officer voice dispatches exactly two tools per run, in order: `market_data:lookup({symbol: <anomaly.symbol>})` then `runbook:search({query: <anomaly-derived query string>, topK: 3})`. No other tools are dispatched within the Risk Officer segment.
- **AC-08**: The Ops Engineer voice dispatches exactly three tools per run, in order: `position:snapshot({})` (no filters), then `broker:reconcile({strategy: "iv-rv-monitor"})`, then `audit:search({recordType: "anomaly:detected", limit: 10})`. No other tools are dispatched within the Ops Engineer segment.
- **AC-09**: The Synthesizer voice dispatches zero tools. It reasons exclusively over prior reasoning records and the original anomaly. The Synthesizer's audit segment contains only `synthesizer:reasoning` and (terminal) `synthesizer:proposal` OR `synthesizer:refusal`.
- **AC-10**: All tool dispatches go through the Sprint 4b `dispatchTool` runtime (the dispatcher writes the `tool:call`/`tool:result` records via `writer.append` directly, per AC-12 from Sprint 4b). The orchestrator does NOT bypass the dispatcher for any tool-flow audit records.

### Per-voice reasoning record content

- **AC-11**: Each `risk_officer:reasoning` and `ops_engineer:reasoning` record satisfies the locked Sprint 3 payload schema (5 fields: `input`, `reasoning`, `confidence`, `durationMs`, `tokens`). The `input` field is a canonicalization-safe summary of what the voice received (anomaly + tool outputs); `reasoning` is the voice's free-text output; `confidence` is in basis points 0-10000; `durationMs` is a non-negative integer; `tokens` carries `{prompt, completion, total}` integers from the LLM provider's response.
- **AC-12**: Each `synthesizer:reasoning` record satisfies the locked Sprint 3 payload schema (5 fields: `riskOfficerInput`, `opsEngineerInput`, `reasoning`, `durationMs`, `tokens`). The two upstream-input fields are canonicalization-safe summaries of the prior reasoning records.
- **AC-13**: For Risk Officer and Ops Engineer reasoning records, the `confidence` value is set to a placeholder constant of **5000** (mid-range) for Sprint 4c. The Sprint 3 schema requires the field to be present and within 0-10000; the placeholder satisfies the contract. The extractor function (or constant) carries a JSDoc explicitly noting this is a Sprint 4c placeholder, that real calibration is Sprint 7 polish, and pointing at the Synthesizer's load-bearing confidence as the actual decision driver. **Reasoning**: Risk Officer and Ops Engineer voices are advisors, not deciders. Their confidence field is informational, not consumed by any decision logic. The Synthesizer's confidence IS load-bearing (drives proposal-vs-refusal) and IS real (structured JSON, model-stated, threshold-checked). Honest placeholders are better than plausibly-wrong heuristics.
- **AC-14**: Every voice's `input` (or `riskOfficerInput`/`opsEngineerInput`) field passes `validateCanonicalSafe` from `@roguemouse/schemas`. No floats; integers in the safe range; no Date objects; only JSON-canonical-safe primitives and nested structures.
- **AC-15**: Each voice's reasoning record's `reasoning` field is non-empty and contains the LLM's actual response content (not a placeholder or fallback string).

### Governance-language guardrail (locked at brainstorm)

- **AC-16**: Each voice's system prompt explicitly establishes the voice's role as a governance officer, NOT a trader. The prompt includes language equivalent to: "You are an [identity] at a governance layer that monitors algorithmic trading systems. You do NOT execute trades. You do NOT mutate system state. Your role is to advise and recommend; a human operator decides whether to act. Every reasoning step you produce will be cryptographically audit-logged." The exact wording is at the implementation's discretion; the structural commitments are: (a) role establishment, (b) explicit non-execution, (c) human-operator-decides framing, (d) audit-log disclosure.
- **AC-16a**: Each voice's system prompt passes three programmatic substring checks (implemented as unit tests against the locked prompt strings):
  - Contains the substring `"advise"` OR `"recommend"` (governance-mode language).
  - Contains the substring `"audit"` (audit-log disclosure).
  - Does NOT contain any imperative-form executable action language; specifically, does NOT contain the substrings `"execute trade"`, `"execute the trade"`, or `"mutate state"` (no-action constraint).

  These checks catch regressions during future prompt edits without requiring human review of every change. The exact wording of each prompt remains at implementation discretion subject to these structural constraints.
- **AC-17**: The Synthesizer's proposal record's `proposalText` is grammatically a recommendation (e.g., "I recommend..." or "We recommend..." or imperative-passive "...should be considered..."), not an imperative action ("Reduce position..."). The voice's output discipline is enforced at the prompt level; the AC verifies the resulting text via spot-check during review.

### Synthesizer structured JSON response

- **AC-18**: The Synthesizer's LLM call uses `response_format: { type: "json_object" }` (or equivalent) to request structured JSON. The system prompt describes the expected schema verbatim.
- **AC-19**: The Synthesizer's response is JSON-parsed; the parsed object is Zod-validated against a locked schema (defined at plan stage). The schema contains at minimum: `confidence_bp` (int 0-10000), `decision` (literal union `"proposal" | "refusal"`), `reasoning` (string), and one of `{proposal_text, supporting_evidence, expected_impact}` (when decision is "proposal") OR `{refusal_reason_code, degraded_inputs}` (when decision is "refusal").
- **AC-20**: A Zod parse failure on the Synthesizer's response produces an error envelope from the runner; the run terminates by writing a `synthesizer:refusal` record with `reasonCode: "synthesizer_malformed_response"` and `degradedInputs` listing the parse failure. The chain does not break.
- **AC-21**: A `confidence_bp` value outside the locked range 0-10000 (e.g., the model returns 150 instead of 1500) is caught by the Zod parse and treated as malformed (per AC-20).

### Proposal-vs-refusal decision

- **AC-22**: The orchestrator's terminal decision is driven by the parsed `confidence_bp` and `decision` fields. If `decision === "proposal"` AND `confidence_bp >= 4500`, the run writes a `synthesizer:proposal` record. If `decision === "refusal"` OR `confidence_bp < 4500`, the run writes a `synthesizer:refusal` record. The orchestrator never produces both.
- **AC-23**: The `synthesizer:proposal` payload satisfies the locked Sprint 3 schema (`proposalText`, `supportingEvidence` array, `expectedImpact`, `confidence`). The confidence field is populated from the parsed `confidence_bp`.
- **AC-24**: The `synthesizer:refusal` payload satisfies the locked Sprint 3 schema (`reasonCode`, `reasoningText`, `degradedInputs` array). The `reasonCode` is a stable identifier (e.g., `low_confidence`, `synthesizer_malformed_response`, `inconsistent_voice_inputs`).

### Audit chain integrity for the multi-record run

- **AC-25**: A complete Scenario A run produces **exactly 15** audit records: 1 `anomaly:detected` + (5 tool dispatches × 2 records each = 10 tool-flow records) + 3 voice reasoning records (`risk_officer:reasoning`, `ops_engineer:reasoning`, `synthesizer:reasoning`) + 1 terminal record (`synthesizer:proposal` OR `synthesizer:refusal`). The locked Decision 2A tool sequences (Risk: 2, Ops: 3, Synth: 0) produce exactly 5 dispatches. No additional tool dispatches are added at plan stage; Decision 2A is binding.
- **AC-26**: Every record in the run shares the same `runId` (a fresh UUIDv4 generated at run start). The first record's `previousHash` equals the genesis hash `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`. Each subsequent record's `previousHash` equals the SHA-256 of the canonical form of the immediately prior record.
- **AC-27**: The chain terminates at exactly one of: `synthesizer:proposal` or `synthesizer:refusal`. No `human:approval`, `human:rejection`, or `final:committed` records are emitted by Sprint 4c's runner (those are honestly out-of-scope; the chain's terminal state is "system awaiting human action").

### Vultr Nemotron pre-flight (locked at brainstorm Q4)

- **AC-28**: Before invoking the Ops Engineer voice, the runner performs a small chat-completion pre-flight against the configured Vultr Nemotron model (a 1-2 word prompt with low max_tokens). On HTTP 200 with a non-empty response, the pre-flight passes and the run proceeds. On HTTP 404 (model rotated out of catalog), HTTP 401/403 (auth failure), or any non-retryable error, the pre-flight fails and the runner exits non-zero with a remediation message that names the failed model and suggests checking `/v1/models` on the Vultr inference endpoint.
- **AC-29**: A transient pre-flight failure (HTTP 429, 5xx, network error) is treated the same as a non-retryable failure for Sprint 4c: hard-fail with the error code/message. Retries with backoff are deferred to Sprint 7 polish. The runner does NOT proceed past a failed pre-flight under any circumstance.

### `--degraded` flag behavior

- **AC-30**: The script-level entry point (`pnpm scenario:a`) accepts an optional `--degraded` flag. When present, the runner loads from an alternate fixture set whose values are: AAPL IV/RV ratio 0.43 (`impliedVolatility: 1720`, `realizedVolatility: 4000`), AAPL position 200 shares, broker reconciliation reports AAPL quantity 175 (a 25-share divergence vs the position's 200). All other fixture fields remain unchanged from the clean set. The degraded fixtures are loaded via the same `loadScenarioA(rootDir)` Zod parse path (with `rootDir` pointing at `fixtures/scenario-a-degraded/` instead of `fixtures/scenario-a/`).
- **AC-31**: The degraded fixture set is schema-valid: `loadScenarioA` against the degraded directory returns successfully and all four fixture files Zod-parse cleanly. The degradation is semantic (uncertainty in the data), not syntactic.
- **AC-32**: The `--degraded` invocation typically produces a `synthesizer:refusal` terminal record (the Synthesizer's structured-JSON confidence falls below 4500 bp due to the inconsistent signals). Because the LLM responses are non-deterministic, this AC is verified by spot-check during the live smoke; the runner does not enforce refusal at the orchestrator level.

### Error envelope handling

- **AC-33**: A Gemini API failure during the Risk Officer call (e.g., HTTP 429 quota, HTTP 403 quota-exhausted-empty, network error) produces an InferenceError envelope. The runner terminates by writing a `synthesizer:refusal` record with `reasonCode: "risk_officer_call_failed"` and `degradedInputs` listing the upstream failure. The chain remains intact.
- **AC-34**: A Vultr Nemotron failure during the Ops Engineer call (post-preflight, e.g., transient 5xx mid-run) produces an InferenceError envelope. The runner terminates by writing a `synthesizer:refusal` record with `reasonCode: "ops_engineer_call_failed"`. The chain remains intact.
- **AC-35**: A Gemini failure during the Synthesizer call (e.g., quota mid-run) produces an InferenceError envelope. The runner writes the terminal `synthesizer:refusal` record directly with `reasonCode: "synthesizer_call_failed"` (since the Synthesizer can't produce its own refusal if it fails). The runner does NOT throw; the chain remains intact.
- **AC-36**: A tool dispatch failure during any voice's segment (e.g., `audit:search` returns an error envelope) does NOT abort the run. The voice's user prompt builder includes the error envelope text in the LLM context ("the system attempted X but encountered: <error code> — <error message>"), letting the LLM reason about partial information. Whether the voice produces hedged reasoning or refuses-by-prompt is at the LLM's discretion.

### Smoke run against real Vultr

- **AC-37**: A `pnpm scenario:a` invocation runs end-to-end against real Vultr Object Storage + real Gemini + real Vultr Inference. The runner reads `.env.local` for `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `GEMINI_API_KEY`, and `VULTR_INFERENCE_API_KEY`. Missing env vars produce a clear exit-non-zero error naming all missing vars at once.
- **AC-38**: A clean Scenario A run (default invocation) writes between 15 and 20 records to the bucket under a single fresh `runId` and exits 0 with a structured PASS report. The PASS report includes: `runId`, `recordCount`, `finalHash`, `genesisHash`, `decision` (one of `"proposal"` or `"refusal"`), `confidence_bp`, `totalElapsedMs`, and per-voice timing breakdowns.
- **AC-39**: A `pnpm scenario:a -- --degraded` invocation produces an analogous PASS report under a different fresh `runId`. The decision typically resolves to `"refusal"` per AC-32 (spot-checked during review).

### Codebase hygiene

- **AC-40**: `pnpm -r typecheck` exits 0 with zero new errors over the Sprint 4b baseline.
- **AC-41**: `pnpm typecheck:scripts` exits 0.
- **AC-42**: `pnpm -r test` exits 0; all existing 230 Sprint-4b-era tests continue to pass; Sprint 4c adds at least 8 new tests (covering `detectAnomalies`, the voice prompt builders, the Synthesizer JSON parse, the orchestrator's terminal-decision branch).
- **AC-43**: No new external dependencies in any `package.json`. Sprint 4c uses only existing deps (`zod`, `openai`, `@aws-sdk/client-s3`, `dotenv`, `tsx`, `vitest`) plus workspace deps from Sprints 1-4b.

---

## Data flow

### Anomaly detector

Input: the loaded `ScenarioAFixtures` object (from `loadScenarioA`).

Output: an array of `Anomaly` objects, each shaped to populate an `anomalyDetectedPayload`:
- `anomalyType` is a stable string identifier (e.g., `iv_rv_ratio_low_bound_breach` or `iv_rv_ratio_high_bound_breach`).
- `severity` is an integer 1-100 derived from the magnitude of the breach (how far the observed ratio is from the threshold).
- `evidence` is a canonicalization-safe object including the symbol, observed ratio (basis points), the threshold that was breached, the surface timestamp, and any other locked evidence fields.
- `detectedAt` is the ISO-8601 ms timestamp at detection time (runner-supplied, typically `new Date().toISOString()`).

The detector iterates `Object.entries(fixtures.marketData)`, computes `ratio_bp = round(impliedVolatility / realizedVolatility * 10000)`, and emits an anomaly whenever the ratio is outside the locked band `[4500, 9500]`.

### Voice user-prompt construction

For each voice, the runner constructs a user prompt that combines:
- The anomaly's content (a human-readable summary of `anomalyType`, `severity`, key evidence fields).
- The voice's tool dispatch results (each tool result is summarized as either success-data text or error-envelope text per AC-36).
- For the Synthesizer: the two upstream reasoning records' `reasoning` fields verbatim.

The user prompt is concatenated with the voice's locked system prompt (per AC-16) and passed to the appropriate `chatCompletion` (Gemini for Risk + Synthesizer; Vultr Nemotron for Ops Engineer).

**Builder purity discipline**: each voice-prompt builder is a pure function. It receives the anomaly, the already-completed tool result data, and (for the Synthesizer) the prior reasoning records. It returns a prompt string. It does NOT touch the dispatcher; it does NOT make tool calls. The orchestrator is the only code path that constructs tool calls. This prevents accidental dispatcher bypass and maintains the AC-10 invariant by construction.

Concrete pattern:
- Orchestrator: `const md = await dispatchTool("market_data:lookup", ...)`
- Orchestrator: `const rb = await dispatchTool("runbook:search", ...)`
- Orchestrator: `const prompt = buildRiskOfficerPrompt(anomaly, md, rb)`
- Orchestrator: `const result = await geminiChatCompletion(client, ...)`

### Synthesizer structured JSON response schema

The Synthesizer's LLM call requests structured JSON. The Zod-defined response schema (locked at plan stage; one of the spec's load-bearing artifacts) contains:

- `decision`: literal union `"proposal" | "refusal"`.
- `confidence_bp`: integer 0-10000.
- `reasoning`: free-text string (assigned to the `synthesizer:reasoning` record).
- When `decision === "proposal"`:
  - `proposal_text`: free-text recommendation TO a human.
  - `supporting_evidence`: array of `{source, claim}` (matching Sprint 3's `supportingEvidenceItemSchema`).
  - `expected_impact`: canonicalization-safe object describing the predicted effect of the proposed action.
- When `decision === "refusal"`:
  - `refusal_reason_code`: stable identifier string.
  - `degraded_inputs`: array of `{source, reason}` (matching Sprint 3's `degradedInputItemSchema`).

The orchestrator runs two audit writes after the LLM call: first `synthesizer:reasoning` (with the `reasoning` field), then the terminal `synthesizer:proposal` OR `synthesizer:refusal` depending on the parsed `decision` and the threshold check.

### `runScenarioA` function

The library function in `@roguemouse/agent` accepts an options object containing at minimum: `writer` (a `RunAuditWriter` already constructed with a fresh runId), `fixtures` (already loaded), `runbookIndex` (already built), and `clients` (an object with `gemini` and `vultr` LLM client instances + locked model names). The function returns a `Promise<ScenarioResult>`.

The thin `scripts/scenario-a.ts` wrapper handles: env loading, S3 client construction, runId generation, writer construction, fixture loading (default or degraded), runbook corpus loading + index building, LLM client construction, then calls `runScenarioA` and prints the structured PASS report.

### `ScenarioResult` shape

- `runId`: UUIDv4 string.
- `recordCount`: integer (typically 15-20).
- `finalHash`: 64-char hex string (the chain's terminal record hash).
- `decision`: `"proposal" | "refusal"`.
- `confidence_bp`: integer 0-10000.
- `totalElapsedMs`: integer.
- `perVoice`: array of `{voice: "risk_officer" | "ops_engineer" | "synthesizer", durationMs: integer}`.
- `perTool`: array of `{name: ToolName, durationMs: integer}` (mirrors Sprint 4b smoke's structure).
- Optionally: `firstKey`, `lastKey` (S3 object keys for spot-check).

---

## Edge cases

- **Case**: Gemini API quota exceeded during the Risk Officer call (HTTP 429 or 403-empty-body per `tasks/lessons.md`).
  **Handling**: InferenceError envelope returned from `geminiChatCompletion`. Orchestrator catches via `if (!result.ok)`. Writes a terminal `synthesizer:refusal` record with `reasonCode: "risk_officer_call_failed"` and `degradedInputs: [{source: "risk_officer", reason: <error.code> + ": " + <error.message>}]`. Chain intact. Exit non-zero with the failure surfaced in the report.

- **Case**: Vultr Nemotron unavailable mid-run (e.g., transient 5xx after a successful pre-flight).
  **Handling**: Mirror AC-33 / AC-34. `synthesizer:refusal` with `reasonCode: "ops_engineer_call_failed"`. Chain intact. Exit non-zero.

- **Case**: Synthesizer Gemini call succeeds but returns malformed JSON.
  **Handling**: Zod parse fails on the response. Runner writes terminal `synthesizer:refusal` with `reasonCode: "synthesizer_malformed_response"` and `degradedInputs: [{source: "synthesizer_response", reason: <zod_error_summary>}]`. Chain intact.

- **Case**: Synthesizer call succeeds, JSON parses, but `confidence_bp` is outside 0-10000.
  **Handling**: Zod parse rejects (the schema constrains `confidence_bp` to `z.number().int().min(0).max(10000)`). Same handling as malformed JSON (AC-21 / AC-20).

- **Case**: Synthesizer's `decision` is `"proposal"` but `confidence_bp < 4500`.
  **Handling**: Per AC-22, the orchestrator's threshold check overrides the model's stated decision. Writes a `synthesizer:refusal` with `reasonCode: "low_confidence"`. The Synthesizer's reasoning record was written truthfully (it still ran); only the terminal record's type is determined by the threshold.

- **Case**: Synthesizer's `decision` is `"refusal"` but `confidence_bp >= 4500`.
  **Handling**: Per AC-22, the runner respects the model's explicit refusal regardless of confidence value. The model may refuse for reasons unrelated to confidence (e.g., insufficient information). Writes a `synthesizer:refusal` with the model's `refusal_reason_code` and `degraded_inputs`.

- **Case**: Tool dispatch failure during the Risk Officer segment (e.g., `runbook:search` throws inside the impl, surfaced as `tool_threw_internal`).
  **Handling**: Per Sprint 4b's dispatcher contract, the tool returns an error envelope (the dispatcher's defensive try/catch). The Risk Officer's user prompt builder includes the error envelope as part of the prompt context ("the system attempted runbook:search but returned: code=tool_threw_internal, message=..."). The voice reasons over the partial information. The chain continues; no early termination.

- **Case**: Tool dispatch failure during the Ops Engineer segment (e.g., `audit:search` LIST returns AccessDenied).
  **Handling**: Same as Risk Officer case. Voice reasons over partial info.

- **Case**: `audit:search` returns zero historical anomaly records (the bucket has no prior `anomaly:detected` for this prefix).
  **Handling**: This is NOT an error. `audit:search` returns `{records: [], hasMore: false}` as success. The Ops Engineer's user prompt includes "no prior anomalies found in audit log" as context. The voice reasons normally.

- **Case**: `--degraded` flag passed but `fixtures/scenario-a-degraded/` directory does not exist.
  **Handling**: `loadScenarioA(rootDir)` throws the existing Phase 1 "Fixture file not found" error from `@roguemouse/tools`. The runner catches and exits non-zero before the writer is constructed; no audit records are written for the failed bootstrap.

- **Case**: Vultr Nemotron pre-flight succeeds but the model rotates out during the run (vanishingly unlikely; vendor catalog changes are typically deployment-time, not session-time).
  **Handling**: The mid-run failure surfaces as AC-34. Same envelope; same handling.

- **Case**: `pnpm scenario:a` run produces 14 records (one short of the 15 minimum due to a tool dispatch never being written).
  **Handling**: Per spec, the dispatcher always writes `tool:call` and `tool:result` records pairwise; a 14-record run would indicate an envelope-discipline violation. The smoke runner's verifier should report this as a FAIL (similar to Sprint 4b's record-count check), naming the runId for forensics.

- **Case**: `pnpm scenario:a` invoked without `.env.local` present.
  **Handling**: Same as Sprint 4a / Sprint 4b smoke patterns. Clear exit-non-zero with a structured error naming the missing file path.

- **Case**: `--degraded` flag's degraded fixtures produce confidence >= 4500 anyway (Synthesizer is decisive despite uncertain inputs).
  **Handling**: The run proposes (per AC-22). This is unusual but acceptable; the model's reasoning is preserved in the audit log. The operator can rerun or accept the result. AC-32 explicitly notes the LLM non-determinism caveat.

---

## Out of scope

- **Scenarios B and C** — Sprint 5 work (deferred per Scope C). The detector's band is general but no second/third anomaly type is wired for Sprint 4c.
- **HTTP endpoint** — Sprint 6/7 work. The `runScenarioA` library function is the durable abstraction; the script is one wrapper; a future HTTP route is another.
- **Multi-round debate (Sprint 4c brainstorm 1C)** — locked at 1A (strict sequence). Sprint 7 polish may revisit if demo storytelling benefits.
- **LLM-driven tool calling (Sprint 4c brainstorm 2B)** — locked at 2A (hardcoded sequences). The architectural rule in `.claude/rules/vultr.md` makes 2B nontrivial.
- **Cost aggregation across runs** — Sprint 7 polish. Per-voice tokens are recorded in audit payloads but not aggregated at run-end.
- **Persistent state across runs** — out of scope. Each `runScenarioA` invocation generates a fresh `runId` and constructs a fresh `RunAuditWriter`. No multi-run chain merging.
- **Web UI** — Sprint 6/7. Sprint 4c is invocable only via `pnpm scenario:a`.
- **Demo video, slide deck, submission copy** — Sprint 7.
- **Multiple anomalies per run** — `detectAnomalies` returns `Anomaly[]` for extensibility, but Sprint 4c processes only the first element (`anomalies[0]`). If the array is empty, Sprint 4c exits before invoking any voice with a non-zero exit and a clear message.
- **Circuit breakers around LLM calls** — `.claude/rules/vultr.md:137-146` recommends them; Sprint 4c does NOT add them. Sprint 7 polish.
- **Retries with exponential backoff** — out of scope. A failed call surfaces as a refusal terminal per AC-33/34/35.
- **Calibration of `confidence_bp` for Risk/Ops voices via separate calls** — Sprint 4c uses a heuristic per AC-13. Sprint 7 may revisit.
- **`human:approval` / `human:rejection` / `final:committed` records** — locked at brainstorm Q7 (chain stops at synthesizer:proposal/refusal).
- **Pre-flight check for Gemini API quota** — out of scope. Only Vultr Nemotron has a pre-flight per AC-28 / Q4. Gemini quota failures during the run are handled as AC-33/AC-35.
- **Schema-validation of audit records on read-back** — the runner does not include a chain-verification step at the end of `runScenarioA` (unlike Sprint 4b's smoke). Sprint 4c's verifier responsibility is at the writer's safeParse layer, not the runner's. Sprint 4b's `scripts/smoke-dispatch.ts` remains available for chain-verification if needed.

---

## Rollback plan

Sprint 4c is composition-heavy and additive. Every change is either a new file in `@roguemouse/agent` or an addition to an existing file. The smoke run produces immutable audit records that are harmless.

- **Phase 1 — anomaly detector + degraded fixture set**. New module in `@roguemouse/agent`; new `fixtures/scenario-a-degraded/` directory. Rollback: `git restore` the agent package and the new fixture directory.

- **Phase 2 — voice prompt builders + Synthesizer structured response schema**. 3 new prompt modules + 1 response-schema module in `@roguemouse/agent`. Rollback: `git restore` the agent package.

- **Phase 3 — confidence extractors (Risk/Ops heuristic + Synthesizer threshold logic)**. New module(s) in `@roguemouse/agent`. Rollback: revert the agent package changes.

- **Phase 4 — `runScenarioA` orchestrator function**. The main composition function in `@roguemouse/agent`. Rollback: revert the agent package.

- **Phase 5 — Vultr Nemotron pre-flight + LLM-client construction wiring**. Pre-flight added to either the orchestrator or the script (plan-stage decision). Rollback: revert the relevant file.

- **Phase 6 — `scripts/scenario-a.ts` script + root `package.json` script entry**. New script + new `"scenario:a"` entry. Rollback: delete the script, revert `package.json`.

- **Phase 7 — pre-flight + live smoke run** (both clean and `--degraded`). Operator confirms `.env.local` (S3 + Gemini + Vultr Inference keys). Runs produce records in the bucket. Rollback at the code level: revert prior phases. Rollback at the bucket level: nothing to do — records are immutable and harmless, contributing to the historical run log.

- **Phase 8 — `/review-task`** produces `review.md` only. Rollback: delete the document.

If the entire sprint must be rolled back: revert every commit on the sprint branch, run `pnpm install`, leave the Phase 7 audit records in the bucket where they are.

---

## Preconditions

- Sprint 4b's commits `ce4f38a` (feat) and `b9e0349` (docs) are on `main`. Working tree clean.
- Node 20.x and pnpm 10.27+ installed; `pnpm install` runs successfully.
- `.env.local` present at repo root with: `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `GEMINI_API_KEY`, `VULTR_INFERENCE_API_KEY`. The last is new to Sprint 4c (Sprint 4a + 4b's smokes did not need it; Sprint 2's smoke did).
- Vultr Object Storage bucket `roguemouse-audit-log` (region `ams1`) reachable; access key has read+write+list permissions (verified in Sprint 4b Phase 6).
- Vultr Serverless Inference subscription active; the configured Nemotron model (per `.claude/rules/vultr.md` + `ROGUEMOUSE_CONTEXT.md`) is reachable from the AMS1 endpoint.
- Gemini API key valid for `gemini-2.5-flash` (Sprint 4a's verified model). Free-tier quota suffices for ~10 Scenario A runs based on Sprint 4a's token measurements.
- The 5 runbook files in `packages/runbooks/content/` are unchanged from Sprint 4b (commit `0e7681b`).
- The 4 clean Scenario A fixture files in `fixtures/scenario-a/` are unchanged from Sprint 4b (commit `ce4f38a`).
- Operator has outbound network access to `https://ams1.vultrobjects.com`, `https://api.vultrinference.com`, and `https://generativelanguage.googleapis.com`.

---

## Stop gate

When the spec is approved, proceed to `/plan-task`. Do not start implementation before the plan is approved.
