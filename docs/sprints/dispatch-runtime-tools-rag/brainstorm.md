# dispatch-runtime-tools-rag — Brainstorm

## Problem

Sprint 3 locked the 8 agent tool schemas as a `TOOLS` registry exported from `@roguemouse/schemas`, locked the `DispatchTool` type signature, and locked the `ToolResult<T>` envelope. Sprint 4a verified the Gemini integration end-to-end through `@roguemouse/inference`. Sprint 4b provides the runtime: the actual `dispatchTool` implementation in `@roguemouse/agent`, the 8 tool implementations in `@roguemouse/tools`, and the application-layer RAG that makes the `runbook:search` tool work over the 5-file runbook corpus that landed in `0e7681b`. After Sprint 4b, the only missing piece for Scenario A (Stale IV Surface) is the multi-agent debate orchestration in Sprint 4c.

Submission scope is **Scope C: Scenario A only, deployed.** That narrows the optimization target. Tools 1–5 (`market_data:lookup`, `runbook:search`, `position:snapshot`, `broker:reconcile`, `audit:append`) are critical-path for Scenario A and must be production-quality. Tools 6–8 (`audit:search`, `score:explain`, `policy:check`) must exist for schema parity — the dispatcher routes any `ToolName` it receives, including ones Scenario A doesn't exercise — but their implementations can be fixture-returning stubs adequate to satisfy their result-data schemas. Scope C does **not** relax architectural rigor for the parts that ship: the dispatcher's audit-chain integrity, the recursion-guard discipline, the envelope discipline, and the tool result narrowing must all be Scenario-A-correct because Scenario A IS the demo.

The audit log architecture's correctness property — every action hash-chained and traceable — must extend to the dispatcher level. Every tool invocation produces a `tool:call` record (before execution) and a `tool:result` record (after execution) via the writer, NOT via the `audit:append` tool. The recursion guard documented in `packages/schemas/src/tools/auditAppend.ts:11-18` is load-bearing: violating it produces an infinite loop. Sprint 4b's dispatcher implementation must enforce this by construction, not by convention.

## Existing code touched

Files Sprint 4b will modify or create:

- `packages/agent/src/index.ts:1` — currently just `export const __packageName = "@roguemouse/agent";`. Sprint 4b populates this package with the dispatcher runtime + planner support code.
- `packages/tools/src/index.ts:1` — currently just `export const __packageName = "@roguemouse/tools";`. Sprint 4b populates this with the 8 tool implementations + the `TOOL_IMPLEMENTATIONS` registry.
- `packages/audit/src/runAuditWriter.ts:59-222` — currently exposes `append` and `read`. Sprint 4b extends the class with `list(args)` for `audit:search` (Decision 6).
- `packages/audit/src/types.ts` — adds new types for the `list` method's args + result envelope.
- `packages/audit/src/index.ts` — adds `list`-related type re-exports.
- `fixtures/scenario-a/*.json` (new) — Scenario A's fixture data (market data, positions, broker positions, anomaly evidence). Per `CLAUDE.md:81` the top-level `fixtures/` directory is the documented home.
- `tsconfig.scripts.json` — may need an `include` entry for `fixtures/` if the dispatcher's smoke test reads them; verify during plan stage.
- Probably a new `scripts/smoke-dispatch.ts` (or similar) for end-to-end verification of Sprint 4b without yet wiring Sprint 4c's planner. Smoke calls 2-3 representative tools, verifies tool:call/tool:result records land correctly, verifies hash chain holds across multiple records (first multi-record chain in the bucket).

Files locked from earlier sprints, consumed by Sprint 4b unchanged:

- `packages/schemas/src/tools/registry.ts:29-78` — the `TOOLS` const + `ToolName`, `ArgsFor<TName>`, `DataFor<TName>` type derivations. Sprint 4b's `TOOL_IMPLEMENTATIONS` registry uses the same `ToolName` keys.
- `packages/schemas/src/tools/dispatchTool.ts:37-40` — the `DispatchTool` type signature. Sprint 4b's runtime implements this exact signature.
- `packages/schemas/src/tools/toolResult.ts:32-34` — the `ToolResult<T>` envelope. Every tool implementation returns this shape.
- `packages/schemas/src/tools/auditAppend.ts:11-18` — the recursion-guard JSDoc. Sprint 4b's dispatcher reads this and implements the guard structurally.
- `packages/schemas/src/auditPayloads.ts:63-84` — the `toolCallPayload` and `toolResultPayload` schemas. Sprint 4b's dispatcher writes records conforming to these.
- `packages/audit/src/runAuditWriter.ts:95-166` — the writer's `append` method. Sprint 4b's dispatcher calls this directly for tool-flow records.
- `packages/inference/src/geminiChatCompletion.ts:49-111` — Risk Officer / Synthesizer voice's LLM path (consumed by Sprint 4c, not Sprint 4b directly, but the planner the dispatcher serves WILL use it).
- `packages/inference/src/chatCompletion.ts:33-95` — Ops Engineer voice's LLM path (same as above).
- `packages/inference/src/errors.ts:35-88` — shared `classifyInferenceError`. Sprint 4b doesn't call this directly but inherits the cross-provider envelope discipline that wraps all LLM errors into the same `InferenceError` shape.

The 5 runbooks (read in full to confirm shape):

- `packages/runbooks/content/iv-rv-divergence.md` — 2,351 bytes. **Scenario A's target runbook.**
- `packages/runbooks/content/circuit-breaker-tripped.md` — 2,153 bytes. Same structure (H1 title + `## When this fires` + `## Diagnostic steps` numbered list + `## Mitigation` numbered list + `## Escalation path`).
- `packages/runbooks/content/audit-chain-integrity-check.md` — 2,236 bytes.
- `packages/runbooks/content/composite-score-anomaly.md` — 2,202 bytes.
- `packages/runbooks/content/position-reconciliation-mismatch.md` — 2,144 bytes.

Total corpus: 11,086 bytes across 5 files. Structurally identical layout per file: title, "When this fires" paragraph, diagnostic steps list, mitigation list, escalation paragraph. This regularity is good news for RAG (Decision 3).

---

## Decision 1 — Parallel vs serial tool dispatch within a planner step

### Approach 1A — Serial through one writer

Every `dispatchTool(name, args)` call runs to completion before the next one begins. The dispatcher writes `tool:call`, executes the tool, writes `tool:result`, returns. The next call starts only after the previous one resolved. Audit records chain in invocation order with no concurrency concerns.

```typescript
async function dispatchTool<TName extends ToolName>(name: TName, args: ArgsFor<TName>): Promise<ToolResult<DataFor<TName>>> {
  await writer.append({ ts: ..., recordType: "tool:call", payload: { toolName: name, invocationId, args } });
  const result = await impl(args, ctx);
  await writer.append({ ts: ..., recordType: "tool:result", payload: { toolName: name, invocationId, result, durationMs } });
  return result;
}
```

Pros:
- Trivially correct. The writer's in-memory `lastHash` is touched by one call at a time; no race condition possible.
- The audit chain interleaves cleanly: `tool:call(A) → tool:result(A) → tool:call(B) → tool:result(B) → …`. A reader walking the chain sees tool invocations in temporal order.
- ~30 lines of dispatcher code.

Cons:
- For Scenario A's planner step that fans out reads (e.g., Risk Officer simultaneously needs market data + position snapshot + runbook context), latency adds linearly: `~5ms + ~5ms + ~1ms = 11ms` for the tool bodies but `~500ms × 3 = 1500ms` for the S3 writes of the three tool:call records before the first tool even starts.
- Wait — actually re-reading: the writes happen in sequence (call A's tool:call → A's body → A's tool:result → B's tool:call → ...). So three serial tool invocations cost roughly `3 × (S3 PUT + body + S3 PUT) = 3 × (~500 + 5 + ~500) = ~3000ms` for three reads that could have run in parallel.
- Scenario A under serial dispatch may complete in 30-60 seconds total. Demo-acceptable but not snappy.

Complexity: small. The dispatcher is roughly `await writer.append(tool:call); await impl(args, ctx); await writer.append(tool:result); return result;` plus error handling.

Forces into scope: nothing.

Anti-features: does NOT support fan-out reads with bounded latency. A planner step that calls 5 tools takes 5× the per-tool S3 round-trip time.

### Approach 1B — Parallel execution with audit writes funneled through a queue

Tool bodies execute in parallel (`Promise.all` over a batch). The audit writes funnel through a per-writer FIFO queue: each `tool:call` and `tool:result` write awaits the previous write to complete before its `safeParse → canonicalize → hash → S3 PUT` cycle begins. The queue preserves chain ordering deterministically while letting the actual tool work overlap.

```typescript
class WriterQueue {
  private chain: Promise<void> = Promise.resolve();
  enqueueAppend(input: AppendInput): Promise<AppendResult> {
    const result = this.chain.then(() => writer.append(input));
    this.chain = result.then(() => undefined, () => undefined); // chain advances on success or failure
    return result;
  }
}
```

The dispatcher uses the queue for both `tool:call` and `tool:result` writes. Tool bodies still parallelize.

Pros:
- For a 3-tool fan-out: writes serialize (3× S3 PUT = ~1500ms) but bodies overlap (~5ms total). Total ≈ `~1500ms + ~5ms ≈ 1505ms`. Compare to (A)'s ~3000ms — roughly 2× speedup for fan-out.
- Audit chain ordering is preserved exactly: the queue is FIFO. Records still interleave in enqueue order. The interleaving may differ from (A)'s "all of A then all of B" pattern — it becomes "tool:call(A) → tool:call(B) → tool:call(C) → tool:result(?, fastest body) → ..." — but it's still deterministic and chain-correct.
- Backpressure naturally bounded by `Promise.all`'s implicit limit (no flooding).
- Roughly 30-40 lines for the queue helper plus the dispatcher's per-call logic.

Cons:
- The "all tool:calls fire first, then results trickle in" interleave is harder to read in the audit log. A human walking the chain sees three call records in a row, then three result records (in completion order). That's still correct but less obvious than the strict per-tool grouping of (A).
- A queue is a small piece of shared mutable state. Easy to get wrong if multiple writers exist. For Scope C this is moot — there's one writer per run — but it adds reasoning cost.
- Sprint 4b's smoke test needs to verify the queue's correctness under contention. That's a new test case.
- If the queue gets desynchronized (e.g., one append throws and the chain promise breaks), recovery is awkward. The implementation should keep the chain alive regardless of individual append success/failure.

Complexity: medium-small. ~40 lines for the queue helper, ~20 additional lines in the dispatcher to enqueue vs await directly.

Forces into scope: a `WriterQueue` (or equivalent) primitive in the dispatcher or in `@roguemouse/audit`. The Sprint 4b smoke test must exercise concurrency.

Anti-features: does NOT support tool bodies that themselves need to write audit records mid-execution (e.g., a tool that logs sub-events). That use case doesn't exist in Scope C.

### Approach 1C — Parallel execution accepting non-deterministic audit order

**Rejected outright** per the operator's session-start framing. Non-deterministic audit ordering breaks the chain-of-record story that's the entire architectural narrative. The chain's `previousHash` field requires a deterministic predecessor; without ordering, the chain isn't a chain.

### Decision 1 summary

| | 1A serial | 1B queued parallel |
|---|---|---|
| Dispatcher complexity | small | medium-small |
| Latency for 3-tool fan-out | ~3000 ms | ~1505 ms |
| Audit chain integrity | trivially correct | correct by FIFO discipline |
| Audit log readability | high (per-tool grouping) | medium (call/result interleave) |
| Smoke test changes | minimal | +1 concurrency test case |
| Scope C alignment | acceptable but slow | better latency for the demo |

**Lean reversal from session-start**: the session-start said "probably (A) for Sprint 4b; (B) is a Sprint 7 polish item." After engagement, (B) is the better default. The queue cost is small (~40 lines), the latency benefit is real and visible in the demo, and Sprint 4c may want to fan out reads in the Risk Officer's first reasoning step — building the queue infrastructure now means 4c can use it without revisiting 4b's runtime. The "demo-acceptable but not snappy" outcome of (A) becomes a "30-60 second demo run that competing projects beat on responsiveness" — avoidable for ~40 lines. **Recommend 1B.**

---

## Decision 2 — How the dispatcher writes `tool:call` and `tool:result` records without violating the recursion guard

### Approach 2A — Dispatcher holds a writer reference; writes tool-flow records directly

The dispatcher's constructor accepts a `RunAuditWriter` reference. Pre-execution and post-execution code call `writer.append(...)` directly with `recordType: "tool:call"` / `"tool:result"`. The `audit:append` tool is implemented in Sprint 4b but its dispatch path is never taken by the dispatcher itself — only by agent voices that explicitly call `dispatchTool("audit:append", {...})`.

```typescript
class Dispatcher {
  constructor(private deps: { writer: RunAuditWriter; tools: ToolImplementations; ctx: ToolCtx }) {}

  async dispatch<TName extends ToolName>(name: TName, args: ArgsFor<TName>): Promise<ToolResult<DataFor<TName>>> {
    const invocationId = randomUUID();
    await this.deps.writer.append({ ts: now(), recordType: "tool:call", payload: { toolName: name, invocationId, args } });
    const start = performance.now();
    const result = await this.deps.tools[name](args, this.deps.ctx);
    const durationMs = Math.round(performance.now() - start);
    await this.deps.writer.append({ ts: now(), recordType: "tool:result", payload: { toolName: name, invocationId, result, durationMs } });
    return result;
  }
}
```

Pros:
- Zero new API surface on `@roguemouse/audit`. The writer's two existing methods (append/read), one to-be-added method (list), and nothing else.
- Direct call path makes the recursion impossible to write: the dispatcher's call site IS the writer; it cannot recurse into `audit:append` because it never goes through the `dispatch` method for these records.
- The `audit:append` tool exists in Sprint 4b but is a normal tool — only invoked when an agent voice explicitly chooses to log a free-form record. The recursion guard is enforced **architecturally** rather than **defensively**.

Cons:
- A future reader who doesn't see this brainstorm might wonder why the dispatcher special-cases tool-flow records. Solved by JSDoc on the dispatcher pointing at `auditAppend.ts:11-18`.
- If someone in Sprint 4c adds a code path that calls `dispatchTool("audit:append", { recordType: "tool:call", ... })` by accident, the writer accepts it (the schema validates) and the chain gets a duplicate record. Annoying but not catastrophic.

Complexity: small.

Forces into scope: nothing.

Anti-features: no runtime check that callers don't abuse `audit:append`. Possible to mitigate via Approach 2D.

### Approach 2B — Add a "bypass" mode to the writer

Introduce `writer.appendBypass(input)` that's identical to `writer.append(input)` semantically. The two methods exist to make call-site intent explicit: the dispatcher uses `appendBypass`, the `audit:append` tool implementation uses `append`.

Pros:
- Self-documenting at call sites: `appendBypass` literally names the recursion-guard mechanism.

Cons:
- The two methods do the exact same thing. The distinction lives entirely in the method name, not in behavior. That's a contract that's invisible at runtime and depends on review discipline.
- Doubles the writer's API surface. `RunAuditWriter` already has 2 methods (3 after Decision 6); adding `appendBypass` brings it to 4. Each is a maintenance line item.
- Doesn't actually prevent misuse: a future caller could still call `appendBypass` from a tool implementation accidentally, with the same effect as calling `append` from one.

Complexity: small (mostly clone of `append`).

Forces into scope: documentation in JSDoc; potentially a runtime assertion that `appendBypass`'s `recordType` must be `tool:call` or `tool:result` (which adds value but also adds a contract).

Anti-features: gives the illusion of safety without the substance. If the only real enforcement is naming convention, then naming convention should do the work alone (Approach 2A with good JSDoc).

### Approach 2C — Split writer methods into `writeFromTool` vs `writeFromAgent`

Replace `append` with two methods: `writeFromTool(input)` for tool-flow records and `writeFromAgent(input)` for agent-voice records. Both call the same internals.

Pros:
- Maximum semantic clarity. Every audit write makes its origin explicit.

Cons:
- Breaking change to Sprint 2's audit-writer surface. Sprint 4a code already uses `append` directly; renaming forces updates to the Gemini smoke runner.
- Splits a unified concept (append-with-chain) into two methods with identical behavior. Wrong abstraction.
- 4 methods on the writer if Decision 6's `list` lands too. Surface bloat.

Complexity: medium (rename ripples through Sprint 2-4a code).

Forces into scope: updates to existing smoke runners; updates to audit package tests.

Anti-features: gains nothing over Approach 2A semantically — the two methods do the same thing. The split is a labelling exercise.

### Approach 2D — Defense in depth: 2A + a runtime check in the `audit:append` tool

Use Approach 2A for the architectural enforcement. Additionally, the `audit:append` tool's implementation includes a runtime check: if `args.recordType === "tool:call"` or `"tool:result"`, the tool returns `{ ok: false, error: { code: "tool_flow_record_via_audit_append", message: "tool:call and tool:result records must be written via the writer directly, not via audit:append", retryable: false } }`.

```typescript
const auditAppend: ToolImpl<"audit:append"> = async (args, ctx) => {
  if (args.recordType === "tool:call" || args.recordType === "tool:result") {
    return { ok: false, error: { code: "tool_flow_record_via_audit_append", message: "...", retryable: false, step: "validate" } };
  }
  const appendResult = await ctx.writer.append({ ts: now(), recordType: args.recordType, payload: args.payload });
  // map to ToolResult shape...
};
```

Pros:
- Two layers of protection. The dispatcher's architecture prevents the recursion; the tool's runtime check prevents accidental misuse from agent-voice code that DOES go through `dispatchTool("audit:append", ...)`.
- The check is ~5 lines of code in one file. Trivially cheap.
- Surfaces the recursion-guard policy at the tool layer too, where a curious reader of `auditAppend.ts` (the schema) and the matching `auditAppend.ts` (the impl, in `@roguemouse/tools`) sees both the JSDoc and the enforcement.

Cons:
- The check would fire only on a programming bug — agent voices shouldn't be passing tool:call/tool:result to audit:append normally. So it's a defensive check that may never trip. That's fine; defensive checks against impossible-but-catastrophic states are the whole point of belt-and-suspenders engineering.

Complexity: small. ~5 lines of code on top of Approach 2A.

Forces into scope: a small extension to the audit:append tool's logic and a JSDoc note in the implementation.

Anti-features: none of substance.

### Decision 2 summary

| | 2A direct writer | 2B bypass method | 2C split methods | 2D = 2A + runtime check |
|---|---|---|---|---|
| Architectural enforcement | yes | yes | yes | yes |
| Runtime enforcement | no | partial | no | yes |
| New writer API surface | none | +1 method | rename+1 | none |
| Breaking change | no | no | yes | no |
| Code cost | small | small | medium | small + ~5 lines |

**Lean reversal**: session-start leaned (A); after engagement, **recommend 2D** (= 2A + the runtime check). The runtime check is so cheap and so directly maps to the JSDoc's intent that omitting it is leaving easy safety on the table. (B) and (C) are clearly inferior. The architectural enforcement (2A) is the load-bearing piece; (D) is belt-and-suspenders.

---

## Decision 3 — RAG implementation for `runbook:search`

### Approach 3A — In-memory keyword match + frequency scoring

At module load, read all 5 runbook files. For each file, tokenize the content (lowercase, split on whitespace + punctuation), build a `Map<string, number>` of token frequencies. At query time, tokenize the query, compute a relevance score per document as `Σ (queryToken_frequency_in_doc / doc_total_tokens)` or similar. Return top-K by score.

```typescript
type Doc = { path: string; rawContent: string; tokens: Map<string, number>; totalTokens: number };
const corpus: Doc[] = loadAllRunbooks(); // at module init

function search(query: string, topK: number): RunbookMatch[] {
  const queryTokens = tokenize(query.toLowerCase());
  const scored = corpus.map((doc) => {
    let score = 0;
    for (const qt of queryTokens) {
      const docFreq = doc.tokens.get(qt) ?? 0;
      score += docFreq / doc.totalTokens;
    }
    return { doc, score };
  });
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ doc, score }) => ({
      path: doc.path,
      excerpt: extractExcerpt(doc.rawContent, queryTokens),
      relevanceScore: Math.round(score * 10000) // basis points
    }));
}
```

Pros:
- Zero new dependencies.
- Sub-millisecond per query for 5 files. No I/O at query time.
- Predictable behavior. Easy to reason about why a document ranked where it did.
- For Scenario A's query patterns (e.g., "IV RV divergence", "stale volatility surface"), keyword overlap with `iv-rv-divergence.md` is obvious. The title alone has "IV" + "RV" + "Divergence" + "Volatility" + "Ratio"; the body has "implied volatility", "realized volatility", "divergence", "stale", "ratio < 0.45". Query/document overlap is large; ranking will work.

Cons:
- No semantic understanding. A query like "options surface looks frozen" wouldn't necessarily rank `iv-rv-divergence.md` highly because none of the query tokens overlap directly with the runbook's vocabulary. A future demo query that uses different words would miss.
- Stopword filtering isn't implemented in the trivial version. "the", "is", "of" inflate scores for documents that don't actually match. Easy to fix (filter a small stopword list of ~20 words), but it's a refinement.
- Relevance score in basis points (0-10000) is loosely calibrated. The score is `Σ frequency-ratios` which doesn't naturally map to 0-1. The runbook schema requires `relevanceScore` integer 0-10000; we clamp.

Complexity: small. ~50-80 lines for tokenize + corpus loader + search + excerpt extractor + stopword filter.

Forces into scope: a runbook-corpus-loader helper. The loader reads the 5 markdown files from `packages/runbooks/content/` at module init. The exported runbook-search index is constructed once.

Anti-features: no semantic matching, no synonyms, no stemming. Future Sprint 7 polish could add stemming (~10 lines via a porter-stemmer) but Scope C doesn't require it.

### Approach 3B — In-memory BM25

Same in-memory loading as 3A, but score documents using BM25 (a standard IR ranking function). BM25 incorporates inverse document frequency (rare terms in the corpus weigh more), document-length normalization (so longer documents don't trivially win), and a tunable saturation curve (multiple hits of the same term yield diminishing returns).

Pros:
- Standard ranking function with known-good properties on small corpora.
- Better calibration: BM25 scores have a natural 0-to-unbounded range. Mapping to basis points is the same clamping problem as 3A but the relative ranking is more meaningful.
- For corpus size of 5, BM25's document-length normalization corrects 3A's bias toward shorter documents.

Cons:
- More code: ~100-130 lines (idf computation + length norm + BM25 formula + the same surrounding tokenizer/excerpt logic).
- Marginal benefit at this corpus size. Five documents of similar length means document-length normalization barely matters; inverse document frequency on a 5-document corpus is weak signal (every term has IDF in a tiny range).
- The marginal ranking improvement is invisible to a demo viewer. The audit log records the relevance score, but viewers won't intuit "3A scored this 6200 vs BM25 would score it 5800."

Complexity: medium-small. ~100 lines vs 3A's ~50-80.

Forces into scope: the BM25 implementation (or an inline copy from an MIT-licensed reference).

Anti-features: still no semantic matching; same vocabulary-mismatch failure mode as 3A.

### Approach 3C — Embeddings + cosine similarity

At boot, compute one embedding per runbook (via Gemini's `embedding-001` model or similar). At query time, compute one embedding for the query, then compute cosine similarity against each runbook's embedding. Return top-K.

Pros:
- Semantic matching: "options surface looks frozen" can rank `iv-rv-divergence.md` highly because the embedding captures the conceptual relationship between "options surface" and "implied volatility" even without literal token overlap.
- Industry-standard approach for production RAG.

Cons:
- Adds a Gemini embedding API call per `runbook:search` invocation (~200ms latency per call). Multiple calls per Scenario A means seconds of accumulated latency for embeddings.
- Adds a dependency on Gemini's embedding endpoint — different API surface from `geminiChatCompletion`. New code path to implement, test, and fail-handle.
- Costs money: Gemini embedding pricing is non-zero, on top of the chat completion costs. Sprint 4a's cost was ~$0.003/run; embeddings might add ~$0.001/run.
- The semantic benefit is real but mostly invisible on a 5-document corpus where the queries Scenario A actually generates will have heavy keyword overlap with the target runbook.
- Adds a Sprint 4b dependency on the Gemini integration being healthy. If Gemini's compat endpoint hits the 403-empty-body quota issue (per `tasks/lessons.md:50-62`), runbook:search degrades even for queries that pure keyword search would have answered.

Complexity: large. ~150 lines for the embedding call + cache + similarity math + the same surrounding tokenizer/excerpt logic. Plus a new failure-mode test path.

Forces into scope: a new Gemini SDK call path (`embeddings.create`); cost/latency reporting in the dispatcher; failure handling for embedding-side errors.

Anti-features: doesn't get us anything keyword search misses for Scope C, but adds operational fragility.

### Approach 3D — Vector DB (Pinecone, Chroma, Weaviate, etc.)

**Rejected outright.** Massive overkill for 5 documents totaling 11 KB. Adds external service dependency, deployment complexity, latency, and cost. Anti-pattern at this scale.

### Excerpt extraction strategy

Common to 3A, 3B, 3C: what does the `excerpt` field contain? Three sub-options:

- (i) The first 200 characters of the file (title + start of "When this fires"). Simple. Same for every query against the same file.
- (ii) The full text of the "When this fires" section. Larger excerpts but consistent per-file. Each runbook has one "When this fires" paragraph; extracting it is a regex match on `## When this fires\n\n([^\n]+)`.
- (iii) The paragraph that contains the most query-token hits. Query-sensitive. More relevant to the specific query but inconsistent across runs.

For Scope C, recommend (ii) — extract the "When this fires" paragraph. It's the section most useful to a Risk Officer / Ops Engineer voice reasoning about whether the runbook applies to a given anomaly. (iii) is better but more code and the marginal benefit doesn't justify the complexity for the demo.

### Decision 3 summary

| | 3A keyword + freq | 3B BM25 | 3C embeddings | 3D vector DB |
|---|---|---|---|---|
| Latency per query | < 1ms | < 1ms | ~200ms | network-dependent |
| Cost per query | $0 | $0 | ~$0.0001 | infra + per-query |
| Dependencies added | 0 | 0 | Gemini embeddings SDK | new external service |
| LOC | ~50-80 | ~100 | ~150 + tests | substantially more |
| Demo relevance | high | high | high | high |
| Hackathon failure surface | minimal | minimal | one more API | many more |

**Recommend 3A** with excerpt strategy (ii) (the "When this fires" paragraph). Session-start lean (A) confirmed after engagement. BM25 (3B) is the right Sprint 7 polish option if a demo viewer notices ranking shortcomings; embeddings (3C) and vector DB (3D) are well-understood and well-precedented but their value-per-line ratio is dramatically lower at this corpus size.

---

## Decision 4 — Where `dispatchTool` runtime lives and how tools are resolved

### Approach 4A — `TOOL_IMPLEMENTATIONS` registry in `@roguemouse/tools`, keyed by `ToolName`

Symmetric with the Sprint 3 `TOOLS` registry. The implementations package exports a constant object whose keys are the 8 `ToolName` literals and whose values are tool implementations of the right shape. The `@roguemouse/agent` dispatcher imports this object and dispatches by name.

```typescript
// packages/tools/src/index.ts
import { marketDataLookupImpl } from "./impls/marketDataLookup.js";
// ... 7 more imports

export const TOOL_IMPLEMENTATIONS = {
  "market_data:lookup": marketDataLookupImpl,
  "runbook:search": runbookSearchImpl,
  "position:snapshot": positionSnapshotImpl,
  "broker:reconcile": brokerReconcileImpl,
  "audit:append": auditAppendImpl,
  "audit:search": auditSearchImpl,
  "score:explain": scoreExplainImpl,
  "policy:check": policyCheckImpl,
} as const;
```

The dispatcher in `@roguemouse/agent`:

```typescript
import { TOOL_IMPLEMENTATIONS } from "@roguemouse/tools";

async function dispatchTool<TName extends ToolName>(name: TName, args: ArgsFor<TName>): Promise<ToolResult<DataFor<TName>>> {
  const impl = TOOL_IMPLEMENTATIONS[name];
  // TypeScript: impl's type is the union of all 8 implementation signatures
  // We need to narrow it; see TypeScript hurdle below
  return impl(args as never, ctx);
}
```

Pros:
- Symmetric with Sprint 3's pattern. Schema registry in `@roguemouse/schemas`; impl registry in `@roguemouse/tools`. Same shape, same key set.
- Adding a 9th tool is two registry extensions (schema + impl) and one new pair of files. The dispatcher doesn't change.
- The dependency graph stays clean: `@roguemouse/agent` → `@roguemouse/tools` → `@roguemouse/schemas`. No cycles.
- Compile-time exhaustiveness: TypeScript can verify at the `TOOL_IMPLEMENTATIONS` definition site that all 8 `ToolName` keys are present (via a satisfies clause).

Cons:
- TypeScript hurdle: when the dispatcher does `TOOL_IMPLEMENTATIONS[name]`, the result type widens to the union of all 8 implementation signatures. Narrowing requires either an `as` assertion at the call site (`impl as ToolImpl<TName>`) or a conditional-type extraction. This is the same existential-types issue Sprint 3 hit; tractable but ugly.
- Some sort of cast is required somewhere. The cast is sound at runtime because the registry is built such that key/value alignment is guaranteed by the satisfies clause.

Complexity: small for the registry; small for the dispatcher; medium for the type-narrowing puzzle.

Forces into scope: a `ToolImpl<TName>` type in `@roguemouse/schemas` (or `@roguemouse/tools`) that's the function signature `(args: ArgsFor<TName>, ctx: ToolCtx) => Promise<ToolResult<DataFor<TName>>>`. Used to define each impl with the right shape.

Anti-features: no dynamic tool registration (no `dispatcher.registerTool("foo", impl)`). The registry is static. For Scope C, this is correct — tools are locked.

### Approach 4B — Factory pattern, composition root assembles the Map

The implementations package exports each implementation individually (and possibly a `TOOL_IMPLEMENTATION_LIST`). The dispatcher's constructor takes a `Map<ToolName, ToolImpl>` (or a record) and uses it for routing. The Scenario A runner (Sprint 4c) constructs the Map.

```typescript
import * as impls from "@roguemouse/tools";
const dispatcher = new Dispatcher({
  writer,
  ctx,
  tools: {
    "market_data:lookup": impls.marketDataLookupImpl,
    "runbook:search": impls.runbookSearchImpl,
    // ... 6 more
  },
});
```

Pros:
- Maximum flexibility. The composition root can wire fewer tools (e.g., a smoke test that only uses 3 of 8) without trusting a pre-built registry.
- Each implementation file is the only place a tool name appears as a literal — no central registry to drift.

Cons:
- More wiring at every composition root. Each new runner/test repeats the 8-line tool map.
- Loss of compile-time exhaustiveness unless the composition root types its Map as `Record<ToolName, ToolImpl<...>>` strictly. If the type is permissive, the runner can ship with a missing tool that fails at runtime.
- Asymmetric with the schema-side `TOOLS` registry. Two different patterns for the same conceptual pairing (schema ↔ impl).

Complexity: small per call site; cumulative complexity goes up as more call sites appear.

Forces into scope: every composition root writes 8 lines of wiring.

Anti-features: doesn't prevent runtime drift if the registry type is loosened.

### Approach 4C — Hardcoded switch statement in the dispatcher

**Rejected outright** per the operator's session-start framing. Defeats Sprint 3's registry pattern.

### Decision 4 summary

| | 4A static registry | 4B composition root |
|---|---|---|
| Code at composition root | 1 import | 8-line tool map |
| Symmetry with Sprint 3 | high | low |
| Adding a 9th tool | edit one place | edit composition roots |
| Exhaustiveness check | satisfies clause | depends on type |
| Type-narrowing complexity | one cast in dispatcher | same cast, different location |

**Recommend 4A.** The symmetry with Sprint 3 is genuinely valuable: a developer reading the code starts at `TOOLS` in `@roguemouse/schemas` to see "these are the tools," then moves to `TOOL_IMPLEMENTATIONS` in `@roguemouse/tools` to see "these are their bodies." The parallel structure is the documentation. The TypeScript hurdle (impl-union widening at lookup) is real but a one-line `as` assertion in the dispatcher resolves it; runtime correctness is enforced by the satisfies clause at registry definition. Session-start lean (A) confirmed.

---

## Decision 5 — Tool implementation shape and dependency injection

### Approach 5A — Single context shape per tool: `(args, ctx) => Promise<ToolResult<Data>>`

All 8 tools have the same signature. The `ctx` parameter is a single object holding the writer, fixture data, runbook search index, and anything else tools collectively need. Tools that don't need a particular dep ignore it.

```typescript
type ToolCtx = {
  writer: RunAuditWriter;
  fixtures: ScenarioAFixtures;
  runbookIndex: RunbookIndex;
};

type ToolImpl<TName extends ToolName> = (
  args: ArgsFor<TName>,
  ctx: ToolCtx,
) => Promise<ToolResult<DataFor<TName>>>;
```

Pros:
- Simplest mental model. Tools are functions; all functions have the same shape.
- Easy to test: provide a mock ctx, call the function with args, assert on the return envelope.
- Adding a new dep (e.g., a circuit breaker in Sprint 7) is one field on ToolCtx, not a change to every tool's signature.
- The dispatcher's job is trivial: pass-through `args` and `ctx`.

Cons:
- Tools declare their dependencies implicitly (by which fields they destructure). A reader has to scan the tool body to see what it touches.
- All tools see all deps. A `score:explain` impl COULD touch `ctx.writer` even though it shouldn't. Convention vs enforcement.

Complexity: small.

Forces into scope: a `ToolCtx` type. The composition root constructs it.

Anti-features: no per-tool dependency hygiene. Tools that should be stateless can still reach into ctx.

### Approach 5B — Factories: `(deps) => ToolImpl`

Each implementation is a factory taking just the deps it needs. The composition root binds deps and gets the impl.

```typescript
const marketDataLookupImpl = (deps: { fixtures: ScenarioAFixtures }) => async (args, _ctx) => { ... };
const auditAppendImpl = (deps: { writer: RunAuditWriter }) => async (args, _ctx) => { ... };

// composition root
const tools: TOOL_IMPLEMENTATIONS = {
  "market_data:lookup": marketDataLookupImpl({ fixtures }),
  "audit:append": auditAppendImpl({ writer }),
  // ...
};
```

Pros:
- Explicit dependency declarations per tool. `marketDataLookupImpl`'s factory signature documents that it needs fixtures and nothing else.
- A stateless tool's factory takes no deps; harder to accidentally reach into the wrong place.

Cons:
- More type ceremony per tool. Eight factories, eight call sites at the composition root.
- The dispatcher's `(args, ctx)` signature still needs a `ctx` parameter even if individual tools don't use it (because the dispatcher writes audit records via ctx.writer). So tools still receive a ctx; the factory just hides which parts each tool's body actually uses.
- Loses the "all tools are the same shape" property of Approach 5A. Not all factory signatures match.
- More verbose at the composition root.

Complexity: medium.

Forces into scope: per-tool dep types; composition-root binding code.

Anti-features: extra type machinery; the elegance benefit is invisible to anyone not looking at the factory signatures.

### Approach 5C — Module-closure fixtures + ctx for runtime services

Static fixture data (market data, positions, broker positions) is loaded at module init into closure constants. Runtime services (writer, runbook index) flow through `ctx`. Tools that only need fixtures have no `ctx` references; tools that need writer/runbook use ctx normally.

```typescript
// packages/tools/src/impls/marketDataLookup.ts
import { readFileSync } from "node:fs";
const fixtures: MarketDataFixtures = JSON.parse(readFileSync("fixtures/scenario-a/market-data.json", "utf8"));

export const marketDataLookupImpl: ToolImpl<"market_data:lookup"> = async (args, _ctx) => {
  const data = fixtures[args.symbol];
  if (!data) return { ok: false, error: { code: "symbol_not_found", message: ..., retryable: false } };
  return { ok: true, data };
};
```

Pros:
- Static fixtures don't need to be passed through every call. They're loaded once at boot.
- ctx stays small: just the writer + runbook index.
- Test setup is simpler for stateless tools — they just import.

Cons:
- Filesystem I/O at module load: slows test startup if a test only needs one tool. For Sprint 4b's smoke test loading all 8 tools, this is still fast (~10ms total).
- Each tool's fixture file is module-private; tests that want different fixtures need to swap the file or refactor.
- Mixes import side-effects with code structure — module load triggers fs.readFileSync. A reader has to remember that.

Complexity: small.

Forces into scope: file-path discipline (tool modules know fixture paths). Sprint 4c may want different fixtures per scenario, which raises a refactor in 4c.

Anti-features: doesn't help with the writer dep — that still needs ctx.

### Decision 5 summary

| | 5A single ctx | 5B factories | 5C module closure |
|---|---|---|---|
| Same shape per tool | yes | no | mostly |
| Test ergonomics | good | good | medium |
| Dep hygiene | implicit | explicit | mixed |
| Composition root LOC | 1 ctx object | 8 factory calls | 1 ctx + module side-effects |
| Adding a runtime dep | 1 ctx field | 1 ctx field + N factories | 1 ctx field |

**Recommend 5A.** Single-shape function signature is the cleanest mental model and matches the Sprint 4a / 4b pattern of "everything returns the same envelope." Module-closure fixtures (5C) is appealing for stateless tools but mixing module-load filesystem I/O with code structure introduces a subtle ordering concern (what if `fixtures/...` is missing? the module load throws, which means importing the package throws, which means any consumer breaks). Better to load fixtures into `ToolCtx` at composition-root time where the failure is visible and recoverable. Factories (5B) are over-engineered for 8 tools that mostly share the same dep set. Session-start lean (A) confirmed.

---

## Decision 6 — Does `audit:search` require adding S3 LIST to `@roguemouse/audit`?

### Approach 6A — Add a `list(args)` method to `RunAuditWriter`

```typescript
async list(args: { runIdPrefix?: string; limit?: number }): Promise<ListResult> {
  try {
    const response = await this.s3Client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: args.runIdPrefix ? `audit/${args.runIdPrefix}/` : "audit/",
      MaxKeys: args.limit ?? 100,
    }));
    const keys = (response.Contents ?? []).map(o => o.Key!).filter(Boolean);
    return { ok: true, data: { keys, hasMore: response.IsTruncated ?? false } };
  } catch (err) {
    return { ok: false, error: classifyS3Error(err, "s3_list") };
  }
}
```

The `audit:search` tool uses `writer.list(...)` then iterates `writer.read(...)` for each matching key, filtering by `recordType` and `sinceTs` after parsing each body.

Pros:
- Architecturally clean. The writer is the audit-store interface; adding a third method (`list`) matches the symmetry of `append` and `read`.
- Reuses the writer's classify-and-envelope discipline (`classifyS3Error`, structured `ListResult` envelope).
- Sprint 4c, Sprint 5+, or any post-submission UI can call `writer.list` directly without going through the `audit:search` tool. Useful for the demo UI.

Cons:
- Sprint 4b is the first sprint to modify `@roguemouse/audit` since Sprint 3 (which itself was a relocation, not a feature addition). The audit package's surface grows by one method.
- Adds two new types: `ListResult` envelope + the `list` args shape. Re-exports from the audit package barrel.
- For Scope C, `audit:search` may not even be exercised by Scenario A. The list method exists but isn't on the critical path. Could be a YAGNI.

Complexity: small. ~30 lines for the method + ~10 lines for types + re-exports.

Forces into scope: writer.list + ListResult types + barrel exports + audit-package tests for the new method.

Anti-features: doesn't fetch record bodies — the caller must do `list` then `read` for each match. For ~120 records that's 120 GETs. Slow but acceptable for the audit-search demo case.

### Approach 6B — Construct a new S3Client inside the `audit:search` tool

The tool builds its own S3 client and does LIST + GET directly, bypassing the writer.

Pros:
- Doesn't modify `@roguemouse/audit`.

Cons:
- Duplicates S3-client construction logic. The writer's `S3ClientConfig` shape (endpoint, region, credentials) has to be re-passed.
- Breaks the principle that S3 access goes through the writer. The audit package is no longer the only S3-touching code path.
- Two error-handling paths for S3: the writer has `classifyS3Error`, the tool would either reuse it (via import — fine) or roll its own (bad).

Complexity: medium. Per-tool S3 client construction + duplicate error handling.

Forces into scope: a second S3 client at runtime; potentially duplicate config plumbing.

Anti-features: nothing positive.

### Approach 6C — Inject the S3 client into the `audit:search` tool's context

Add `s3Client` to `ToolCtx`. The audit:search tool calls `ctx.s3Client.send(new ListObjectsV2Command(...))` directly. The writer abstraction is bypassed for LIST.

Pros:
- No `@roguemouse/audit` modification.

Cons:
- Same "two S3 access points" problem as 6B, but the second client is shared rather than constructed. Still spreads S3 knowledge.
- `ToolCtx` grows by an `s3Client` field that only one tool uses.
- The audit package no longer encapsulates the audit store. A future addition like "scrub a record's user-metadata" would face the same question.

Complexity: small.

Forces into scope: ctx field addition.

Anti-features: erodes the package boundary.

### Decision 6 summary

| | 6A writer.list | 6B tool's own S3Client | 6C inject S3Client |
|---|---|---|---|
| Modifies `@roguemouse/audit` | yes | no | no |
| Audit-store encapsulation | preserved | broken | broken |
| Code cost | ~40 lines | medium | small |
| Reusable for UI/demo | yes | no | yes |
| Test surface added | yes | no | minimal |

**Recommend 6A.** Session-start lean confirmed. The audit package is the audit store; adding LIST goes there. Modifications to `@roguemouse/audit` are noteworthy but not concerning — the change is additive, the existing `append`/`read` surface is byte-unchanged, and the new method follows the established envelope discipline. Sprint 4c's planner and the eventual demo UI can both benefit from `writer.list` being available beyond just the tool's call site.

---

## Decision 7 — Fixture seeding for Scenario A — where do fixtures live?

### Approach 7A — Top-level `fixtures/` directory per `CLAUDE.md:81`

```
fixtures/
  scenario-a/
    market-data.json
    positions.json
    broker-positions.json
    anomaly.json
```

JSON format. Tool implementations read at boot (or via ctx at composition root). `CLAUDE.md` already documents this directory.

Pros:
- Matches the documented file map.
- JSON is editable without recompile — useful during demo prep.
- Fixtures are physically separated from code; clear semantic boundary.
- Future scenarios (B, C — deferred but not deleted from the codebase) add sibling directories.

Cons:
- Filesystem I/O at module load (if loaded statically) or at composition-root time. Both are fine.
- JSON loses type safety. A field rename in `ScenarioAFixtures` doesn't flag the JSON file. Mitigated by Zod parsing the JSON through a schema at boot.

Complexity: small.

Forces into scope: a small fixture-loader helper. JSON parsing through Zod for type safety.

Anti-features: no compile-time fixture validation. Boot-time Zod parse is the safety net.

### Approach 7B — Inline TypeScript constants in `@roguemouse/tools`

```typescript
// packages/tools/src/fixtures/scenarioA.ts
export const MARKET_DATA_FIXTURES: Record<string, MarketDataLookupResultData> = {
  "AAPL": { spotPrice: 18545, impliedVolatility: 1900, realizedVolatility: 4500, surfaceTs: "..." },
};
```

Pros:
- Compile-time type safety. A rename in the schema flags the fixture.
- No filesystem I/O.
- Easy to grep.

Cons:
- Mixes fixture data with implementation code. The tools package becomes a mix of behavior and seed data.
- Editing fixture data requires a TypeScript edit. For demo tuning this is more friction than editing JSON.
- Diverges from `CLAUDE.md:81`'s documented `fixtures/` directory.

Complexity: small.

Forces into scope: organization rules for fixture files inside `@roguemouse/tools`.

Anti-features: tools package no longer purely about tool behavior.

### Approach 7C — Inside `@roguemouse/broker-mock`

The package's stated purpose per `CLAUDE.md:79` is "deterministic fixture replay." Currently empty. Could be the home for ALL mocked data (broker + market + positions + etc.), not just broker-specific.

Pros:
- Aligns with the empty-scaffold package's stated purpose.
- Centralizes mock data in one package.

Cons:
- Semantic stretch. "broker-mock" specifically names the broker. If it hosts market data and positions, the name is misleading.
- Adds package-import overhead: `@roguemouse/tools` would depend on `@roguemouse/broker-mock` for fixture access. Currently no dependency between them.
- The package's purpose was specifically the broker's deterministic replay (for the `broker:reconcile` tool). Adding market-data scope to it is concept creep.

Complexity: small for the package setup, medium for the rename/scope clarification.

Forces into scope: a package-dependency edge from `@roguemouse/tools` to `@roguemouse/broker-mock`.

Anti-features: lies about scope via the package name.

### File format sub-decision (only relevant for 7A)

- **JSON**: editable without recompile; parseable with Zod for runtime type safety; standard format.
- **TS**: compile-time type safety; harder to edit; requires recompile for changes.
- **YAML**: comments + multi-line strings supported; adds a parser dependency (js-yaml or similar).

For Scope C: **JSON**. The fixture corpus is small (~3-5 files for Scenario A), Zod-parseable at boot, easy to inspect and edit. YAML's benefits don't outweigh the new dependency.

### Decision 7 summary

| | 7A top-level fixtures/ | 7B inline TS in tools | 7C in broker-mock |
|---|---|---|---|
| Matches CLAUDE.md | yes | no | partial |
| Edit-without-recompile | yes (JSON) | no | varies |
| Type safety | runtime (Zod) | compile-time | varies |
| Package-graph impact | none | none | new edge |
| Semantic clarity | high | low | misleading |

**Recommend 7A** with JSON format. Session-start lean confirmed. The fixtures/ directory is documented; using it makes the file map accurate. JSON keeps demo tuning fast. Zod parsing at boot provides type safety without compile-time coupling. The broker-mock package keeps its narrow purpose (broker-side data for the `broker:reconcile` tool) and can either still live in `@roguemouse/broker-mock` OR move to `fixtures/scenario-a/broker-positions.json`; recommend the latter for consistency, leaving `@roguemouse/broker-mock` empty until a real use case emerges.

---

## Additional considerations

- **Sprint 4b smoke test.** Sprint 4b should have its own smoke runner (e.g., `scripts/smoke-dispatch.ts`) that exercises the dispatcher end-to-end before Sprint 4c builds the full planner. The smoke calls 2-3 representative tools through the dispatcher and verifies the resulting tool:call / tool:result audit chain. This will be the **first multi-record chain** in the bucket: previous smokes wrote one record each; the dispatch smoke writes ~6 records (3 calls × 2 records each) chained together. This is also the first concurrency test if Decision 1B (queued parallel) is chosen.

- **`audit:append` tool's role in Scenario A.** Even though the dispatcher doesn't use it for tool:call/tool:result records, the agent voices in Sprint 4c may use it for free-form records (e.g., a Risk Officer voice deciding to log additional context). Sprint 4b implements the tool fully (per Decision 2D, with the runtime tool_flow guard). Scope C doesn't require the agent voices to use it — but if they do, it works.

- **Tools 6, 7, 8 stub policy for Scope C.** `audit:search`: implementation calls `writer.list` + `writer.read` per Decision 6; the tool body is real but may not be exercised by Scenario A. `score:explain`: a deterministic implementation that returns a small fixture-shaped response if `args.scoreValue` is in range. `policy:check`: a static rule set (e.g., always returns `allowed: true` for now, or applies one demo policy like "no orders over 10000 shares"). All three have full schema validation and proper envelope returns. Sprint 4c may surface a need to deepen one of these; Sprint 4b ships them at "schema-correct stub" level.

- **Cost tracking deferred to Sprint 7.** Sprint 4b's dispatcher could compute per-tool token cost from inference responses and accumulate into a run-level total. Tempting but out of scope for Scope C. Sprint 7 polish can add a cost-aggregator that walks the audit log after the run completes.

- **Circuit breakers deferred.** `.claude/rules/vultr.md:137-146` describes circuit breakers for LLM calls. Sprint 4b's dispatcher could add per-tool circuit breakers too. Defer — Sprint 4c needs to see what failure modes emerge in production before deciding what to wrap. The dispatcher's existing envelope discipline gives Sprint 7 a clean place to add `opossum` wrappers.

- **Hash-chain HEAD persistence.** The Sprint 4a context update says `RunAuditWriter` remains in-memory per run; persistent HEAD across processes is "deferred to Sprint 4 (later)." Sprint 4b stays in-memory. Sprint 4c (or later) revisits if/when the dispatcher needs to resume mid-run after a process restart. Scope C doesn't require it.

- **The TypeScript existential-types puzzle (Decision 4A).** When the dispatcher does `TOOL_IMPLEMENTATIONS[name]`, TypeScript widens to a union of all 8 impl signatures. Narrowing requires casts. Two approaches:
  - (i) Cast at the dispatcher boundary: `(impl as ToolImpl<TName>)(args, ctx)`. Sound at runtime because the registry's satisfies clause enforces alignment.
  - (ii) Conditional-type extraction via a `dispatchInner` helper. Slightly cleaner; same runtime behavior.
  Plan stage decides which is less ugly. Both work.

---

## Open questions

These belong to the operator, not Claude Code:

1. **What's the boundary between "tools 6-8 are stubs" and "tools 6-8 are production-ready"?** Specifically, does `policy:check` need to actually deny anything for Scenario A's refusal moment (per `.claude/rules/hackathon.md:104-110`), or is the refusal driven by the synthesizer voice's confidence threshold (Sprint 4c) rather than by a policy violation? If the refusal route is via `policy:check`, then `policy:check` is critical-path and needs real rules. If the refusal route is via low confidence, `policy:check` can be a stub.

2. **Where does the runbook corpus get reloaded if the operator edits a runbook mid-development?** Sprint 4b loads at module init. Hot-reload during dev is out of scope. Reasonable; confirm.

3. **Sprint 4b smoke runner — does it need the live Vultr bucket, or can it use a mock?** Sprint 2/3/4a all ran against real Vultr. Sprint 4b's smoke writes ~6 records per run. At Vultr's S3 pricing this is negligible cost. Recommend continue using real Vultr; matches Sprint 4a's precedent and tests the same code path the production planner will use.

4. **`audit:search`'s pagination semantics.** Sprint 4b's smoke run produces ~6 records. Scenario A produces ~120. Sprint 4b's `audit:search` implementation pages naturally because the underlying `writer.list` returns `hasMore`. The tool's args schema includes `limit` (1-100) but no offset/cursor. Is single-page-only acceptable for Scope C, or does the tool need to expose pagination explicitly? Recommend single-page (matches the schema; consistent with Scope C's narrow target).

---

## Recommendation

I'd recommend the following bundle, with one explicit lean reversal from the session-start.

**Decision 1: Approach 1B (parallel execution with audit writes funneled through a queue).** This is the lean reversal. The queue costs ~40 lines and buys a real latency improvement that will show in the demo. Sprint 4c may want fan-out reads at debate-start time; building the infrastructure here means 4c doesn't revisit 4b. Audit chain integrity is preserved by the queue's FIFO discipline.

**Decision 2: Approach 2D (dispatcher writes directly + audit:append tool runtime guard).** The dispatcher holds a writer reference and writes tool:call/tool:result records via `writer.append` — recursion is impossible by construction. Additionally, the `audit:append` tool's implementation includes a ~5-line check that rejects `recordType: "tool:call"` or `"tool:result"` with a structured error. Belt-and-suspenders. Session-start lean (2A) extended to add 2D's defensive check.

**Decision 3: Approach 3A (in-memory keyword + frequency) + excerpt strategy (ii) (the "When this fires" paragraph).** Zero deps, sub-millisecond latency, handles Scenario A's expected queries well. BM25's marginal benefit doesn't justify ~50 extra lines at this corpus size. Embeddings add operational fragility and Gemini-side fail modes for invisible quality gain.

**Decision 4: Approach 4A (TOOL_IMPLEMENTATIONS static registry in @roguemouse/tools).** Symmetric with Sprint 3's TOOLS registry. The TypeScript narrowing puzzle is real but a one-line cast resolves it; runtime safety comes from the satisfies clause at registry definition.

**Decision 5: Approach 5A (single ToolCtx shape, `(args, ctx) => ...` signature).** Simplest mental model. All tools the same shape. Composition-root constructs one ctx. Factories (5B) are over-engineered; module-closure fixtures (5C) mix import side-effects with code structure.

**Decision 6: Approach 6A (add `writer.list` to RunAuditWriter).** The audit package is the audit-store interface; LIST goes there. Sprint 4b's first modification to `@roguemouse/audit` since Sprint 3 — additive only, doesn't touch existing append/read methods. Future demo UI and Sprint 5+ can use the same method.

**Decision 7: Approach 7A (top-level `fixtures/` directory, JSON format).** Matches `CLAUDE.md:81`. Editable without recompile (good for demo tuning). Zod parsing at boot provides type safety. `@roguemouse/broker-mock` stays empty until a real "broker simulator with behavior" use case emerges.

### Lean reversals

- **Decision 1 reversed.** Session-start said "probably (A) serial; (B) is Sprint 7 polish." After engagement, the queue is small enough and the latency benefit visible enough that (B) is the better default. The session-start under-counted the demo-time impact of 30-60 second runs.

- **Decision 2 extended.** Session-start lean (2A) was correct architecturally; engagement added 2D's defensive runtime check as belt-and-suspenders. Both are cheap; both add safety.

- **Decisions 3, 4, 5, 6, 7 confirmed.** Session-start leans held up under scrutiny.

### Meta-questions for operator

- Confirm Open question 1 (tools 6-8 stub policy). My read of `.claude/rules/hackathon.md:104-110` is that the refusal moment is driven by the Synthesizer voice's confidence threshold (Sprint 4c), which means `policy:check` can be a schema-correct stub. But if you want the refusal triggered by a hard policy violation (more dramatic for the demo?), `policy:check` becomes critical-path.

- Confirm Open question 3 (Sprint 4b smoke runs against real Vultr). Defaulting yes; alternative is a mock S3 client for unit-test-style smoke. Real-Vultr matches Sprint 2/3/4a precedent.

- The 7 decisions assume Scope C (Scenario A only). If scope expands back to A + B, decisions don't fundamentally change but Tool implementations 6-8 may need to be more capable for B's scenarios. Sprint 4b stays minimal for 6-8 unless Scope C reverses.

### Stop gate

When the brainstorm is approved, proceed to `/spec-task`. Do not start implementation before the spec is approved.
