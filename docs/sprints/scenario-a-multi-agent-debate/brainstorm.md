# scenario-a-multi-agent-debate — Brainstorm

## Problem

Sprint 4b shipped the dispatch runtime, 8 tool implementations, application-layer RAG, and `writer.list` — the machinery that turns the Sprint 3 schemas into a working agent layer. Verified end-to-end against real Vultr Object Storage with a 7-record chain at runId `2bae8eaa-1553-4d5a-bd02-8f15a3cb82db`. What's missing is the **orchestration**: an "agent loop" that detects an anomaly, runs three agent voices through a structured deliberation, dispatches tools as the voices reason, and produces either a proposal or a refusal — every step audit-logged.

Sprint 4c is the demo. The target scenario is **Stale IV Surface (Scenario A)**: AAPL's IV/RV ratio is 0.42, below the 0.45 low-bound threshold (fixture data already shaped this way in `fixtures/scenario-a/`). An ops-officer system detects this anomaly, the Risk Officer (Gemini Flash) reasons about exposure, the Ops Engineer (Vultr Nemotron) inspects system internals, the Synthesizer (Gemini Flash) reconciles both perspectives, and the run terminates with a proposal or refusal record. The audit chain reflects every step. The demo run produces enough records that the count is itself a credibility signal per the hackathon's countable-artifacts framing.

The competitive narrative is **external governance layer over a trader, not a trader**. This sprint's deliverable must reinforce that framing at every layer: in the prompts (voices speak like governance officers, not traders), in the tool dispatches (the agent inspects state but does not commit trades), in the proposal/refusal output (a recommendation TO a human, never an action), and in the audit log itself (every reasoning step is recorded, hash-chained, queryable). Sprint 4c composes the Sprint 4b machinery into the story we tell judges.

## Existing code touched

- `packages/agent/src/dispatcher.ts:25-167` — `createDispatcher({writer, fixtures, runbookIndex})` factory + serial mutex + tool-flow audit writes. Sprint 4c constructs one dispatcher per scenario run.
- `packages/agent/src/index.ts:1-5` — agent package barrel. Sprint 4c adds the scenario-runner export (likely `runScenarioA` or similar).
- `packages/tools/src/implementations/registry.ts:54-66` — `TOOL_IMPLEMENTATIONS` registry. Sprint 4c invokes via `dispatchTool(name, args)` (the dispatcher resolves to the registered impl).
- `packages/tools/src/toolCtx.ts:14-22` — `ToolCtx` shape. Sprint 4c's runner constructs this once, passes to `createDispatcher`.
- `packages/schemas/src/auditPayloads.ts:85-167` — payloads for `anomaly:detected`, `risk_officer:reasoning`, `ops_engineer:reasoning`, `synthesizer:reasoning`, `synthesizer:proposal`, `synthesizer:refusal`. Sprint 4c writes one of each per run (5–6 reasoning/proposal records depending on terminal branch).
- `packages/inference/src/geminiChatCompletion.ts:49-111` — Gemini chat completion wrapper. Sprint 4c calls this for Risk Officer + Synthesizer voices.
- `packages/inference/src/chatCompletion.ts` — Vultr Nemotron chat completion wrapper (same envelope shape). Sprint 4c calls this for Ops Engineer voice.
- `packages/inference/src/index.ts:3-7` — inference package barrel. Sprint 4c imports `createInferenceClient + chatCompletion` and `createGeminiClient + geminiChatCompletion`.
- `packages/runbooks/content/iv-rv-divergence.md:1-22` — the target runbook. Already verified rank-1 against the Scenario A query (Sprint 4b Phase 2 manual verification).
- `packages/audit/src/runAuditWriter.ts:59-220` — `RunAuditWriter` class with `append`/`read`/`list` methods. Sprint 4c uses all three (append for every record, list+read for chain verification).
- `fixtures/scenario-a/*.json` — already authored in Sprint 4b Phase 1. Sprint 4c uses the same files unchanged.
- `scripts/smoke-dispatch.ts` — Sprint 4b's structural template. Sprint 4c's runner mirrors the env-loading + bootstrap + structured-report pattern.

New files Sprint 4c will create (rough inventory; exact paths locked at spec stage):

- A scenario-runner module in `@roguemouse/agent` (the orchestration library function).
- An anomaly detector module in `@roguemouse/agent` (small, testable).
- A voice-prompt module per voice in `@roguemouse/agent` (3 files; system + user prompt builders).
- A thin script `scripts/scenario-a.ts` invoking the runner.
- Test files for the detector + prompt builders + orchestrator (mocked LLM calls).
- The sprint docs (`docs/sprints/scenario-a-multi-agent-debate/{brainstorm,spec,plan,review}.md`).

---

## Decision 1 — Voice sequencing

How do the three agent voices (Risk Officer Gemini, Ops Engineer Nemotron, Synthesizer Gemini) interact during a run?

### Approach 1A — Strict sequence

Risk Officer reasons over the anomaly + market data + runbook → writes `risk_officer:reasoning`. Ops Engineer reasons over the anomaly + positions + broker reconciliation → writes `ops_engineer:reasoning`. Synthesizer reads both reasoning outputs → writes `synthesizer:reasoning` → writes `synthesizer:proposal` OR `synthesizer:refusal`. Each voice runs exactly once.

**Pros**:
- Simplest orchestrator. Three sequential `await` calls.
- Deterministic audit chain shape: same record sequence on every run (modulo content).
- Each voice gets independent perspective (Risk doesn't see Ops, Ops doesn't see Risk). This is genuinely how some governance models work — independent reviews then reconciliation.
- The Synthesizer payload schema (`riskOfficerInput`, `opsEngineerInput`) is shaped for exactly this pattern.
- Predictable wall-clock latency: ~15 seconds for 3 voice calls + ~5 seconds of tool dispatches.
- Easy to test with mocked LLMs.

**Cons**:
- "Debate" framing is weak — there's no actual back-and-forth. Each voice gives a monologue.
- The Synthesizer carries all the rhetorical weight: it has to be the one that articulates the "two voices considered" narrative in its prose.
- A judge skimming the audit log sees three reasoning records and a proposal — looks more like a checklist than a debate.

**Complexity**: small.

**Forces into scope**: three voice prompts; orchestrator with sequential `await`s; tests covering each voice; the Synthesizer prompt must explicitly reconcile both inputs.

**Anti-features**: no rebuttal logic; no inter-voice cross-talk; no adaptive sequencing.

### Approach 1B — Risk + Ops in parallel, then Synthesizer

Same record shape as 1A, but Risk Officer and Ops Engineer fire in parallel via `Promise.all`, since they read independent context. Synthesizer waits for both, then runs.

**Pros**:
- Saves ~5 seconds wall-clock on the demo run (one voice latency overlapped instead of sequential).
- Audit chain shape is unchanged (both records still write; chain ordering preserved because the writer is serial — `await Promise.all` resolves before the synthesizer fires).
- Same orchestrator code complexity as 1A, with `Promise.all` instead of two awaits.

**Cons**:
- Sprint 4b's locked Decision 1A (serial dispatch) means tool dispatches inside each voice serialize through the same writer. With parallel voices, both voices are simultaneously fighting for the writer's mutex. The "Risk Officer ran in parallel" claim doesn't quite hold — the LLM calls overlap, but the tool dispatches inside each voice still serialize through the shared writer.
- More error-handling surface: what if Risk fails and Ops succeeds? Synthesizer needs to handle partial state.
- "Parallel reasoning" is harder to explain in the demo narrative — the linear story is clearer.

**Complexity**: small (technically), medium (in error-handling thought).

**Forces into scope**: error-handling for partial-success cases; tests covering one-voice-fails scenarios.

**Anti-features**: no inter-voice awareness during the parallel phase.

### Approach 1C — Iterative debate

Risk Officer reasons (round 1). Ops Engineer reasons (round 1), sees Risk's reasoning. Risk Officer rebuts (round 2), sees Ops's reasoning. Ops Engineer rebuts (round 2), sees Risk's rebuttal. Synthesizer reconciles all 4 reasoning records.

**Pros**:
- Genuine debate. The audit log shows back-and-forth that matches the sprint's name ("multi-agent-debate").
- Demo-narratively richest: judges see two voices engaging with each other's arguments.
- Each round can refine the agent's understanding (a voice that read the other's reasoning may discover a consideration its first pass missed).

**Cons**:
- 5 reasoning records + Synthesizer instead of 3 + Synthesizer. Adds ~10 seconds wall-clock (2 extra voice calls).
- The audit payload schema for `risk_officer:reasoning` doesn't have a "round" field — same recordType for both rounds, distinguishable only by chain order.
- Risk of unbounded debate if cap is misimplemented.
- Synthesizer prompt becomes harder: it must reconcile 4 inputs instead of 2.
- More prompt engineering work (round-1 and round-2 prompts differ).

**Complexity**: medium.

**Forces into scope**: a `round` parameter in the orchestrator; cap enforcement (hard cap at 2 rounds; no infinite-loop risk); rebuttal prompts that reference the other voice's prior reasoning; a Synthesizer prompt that handles 4-input reconciliation.

**Anti-features**: no adaptive decision about whether to debate further (cap is fixed at 2 rounds).

### Approach 1D — Synthesizer-first adaptive orchestration

The Synthesizer runs first as a "moderator." It reads the anomaly, decides which voices to consult and in what order, calls them adaptively, and may re-consult voices based on their outputs. Most agent-like; potentially fewer voice calls if Synthesizer decides one voice's perspective is sufficient.

**Pros**:
- Most agent-like. The Synthesizer is the agent; the other voices are tools.
- Adaptive — can short-circuit on clear cases.
- Differentiated narrative ("the agent reasons about its own reasoning process").

**Cons**:
- Multiple Synthesizer LLM calls (~3-5 instead of 1). Substantial cost increase ($0.005-0.01 per run vs $0.001).
- Hardest to test deterministically.
- The audit chain becomes harder to script for the demo — different runs may produce different sequences.
- The "two independent voices reconciled by a synthesizer" framing is lost.
- Significantly more prompt engineering (the Synthesizer needs prompts for "decide what to do," "ask the Risk Officer X," "now ask the Ops Engineer Y," etc.).
- Sprint 4c's timeline (Day 5 of 6) does not have room for this.

**Complexity**: large.

**Forces into scope**: Synthesizer-as-orchestrator prompts; LLM-side decisions about voice routing; adaptive flow control; significantly more error handling.

**Anti-features**: predictability; deterministic demo runs.

### Narrative consideration

The sprint folder name is `scenario-a-multi-agent-debate`. "Debate" leans toward 1C. But the operator's framing in the problem statement said: "**three voices through a structured deliberation**" — which is softer language ("deliberation" can be sequential, not literal debate). And the synthesizer:reasoning payload schema's `{riskOfficerInput, opsEngineerInput}` fields are shaped for exactly two upstream inputs, supporting 1A or 1B.

The competitive narrative — "external governance layer" — is best served by clarity and discipline, not by maximum agent-acrobatics. A clean three-voice sequence with strong prose in each voice's reasoning is more credible to judges than a noisy multi-round debate that might confuse them.

---

## Decision 2 — How does each voice decide which tools to dispatch?

### Approach 2A — Hardcoded per-voice tool sequences

Each voice has a fixed sequence of tools it dispatches before its reasoning step. The orchestrator dispatches the tools, collects the results, formats them into the voice's user prompt, and calls the LLM.

Concrete locked sequences (proposed for spec):

- **Risk Officer** dispatches: `market_data:lookup({symbol: "AAPL"})` + `runbook:search({query: <anomaly-derived>, topK: 3})`. Then calls Gemini with the anomaly context + market data + top runbook match.
- **Ops Engineer** dispatches: `position:snapshot({})` + `broker:reconcile({strategy: "iv-rv-monitor"})` + `audit:search({runId: <prior anomaly run, if any>, recordType: "anomaly:detected", limit: 10})`. Then calls Vultr Nemotron with the anomaly context + position state + broker state + historical anomaly context.
- **Synthesizer** dispatches: 0 tools (it reasons over the two reasoning records). Then calls Gemini with both reasoning records + the original anomaly + optionally the proposal payload schema in the response_format.

That's 5 tool dispatches per run → 10 tool-flow audit records. Plus 1 anomaly + 3 reasoning + 1 proposal/refusal = **15+ records** per Scenario A run.

**Pros**:
- Deterministic. Same audit chain shape every run; the demo video shows the same sequence each time.
- Easy to test (mocked LLMs, hardcoded tool sequences).
- Aligns with the project's architectural rule: "tools orchestrated from planner code, not from LLM" (`.claude/rules/vultr.md`). The Vultr Nemotron path does not support function calling reliably; hardcoded sequences avoid the LLM-side function-calling complexity entirely.
- Each voice's "context shape" is known in advance, which simplifies prompt engineering.

**Cons**:
- Less "agentic" — the demo's agent appears scripted.
- If we ever want to add a tool to a voice's reasoning, it requires a code change rather than a prompt change.
- Audit log records `tool:call` payloads with `args` that are obviously hardcoded — judges who look closely might find this less impressive than LLM-driven dispatch.

**Complexity**: small.

**Forces into scope**: 5 hardcoded tool dispatches per run with stable args; tests verifying the dispatch sequence.

**Anti-features**: dynamic tool selection; agent-driven exploration.

### Approach 2B — LLM-driven tool calling

Each voice's prompt describes available tools. The LLM produces a structured response indicating which tools to call. The orchestrator dispatches what the LLM requested, gathers results, returns them to the LLM for the final reasoning step.

**Pros**:
- More "agentic" — the agent actually decides what to inspect.
- More flexible to scenario variation (in principle).
- Better story to judges who ask "what does this agent actually do?"

**Cons**:
- **Architectural rule conflict**: `.claude/rules/vultr.md` explicitly states "Native function calling per the OpenAI spec is **not** supported on most Vultr models (only `kimi-k2-instruct` supports it). Our architecture orchestrates tools from the planner code (Node.js), not from the LLM." Sprint 4c is bound by this rule. The Ops Engineer voice (Vultr Nemotron) cannot use LLM-driven function calling. Implementing 2B for only the Gemini voices (Risk + Synthesizer) and 2A for the Vultr voice would break symmetry and add per-voice orchestrator branches.
- More prompt engineering (each voice's prompt needs structured tool-call output specs).
- Less deterministic — different runs may produce different tool sequences. Demo video harder to script.
- Risk of LLM hallucinating tool names or args; needs validation + retry layer.
- Prompt token count goes up substantially (tool schemas in every prompt).
- More tokens per call → more cost; not material at hackathon scale but adds compounding complexity.

**Complexity**: medium-large.

**Forces into scope**: tool-schema serialization for prompts; validation of LLM tool-call output; retry/correction logic for malformed tool calls; per-voice branching in the orchestrator (Gemini can use function-calling, Vultr Nemotron cannot).

**Anti-features**: predictable demo audit chain; deterministic record count.

### Narrative consideration

"The agent reasons about what to inspect" is a stronger narrative than "the agent follows a script." But: judges who know the field know that production agent systems lean heavily on hardcoded tool sequences with LLM-driven *content* but operator-driven *routing*. Selling "our planner decides which tools to call" is actually credible to sophisticated judges.

The audit log will reflect either choice clearly. With 2A, the `tool:call` payload args are predictable. With 2B, they vary — but parse failure or mistaken tool names would show up as `tool_threw_internal` envelopes in the `tool:result`, which is a worse demo moment than a clean predictable sequence.

The project rules tip this strongly toward 2A. Sprint 7 polish could revisit if there's time.

---

## Decision 3 — Confidence extraction for refusal/proposal

The Synthesizer voice produces a final decision. The decision is proposal-vs-refusal based on a confidence value extracted from its output. How is confidence extracted?

### Approach 3A — System-prompt-coached integer in the response text

The Synthesizer's system prompt instructs the model to output a confidence integer 0-10000 in basis points alongside the proposal text. The orchestrator parses the integer from the response.

Example response shape (free-form text):
```
CONFIDENCE: 6500
REASONING: ...
PROPOSAL: ...
```

The orchestrator runs a regex over the response to extract the confidence.

**Pros**:
- Simple. No model-side complexity.
- Works against any LLM provider (no `response_format` support required).

**Cons**:
- Fragile parsing. The model may say "I'm about 65% confident" instead of "CONFIDENCE: 6500". The regex needs to handle several formats, or the prompt needs to be very firm.
- Demo failure mode: if the regex doesn't match, the orchestrator needs a fallback (default confidence? error?). Either choice is awkward.

**Complexity**: small.

**Forces into scope**: regex parser; fallback path; tests covering multiple confidence formats.

**Anti-features**: structured response validation; type-safe parsing.

### Approach 3B — Response-feature heuristic

Confidence inferred from response characteristics: hedging language ("might", "could", "uncertain"), response length, sentiment, specific keywords.

**Pros**: none for a hackathon demo.

**Cons**: brittle, untrustworthy, not demo-worthy. Skipped immediately.

**Complexity**: medium.

### Approach 3C — Structured JSON via `response_format`

The Synthesizer's API call sets `response_format: { type: "json_object" }` (Gemini supports this; the openai SDK exposes it via the same parameter). The system prompt instructs the model to output JSON matching a specific schema. The orchestrator JSON.parses and Zod-validates.

Example response (JSON):
```json
{
  "confidence_bp": 6500,
  "decision": "proposal",
  "reasoning": "...",
  "proposal_text": "...",
  "supporting_evidence": [...],
  "expected_impact": {...}
}
```

If `decision: "refusal"`, then `refusal_reason_code` and `degraded_inputs` populate instead of the proposal fields.

**Pros**:
- Robust parsing. JSON.parse + Zod-validate, fail loudly if malformed.
- Demo-worthy. Judges who look at the prompts will appreciate the structured-output discipline.
- The Synthesizer payload schemas in `auditPayloads.ts` (`synthesizerProposalPayload`, `synthesizerRefusalPayload`) align cleanly with this JSON shape — minimal transformation.

**Cons**:
- Requires Gemini's `response_format` support. Confirmed via the openai SDK's typings. Vultr Nemotron's support is unknown — but the Synthesizer is Gemini, so this is moot.
- Slightly more complex error path: if the model produces malformed JSON, the parse fails and the orchestrator needs a fallback. Same envelope-discipline rule as everywhere else (return an error envelope, never throw).
- Prompt engineering must precisely describe the expected JSON shape (or include the schema verbatim).

**Complexity**: small-medium.

**Forces into scope**: Zod schema for the structured response (locked at spec stage); a synthesizer-prompt builder that injects the schema description; error envelope on JSON parse / Zod validation failure.

**Anti-features**: free-form response handling; soft fallback on partial structure.

### Approach 3D — Separate dedicated confidence call

Synthesizer first produces the reasoning + proposal text. A second LLM call asks the model "rate your confidence in the above proposal on a 0-10000 scale." Orchestrator parses the second response.

**Pros**:
- Cleanest separation of concerns. The reasoning prompt focuses on reasoning; the confidence prompt focuses on calibration.

**Cons**:
- Doubles Synthesizer latency (~10 seconds instead of ~5).
- Doubles Synthesizer cost (~$0.002 instead of ~$0.001 per run; trivial absolute but inelegant).
- A model self-rating its own reasoning is well-known to be biased toward high confidence.
- More records (the second confidence call needs its own audit entry, or it's hidden — both bad options).

**Complexity**: small.

**Forces into scope**: a second Synthesizer call site; tests for both calls; an audit record for the confidence sub-call (or a decision to omit it).

**Anti-features**: calibrated confidence (the model's self-rating is suspect).

### Threshold for refusal/proposal split

Whichever extraction approach is chosen, the orchestrator compares the parsed confidence against a threshold to decide between writing a `synthesizer:proposal` record or a `synthesizer:refusal` record.

Candidates:
- **3000 (30%)** — very aggressive refusal; nearly any uncertainty triggers refusal. Demo theater leans heavy on "responsible governance."
- **4500 (45%)** — matches the Scenario A IV/RV threshold (also 45%). Aesthetically appealing.
- **5000 (50%)** — coin flip. Standard but arbitrary.
- **6500 (65%)** — moderate confidence required to propose. Most realistic for a production governance system.

The Scenario A inputs are clean (good fixtures, top RAG match has score 476 bp, position data clear, broker reconciliation only 1-share off). With clean inputs, the model is likely to produce confidence in the 6000-8000 range. So the default Scenario A path will probably propose at any reasonable threshold.

### The refusal-moment narrative gap

Per `.claude/rules/hackathon.md`: **"The audit log proves the system refuses to act when uncertain — not just that it acts when confident."** That's the high-trust demo moment. But Scope C is Scenario A only, and Scenario A's clean inputs naturally produce a proposal, not a refusal.

Options to manufacture a refusal:
- (i) Engineer the Synthesizer prompt to be skeptical by default (raises confidence floor).
- (ii) Add a CLI flag to the Sprint 4c runner (`--degraded`) that swaps in deliberately corrupted fixtures (RAG returns low-score matches, broker reconciliation diverges by 30 shares not 1, anomaly evidence is missing fields). Same code path, different inputs, refusal naturally emerges.
- (iii) Two scenarios within Scenario A: the default ("clean") proposes, and a "degraded inputs" variant refuses. Both demoed.

Option (ii) is the cleanest. It adds ~50 lines to the runner (a `loadScenarioADegraded()` alternate loader) and tells the most credible story: same system, different inputs, different outputs. The refusal isn't manufactured by tweaking the agent — it emerges from the same agent reasoning over worse data.

---

## Decision 4 — Anomaly detector: code or fixture?

Where does the `anomaly:detected` record come from at the start of a run?

### Approach 4A — Synthetic (hardcoded in runner)

The Sprint 4b smoke wrote the anomaly directly with hardcoded payload values. Sprint 4c continues this pattern: the runner reads `fixtures.anomalyEvidence` and writes an `anomaly:detected` record without a "detection" code path.

**Pros**:
- Zero code to write.
- Same approach as Sprint 4b's smoke.

**Cons**:
- No "detection" narrative element. The audit log says "we noticed an anomaly" but there's no code that does the noticing.
- A judge who reads the runner sees "and then we wrote the anomaly record" — looks scripted.

**Complexity**: trivial.

### Approach 4B — Real anomaly detector function

A small `detectAnomalies(fixtures): Anomaly[]` function in `@roguemouse/agent` scans `fixtures.marketData`, computes IV/RV ratios per symbol, compares against the locked low-bound + high-bound thresholds, emits one anomaly per breach. The runner calls this, takes the first anomaly, writes the `anomaly:detected` record.

**Pros**:
- Genuine detection narrative. The runner code reads "anomalies = detectAnomalies(fixtures); writeAudit(anomalies[0])". Each "and then" looks deliberate.
- Trivially testable (unit tests against known fixture inputs).
- Extensible: Sprint 5's Scenarios B and C add their own detectors. The detector module becomes a small library.
- ~20-30 lines of code. Genuinely small.

**Cons**:
- Tiny code-time cost.
- The detector hides the fact that the inputs are 100% controlled — but the demo is honest about being fixture-driven anyway (per the README disclaimer).

**Complexity**: small.

**Forces into scope**: a `detectAnomalies` module with unit tests covering breach + non-breach cases.

### Approach 4C — Anomaly as input parameter

The runner accepts an anomaly object as a parameter; it doesn't detect, just reacts.

**Pros**:
- Most flexible for testing.

**Cons**:
- Breaks the narrative completely. "An anomaly happened" with no detection code is just a function that takes "anomaly" as a parameter — that's not a governance system.

**Complexity**: trivial.

### Narrative consideration

Detection is part of the story Roguemouse tells. Without it, the demo opens mid-stream: "an anomaly was detected" (by whom? when? on what basis?). With detection, the demo opens with deliberate state: "the system scanned the market surface, identified an anomaly against the locked threshold, recorded it." Detection is ~30 lines; the narrative payoff is large.

---

## Decision 5 — Scenario A runner shape: script or HTTP endpoint?

### Approach 5A — Script only

Sprint 4c ships `scripts/scenario-a.ts` (mirrors `scripts/smoke-dispatch.ts` structurally). The runner is operator-invoked via `pnpm scenario:a` or `pnpm exec tsx scripts/scenario-a.ts`. The demo video shows terminal output.

**Pros**:
- Simplest. Same pattern as every prior smoke.
- Demo video can be a screen-share of the terminal.
- Decouples Sprint 4c from Sprint 6 deploy work.

**Cons**:
- The deployed UI (Sprint 6) needs its own entry point eventually. The script can't be invoked from a browser.

**Complexity**: small.

### Approach 5B — HTTP endpoint

Sprint 4c ships an `apps/web/api/scenario-a` (or similar Next.js App Router route) that invokes the scenario. The demo video shows a browser UI hitting the endpoint, the audit log appearing in the response.

**Pros**:
- Demo video can show a real UI flow.
- Sprint 6 deploy already targets `apps/web`; the endpoint just becomes available remotely.

**Cons**:
- Adds Next.js API route surface, request validation, response shaping, error envelopes for HTTP, CORS handling (or skipping it for a same-origin demo).
- The `apps/web` deploy story (Sprint 6) isn't fully designed yet; adding a backend endpoint pre-empts those decisions.
- Sprint 4c's timeline (Day 5 of 6) does not have room for both the orchestration AND a polished HTTP surface.
- Operator authentication question (per ROGUEMOUSE_CONTEXT.md open questions) is unresolved — the endpoint would either need auth (Sprint 7) or be deliberately unauthenticated (security disclosure).

**Complexity**: medium (the orchestration itself is no more complex, but the endpoint surface adds work).

### Approach 5C — Both (script for dev, endpoint for demo)

The orchestration logic is extracted as a library function (`runScenarioA(options): Promise<ScenarioResult>`) in `@roguemouse/agent`. The script is a thin tsx wrapper. The endpoint is a thin API-route wrapper. Sprint 4c ships just the function + script; Sprint 6 (or 7) adds the endpoint.

**Pros**:
- Best of both worlds. The function is the durable abstraction; the script and endpoint are both thin wrappers.
- Sprint 6 doesn't need to refactor anything to add the endpoint.
- Sprint 4c remains decoupled from deploy.

**Cons**:
- Two-line refactor (the orchestration code moves from `scripts/scenario-a.ts` to `packages/agent/src/runScenarioA.ts`) but the operator should know this is the intended pattern.

**Complexity**: small.

### Narrative consideration

Whatever the runner shape, the abstraction should be a library function in `@roguemouse/agent`. That's the right architectural decision regardless of Decision 5's outcome — it makes Sprint 4c's deliverable reusable without forcing the team to commit to an HTTP surface this sprint.

---

## Additional considerations (not decisions, but worth flagging)

### Prompt engineering as load-bearing deliverable

Each of the three voices needs a system prompt that:
- Establishes the voice's identity ("you are a risk officer at a quantitative trading firm...")
- Frames the task ("you have received an anomaly notification...")
- Constrains the response shape (free-text vs JSON; specific format)
- Reinforces the governance narrative ("you do NOT execute trades; you advise...")

Plus a user prompt builder that injects:
- The anomaly description (deterministic from `anomaly:detected.payload`)
- The relevant tool dispatch results (from prior tool:result records in the run)
- For the Synthesizer: both upstream reasoning records

The prompts are not a brainstorm-level concern (specific text), but the brainstorm flags them as a substantial in-scope deliverable. Estimate: 200-400 words per system prompt × 3 voices = ~1500 words of careful prompt copy. Plus per-voice user-prompt builders.

### Token budget per voice (Sprint 4a-derived estimates)

- Sprint 4a's smoke (Gemini Flash, ~80-word prompt + 2-3 sentence response): ~89 tokens prompt+completion + ~956 tokens thinking-mode = 1045 total.
- Sprint 4c voices will produce longer responses (estimated 5-10 sentences per voice).
- Estimate: 3000-5000 total tokens per voice call (including thinking allocation).
- Three voices × 1 call each = 9000-15000 tokens per Scenario A run.
- At Gemini Flash pricing (free tier): $0; at paid tier: ~$0.001-0.002 per run.
- Negligible cost. Token budget is not a constraint for Sprint 4c.

### Demo latency budget

Per Sprint 4b empirical data (2026-05-17 smoke):
- 1 anomaly:detected direct write: ~150ms
- N tool dispatches × ~600-900ms each (Sprint 4b measured 452-934ms with serial mutex + 2 S3 writes per dispatch)
- 3 voice LLM calls × ~5s each (Sprint 4a measured 5.8s for one Gemini Flash call)
- Final write + chain verification: ~2s

Scenario A with 5 tool dispatches (per Decision 2A): 1 × 150ms + 5 × 750ms + 3 × 5000ms + 2000ms = **~21 seconds total**.

Acceptable for a demo run; on the slow end of judges' patience. Tightenable in Sprint 7 polish (parallel-dispatch todo entry, Gemini Flash → Flash-Lite where appropriate, etc.).

### Failure modes specific to Sprint 4c

These are spec-stage concerns but flagged here so they're not missed:

- **Gemini quota hit mid-run**: per `tasks/lessons.md`, free-tier Pro has limit:0; Flash has non-zero quota but is rate-limited. If the Risk Officer call succeeds but the Synthesizer call hits a 429, what does the runner do? Options: (a) retry with exponential backoff (per `.claude/rules/vultr.md` circuit-breaker pattern, Sprint 7 polish), (b) hard-fail and surface the quota error, (c) write a `synthesizer:refusal` with a "degraded_inputs" entry pointing to the failed call.
- **Vultr Nemotron unavailable**: if the Vultr Inference endpoint is down, the Ops Engineer call fails. Same three options as above. Note: Sprint 4c's spec should decide between "hard-fail the whole run" (cleanest) and "refuse with degraded-inputs" (more agent-like).
- **LLM produces malformed structured response** (relevant to Decision 3C): Zod parse fails → orchestrator returns a refusal with `degraded_inputs: [{source: "synthesizer_response", reason: "malformed_json"}]`. The refusal is the safety net.
- **Tool dispatch fails mid-voice**: a voice's tool sequence produces an error envelope for one of the tools. The voice's user prompt builder should include "the system tried to fetch X but got error: Y" in the prompt, letting the LLM reason about it. The LLM then either refuses to reason ("I can't assess without market data") or hedges ("based on available data, with the caveat that..."). Either is a credible demo moment.

### Competitive narrative reinforcement

Per `.claude/rules/hackathon.md` and the operator's framing: every audit record should reinforce "external governance layer."

- Risk Officer prompt should sound like a risk officer: "I am concerned about exposure to the IV/RV divergence..."
- Ops Engineer prompt should sound like an engineer: "The position-state telemetry reports..."
- Synthesizer prompt should sound deliberative: "Considering both the Risk Officer's concern about exposure and the Ops Engineer's confirmation of position state..."
- Proposal text should be a recommendation TO a human: "I recommend halving the AAPL position pending..." (not "halve the AAPL position"). The grammatical mood matters.
- Refusal text should be epistemically humble: "I do not have sufficient confidence to recommend an action because..."

These are prompt-engineering deliverables, not brainstorm decisions, but the brainstorm flags the load-bearing-ness of the prompt copy.

### Audit record count: countable artifact

Per `.claude/rules/hackathon.md`'s countable-artifacts framing: "~120 audit log entries per scenario run (depending on tool-call depth)." Sprint 4c at the proposed Decision 2A sequence produces ~15-20 records (1 anomaly + 5 tool dispatches × 2 + 3 reasoning + 1 proposal/refusal = 15; plus any additional records like policy:check before final proposal = up to 20).

15-20 << 120. Options to inflate:
- (i) Each voice dispatches more tools (Risk could also call `policy:check`; Ops could call `audit:search` for multiple lookback windows; Synthesizer could call `score:explain` for the proposed action).
- (ii) Multiple anomaly:detected records per run (detect IV/RV breach in multiple symbols; iterate through them).
- (iii) Accept the lower count and revise the hackathon-pitch number to reflect Scope C reality.

For Sprint 4c's brainstorm: I recommend (iii) — accept ~15-20 records as the honest demo number. The countable-artifact pitch should be updated for the submission to say "X records per Scenario A run" with the real number. Inflation for inflation's sake feels gameable to judges. The chain depth (15-20 unbroken hash links) is impressive on its own; quality > quantity.

This is a Sprint 7 polish decision (the submission copy), not a Sprint 4c decision. But flagging here so the operator can think about whether the hackathon pitch number needs adjustment.

---

## Open questions

1. **Decision 3 threshold + default narrative**: Is Scenario A's default narrative "propose" or "refuse"? If propose, the refusal moment is demoed via a `--degraded` flag (Option ii above). If refuse, the default fixtures need to be engineered for low confidence and the propose moment is the special case. Which beat is the demo's climax?

2. **Decision 1 round count for 1C** (only if 1C is selected): hard cap at 2 rounds (Risk → Ops → Risk-rebuts → Ops-rebuts → Synthesizer = 5 reasoning records), or 1 round (Risk → Ops → Synthesizer = 3 reasoning records but with Ops seeing Risk's reasoning)?

3. **Decision 5 abstraction location**: Even if Sprint 4c is script-only (5A), should the orchestration be exposed as a library function in `@roguemouse/agent` from the start, anticipating Sprint 6/7 endpoint work? My strong inclination is yes (per the "library function + thin script wrapper" pattern in 5C), but worth confirming.

4. **Vultr Nemotron model verification**: Sprint 4a smoke verified Gemini Flash. Has Vultr Nemotron (`nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` per `.claude/rules/vultr.md` and `ROGUEMOUSE_CONTEXT.md`) been verified end-to-end recently? If models rotate, the Ops Engineer voice may hit a model-not-found 404. Sprint 4c should include a model-availability pre-flight (like Sprint 4b's permission pre-flight) before starting the run.

5. **Cost tracking aggregation**: each `*:reasoning` audit payload includes a `tokens` field. The runner could compute a per-run cost estimate at the end and include it in the structured PASS report. Worth doing? (Trivial work but additive scope.)

6. **Audit-record-count target**: should the spec target 20+ records explicitly (closer to the countable-artifact pitch), or accept the natural 15-record count from Decision 2A's hardcoded sequences? If 20+, add `policy:check` to the Synthesizer's pre-proposal flow and `score:explain` for the proposed action.

7. **Final terminal record**: Sprint 3 locked 12 recordTypes including `human:approval`/`human:rejection`/`final:committed`. Does Scenario A's demo emit a `human:approval` record (with a hardcoded approver) to round out the chain, or stop at `synthesizer:proposal`? The hackathon narrative suggests "every action requires human approval" (per `.claude/rules/hackathon.md` countable artifacts: "0 autonomous mutations of trading-system state"). Stopping at `synthesizer:proposal` is more honest; emitting a synthetic `human:approval` is more dramatic. Trade-off.

---

## Recommendation

I recommend:

**Decision 1 (voice sequencing) → 1A (strict sequence)**. Three sequential voice calls produce a deterministic 15-20 record audit chain, easy to test, easy to script for the demo, and matches the `synthesizer:reasoning` payload schema's two-input shape. The "debate" framing comes from the prose in each voice's prompt and the Synthesizer's deliberative reconciliation — not from orchestrator-level back-and-forth. Sprint 4c is Day 5 of 6; correctness over agentic theater. If the demo feels too linear, Sprint 7 polish can add a single rebuttal round (~10 extra seconds, ~2 extra records).

**Decision 2 (tool dispatch per voice) → 2A (hardcoded per-voice sequences)**. The Vultr Nemotron path explicitly does not support LLM-driven function calling per `.claude/rules/vultr.md`; routing only the Gemini voices through LLM-driven dispatch would break orchestrator symmetry. Hardcoded sequences are also more demo-scriptable and align with the project's locked "tools orchestrated from planner, not from LLM" principle. Proposed sequences locked above (Risk: market+runbook; Ops: position+broker+audit-search; Synth: none).

**Decision 3 (confidence extraction) → 3C (structured JSON via response_format)**. Robust parsing, aligns cleanly with `synthesizerProposalPayload` / `synthesizerRefusalPayload` schemas, demo-worthy. Threshold: **4500 (45%)** — aesthetically matches Scenario A's IV/RV threshold, low enough that intentionally-degraded inputs in the `--degraded` variant will trigger refusal naturally. Default Scenario A path (clean inputs) likely proposes; the `--degraded` flag (option ii from Decision 3 narrative) demos the refusal. Both run from the same orchestrator code.

**Decision 4 (anomaly detector) → 4B (real detector function)**. ~30 lines of code, unit-testable, narrative-worthy. Lives in `packages/agent/src/detectAnomalies.ts` with one type (`Anomaly`) and one function. Extensible to Sprint 5's Scenarios B/C.

**Decision 5 (runner shape) → 5C-modulo (library function + script only)**. Sprint 4c ships the orchestration as `runScenarioA` in `@roguemouse/agent` and a thin `scripts/scenario-a.ts` wrapper. Sprint 6's HTTP endpoint (if needed) becomes a second wrapper around the same function — zero refactor required. This is the right architectural call regardless of when the endpoint actually lands.

**Net Sprint 4c shape**: 1 detector function + 3 voice prompt builders + 1 orchestrator function (`runScenarioA`) + 1 thin script + ~5 test files. The orchestration is the smallest sprint by code volume since Sprint 4a, but the largest by narrative weight. The 5-stage protocol's value here is forcing every prompt decision and every audit-record-shape decision to be made explicitly at spec/plan stage, not improvised during implementation.
