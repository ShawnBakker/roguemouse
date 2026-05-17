# scenario-a-multi-agent-debate — Plan

## Summary

Sprint 4c lands in 8 phases. The architectural surface is smaller than Sprint 4b's (no new package boundaries, no new infrastructure primitives) — Sprint 4c composes existing pieces into the demo. The risk concentration is in Phases 6 (orchestrator) and 8 (live smokes), with the orchestrator being where all prior phases compose and the live smokes being the first time real LLM calls land alongside the new structured-JSON parsing logic.

Anti-patterns from `tasks/lessons.md` (now 5 entries):
- **Markdown-wrapper strip (2026-05-14)**: applicable to any operator-paste of file content.
- **Conditional package exports (2026-05-14)**: not in play — Sprint 4c adds no new packages.
- **Gemini 403-empty-body (2026-05-16)**: directly relevant — the Sprint 4c Synthesizer + Risk Officer calls are Gemini. If a call surfaces an `http_403` with empty message, the diagnosis path is to probe the native Gemini endpoint to distinguish auth vs quota.
- **Gemini free-tier Pro quota=0 (2026-05-16)**: not in play — Sprint 4c uses `gemini-2.5-flash` per `ROGUEMOUSE_CONTEXT.md` locked model decision; no Pro calls.
- **Dispatcher recursion-guard literal regex (2026-05-17)**: not in play for Sprint 4c's new code (the guard is in `packages/agent/src/dispatcher.ts`, which Sprint 4c does NOT modify).

Phase exit criteria are concrete and operator-verifiable. The two-commit pattern matching Sprints 3 / 4a / 4b applies at sprint close (Phase 8).

---

## Phase 1 — Anomaly detector + degraded fixture set

### Goal
Land the `detectAnomalies` function in `@roguemouse/agent` and create the `fixtures/scenario-a-degraded/` directory. After this phase, both the clean and degraded fixture sets load via the existing `loadScenarioA` path, and the detector returns the expected anomaly for each.

### Files touched

- **NEW**: `packages/agent/src/anomaly.ts` (the `Anomaly` type + `detectAnomalies` function)
- **NEW**: `packages/agent/src/__tests__/anomaly.test.ts`
- **NEW**: `fixtures/scenario-a-degraded/market-data.json`
- **NEW**: `fixtures/scenario-a-degraded/positions.json`
- **NEW**: `fixtures/scenario-a-degraded/broker-positions.json`
- **NEW**: `fixtures/scenario-a-degraded/anomaly-evidence.json`
- **MODIFIED**: `packages/agent/src/index.ts` (re-export `detectAnomalies` + `Anomaly` type)
- **MODIFIED**: `packages/agent/package.json` (add `@roguemouse/tools` workspace dep — needed for the `ScenarioAFixtures` type)

### Step-by-step

1. Create `packages/agent/src/anomaly.ts`. Define:
   ```typescript
   import type { ScenarioAFixtures } from "@roguemouse/tools";

   export type Anomaly = {
     anomalyType: string;
     severity: number;          // int 1-100
     symbol: string;
     observedRatioBp: number;   // int 0-10000
     thresholdBp: number;       // int 0-10000
     surfaceTs: string;         // ISO ms
     detectedAt: string;        // ISO ms, runner-supplied
   };

   const LOW_BOUND_BP = 4500;
   const HIGH_BOUND_BP = 9500;

   export function detectAnomalies(
     fixtures: ScenarioAFixtures,
     detectedAt: string,
   ): Anomaly[] {
     const results: Anomaly[] = [];
     for (const [symbol, md] of Object.entries(fixtures.marketData)) {
       if (md.realizedVolatility === 0) continue; // defensive
       const ratioBp = Math.round((md.impliedVolatility / md.realizedVolatility) * 10000);
       if (ratioBp < LOW_BOUND_BP) {
         results.push({
           anomalyType: "iv_rv_ratio_low_bound_breach",
           severity: clampSeverity(LOW_BOUND_BP - ratioBp),
           symbol, observedRatioBp: ratioBp, thresholdBp: LOW_BOUND_BP,
           surfaceTs: md.surfaceTs, detectedAt,
         });
       } else if (ratioBp > HIGH_BOUND_BP) {
         results.push({
           anomalyType: "iv_rv_ratio_high_bound_breach",
           severity: clampSeverity(ratioBp - HIGH_BOUND_BP),
           symbol, observedRatioBp: ratioBp, thresholdBp: HIGH_BOUND_BP,
           surfaceTs: md.surfaceTs, detectedAt,
         });
       }
     }
     return results;
   }
   ```
   Helper `clampSeverity(diff)` maps the breach magnitude to a severity 1-100 (e.g., `Math.min(100, Math.max(1, Math.round(diff / 30)))` — 30 bp per severity step, gives severity 75 for AAPL's 300bp breach at 4200 vs 4500).

2. Create `packages/agent/src/__tests__/anomaly.test.ts`:
   - **Low-bound breach**: AAPL at 1680/4000 (ratio 4200 bp) → emits one `iv_rv_ratio_low_bound_breach` anomaly with severity ~10.
   - **High-bound breach**: AAPL at 9800/10000 (ratio 9800 bp) → emits one `iv_rv_ratio_high_bound_breach` anomaly.
   - **In-band**: AAPL at 3000/5000 (ratio 6000 bp) → no anomaly emitted.
   - **Empty marketData**: returns `[]`.
   - **Multiple breaches**: AAPL low + MSFT high → returns 2 anomalies.
   - **Defensive RV=0**: returns `[]` for that symbol (no divide-by-zero).

3. Author `fixtures/scenario-a-degraded/*.json`. All 4 files mirror the clean set's schema. Locked degraded values (per Amendment 2 — tightened for reliable refusal):
   - `market-data.json`: AAPL `{spotPrice: 19450, impliedVolatility: 1760, realizedVolatility: 4000, surfaceTs: "2026-05-16T09:31:14.000Z"}` (ratio 1760/4000 = 0.44 = 4400 bp; just barely below 4500 threshold). MSFT and GOOGL unchanged from clean.
   - `positions.json`: AAPL quantity 200 (vs 100 clean); other positions unchanged.
   - `broker-positions.json`: AAPL quantity 140 (vs 200 internal — **60-share divergence**, 30% reconciliation problem; much more concerning than a modest divergence). MSFT and GOOGL unchanged.
   - `anomaly-evidence.json`: `observedValue: 4400` (matches the new degraded IV/RV ratio); `lowBoundThreshold: 4500`; other fields unchanged.

   Reasoning: the original draft values (0.43 ratio + 25-share divergence) might allow the Synthesizer to reason "borderline breach + modest divergence = recommend modest action with confidence ~5500" — which would propose, not refuse. The tightened values (0.44 ratio + 60-share divergence) push toward "the system can't trust its own state; I should refuse." If even these don't reliably refuse in Phase 8, plan for fixture-tuning iteration during the live smoke (AC-32 explicitly accepts spot-check verification due to LLM non-determinism).

4. Update `packages/agent/src/index.ts`: re-export `detectAnomalies` + `Anomaly` type.

5. Update `packages/agent/package.json` to add `@roguemouse/tools` as a workspace dep. Run `pnpm install`.

6. Validation:
   - `pnpm --filter @roguemouse/agent typecheck`
   - `pnpm --filter @roguemouse/agent test` (verify 6+ new tests pass alongside the existing 9 dispatcher tests)
   - `pnpm exec tsx -e 'import("@roguemouse/tools").then(({loadScenarioA}) => loadScenarioA(process.cwd()).then(f => console.log("clean OK", Object.keys(f.marketData))))'` — verify clean fixtures still load
   - Same probe with `loadScenarioA("./fixtures-degraded-test")` after temporarily symlinking, OR a one-off tsx script that loads from `fixtures/scenario-a-degraded/` to confirm Zod parses cleanly (the loader currently joins with `fixtures/scenario-a/`; Phase 7's runner adjusts the path)

### Test strategy

- Unit tests in `packages/agent/__tests__/anomaly.test.ts`.
- Manual fixture-load probe via one-off tsx (delete after verification, per Phase 2 / Phase 6 precedent).

### Anti-patterns to avoid

- **Markdown-wrapper strip**: JSON fixture files don't use leading `#` or `*` characters at line starts; safe. But if the operator wants to paste content for me to write verbatim, verify on-disk after Write.
- **Conditional exports**: `@roguemouse/agent` already has the `exports` block from Sprint 4b. New modules pass through the barrel unconditionally.

### Phase exit criteria

- [ ] `detectAnomalies(fixtures, detectedAt)` exported from `@roguemouse/agent` with correct signature
- [ ] `Anomaly` type exported from `@roguemouse/agent`
- [ ] All 6+ `anomaly.test.ts` Vitest cases pass
- [ ] `fixtures/scenario-a-degraded/` contains 4 JSON files, all Zod-parseable via `loadScenarioA`
- [ ] `pnpm --filter @roguemouse/agent typecheck` exits 0
- [ ] `pnpm -r typecheck` exits 0 (cross-package regression)

### Phase rollback

- `git restore packages/agent/src/ packages/agent/package.json fixtures/scenario-a-degraded/`
- No mutable state outside the repo.

---

## Phase 2 — Voice prompt builders + system prompts

### Goal
Land the three voice system prompts (Risk Officer, Ops Engineer, Synthesizer) and the three pure prompt-builder functions that compose system + user prompts. Each system prompt satisfies the AC-16 governance-language contract and the AC-16a programmatic substring checks.

### Files touched

- **NEW**: `packages/agent/src/voices/systemPrompts.ts` (3 constant strings)
- **NEW**: `packages/agent/src/voices/riskOfficerPrompt.ts` (pure builder)
- **NEW**: `packages/agent/src/voices/opsEngineerPrompt.ts` (pure builder)
- **NEW**: `packages/agent/src/voices/synthesizerPrompt.ts` (pure builder)
- **NEW**: `packages/agent/src/voices/__tests__/systemPrompts.test.ts` (AC-16a substring checks)
- **NEW**: `packages/agent/src/voices/__tests__/riskOfficerPrompt.test.ts`
- **NEW**: `packages/agent/src/voices/__tests__/opsEngineerPrompt.test.ts`
- **NEW**: `packages/agent/src/voices/__tests__/synthesizerPrompt.test.ts`
- **MODIFIED**: `packages/agent/src/index.ts` (re-export prompt builders + system prompt constants)

### Step-by-step

1. Author `packages/agent/src/voices/systemPrompts.ts`. Three constant strings, each ~150-250 words:

   **`RISK_OFFICER_SYSTEM_PROMPT`** (sample shape; exact wording at implementation discretion):
   > You are a Risk Officer at a governance layer that monitors algorithmic trading systems. Your role is to assess exposure risk when anomalies are detected and to advise on potential remediation. You do NOT execute trades. You do NOT mutate system state. You advise; a human operator decides whether to act on your recommendations. Every reasoning step you produce will be cryptographically audit-logged and reviewable by regulators.
   > 
   > Given an anomaly notification and the current market state, reason about: (1) the magnitude of the risk exposure, (2) whether the data quality is sufficient to recommend action, (3) historical context for similar anomalies. Be specific. Cite the numbers you were given. Hedge if the data is inconsistent. Refuse to recommend if confidence is too low — silence is acceptable when the inputs don't warrant action.

   **`OPS_ENGINEER_SYSTEM_PROMPT`** (sample shape):
   > You are an Operations Engineer at a governance layer that monitors algorithmic trading systems. Your role is to inspect system state — positions, broker reconciliation, historical audit records — when anomalies are flagged, and to advise on operational integrity. You do NOT execute trades. You do NOT mutate system state. You advise; a human operator decides whether to act. Every reasoning step is cryptographically audit-logged.
   > 
   > Given an anomaly notification and snapshots of internal state, reason about: (1) whether the system's position state matches the broker's view, (2) whether historical context suggests this anomaly is novel or recurring, (3) whether operational concerns warrant remediation. Recommend specific actions ONLY if the data is consistent.

   **`SYNTHESIZER_SYSTEM_PROMPT`** (sample shape):
   > You are a Synthesizer at a governance layer that monitors algorithmic trading systems. Your role is to reconcile the Risk Officer's and Ops Engineer's perspectives and produce a structured decision. You do NOT execute trades. You do NOT mutate system state. You recommend; a human operator decides. Every reasoning step is cryptographically audit-logged.
   > 
   > You will respond with JSON matching exactly this schema:
   > ```
   > {
   >   "decision": "proposal" | "refusal",
   >   "confidence_bp": <integer 0-10000>,
   >   "reasoning": "<string explaining your synthesis>",
   >   // if decision is "proposal":
   >   "proposal_text": "<recommendation TO a human operator>",
   >   "supporting_evidence": [{"source": "...", "claim": "..."}, ...],
   >   "expected_impact": {<canonical-safe object>},
   >   // if decision is "refusal":
   >   "refusal_reason_code": "<stable identifier>",
   >   "degraded_inputs": [{"source": "...", "reason": "..."}, ...]
   > }
   > ```
   > Choose "refusal" when: voice perspectives substantially disagree, key inputs are missing or stale, or your confidence is below 4500 basis points. The `proposal_text` (when used) must be phrased as a recommendation TO a human, not as an imperative action.

   Each prompt contains: `"advise"` OR `"recommend"`, `"audit"`, NO `"execute trade"` / `"execute the trade"` / `"mutate state"`. Verified by AC-16a tests.

2. Author `packages/agent/src/voices/riskOfficerPrompt.ts`:
   ```typescript
   import type { Anomaly } from "../anomaly.js";
   import type { ToolResult, DataFor } from "@roguemouse/schemas";

   export function buildRiskOfficerUserPrompt(
     anomaly: Anomaly,
     marketData: ToolResult<DataFor<"market_data:lookup">>,
     runbookSearch: ToolResult<DataFor<"runbook:search">>,
   ): string {
     const lines: string[] = [
       `ANOMALY DETECTED:`,
       `  Type: ${anomaly.anomalyType}`,
       `  Symbol: ${anomaly.symbol}`,
       `  Severity: ${anomaly.severity}/100`,
       `  Observed IV/RV ratio: ${(anomaly.observedRatioBp / 10000).toFixed(4)} (threshold: ${(anomaly.thresholdBp / 10000).toFixed(4)})`,
       `  Surface timestamp: ${anomaly.surfaceTs}`,
       `  Detected at: ${anomaly.detectedAt}`,
       ``,
       `MARKET DATA LOOKUP:`,
     ];
     if (marketData.ok) {
       lines.push(`  spotPrice: ${marketData.data.spotPrice} (cents)`);
       lines.push(`  impliedVolatility: ${marketData.data.impliedVolatility} bp`);
       lines.push(`  realizedVolatility: ${marketData.data.realizedVolatility} bp`);
       lines.push(`  surfaceTs: ${marketData.data.surfaceTs}`);
     } else {
       lines.push(`  ERROR: code=${marketData.error.code} message=${marketData.error.message}`);
     }
     lines.push("", `RUNBOOK SEARCH:`);
     if (runbookSearch.ok) {
       runbookSearch.data.matches.forEach((m, i) => {
         lines.push(`  ${i + 1}. ${m.path} (relevance ${m.relevanceScore} bp)`);
         lines.push(`     excerpt: ${m.excerpt}`);
       });
       if (runbookSearch.data.matches.length === 0) {
         lines.push(`  (no runbook matches found)`);
       }
     } else {
       lines.push(`  ERROR: code=${runbookSearch.error.code} message=${runbookSearch.error.message}`);
     }
     lines.push("", "Reason about the exposure risk and advise on whether a recommendation is warranted. Be specific about which inputs informed your reasoning. If data quality is degraded, say so.");
     return lines.join("\n");
   }
   ```
   The builder is a pure function — no side effects, no dispatcher access, no tool calls.

3. Author `packages/agent/src/voices/opsEngineerPrompt.ts` analogously. Takes the anomaly + 3 tool results (`position:snapshot`, `broker:reconcile`, `audit:search`).

4. Author `packages/agent/src/voices/synthesizerPrompt.ts`. Takes the anomaly + the two prior reasoning records' `reasoning` fields (as strings) + the two voices' `input` fields. Constructs a user prompt summarizing both upstream perspectives. The system prompt (set 1) already describes the response schema; the user prompt provides the inputs.

5. Author the 4 test files:
   - `systemPrompts.test.ts` — AC-16a substring checks (3 prompts × 3 assertions each = 9 tests).
   - `riskOfficerPrompt.test.ts` — happy path (tool results all ok), tool-failure path (one tool error envelope embedded), edge case (empty runbook matches).
   - `opsEngineerPrompt.test.ts` — same shape.
   - `synthesizerPrompt.test.ts` — happy path, governance-grammar check on output structure.

6. Update `packages/agent/src/index.ts` to re-export prompt builders + system prompts (system prompts re-exported so Sprint 7 polish can iterate without forking).

7. Validation:
   - `pnpm --filter @roguemouse/agent typecheck`
   - `pnpm --filter @roguemouse/agent test`

### Test strategy

- AC-16a: 9 substring assertions (3 per voice × 3 checks: `"advise"|"recommend"`, `"audit"`, NOT `"execute trade"|"execute the trade"|"mutate state"`).
- Builder purity: each test constructs inputs in-memory, calls the builder, asserts the returned string contains expected substrings. No mocking needed — the builders are pure.

### Anti-patterns to avoid

- **Markdown-wrapper strip**: the prompt strings will be multi-line template literals with `:` and `#`-free content; risk is low. If you ever paste new prompt copy for me to write, verify on-disk after.
- **AC-16 / AC-16a regression**: the substring checks catch this. If a future edit removes the `"advise"` word, the test fails.

### Phase exit criteria

- [ ] 3 system-prompt constants exist, all pass AC-16a substring checks
- [ ] 3 pure prompt-builder functions exist, no dispatcher imports
- [ ] All 4 test files pass (15+ tests total)
- [ ] `pnpm --filter @roguemouse/agent typecheck` exits 0

### Phase rollback

- `git restore packages/agent/src/voices/ packages/agent/src/index.ts`

---

## Phase 3 — Synthesizer structured response Zod schema

### Goal
Define the Zod schema for the Synthesizer's structured JSON response. Discriminated union on the `decision` field. Unit tests cover parse success (both branches), malformed JSON, out-of-range confidence, and missing required fields.

### Files touched

- **NEW**: `packages/agent/src/voices/synthesizerResponseSchema.ts`
- **NEW**: `packages/agent/src/voices/__tests__/synthesizerResponseSchema.test.ts`
- **MODIFIED**: `packages/agent/src/index.ts` (re-export schema + inferred type)

### Step-by-step

1. Create `packages/agent/src/voices/synthesizerResponseSchema.ts`:
   ```typescript
   import { z } from "zod";
   import { canonicalSafeSchema } from "@roguemouse/schemas";

   const supportingEvidenceItem = z.object({
     source: z.string().min(1),
     claim: z.string().min(1),
   }).strict();

   const degradedInputItem = z.object({
     source: z.string().min(1),
     reason: z.string().min(1),
   }).strict();

   const proposalBranchSchema = z.object({
     decision: z.literal("proposal"),
     confidence_bp: z.number().int().min(0).max(10000),
     reasoning: z.string().min(1),
     proposal_text: z.string().min(1),
     supporting_evidence: z.array(supportingEvidenceItem),
     expected_impact: canonicalSafeSchema,
   }).strict();

   const refusalBranchSchema = z.object({
     decision: z.literal("refusal"),
     confidence_bp: z.number().int().min(0).max(10000),
     reasoning: z.string().min(1),
     refusal_reason_code: z.string().min(1),
     degraded_inputs: z.array(degradedInputItem),
   }).strict();

   export const synthesizerResponseSchema = z.discriminatedUnion("decision", [
     proposalBranchSchema,
     refusalBranchSchema,
   ]);

   export type SynthesizerResponse = z.infer<typeof synthesizerResponseSchema>;
   ```
   Note: `@roguemouse/agent` will need `zod` as a workspace dep — verify it's already transitively available via `@roguemouse/schemas` and add direct if not.

2. Add `zod` to `packages/agent/package.json` dependencies if not already present (currently it's a transitive dep through schemas/tools; making it direct is correct per the stack rule about avoiding implicit transitives).

3. Create `synthesizerResponseSchema.test.ts`:
   - **Happy proposal**: valid proposal-shape JSON parses; inferred type is the proposal branch.
   - **Happy refusal**: valid refusal-shape JSON parses.
   - **Mixed-branch**: object with both `proposal_text` AND `refusal_reason_code` fails the strict union (each branch's `.strict()` rejects extra keys).
   - **Out-of-range confidence (negative)**: `confidence_bp: -100` fails parse.
   - **Out-of-range confidence (>10000)**: `confidence_bp: 15000` fails parse.
   - **Non-integer confidence**: `confidence_bp: 4500.5` fails parse.
   - **Missing decision**: object lacking `decision` field fails the union.
   - **Invalid decision literal**: `decision: "uncertain"` fails the union.
   - **Empty reasoning**: `reasoning: ""` fails parse (min(1)).
   - **Empty supporting_evidence**: `supporting_evidence: []` PASSES (array of 0+ items is valid; the spec doesn't require ≥1).
   - **Malformed nested supporting_evidence**: array with `{source: "x"}` (missing `claim`) fails.

4. Update `packages/agent/src/index.ts` to re-export `synthesizerResponseSchema` and `SynthesizerResponse` type.

5. Validation:
   - `pnpm --filter @roguemouse/agent typecheck`
   - `pnpm --filter @roguemouse/agent test`

### Test strategy

- 11 Zod schema tests covering happy paths + each constraint failure independently.

### Anti-patterns to avoid

- **Conditional exports**: `@roguemouse/agent` already has exports block; safe.

### Phase exit criteria

- [ ] `synthesizerResponseSchema` exported with discriminated union over "decision"
- [ ] `SynthesizerResponse` type exported
- [ ] All 11+ schema tests pass
- [ ] `pnpm --filter @roguemouse/agent typecheck` exits 0

### Phase rollback

- `git restore packages/agent/src/voices/synthesizerResponseSchema.ts packages/agent/src/voices/__tests__/synthesizerResponseSchema.test.ts packages/agent/src/index.ts`

---

## Phase 4 — Confidence extractors

### Goal
Land the Risk/Ops placeholder constant + the Synthesizer's parse-and-threshold logic. Per AC-13 (locked Amendment 1), Risk/Ops confidence is a 5000 placeholder; the Synthesizer's confidence is real and load-bearing.

### Files touched

- **NEW**: `packages/agent/src/voices/confidence.ts`
- **NEW**: `packages/agent/src/voices/__tests__/confidence.test.ts`
- **MODIFIED**: `packages/agent/src/index.ts` (re-export constants + threshold function)

### Step-by-step

1. Create `packages/agent/src/voices/confidence.ts`:
   ```typescript
   import { synthesizerResponseSchema, type SynthesizerResponse } from "./synthesizerResponseSchema.js";

   /**
    * Sprint 4c placeholder constant for the Risk Officer and Ops Engineer
    * reasoning records' `confidence` field. These voices are advisors,
    * not deciders — their confidence is informational, not consumed by
    * any decision logic. The Synthesizer's confidence IS load-bearing
    * (drives proposal-vs-refusal via the SYNTHESIZER_CONFIDENCE_THRESHOLD_BP
    * threshold below).
    *
    * Real calibration is Sprint 7 polish (see tasks/todo.md entry from
    * 2026-05-17). Until then, honest placeholders are better than
    * plausibly-wrong heuristics.
    */
   export const RISK_OPS_PLACEHOLDER_CONFIDENCE_BP = 5000;

   /**
    * Synthesizer's confidence threshold for the proposal-vs-refusal
    * decision (locked at spec AC-22). Below this, the run produces a
    * refusal; at or above, a proposal (subject to the model's stated
    * decision per AC-22's full logic).
    */
   export const SYNTHESIZER_CONFIDENCE_THRESHOLD_BP = 4500;

   export type SynthesizerParseResult =
     | { ok: true; response: SynthesizerResponse }
     | { ok: false; reasonCode: string; degradedInputs: Array<{source: string; reason: string}> };

   /**
    * Parse the Synthesizer's raw response string. Returns either the
    * validated structured response or a structured failure envelope
    * suitable for emitting as a synthesizer:refusal record.
    */
   export function parseSynthesizerResponse(raw: string): SynthesizerParseResult {
     let parsed: unknown;
     try {
       parsed = JSON.parse(raw);
     } catch (err) {
       return {
         ok: false,
         reasonCode: "synthesizer_malformed_response",
         degradedInputs: [{
           source: "synthesizer_response",
           reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
         }],
       };
     }
     const zodResult = synthesizerResponseSchema.safeParse(parsed);
     if (!zodResult.success) {
       return {
         ok: false,
         reasonCode: "synthesizer_malformed_response",
         degradedInputs: [{
           source: "synthesizer_response",
           reason: `schema validation failed: ${zodResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
         }],
       };
     }
     return { ok: true, response: zodResult.data };
   }

   /**
    * Apply the proposal-vs-refusal threshold rule (spec AC-22). Returns
    * the terminal recordType the orchestrator should emit.
    *
    * Rules:
    * - If response.decision === "refusal": always refusal (respect the
    *   model's explicit refusal regardless of confidence).
    * - If response.decision === "proposal" && confidence_bp >= 4500:
    *   proposal.
    * - If response.decision === "proposal" && confidence_bp < 4500:
    *   refusal (threshold override).
    */
   export function resolveTerminalDecision(
     response: SynthesizerResponse,
   ): "proposal" | "refusal" {
     if (response.decision === "refusal") return "refusal";
     if (response.confidence_bp >= SYNTHESIZER_CONFIDENCE_THRESHOLD_BP) return "proposal";
     return "refusal";
   }
   ```

2. Create `confidence.test.ts`:
   - **`RISK_OPS_PLACEHOLDER_CONFIDENCE_BP === 5000`**.
   - **`SYNTHESIZER_CONFIDENCE_THRESHOLD_BP === 4500`**.
   - **`parseSynthesizerResponse` happy proposal**: valid JSON proposal → `ok: true, response: <proposal branch>`.
   - **`parseSynthesizerResponse` happy refusal**: valid JSON refusal → `ok: true, response: <refusal branch>`.
   - **`parseSynthesizerResponse` malformed JSON**: `"not json"` → `ok: false, reasonCode: synthesizer_malformed_response, degradedInputs: [{source: "synthesizer_response", reason: <JSON parse fail msg>}]`.
   - **`parseSynthesizerResponse` schema failure**: valid JSON but wrong shape (e.g., missing `decision`) → `ok: false` with schema-validation reason.
   - **`resolveTerminalDecision` proposal at 4500**: returns `"proposal"` (>=, not >).
   - **`resolveTerminalDecision` proposal at 4499**: returns `"refusal"` (threshold override).
   - **`resolveTerminalDecision` refusal at 9999**: returns `"refusal"` (model's explicit refusal respected).
   - **`resolveTerminalDecision` proposal at 0**: returns `"refusal"`.

3. Update `packages/agent/src/index.ts` to re-export the constants + functions.

4. Validation:
   - `pnpm --filter @roguemouse/agent typecheck`
   - `pnpm --filter @roguemouse/agent test`

### Test strategy

- 10 confidence/parse/threshold tests covering all branches of the logic.

### Anti-patterns to avoid

- None directly applicable.

### Phase exit criteria

- [ ] `RISK_OPS_PLACEHOLDER_CONFIDENCE_BP` and `SYNTHESIZER_CONFIDENCE_THRESHOLD_BP` constants exported
- [ ] `parseSynthesizerResponse` and `resolveTerminalDecision` functions exported
- [ ] All 10+ confidence tests pass
- [ ] JSDoc on the placeholder constant references the Sprint 7 todo entry

### Phase rollback

- `git restore packages/agent/src/voices/confidence.ts packages/agent/src/voices/__tests__/confidence.test.ts packages/agent/src/index.ts`

---

## Phase 5 — Vultr Nemotron pre-flight check

### Goal
Land the pre-flight probe that runs before the Ops Engineer voice is invoked. A small chat-completion against the configured Vultr Nemotron model; abort with remediation on failure (AC-28 / AC-29).

### Files touched

- **NEW**: `packages/agent/src/preflight.ts`
- **NEW**: `packages/agent/src/__tests__/preflight.test.ts`
- **MODIFIED**: `packages/agent/src/index.ts` (re-export pre-flight function)

### Step-by-step

1. Create `packages/agent/src/preflight.ts`:
   ```typescript
   import type { OpenAI } from "openai";
   import { chatCompletion } from "@roguemouse/inference";

   export type PreflightResult =
     | { ok: true }
     | { ok: false; code: string; message: string; remediation: string };

   /**
    * Probe the Vultr Nemotron model with a minimal chat completion to
    * verify availability before invoking the Ops Engineer voice. Aborts
    * the run on any failure; retries are out of scope for Sprint 4c.
    */
   export async function vultrNemotronPreflight(
     client: OpenAI,
     model: string,
   ): Promise<PreflightResult> {
     const result = await chatCompletion(client, {
       model,
       messages: [{ role: "user", content: "ok" }],
       maxTokens: 10,
     });
     if (!result.ok) {
       return {
         ok: false,
         code: result.error.code,
         message: result.error.message,
         remediation: `Vultr Nemotron model '${model}' pre-flight failed. Check https://api.vultrinference.com/v1/models for current catalog; the model may have rotated. Update ROGUEMOUSE_CONTEXT.md if a new model is selected. Inspect .env.local's VULTR_INFERENCE_API_KEY validity.`,
       };
     }
     return { ok: true };
   }
   ```

2. Create `preflight.test.ts`. Uses a hand-rolled fake `OpenAI` client (similar to Phase 3 / Phase 5 fakes in Sprint 4b):
   - **Happy path**: fake returns 200 with content → `ok: true`.
   - **HTTP 404 (model rotated)**: fake throws an SDK error simulating 404 → `ok: false, code: <classified>, message: <classified>, remediation: <matches expected text>`.
   - **HTTP 401/403**: same shape.
   - **Network error**: same shape (retryable: true at the classifier level, but pre-flight still hard-fails per AC-29).
   - **Empty response**: fake returns 200 with empty content → `ok: false` via `chatCompletion`'s envelope.

3. Update `packages/agent/src/index.ts` to re-export `vultrNemotronPreflight` + `PreflightResult` type.

4. Validation:
   - `pnpm --filter @roguemouse/agent typecheck`
   - `pnpm --filter @roguemouse/agent test`

### Test strategy

- 5 pre-flight unit tests with hand-rolled fake OpenAI client.

### Anti-patterns to avoid

- **Gemini 403-empty-body (2026-05-16)**: NOT applicable here — this pre-flight targets the Vultr Inference endpoint, not Gemini. If Vultr Nemotron ever exhibits similar behavior, this lesson reapplies.

### Phase exit criteria

- [ ] `vultrNemotronPreflight(client, model)` function exists with correct signature
- [ ] All 5+ pre-flight tests pass
- [ ] `pnpm --filter @roguemouse/agent typecheck` exits 0

### Phase rollback

- `git restore packages/agent/src/preflight.ts packages/agent/src/__tests__/preflight.test.ts packages/agent/src/index.ts`

---

## Phase 6 — `runScenarioA` orchestrator function

### Goal
The main composition function. Anomaly detection → Risk Officer voice → Ops Engineer voice → Synthesizer voice → terminal proposal/refusal. Every voice's tool dispatches go through the Sprint 4b dispatcher. Error envelopes from any LLM call surface as `synthesizer:refusal` terminal records.

### Files touched

- **NEW**: `packages/agent/src/runScenarioA.ts`
- **NEW**: `packages/agent/src/__tests__/runScenarioA.test.ts`
- **MODIFIED**: `packages/agent/src/index.ts` (re-export `runScenarioA` + `ScenarioResult` type)

### Step-by-step

1. Create `packages/agent/src/runScenarioA.ts`. The orchestrator is roughly 300-400 lines (the largest single file in Sprint 4c). High-level structure:
   ```typescript
   import { performance } from "node:perf_hooks";
   import type { OpenAI } from "openai";
   import type { RunAuditWriter } from "@roguemouse/audit";
   import type { RunbookIndex } from "@roguemouse/runbooks";
   import {
     chatCompletion,
     geminiChatCompletion,
     type ChatCompletionData,
     type InferenceResult,
   } from "@roguemouse/inference";
   import { canonicalize, type ToolName } from "@roguemouse/schemas";
   import type { ScenarioAFixtures, ToolCtx } from "@roguemouse/tools";

   import { detectAnomalies, type Anomaly } from "./anomaly.js";
   import { createDispatcher } from "./dispatcher.js";
   import { vultrNemotronPreflight, type PreflightResult } from "./preflight.js";
   import {
     RISK_OFFICER_SYSTEM_PROMPT,
     OPS_ENGINEER_SYSTEM_PROMPT,
     SYNTHESIZER_SYSTEM_PROMPT,
   } from "./voices/systemPrompts.js";
   import { buildRiskOfficerUserPrompt } from "./voices/riskOfficerPrompt.js";
   import { buildOpsEngineerUserPrompt } from "./voices/opsEngineerPrompt.js";
   import { buildSynthesizerUserPrompt } from "./voices/synthesizerPrompt.js";
   import {
     RISK_OPS_PLACEHOLDER_CONFIDENCE_BP,
     parseSynthesizerResponse,
     resolveTerminalDecision,
   } from "./voices/confidence.js";

   export type RunScenarioAArgs = {
     writer: RunAuditWriter;
     fixtures: ScenarioAFixtures;
     runbookIndex: RunbookIndex;
     gemini: { client: OpenAI; model: string };
     vultr: { client: OpenAI; model: string };
   };

   export type ScenarioResult = {
     runId: string;
     recordCount: number;
     finalHash: string;
     decision: "proposal" | "refusal";
     confidence_bp: number;
     totalElapsedMs: number;
     perVoice: Array<{ voice: "risk_officer" | "ops_engineer" | "synthesizer"; durationMs: number }>;
     perTool: Array<{ name: ToolName; durationMs: number }>;
     firstKey?: string;
     lastKey?: string;
   };

   export async function runScenarioA(args: RunScenarioAArgs): Promise<ScenarioResult> {
     const startTotal = Date.now();

     // 1. Pre-flight Vultr Nemotron.
     const preflight = await vultrNemotronPreflight(args.vultr.client, args.vultr.model);
     if (!preflight.ok) {
       throw new Error(
         `Pre-flight failed: ${preflight.code} — ${preflight.message}\nRemediation: ${preflight.remediation}`,
       );
     }

     // 2. Detect anomaly. AC-Special: if no anomalies, exit early (this should not happen for Scenario A fixtures).
     const anomalies = detectAnomalies(args.fixtures, new Date().toISOString());
     if (anomalies.length === 0) {
       throw new Error("Scenario A fixtures produced no anomalies; runner aborts");
     }
     const anomaly = anomalies[0]!;

     // 3. Write anomaly:detected record DIRECTLY via writer (this is setup, not a dispatch).
     const anomalyWrite = await args.writer.append({
       ts: new Date().toISOString(),
       recordType: "anomaly:detected",
       payload: {
         anomalyType: anomaly.anomalyType,
         severity: anomaly.severity,
         evidence: {
           symbol: anomaly.symbol,
           observedRatioBp: anomaly.observedRatioBp,
           thresholdBp: anomaly.thresholdBp,
           surfaceTs: anomaly.surfaceTs,
         },
         detectedAt: anomaly.detectedAt,
       },
     });
     if (!anomalyWrite.ok) {
       throw new Error(`anomaly:detected write failed: ${anomalyWrite.error.code} — ${anomalyWrite.error.message}`);
     }

     // 4. Construct dispatcher.
     const dispatchTool = createDispatcher({
       writer: args.writer,
       fixtures: args.fixtures,
       runbookIndex: args.runbookIndex,
     });

     // 5. Risk Officer segment.
     const tRisk = performance.now();
     const mdResult = await dispatchTool("market_data:lookup", { symbol: anomaly.symbol });
     const rbResult = await dispatchTool("runbook:search", { query: <anomaly-derived>, topK: 3 });
     const riskUserPrompt = buildRiskOfficerUserPrompt(anomaly, mdResult, rbResult);
     const riskResult = await geminiChatCompletion(args.gemini.client, {
       model: args.gemini.model,
       messages: [{ role: "system", content: RISK_OFFICER_SYSTEM_PROMPT }, { role: "user", content: riskUserPrompt }],
     });
     if (!riskResult.ok) {
       return await terminateWithRefusal(args.writer, anomaly, "risk_officer_call_failed", [{source: "risk_officer", reason: `${riskResult.error.code}: ${riskResult.error.message}`}], startTotal /* per-tool/voice timings */);
     }
     await args.writer.append({
       ts: new Date().toISOString(),
       recordType: "risk_officer:reasoning",
       payload: {
         input: { anomaly, marketData: <summary>, runbookSearch: <summary> },
         reasoning: riskResult.data.content,
         confidence: RISK_OPS_PLACEHOLDER_CONFIDENCE_BP,
         durationMs: Math.round(performance.now() - tRisk),
         tokens: { prompt: riskResult.usage!.promptTokens, completion: riskResult.usage!.completionTokens, total: riskResult.usage!.totalTokens },
       },
     });

     // 6. Ops Engineer segment. (Analogous structure with 3 tool dispatches + Vultr Nemotron chatCompletion.)
     // ...

     // 7. Synthesizer segment. (No tools; Gemini call with response_format JSON.)
     // ...
     // Parse via parseSynthesizerResponse. On failure, terminateWithRefusal.
     // On success, write synthesizer:reasoning, then write terminal proposal/refusal per resolveTerminalDecision.

     // 8. Compose ScenarioResult.
   }

   async function terminateWithRefusal(...): Promise<ScenarioResult> {
     // Helper that writes synthesizer:refusal and returns ScenarioResult.
   }
   ```

   The full implementation lives in `runScenarioA.ts`. The key disciplines:
   - **No tool calls outside the dispatcher**. The orchestrator always uses `dispatchTool(...)` for tool invocations; the `anomaly:detected` and reasoning records go through `args.writer.append` directly.
   - **Builder purity**: prompt builders are called BEFORE the LLM call, with the already-completed tool results passed in. No builders touch the dispatcher.
   - **`terminateWithRefusal` helper**: any LLM call failure routes through this helper, which writes a `synthesizer:refusal` record and returns a populated `ScenarioResult`. The chain stays intact even on mid-run failure. The helper sets an internal `failureTerminated = true` flag (or equivalent state) so the AC-25 invariant assert (below) only fires on the happy path.
   - **`canonicalize` not needed in the orchestrator** — the writer's `safeParse` + canonicalization happens inside `writer.append`. Orchestrator passes raw JSON-safe values.
   - **AC-25 runtime invariant assert (Amendment 1)**: at the end of the happy path (no mid-run LLM failure), before returning the `ScenarioResult`, the orchestrator asserts `recordCount === 15`. Drift indicates a code edit that changed tool sequences without updating AC-25. Fail loudly:
     ```typescript
     // AC-25 invariant: clean Scenario A runs produce exactly 15 records.
     // Drift here indicates a code edit that changed the tool sequences
     // without updating AC-25. Fail loudly. Belt-and-suspenders pattern
     // mirroring Sprint 4b's recursion guard.
     if (!failureTerminated && result.recordCount !== 15) {
       throw new Error(
         `AC-25 violation: expected 15 records, got ${result.recordCount}. ` +
         `Tool sequences may have drifted from locked Decision 2A.`,
       );
     }
     ```
     The assert only applies when `failureTerminated === false`. Mid-run failures route through `terminateWithRefusal` and may produce fewer than 15 records; that's a legitimate partial-chain outcome, not a violation.

2. Create `runScenarioA.test.ts`. Tests are integration-style using mocked LLM clients + the real dispatcher + a hand-rolled writer fake:
   - **Happy path (proposal)**: mock Risk LLM returns "...", mock Ops LLM returns "...", mock Synth LLM returns a valid proposal JSON with confidence_bp 7500. Verify ScenarioResult has decision "proposal", recordCount 15, perVoice/perTool populated.
   - **Happy path (refusal via low confidence)**: mock Synth returns proposal-shape JSON with confidence_bp 3000. Verify decision is "refusal" (threshold override per AC-22).
   - **Happy path (explicit refusal)**: mock Synth returns refusal-shape JSON. Verify decision is "refusal".
   - **Risk Officer call fails**: mock Risk returns InferenceError. Verify orchestrator writes `synthesizer:refusal` with `risk_officer_call_failed`, recordCount ≤ 15 (depends on which records were written before failure).
   - **Ops Engineer call fails**: mock Ops returns InferenceError. Verify `ops_engineer_call_failed`.
   - **Synth malformed JSON**: mock Synth returns "not json". Verify `synthesizer_malformed_response`.
   - **Pre-flight fails**: mock Vultr returns 404. Verify the orchestrator throws (not catches — pre-flight is a hard fail per AC-29).
   - **Record count = 15**: happy proposal path produces exactly 15 records.

3. Update `packages/agent/src/index.ts` to re-export `runScenarioA` + `ScenarioResult` + `RunScenarioAArgs`.

4. Validation:
   - `pnpm --filter @roguemouse/agent typecheck`
   - `pnpm --filter @roguemouse/agent test`
   - Cross-package: `pnpm -r typecheck`

### Test strategy

- 8 integration tests with mocked LLM clients + real dispatcher.
- Mocking pattern: hand-rolled `OpenAI` shape with a `chat.completions.create` method that returns sequenced canned responses.

### Anti-patterns to avoid

- **Gemini 403-empty-body**: if a Gemini call returns `http_403` with empty message during testing, the diagnosis is to probe the native endpoint (per the lesson). This won't happen in unit tests (mocked) but is on watch for the Phase 8 live smoke.
- **Recursion guard**: not applicable here — the orchestrator does NOT touch `dispatcher.ts`. The recursion guard remains valid.

### Phase exit criteria

- [ ] `runScenarioA({writer, fixtures, runbookIndex, gemini, vultr})` exported from `@roguemouse/agent`
- [ ] All 8+ runScenarioA tests pass
- [ ] Happy proposal path produces exactly 15 records
- [ ] All failure paths write a `synthesizer:refusal` record (chain stays intact)
- [ ] No file path in the orchestrator contains the substring `dispatchTool("audit:append"` (architectural recursion guard preserved by inspection)
- [ ] `pnpm --filter @roguemouse/agent typecheck` exits 0
- [ ] `pnpm -r typecheck` exits 0

### Phase rollback

- `git restore packages/agent/src/runScenarioA.ts packages/agent/src/__tests__/runScenarioA.test.ts packages/agent/src/index.ts`

---

## Phase 7 — `scripts/scenario-a.ts` thin wrapper + `pnpm scenario:a` script entry

### Goal
Land the script that wires `.env.local` loading + S3 + LLM client construction + fixture loading (default or degraded) + runbook index building + `runScenarioA` invocation + structured PASS report. Mirrors `scripts/smoke-dispatch.ts` structurally.

### Files touched

- **NEW**: `scripts/scenario-a.ts`
- **MODIFIED**: `package.json` (root — add `"scenario:a": "tsx scripts/scenario-a.ts"` script entry)

### Step-by-step

1. Create `scripts/scenario-a.ts`. Structure mirrors `scripts/smoke-dispatch.ts`:
   - Bootstrap: load `.env.local`; clear error on missing file.
   - Validate env vars: `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `GEMINI_API_KEY`, `VULTR_INFERENCE_API_KEY`. Missing → exit non-zero with all missing vars listed.
   - Parse CLI flags: detect `--degraded` (or `--variant=degraded`); resolve fixture directory accordingly. The default is `fixtures/scenario-a/`; with `--degraded`, switch to `fixtures/scenario-a-degraded/`.
   - Construct S3 client via `createS3Client`.
   - Generate runId via `randomUUID()`.
   - Construct writer.
   - Construct Gemini client via `createGeminiClient`.
   - Construct Vultr Inference client via `createInferenceClient` (configured to `https://api.vultrinference.com/v1`).
   - Load fixtures via `loadScenarioA(<fixture-root>)` where `<fixture-root>` is computed from the flag.
   - Load runbook corpus + build index.
   - Call `runScenarioA({writer, fixtures, runbookIndex, gemini: {client, model}, vultr: {client, model}})`.
   - On success: print structured PASS report (JSON.stringify the ScenarioResult). Exit 0.
   - On thrown error (pre-flight, anomaly write, etc.): print structured FAIL with error context. Exit non-zero.
   - On returned `ScenarioResult.decision`: just report; both branches are PASS outcomes (the runner does not exit non-zero on refusal — refusal is a legitimate terminal state per AC-22).

2. Locked LLM model selection (matches `ROGUEMOUSE_CONTEXT.md`). Three per-voice model overrides (per Amendment 3 — independent voice upgrades supported):
   - Risk Officer (Gemini): `gemini-2.5-flash` default; overrideable via `GEMINI_RISK_MODEL` env var (Sprint 4a precedent).
   - Synthesizer (Gemini): `gemini-2.5-flash` default; overrideable via `GEMINI_SYNTH_MODEL` env var (new).
   - Ops Engineer (Vultr): `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` default; overrideable via `VULTR_OPS_MODEL` env var (new).

   Three env vars, three voices, three overrides. Operators can upgrade individual voices independently post-submission (e.g., swap Synthesizer to `gemini-2.5-pro` if billing is enabled, without touching Risk Officer).

3. Note the fixture path resolution: `loadScenarioA(rootDir)` (from `@roguemouse/tools`) joins `rootDir + "fixtures/scenario-a/"` internally. For the `--degraded` path, the script needs to pass a different root — OR the script needs to call `loadScenarioA` with a custom subdirectory. Two options:
   - (a) Refactor `loadScenarioA` to accept a `subdir` parameter (`loadScenarioA(rootDir, subdir = "fixtures/scenario-a")`). Minimal change to Sprint 4b's exports.
   - (b) Symlink hack at runtime (no, bad).
   - (c) Manually replicate the loader logic in the script (no, duplicates Phase 1 work).
   - **Decision**: option (a). Refactor in this phase. Add the optional `subdir` parameter; default behavior unchanged for all Sprint 4b code paths. Update unit tests if needed.

4. Update root `package.json` scripts block: add `"scenario:a": "tsx scripts/scenario-a.ts"`.

5. Validation:
   - `pnpm typecheck:scripts`
   - `pnpm -r typecheck`

### Test strategy

- Manual: verify the script typechecks. Live execution happens in Phase 8.
- No automated test for the script itself (matches Sprint 4b's smoke pattern).

### Anti-patterns to avoid

- **Gemini 403-empty-body**: applicable to live run. If Phase 8 surfaces this, diagnosis path is in `tasks/lessons.md`.
- **Conditional exports**: script imports from 4 workspace packages; verify all resolve under `tsx`'s default conditions.

### Phase exit criteria

- [ ] `scripts/scenario-a.ts` exists and typechecks
- [ ] `pnpm scenario:a` script entry added to root `package.json`
- [ ] `loadScenarioA` accepts optional `subdir` parameter (defaults preserve Sprint 4b behavior); all existing Sprint 4b tests still pass
- [ ] `pnpm -r typecheck` and `pnpm typecheck:scripts` exit 0
- [ ] `pnpm -r test` exits 0 (no regressions)

### Phase rollback

- `git restore scripts/scenario-a.ts package.json packages/tools/src/fixtures/loadScenarioA.ts`

---

## Phase 8 — Live smoke runs (clean + `--degraded`) + `/review-task` + 2 commits

### Goal
Execute both Scenario A variants against real Vultr + Gemini + Vultr Inference. Audit the implementation against the 43 ACs. Write `review.md`, update `ROGUEMOUSE_CONTEXT.md`, append any new lessons. Author the two-commit pattern.

### Files touched

- **NEW**: `docs/sprints/scenario-a-multi-agent-debate/review.md`
- **MODIFIED**: `ROGUEMOUSE_CONTEXT.md`
- **MODIFIED**: `tasks/lessons.md` (only if new entries)
- **MODIFIED**: `tasks/todo.md` (only if new entries beyond the 5000-placeholder entry already filed)

### Step-by-step

1. **Pre-flight (operator-authorized)**:
   - Confirm `.env.local` contains all 4 required env vars (S3 + Gemini + Vultr Inference). Masked check pattern from Sprint 4b Phase 6.
   - Confirm Vultr Inference catalog includes the configured Nemotron model (the script's pre-flight will catch this if not).

2. **Final validation sweeps**:
   - `pnpm -r typecheck` exit 0
   - `pnpm -r test` exit 0
   - `pnpm typecheck:scripts` exit 0
   - Sprint 4b's `pnpm smoke:dispatch` regression check (optional, only if there's concern about Sprint 4b changes — there shouldn't be)

3. **Live clean run**:
   - Invoke `pnpm scenario:a`
   - Capture full stdout + the structured PASS report
   - Verify: exit 0, recordCount = 15, decision = "proposal" (typical), confidence_bp >= 4500
   - Note runId, finalHash, perVoice + perTool timings

4. **Live degraded run**:
   - Invoke `pnpm scenario:a -- --degraded`
   - Capture full stdout + the structured PASS report
   - Verify: exit 0, recordCount = 15, decision = "refusal" (typical via threshold override or explicit refusal), confidence_bp < 4500 (if threshold-override) OR `synthesizer:refusal` with model-stated reason
   - Note runId, finalHash

5. **AC-by-AC review**: walk through all 43 ACs in `spec.md`, mark each as VERIFIED / PARTIAL / DEVIATION. Verification methods:
   - AC-01 to AC-15: unit tests + clean live run
   - AC-16, AC-16a: substring tests + spot-check
   - AC-17: spot-check the proposal text from the live clean run for governance-grammar
   - AC-18 to AC-21: Zod schema tests + live run's structured response
   - AC-22 to AC-24: clean live run (proposal path) + degraded live run (refusal path)
   - AC-25 to AC-27: live run record counts (exactly 15) + chain verification (the writer's hash chain auto-advances per Sprint 4b's design)
   - AC-28, AC-29: pre-flight unit tests + live pre-flight pass
   - AC-30 to AC-32: degraded fixture load + degraded live run
   - AC-33 to AC-36: error envelope unit tests in runScenarioA.test.ts
   - AC-37 to AC-39: clean live run + degraded live run
   - AC-40 to AC-43: final validation sweep results

6. **Write `review.md`**:
   - Summary (1-2 paragraphs)
   - 43-row AC coverage table (AC#, verdict, method, notes)
   - Deviations from plan (per phase)
   - Decisions made during implementation
   - Live smoke evidence (both runIds, recordCounts, finalHashes, perVoice/perTool timings, decision outcomes)
   - Demo readiness assessment
   - Follow-ups added to tasks/todo.md
   - Lessons added to tasks/lessons.md (if any)
   - Final commit references (filled in after the commits land)

7. **Update `ROGUEMOUSE_CONTEXT.md`**:
   - Mark Sprint 4c complete (date: when Phase 8 lands)
   - Queue Sprint 5 (Scenarios B/C) or Sprint 6 (Vultr VPS deploy) per the project roadmap
   - Add a fifth Artifact entry: "Fifth audit run / Sprint 4c clean Scenario A artifact" with runId, recordCount=15, finalHash, decision="proposal"
   - Add a sixth Artifact entry: "Sixth audit run / Sprint 4c degraded Scenario A artifact" with runId, recordCount=15, finalHash, decision="refusal"
   - Append architectural decisions made during Sprint 4c:
     - Three voice system prompts as locked constants in `@roguemouse/agent`
     - Synthesizer structured JSON via `response_format` + discriminated-union Zod schema
     - Risk/Ops placeholder confidence (5000); Synthesizer load-bearing confidence with 4500 threshold
     - Pre-flight pattern for Vultr Nemotron mirrors Sprint 4b's permission pre-flight
     - `--degraded` flag pattern as the demo's refusal vehicle (same code, swapped inputs)
   - Mark recordTypes exercised end-to-end: bring from 5 of 12 to 8 of 12 (adds `risk_officer:reasoning`, `ops_engineer:reasoning`, `synthesizer:reasoning`, `synthesizer:proposal`, `synthesizer:refusal`).

8. **Two-commit pattern**:
   - **feat commit**:
     - Subject: `feat(agent): land Scenario A multi-agent debate with proposal + refusal paths`
     - Body explains WHY: enables Scope C submission with demoable governance flow; first end-to-end multi-agent run; recordTypes exercised end-to-end go from 5 of 12 to 8 of 12; both terminal branches (proposal + refusal) verified in live smoke.
     - Includes: all Phases 1-7 code + `spec.md`, `plan.md`, `review.md`
   - **docs commit**:
     - Subject: `docs(context): mark Sprint 4c complete, queue Sprint 5/6, pin fifth and sixth audit run artifacts`
     - Body: artifact runIds, high-level changes.
     - Includes: `ROGUEMOUSE_CONTEXT.md`, `tasks/lessons.md` (if new), `tasks/todo.md` (if new)

9. **Do NOT push** without operator authorization. Report commit hashes.

### Test strategy

- Two live runs (clean + degraded) operator-supervised against real Vultr + Gemini + Vultr Inference.
- No CI integration; manual verification only (per Sprint 4b pattern).

### Anti-patterns to avoid

- **Markdown-wrapper strip**: review.md will be a large markdown file. If pasting content for me to write verbatim, verify on-disk.
- **Sprint state drift**: ROGUEMOUSE_CONTEXT.md must be updated in the same session as implementation. Sprint 3/4a/4b precedent: context update is a separate commit immediately after feat.
- **Opportunistic refactoring**: do not "clean up" anything noticed during review. Add to `tasks/todo.md`.

### Phase exit criteria

- [ ] `pnpm -r typecheck` exits 0
- [ ] `pnpm -r test` exits 0
- [ ] Clean live run: exit 0, recordCount=15, decision=proposal, structured PASS report
- [ ] Degraded live run: exit 0, recordCount=15, decision=refusal (or model-stated), structured PASS report
- [ ] `review.md` written with 43-row AC coverage table and PASS verdict
- [ ] `ROGUEMOUSE_CONTEXT.md` updated with Sprint 4c state + 2 new artifacts
- [ ] Two commits authored (feat + docs)
- [ ] Working tree clean
- [ ] Operator authorizes push (separate gate)

### Phase rollback

- `git restore docs/sprints/scenario-a-multi-agent-debate/review.md ROGUEMOUSE_CONTEXT.md tasks/lessons.md tasks/todo.md`
- If two commits authored but not pushed: soft-reset `git reset HEAD~2` (preserves working tree); re-author after correction.
- If pushed and a correction needed: follow-up commit (no force-push to main).

---

## Cross-phase notes

### Lessons applied (per `tasks/lessons.md`, now 5 entries)

- **2026-05-14 — Markdown wrappers strip leading hash and asterisk**: flagged against Phases 1, 2, 7, 8 (any phase with file content authoring). Mitigation: verify on-disk after Write.
- **2026-05-14 — Conditional package exports require invocation discipline**: not in play — Sprint 4c adds no new packages.
- **2026-05-16 — Gemini OpenAI-compat shim translates RESOURCE_EXHAUSTED to HTTP 403-with-empty-body**: directly relevant to Phases 6 and 8. If a Gemini call surfaces `http_403` with empty message during the live smoke, diagnose by probing the native endpoint (`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`). If quota exhausted, route the failure as `risk_officer_call_failed` or `synthesizer_call_failed` per AC-33/AC-35.
- **2026-05-16 — Free-tier gemini-2.5-pro has limit: 0 quota**: not in play — Sprint 4c uses Flash.
- **2026-05-17 — Dispatcher recursion-guard test uses literal regex against source**: not in play — Sprint 4c does NOT modify `packages/agent/src/dispatcher.ts`. The guard remains valid; no new code introduces guarded patterns.

### Workflow gates

After each phase: operator approval before the next phase begins. Each phase is verifiable in isolation. Recommended cadence:
- Phases 1-3 in one session (data + prompt + schema foundation)
- Phases 4-6 in another session (orchestration logic)
- Phase 7 in a brief session (script wrapper)
- Phase 8 in the final session (live runs + review + commits)

### What "complete" means for Sprint 4c

When all 43 ACs verified, both live smokes PASS, the two-commit pattern lands on `main`, Scope C is feature-complete from a code perspective. Sprint 5 (Scenarios B/C) becomes optional polish; Sprint 6 (deploy) can begin.

The Scenario A demo is the climactic deliverable. Sprint 4c is the sprint that turns the architectural commitment ("external governance layer for algorithmic trading") into a runnable artifact.

---

## Stop gate

When the plan is approved, proceed to `/implement-task` starting with Phase 1. Do not skip phases. Each phase has explicit operator approval gates per the workflow rules.
