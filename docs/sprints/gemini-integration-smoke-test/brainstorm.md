# gemini-integration-smoke-test — Brainstorm

## Problem

Sprint 2 verified Vultr Serverless Inference works end-to-end from TypeScript. Sprint 3 locked the audit record discriminated union with 12 branches including `risk_officer:reasoning` (the payload shape for Gemini-generated reasoning). Sprint 4a is the third external integration: Google's Gemini API. Without it, the multi-agent debate architecture (Risk Officer voice on Gemini + Ops Engineer voice on Vultr Nemotron + Synthesizer voice on Gemini Flash) cannot proceed; Sprint 4b's dispatch runtime and Sprint 4c's scenario assembly both block on this. This sprint is the cheap, contained verification step before those higher-risk sprints commit to a particular SDK shape.

The sprint mirrors Sprint 2's pattern: one chat completion call → build one audit record describing the call → hash-chain it with genesis → write to Vultr Object Storage → read it back → verify integrity. The deltas vs Sprint 2 are the LLM provider (Gemini instead of Vultr's OpenAI-compatible Nemotron endpoint), the `recordType` (`risk_officer:reasoning` instead of `smoke_test:chat_completion`), and the payload shape (the locked 5-field Risk Officer shape: `input`, `reasoning`, `confidence`, `durationMs`, `tokens`). If anything about Gemini's API surface differs from our assumptions — SDK shape, response structure, auth model, streaming-vs-blocking behavior — this is where we discover it. The audit-record chain gains its third record (after Sprint 2's "patient zero" and Sprint 3's "second patient zero"), and that record will be the first `risk_officer:reasoning` record in the bucket.

## Existing code touched

Files Sprint 4a will modify or create:

- `packages/inference/src/types.ts:1-72` — current envelope shape. Sprint 4a's Gemini client returns the same `InferenceResult<ChatCompletionData>` envelope. May or may not add new types here depending on Decision 6.
- `packages/inference/src/client.ts:1-23` — current `createInferenceClient` factory. Pattern is reusable but it returns the `OpenAI` SDK instance directly. Sprint 4a's Gemini client either reuses this (if Decision 1 picks OpenAI-compat) or introduces a parallel `createGeminiClient` factory (if Decision 1 picks the native SDK).
- `packages/inference/src/chatCompletion.ts:1-163` — current wrapped function with envelope returns and HTTP error classification. Sprint 4a's `geminiChatCompletion` (or equivalent) follows the same disciplines: no throws on the public surface, structured `InferenceError` for every failure path, retryable flag set per HTTP convention.
- `packages/inference/src/index.ts:1-15` — barrel. Adds new exports for the Gemini client + chat completion function.
- `packages/inference/package.json:16-18` — currently has only `openai` as a direct dep. Sprint 4a may add `@google/generative-ai` (Decision 1 option A) or keep the dependency set unchanged (Decision 1 option B).
- `scripts/smoke-gemini.ts` (new file) — mirrors `scripts/smoke-vultr.ts` (373 lines) almost line-for-line, with the inference step swapped for Gemini and the audit record using `recordType: "risk_officer:reasoning"`.
- `package.json` (root, lines 15-23) — currently has `"smoke": "tsx scripts/smoke-vultr.ts"`. Sprint 4a adds a parallel script entry (`"smoke:gemini": "tsx scripts/smoke-gemini.ts"`) or renames the existing entry. Sprint 4a's brainstorm should decide naming convention.
- `.env.example` — already documents `GEMINI_API_KEY`, `GEMINI_RISK_MODEL=gemini-2.5-pro`, `GEMINI_SYNTH_MODEL=gemini-2.5-flash` (lines 13-16). No change needed unless we add new variables.

Files locked by Sprint 3 that Sprint 4a inherits unchanged:

- `packages/schemas/src/auditPayloads.ts:105-113` — the `riskOfficerReasoningPayload` shape: `{ input: canonicalSafeSchema, reasoning: string, confidence: integer 0-10000, durationMs: non-negative integer, tokens: { prompt, completion, total } }`.
- `packages/schemas/src/auditRecord.ts:129` — the union branch built via `defineAuditRecord("risk_officer:reasoning", riskOfficerReasoningPayload)`.
- `packages/audit/src/runAuditWriter.ts` — `RunAuditWriter.append` and `read` are unchanged. The writer's internal `safeParse` against the discriminated union (line 112) accepts the `risk_officer:reasoning` branch.
- `packages/schemas/src/canonicalize.ts` — unchanged. The new audit record's payload contains only canonicalization-safe values (strings, integers, plus `input` which is constrained by `canonicalSafeSchema` at schema-parse time).

Files NOT touched by Sprint 4a:

- `packages/agent/`, `packages/tools/`, `packages/broker-mock/`, `packages/runbooks/` — Sprint 4b/4c work.
- `apps/web/` — Sprint 6+ deploy work.
- `packages/audit/`, `packages/schemas/` — locked from Sprint 3.

---

## Decision 1 — Gemini SDK choice

### Approach 1A — Native `@google/generative-ai` SDK

Use Google's first-party SDK for Gemini. It exposes a `GoogleGenerativeAI` class with model-specific generators, native streaming, vision, and function-calling support, plus Gemini-specific safety controls.

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
const result = await model.generateContent("Hello, Risk Officer.");
const text = result.response.text();
const usage = result.response.usageMetadata; // promptTokenCount, candidatesTokenCount, totalTokenCount
```

Pros:
- Full Gemini feature coverage (streaming, vision, function-calling, safety controls, system instructions as a first-class field).
- Type-safe Gemini-specific responses (e.g., `finishReason: "STOP" | "SAFETY" | "MAX_TOKENS" | ...`).
- Authoritative SDK; first-party maintenance commitment.
- Distinct from `OpenAI` SDK type system, so Vultr and Gemini paths can't accidentally cross-pollute.

Cons:
- Adds one new direct dependency. The dependency closure increases (the SDK pulls in its own RPC/HTTP layer).
- Different shape from the existing `chatCompletion` wrapper — the wrapping logic needs to be rewritten for the new SDK's surface, not adapted.
- Token usage field names differ: `promptTokenCount` vs OpenAI's `prompt_tokens`. Re-keying logic in `chatCompletion.ts` needs a Gemini variant.
- Error shape differs from `OpenAI.APIError`. The classifyInferenceError function in `chatCompletion.ts:110-163` does not transfer; a parallel Gemini classifier is needed.

Complexity: medium. The SDK is well-documented but the integration surface is non-trivial — ~80-120 lines of new wrapper + classifier code.

Forces into scope: a new dev dependency in `packages/inference/package.json`; a parallel error classifier with Gemini-specific error types; a parallel token-usage re-keying step.

Anti-features: does not auto-unify the two providers behind a single envelope — that unification is structural (both return `InferenceResult<T>`) but the wrapping code is duplicated.

### Approach 1B — Gemini's OpenAI-compatibility shim

Gemini exposes an OpenAI-compatible endpoint at `https://generativelanguage.googleapis.com/v1beta/openai/`. Point the existing `openai` SDK at that base URL with the Gemini API key as the bearer token, and call `chat.completions.create` exactly as the Vultr client does.

```typescript
import { OpenAI } from "openai";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const response = await client.chat.completions.create({
  model: "gemini-2.5-pro",
  messages: [{ role: "user", content: "Hello, Risk Officer." }],
  max_tokens: 500,
});
// Same shape as Vultr response: response.choices[0].message.content, response.usage.prompt_tokens, etc.
```

Pros:
- Zero new dependencies. `openai` is already in `packages/inference/package.json:17`.
- Reuses the entire existing `chatCompletion.ts` wrapper unchanged. The only delta is the `baseURL` passed to `createInferenceClient` and the `apiKey` source. The error classifier (lines 110-163) works as-is because Gemini's OpenAI-compat mode returns OpenAI-shaped errors.
- Same token-usage re-keying logic works (Gemini's compat layer reports `prompt_tokens`/`completion_tokens`/`total_tokens` to mirror OpenAI).
- Lower cognitive load: one mental model (OpenAI chat-completions shape) across both providers.

Cons:
- Subset of Gemini features. No native streaming through the openai SDK against the compat endpoint (it's supported but limited). No vision (not needed for Sprint 4a). No function calling in compat mode (not needed — our architecture orchestrates tools from planner code per `.claude/rules/vultr.md:121-125`). No safety-control fine-tuning.
- Compat-mode behavior may diverge from native Gemini on edge cases. Documented unknowns: how does Gemini's `finishReason: "SAFETY"` surface through OpenAI's `finish_reason` enum? Likely as `content_filter` or similar — needs verification.
- Token counts in compat mode may not match what `@google/generative-ai` reports (the SDKs occasionally round/aggregate differently). For audit-log honesty this is a minor concern.
- Locks us to whatever Gemini's compat-mode catalog supports. Gemini-3-pro availability through compat mode is currently unverified (the documented compat endpoint references `gemini-2.5-*` and `gemini-2.0-*`).

Complexity: small. The existing `createInferenceClient` and `chatCompletion` may need zero changes — the smoke runner just instantiates a second client with a different baseURL. If a separate wrapper is preferred for readability, that wrapper is ~10 lines.

Forces into scope: a new export from `@roguemouse/inference` for the Gemini-specific factory (or a discriminator in the existing factory); nothing else.

Anti-features: does not get us native streaming, vision, or Gemini-specific safety controls. None of these are needed for Sprint 4a's smoke. If 4b/4c needs them, the SDK can be added incrementally.

### Decision 1 summary

| | 1A native SDK | 1B OpenAI-compat |
|---|---|---|
| New dependencies | 1 (`@google/generative-ai`) | 0 |
| Code reuse with Vultr path | low | high |
| Gemini feature coverage | full | chat completions subset |
| Smoke test feasibility | works but more code | works with minimal code |
| Risk for Sprint 4b/4c | low (feature complete) | medium (may need to add SDK later if streaming/vision required) |

**Recommended: 1B.** Reasoning is in the final recommendation section.

---

## Decision 2 — Package home for the Gemini client

### Approach 2A — Extend `@roguemouse/inference` with Gemini-specific files

Add `geminiClient.ts` and `geminiChatCompletion.ts` (or, if Decision 1B is chosen, simply a thin factory wrapper) alongside the existing Vultr-oriented `client.ts` and `chatCompletion.ts`. Both providers live in the same package, share the `InferenceResult<T>` envelope, and are exported from the same barrel.

Pros:
- Lowest refactor cost: don't change anything that works.
- Both providers exposed through one import path: `import { chatCompletion, geminiChatCompletion } from "@roguemouse/inference"`. Easy to read at call sites.
- Single test target (`pnpm --filter @roguemouse/inference test`) covers both.
- Future provider additions follow the same pattern.

Cons:
- The package's name (`inference`) becomes slightly inaccurate — it now hosts two distinct provider integrations. Acceptable but mildly imprecise.
- If providers diverge significantly later (different envelope semantics, different streaming behavior), the single-package home gets messy.

Complexity: small. New files added to an existing package; barrel re-exports; no package.json scaffolding.

Forces into scope: minor barrel updates.

Anti-features: does not isolate provider failures across packages. If Gemini's SDK has a runtime bug, the inference package's tests/build can be affected. (Mitigation: each provider's tests/code paths are independent.)

### Approach 2B — Refactor `@roguemouse/inference` to be provider-agnostic

Introduce a `Provider` abstraction. `chatCompletion(client, args)` becomes the public surface; internally it routes to `vultrChatCompletion` or `geminiChatCompletion` based on the client type (or an explicit provider parameter). Provider-specific clients become internal details.

```typescript
type Provider = "vultr" | "gemini";

export async function chatCompletion(
  client: InferenceClient,
  args: ChatCompletionArgs,
): Promise<InferenceResult<ChatCompletionData>> {
  switch (client.provider) {
    case "vultr": return vultrChatCompletion(client.openai, args);
    case "gemini": return geminiChatCompletion(client.openai, args);
  }
}
```

Pros:
- Cleanest long-term API: one function name, provider is a detail.
- Sprint 4b's dispatch logic can hold a `Provider` value and use the same function regardless of which voice it's invoking.

Cons:
- Refactors working Sprint 2 code. The existing `chatCompletion(openai, args)` signature changes. Every call site updates (currently just `scripts/smoke-vultr.ts:195-200`).
- We don't yet know what provider-agnostic abstraction is right. Premature abstraction risk: if Gemini's quirks (e.g., safety blocks, multi-turn behavior) need to leak through, the abstraction has to grow.
- Sprint 4a is a smoke test. Refactoring stable Sprint 2 code at this stage adds risk to two integrations at once.

Complexity: medium. Refactor existing files; update call sites; verify Sprint 2's smoke test still passes; then implement Gemini path.

Forces into scope: refactor of `client.ts` and `chatCompletion.ts`; updates to `scripts/smoke-vultr.ts`; an additional `pnpm smoke` run to verify Sprint 2 path hasn't regressed.

Anti-features: does not make provider differences impossible to express (Gemini-specific options still need somewhere to go).

### Approach 2C — New `@roguemouse/gemini-inference` package

Create a sibling package dedicated to Gemini.

Pros:
- Maximum isolation. Each provider's code lives in its own home.
- Each package can declare its own SDK dependency without cross-coupling.

Cons:
- New `package.json`, `tsconfig.json`, `vitest.config.ts` scaffolding. Per Sprint 3's `lessons.md` entry on conditional-exports, every new workspace package brings a quiet maintenance tax.
- Cross-package imports increase. Sprint 4b will need both `@roguemouse/inference` (for Vultr) and `@roguemouse/gemini-inference` (for Gemini) — twice as many imports for the same conceptual thing.
- Sprint 4a doesn't need this isolation. The integration is small enough to live alongside the existing one.

Complexity: medium (mostly scaffolding).

Forces into scope: new package configuration; updates to `pnpm-workspace.yaml`; new typecheck target.

Anti-features: justified only if we expect a third or fourth provider integration. Currently we expect Vultr + Gemini and nothing else.

### Decision 2 summary

| | 2A extend inference | 2B refactor agnostic | 2C new package |
|---|---|---|---|
| Refactor risk | none | medium | none |
| Long-term cleanliness | medium | high | high |
| Sprint 4a footprint | small | medium | medium |
| Sprint 4b ergonomics | good | best | worst |

**Recommended: 2A.** Reasoning is in the final recommendation section.

---

## Decision 3 — Gemini model pinning

### Approach 3A — Hardcode `gemini-2.5-pro` in the runner

The smoke runner defines `const RISK_MODEL = "gemini-2.5-pro";` (or similar) at the top, with no env override. Mirrors the locked-constants pattern from `scripts/smoke-vultr.ts:110-118` where endpoint/region/bucket are hardcoded but the model is env-overridable.

Pros:
- Most predictable. Same model every run.
- No env-handling logic.

Cons:
- Diverges from Sprint 2's pattern: `OPS_MODEL = envModel?.trim() || DEFAULT_OPS_MODEL` reads the model from env with a default. Sprint 4a should mirror this.
- Hard to test against alternative model versions without editing the runner.

Complexity: trivial.

Forces into scope: nothing.

Anti-features: no way to verify Gemini 3 availability without code changes.

### Approach 3B — Try `gemini-3-pro` first, fall back to `gemini-2.5-pro`

Pre-flight call to Gemini's list-models endpoint (or attempt with 3-pro and catch a 404), then retry with 2.5-pro if needed.

Pros:
- Demo-ready: if 3-pro is available, the demo run uses it; otherwise 2.5-pro keeps things working.

Cons:
- Adds an HTTP call per smoke run (~100-300ms latency overhead, $0 cost since model listing is free).
- Adds branching logic to the smoke runner. For a smoke test the goal is "did the integration work" — the answer should be unambiguous, not "yes but it fell back."
- Fallback logic may mask a real availability bug. If 3-pro is unavailable for a reason we should know about, silently falling back hides it.
- The cost is wrong-priority: Sprint 4a is verifying integration, not preparing for demo. Demo model selection is Sprint 7 territory.

Complexity: medium.

Forces into scope: list-models call OR a try/catch around `chat.completions.create`; documentation of fallback behavior.

Anti-features: does not give Sprint 7 useful information either — Sprint 7 will decide based on demo polish, not on smoke-run results.

### Approach 3C — Env-var-driven with `gemini-2.5-pro` default

```typescript
const DEFAULT_RISK_MODEL = "gemini-2.5-pro";
const envModel = process.env.GEMINI_RISK_MODEL?.trim();
const RISK_MODEL = envModel && envModel.length > 0 ? envModel : DEFAULT_RISK_MODEL;
```

Same pattern as Sprint 2's `OPS_MODEL` (`scripts/smoke-vultr.ts:115-118`). The `.env.example` already documents `GEMINI_RISK_MODEL=gemini-2.5-pro` (line 15), so no `.env.example` changes are needed.

Pros:
- Consistent with the existing pattern.
- Operator can test alternative model versions by editing `.env.local`.
- Sprint 7 can flip the demo to `gemini-3-pro` by changing `.env.local` without touching the smoke runner.

Cons:
- None of substance for a smoke test.

Complexity: trivial.

Forces into scope: nothing — `.env.example` is already prepared.

Anti-features: does not validate the model name client-side. If the operator sets `GEMINI_RISK_MODEL=foo-bar`, the smoke fails at first call with a 404 from Gemini. That's an acceptable failure mode (clear, fast).

### Decision 3 summary

| | 3A hardcode | 3B fallback | 3C env-driven |
|---|---|---|---|
| Pattern consistency | low | n/a | high (matches Sprint 2) |
| Complexity | trivial | medium | trivial |
| Demo-future-readiness | low | masks bugs | high |

**Recommended: 3C.** Reasoning is in the final recommendation section.

---

## Decision 4 — Smoke test prompt + `input` field synthesis

This decision has two sub-parts. The first is what prompt the smoke test sends; the second is what shape the audit record's `payload.input` field captures.

### Sub-decision 4A — Prompt content

**Option (i) — Synthetic anomaly description.**
```
"IV/RV ratio is 0.42 for AAPL at 09:31:14 UTC; the project's low-bound
threshold is 0.45. Diagnose in 2-3 sentences."
```
Realistic Risk Officer-shape input. Tests the model's response under our intended use case.

Pros:
- Exercises Gemini's reasoning behavior on a domain-relevant task.
- The completion will be a few hundred tokens — enough to verify token-counting plumbing works.
- Manual inspection of the output is informative (does the model say something sensible about IV/RV?).

Cons:
- Larger prompt than strictly needed for "did the integration work."
- Response varies run-to-run (LLMs are non-deterministic). Not byte-stable across smokes — the same input produces different audit records on each run.

**Option (ii) — Trivial prompt.**
```
"Reply with only the word OK."
```
Minimum viable prompt.

Pros:
- Most predictable response. Easier to verify the integration works.
- Lower cost (~$0.0001 vs ~$0.0005 for option i).

Cons:
- Doesn't exercise reasoning behavior. We learn nothing about whether the model is suitable for Risk Officer reasoning.
- Audit record's `reasoning` field is just "OK", which is dishonest about what the production Risk Officer will look like.

**Option (iii) — RAG-augmented (include runbook content as context).**

Inject `packages/runbooks/content/iv-rv-divergence.md` (one of the 5 runbooks present in 0e7681b) into a system prompt, then ask the question from option (i).

Pros:
- Closest to the production flow.
- Tests that the runbook content works as context for Gemini specifically.

Cons:
- Out of scope for 4a — runbook retrieval is Sprint 4b/4c territory. Sprint 4a is verifying basic integration, not the full RAG path.
- Couples Sprint 4a to the runbook corpus. If the runbook content evolves, the smoke test changes.
- Larger prompt = higher cost.

### Sub-decision 4B — `payload.input` shape

The `risk_officer:reasoning` payload's `input` field is typed as `canonicalSafeSchema` (any canonicalization-safe value). What concrete shape should the smoke runner write?

**Option (i) — Just the prompt string.** `input: "IV/RV ratio is..."`
Simplest. But loses model identity and other call-site context.

**Option (ii) — Object with prompt + model.** `input: { prompt: "...", model: "gemini-2.5-pro" }`
Captures the LLM identity in the audit record. The locked `risk_officer:reasoning` payload doesn't have a separate `model` field (unlike `smoke_test:chat_completion`), so `model` belongs inside `input`.

**Option (iii) — Object with full messages array + model + temperature.** `input: { messages: [{role, content}], model, temperature }`
Maximum fidelity. Reproduces exactly what the call looked like.

### Decision 4 summary

| Prompt option | Tests integration | Tests reasoning | Cost | Sprint 4a-appropriate |
|---|---|---|---|---|
| (i) anomaly | yes | yes | ~$0.0005 | yes |
| (ii) trivial | yes | no | ~$0.0001 | yes-but-shallow |
| (iii) RAG | yes | yes | ~$0.0008 | no — out of scope |

| Input shape | Captures prompt | Captures model | Captures all args |
|---|---|---|---|
| (i) string | yes | no | no |
| (ii) `{prompt, model}` | yes | yes | partial |
| (iii) full messages + config | yes | yes | yes |

**Recommended: prompt (i) anomaly description, input shape (ii) `{ prompt, model }`.** Reasoning is in the final recommendation section.

---

## Decision 5 — Confidence synthesis

The `risk_officer:reasoning` payload requires `confidence: z.number().int().min(0).max(10000)` (basis points, 0% to 100% in 0.01% steps). LLMs do not natively emit confidence values in this format.

### Approach 5A — Fixed synthetic value

```typescript
const SMOKE_CONFIDENCE = 5000; // 50%, synthetic — not a real model confidence
```

The smoke runner uses a constant. A JSDoc comment notes that the value is synthetic for smoke-test purposes.

Pros:
- Deterministic. No parse logic that can fail.
- Honest: the smoke test isn't trying to fake real confidence extraction.
- Trivial to implement.

Cons:
- Doesn't exercise any confidence-extraction logic. If Sprint 4b/4c needs to extract confidence, that logic is unbuilt.
- Audit record's `confidence` value is uninformative.

Complexity: trivial.

Forces into scope: a JSDoc note in the runner explaining the synthetic value.

### Approach 5B — Extract from model response via system-prompt coaching

The system prompt asks Gemini to emit confidence at the end of its response in a tagged format:

```
"After your reasoning, on a new line, emit:
[confidence]<integer 0-10000></confidence>
where 0 means no confidence and 10000 means complete confidence."
```

The runner parses the response with a regex to extract the integer.

Pros:
- Tests realistic Risk Officer behavior (extracting structured fields from LLM output).
- Sprint 4b/4c will need this capability anyway; might as well prototype it here.

Cons:
- Brittle. Gemini may not follow the system prompt exactly — emitting `[confidence]50%[/confidence]` or `confidence: 5000` or `I'm 50% confident` instead of the expected tag. Each variant needs handling.
- Adds parse logic to the smoke runner that doesn't belong there (the smoke is verifying integration, not prompt-engineering reliability).
- A parse failure on the smoke is hard to diagnose: did the integration fail, did the prompt fail, did the parse logic fail? Three potential bugs in one PASS/FAIL.
- Falls back to what value if the parse fails? If 0, the audit record is misleading. If the runner fails, the smoke is reporting a false negative on the integration.

Complexity: medium (parse + fallback).

Forces into scope: a parse helper; a fallback strategy on parse failure; documentation of the system-prompt contract.

Anti-features: doesn't make the runner more robust — adds a failure mode that's unrelated to the smoke's actual purpose.

### Approach 5C — Heuristic based on response characteristics

Compute confidence from response length, hedge-word count, etc. (e.g., shorter responses with fewer hedges → higher confidence).

Pros:
- Doesn't depend on the model following a system prompt.

Cons:
- Not appropriate for a smoke test. Sprint 4a is too early for this; the heuristic itself would need its own validation.

Complexity: large for a smoke; out of scope.

Forces into scope: heuristic design and validation, which is not Sprint 4a's purpose.

### Decision 5 summary

| | 5A fixed | 5B extracted | 5C heuristic |
|---|---|---|---|
| Determinism | high | low | medium |
| Tests extraction | no | yes | partial |
| Sprint 4a-appropriate | yes | borderline | no |
| Parse-failure risk | none | real | n/a |

**Recommended: 5A.** Reasoning is in the final recommendation section.

---

## Decision 6 — Error envelope shape

### Approach 6A — Reuse `InferenceError` exactly

The existing `InferenceError = { code: string, message: string, retryable: boolean }` (from `packages/inference/src/types.ts:23-27`) covers Gemini errors with no additions. Gemini's error categories map cleanly:

- HTTP 408/429/5xx → retryable.
- HTTP 4xx other → not retryable.
- `finishReason: "SAFETY"` from a successful API call → translate to `{ code: "safety_block", message: "...", retryable: false }`.
- Network errors → retryable.

Pros:
- Consistent envelope across `@roguemouse/inference` providers. Sprint 4b's dispatch code uses the same `if (result.ok)` everywhere.
- Audit records (and any future error logs) record errors in a single shape across providers.
- Sprint 4a's runner reuses the existing `failNoState` / `failWithState` helpers in `smoke-vultr.ts:144-175` unchanged.

Cons:
- Loses Gemini-specific metadata. If Gemini returns a `safetyRatings` block alongside a safety-blocked completion, that data is dropped (or stringified into `message`).
- If a future Gemini-specific debugging need arises, the envelope is too narrow.

Complexity: small.

Forces into scope: a Gemini-specific `classifyGeminiError` function that maps Gemini's error shapes into `InferenceError` (parallel to `classifyInferenceError` at `chatCompletion.ts:110-163`).

Anti-features: no first-class field for Gemini's safety-block details.

### Approach 6B — `GeminiError`-specific shape

Define a separate `GeminiError` type with Gemini-specific fields:

```typescript
type GeminiError = {
  code: string;
  message: string;
  retryable: boolean;
  blockReason?: "SAFETY" | "RECITATION" | "OTHER";
  safetyRatings?: Array<{ category: string; probability: string }>;
};
```

`GeminiResult<T> = { ok: true, ... } | { ok: false, error: GeminiError }`.

Pros:
- First-class Gemini diagnostics.
- Sprint 4b's planner can branch on Gemini-specific error codes.

Cons:
- Diverges from the cross-provider envelope discipline. Two error types instead of one.
- Sprint 4b's dispatch code needs to handle both `InferenceError` and `GeminiError` — every call site does a provider-specific branch. The whole point of the discriminated-union envelope pattern (per Sprint 2's `LLM error handling` architectural decision) was to avoid this.
- Premature: we don't yet have a concrete Sprint 4b/4c need that motivates Gemini-specific error fields.

Complexity: medium.

Forces into scope: a separate type; separate test fixtures; separate handler code at every call site.

Anti-features: does not give us anything we can't get with 6A + a JSDoc note that Gemini-specific details are stringified into `message`.

### Approach 6C — `InferenceError` + optional `providerSpecific` field

```typescript
type InferenceError = {
  code: string;
  message: string;
  retryable: boolean;
  step?: string;
  providerSpecific?: Record<string, unknown>;
};
```

When Gemini returns extra metadata, populate `providerSpecific`. Vultr path leaves it `undefined`.

Pros:
- Cross-provider consistency at the top level.
- Optional Gemini-specific data when useful.

Cons:
- Modifies the cross-package envelope shape. Affects `@roguemouse/inference` and possibly `@roguemouse/audit` if its error type ever needed to mirror.
- YAGNI: we don't have a concrete need for the field right now. Adding optional fields "in case we need them" is a known anti-pattern in this codebase (the brainstorm from Sprint 3 explicitly rejected redundant tagging on similar grounds).

Complexity: small (add an optional field) but the modification touches the locked Sprint 2 envelope shape.

Forces into scope: a careful audit of every call site that consumes `InferenceError` to confirm the optional field doesn't change behavior; documentation of the new field's purpose.

Anti-features: optional fields create implicit-vs-explicit ambiguity at call sites. Reviewers don't know if a missing `providerSpecific` means "no metadata available" or "the producer forgot to set it."

### Decision 6 summary

| | 6A reuse InferenceError | 6B GeminiError | 6C InferenceError + provider data |
|---|---|---|---|
| Envelope consistency | high | low | medium |
| Gemini diagnostics | message-only | first-class | optional |
| Sprint 4a-appropriate | yes | no | borderline |
| Locks Sprint 2 envelope | no | no | yes (modifies it) |

**Recommended: 6A.** Reasoning is in the final recommendation section.

---

## Preconditions and additional considerations

These are not separate decisions but worth flagging for the spec stage:

- **`.env.local` does not have `GEMINI_API_KEY` populated yet.** The `.env.example` documents the variable (`.env.example:14`). The operator's first action for Sprint 4a is generating an API key in Google AI Studio (`https://aistudio.google.com/apikey`) and populating it. Sprint 4a's spec preconditions section should call this out explicitly, the same way Sprint 2's spec called out the three Vultr secrets.

- **Cost estimate per smoke run.** Sprint 2's smoke recorded `~$0.0000518` (Vultr Nemotron pricing). Gemini 2.5 Pro is `$1.25/M input tokens` and `$10/M output tokens` in thinking mode (or `$5/M output` without thinking). A Sprint 4a smoke with the recommended anomaly prompt is ~100 input tokens + ~300 output tokens, which costs roughly `0.000125 + 0.003 ≈ $0.0031` per run in thinking mode, or `~$0.0016` without. An order of magnitude more expensive than Vultr, but still well under a cent. Worth noting in the spec but not a constraint.

- **Audit chain status.** The bucket currently holds two records (Sprint 2's "patient zero" and Sprint 3's "second patient zero"). Sprint 4a's record will be the **third record in the bucket** and the **first `risk_officer:reasoning` record** ever written. Each run uses a fresh `randomUUID()` runId, so the record is its own one-record chain rooted at genesis — same model as Sprints 2 and 3.

- **Smoke runner script naming.** Sprint 2's runner is `scripts/smoke-vultr.ts`, invoked via `pnpm smoke`. Sprint 4a's runner needs a name. Options: `scripts/smoke-gemini.ts` with `pnpm smoke:gemini`, or rename Sprint 2's to `scripts/smoke-vultr.ts` + `pnpm smoke:vultr` for parallelism. Recommend the former (`scripts/smoke-gemini.ts` + `pnpm smoke:gemini`) — Sprint 2's `pnpm smoke` is referenced in `.claude/rules/stack.md:70` as part of the CI pipeline, so renaming it has a documentation ripple.

- **Architectural decision deferred from Sprint 3 to Sprint 4a.** `ROGUEMOUSE_CONTEXT.md:108` says: "Specific Gemini model versions (Pro 2.5 vs 3, Flash 1.5 vs 2.5) — verify at first Gemini integration." This is that verification. Decision 3's recommendation (env-driven default `gemini-2.5-pro`) closes the dev-target half; the demo-target (3-pro or 2.5-pro) is still deferred to Sprint 7 since 4a doesn't need to make that call.

- **Sprint 4a does NOT design 4b or 4c.** The multi-agent debate logic, scenario assembly, runbook retrieval, dispatch runtime, and 8 tool implementations are all out of scope for this brainstorm. If the brainstorm tries to anticipate every future decision, it stops being scoped.

- **Markdown-strip lesson** (`tasks/lessons.md:18-32`): not directly applicable because Sprint 4a's content is mostly TypeScript and JSON. The one place it could bite is if the smoke runner's hardcoded prompt string contains leading `#` or `*` characters — it doesn't under the recommended anomaly prompt.

- **Conditional-exports lesson** (`tasks/lessons.md:36-46`): not applicable. The recommended Decision 2A (extend `@roguemouse/inference`) does not modify the package's `exports` field. If Decision 2C were chosen, the new package's `exports` would be unconditional `{ ".": "./src/index.ts" }` per the lesson's mitigation guidance.

---

## Open questions

These are decisions the operator should make before `/spec-task`, beyond the six already enumerated:

1. **Smoke runner script name and pnpm script.** `scripts/smoke-gemini.ts` + `pnpm smoke:gemini`, or some other convention? Recommendation: `scripts/smoke-gemini.ts` + `pnpm smoke:gemini` (leave Sprint 2's `pnpm smoke` alone to avoid `.claude/rules/stack.md:70` documentation ripple).

2. **Should the spec include an AC for the actual model identity reported back?** Sprint 2's spec had AC-06 ("uses the locked Ops Engineer model `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16`"). Sprint 4a's analog would be ACs about `gemini-2.5-pro` — but Decision 3C makes the model env-driven. The AC should probably read "uses whatever model is specified in `GEMINI_RISK_MODEL` env var, default `gemini-2.5-pro`" rather than pinning a specific name.

3. **Should the smoke runner verify the response is non-empty and the token usage is well-formed**, the same way `chatCompletion.ts:43-76` does for the Vultr path? Yes by default — the recommended Decision 1B reuses the existing wrapper, which already does this. But if the spec wants explicit ACs analogous to Sprint 2's AC-07 and AC-08, those need to be listed.

4. **Does Sprint 4a need a fail-mode test** (e.g., invalid API key)? Sprint 2's spec didn't ship one as a code test, just as edge cases. Recommendation: edge cases only, no automated negative-path test in 4a — keep scope tight.

---

## Recommendation

I'd recommend the following bundle:

**Decision 1: Approach 1B (Gemini's OpenAI-compatibility shim through the existing `openai` package).** Sprint 4a's whole purpose is verifying that the integration works; the more code we share with the already-working Sprint 2 path, the higher the confidence that what we're testing IS the integration rather than our wrapper. Gemini's compat mode exposes exactly the features we need (chat completions with messages, max_tokens, model identifier, and token usage) and exactly nothing we don't. If Sprint 4b discovers it needs streaming or vision, the native SDK can be added then with full context about what's needed — not speculatively.

**Decision 2: Approach 2A (extend `@roguemouse/inference` with Gemini-specific files alongside the Vultr files).** Don't refactor what works. A second provider as a sibling file in an existing package is the lowest-risk path. The package name `inference` accurately describes its scope (LLM inference, regardless of provider). If a third provider ever materializes — unlikely given `.claude/rules/hackathon.md:20` explicitly skips Kraken/Featherless/Speechmatics — we revisit then.

**Decision 3: Approach 3C (env-var-driven model with `gemini-2.5-pro` default).** Mirrors Sprint 2's `OPS_MODEL` pattern exactly (`scripts/smoke-vultr.ts:115-118`). The `.env.example` is already set up. Operator can flip to `gemini-3-pro` for the demo by editing `.env.local`; no code changes required. The demo-vs-dev model split is deferred to Sprint 7 in `ROGUEMOUSE_CONTEXT.md:108`, which is correct.

**Decision 4: Anomaly prompt (sub-option i) + input shape (sub-option ii) `{ prompt, model }`.** The synthetic anomaly prompt costs ~$0.003 per run — trivially within budget — and exercises Gemini's reasoning behavior on a domain-relevant input. The trivial "OK" prompt is too shallow for our purposes (we want to verify Gemini can reason, not just respond). The input shape `{ prompt, model }` captures the LLM identity that the `risk_officer:reasoning` payload doesn't otherwise hold (no separate `model` field exists, unlike `smoke_test:chat_completion`), so storing model in `input` is the natural home. RAG (sub-option iii) is out of scope — Sprint 4b/4c owns it.

**Decision 5: Approach 5A (fixed synthetic value).** A smoke test verifying integration should not depend on prompt-engineering reliability. Confidence extraction is real work that belongs to Sprint 4b (when we're building the Risk Officer voice's actual logic). For 4a, hardcode `5000` (50%) with a JSDoc comment marking it synthetic. If Sprint 4b's extraction logic later needs prototyping, that's its own brainstorm.

**Decision 6: Approach 6A (reuse `InferenceError` exactly).** The cross-provider envelope discipline is a Sprint 2 architectural decision (`ROGUEMOUSE_CONTEXT.md:95, 100`); diverging for a new provider undermines the rationale. Gemini's specific error categories — including safety blocks — map cleanly into `{ code, message, retryable }`. If Sprint 4b or 4c discovers a concrete need for Gemini-specific error data, the envelope can be extended at that point (option 6C). For 4a, do not pre-extend.

---

**Stop gate.** Brainstorm written. Awaiting operator decisions on the six recommendations plus the four open questions before `/spec-task`.
