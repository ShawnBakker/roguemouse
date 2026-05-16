# tool-schema-and-payload-narrowing — Brainstorm

## Problem

Sprint 2 locked the audit record envelope (`auditRecordBodySchema`) with five fields — `ts`, `runId`, `recordType`, `previousHash`, `payload` — and deferred narrowing of `payload` from `z.unknown()` until Sprint 3. Sprint 4 will introduce the first end-to-end scenario (Scenario A: Stale IV Surface) in which the agent invokes tools, produces typed tool results, and records each invocation + result into the audit log. For Sprint 4 to be tractable, the audit payload shape must be statically typed at every Sprint-4 call site (no `as unknown as ToolCallPayload` casts), and the eight agent tools must have locked input/output contracts that the planner can dispatch generically. This sprint also closes the Day 2 hackathon kill-switch (`.claude/rules/hackathon.md` — Tool Schema + Audit Schema locked = Vector Store RAG stays in scope) retroactively: today is Day 3, and the kill-switch ruling is binding the moment Sprint 3's review passes.

A second, narrower consolidation goal is in scope: today the canonicalization rules live in `@roguemouse/schemas` (`canonicalSafe.ts` — defines what is JSON-safe for hashing) while the serializer lives in `@roguemouse/audit` (`canonicalize.ts` — produces the canonical byte sequence). The original sprint framing called this a "consolidation"; in fact the *rules* are already centralized in schemas (audit imports them). Only the *serializer's* location is up for debate, and Sprint 4's tool-call audit records will need access to canonicalization from packages that don't currently import audit — so the import-graph question matters now.

## Existing code touched

Files Sprint 3 will modify:

- `packages/schemas/src/auditRecord.ts:18-35` — `auditRecordBodySchema` currently has `payload: z.unknown()`. Sprint 3 narrows this. The envelope's five-field count and `.strict()` discipline are locked; only the `payload` field's type changes (or, in approach B, the whole record becomes a `z.discriminatedUnion` of branches each preserving the five-field shape).
- `packages/schemas/src/smokeTestPayload.ts:20-38` — `smokeTestChatCompletionPayloadSchema` is the only payload variant that exists today (recordType `smoke_test:chat_completion`). It becomes the first member of the new discriminated union, possibly renamed/reorganized.
- `packages/schemas/src/index.ts:1-15` — barrel re-exports the three current public symbols. New exports for the tool schemas + the narrowed payload union land here.
- `packages/audit/src/canonicalize.ts:46-76` — under approach 4A this file moves to `@roguemouse/schemas`; under approach 4B it stays put. Either way it is touched, because the new tool-call audit payload shapes need to round-trip through it cleanly.
- `packages/audit/src/types.ts:30` — `AppendInput = Omit<AuditRecordBody, "previousHash" | "runId">`. Once `AuditRecordBody` becomes a discriminated union (decision 1B), `AppendInput` automatically becomes a discriminated union too via the `Omit` distribution. The line need not change but its meaning evolves; needs a docstring update.
- `packages/audit/src/runAuditWriter.ts:95-158` — the `append` method's signature follows `AppendInput`. With a narrowed payload union, the `record: AuditRecordBody = { ... }` literal on line 96-102 may need a type-assertion fix or restructuring to satisfy TypeScript's narrowing rules under discriminated-union mode.
- `scripts/smoke-vultr.ts:213-260` — builds the payload, parses it through `smokeTestChatCompletionPayloadSchema`, then passes it into `writer.append({ ts, recordType, payload })`. Sprint 3's migration choice (decision 5) determines whether this file gets rewritten to use the new union or stays as-is.

Files Sprint 3 will create:

- `packages/schemas/src/tools/` — new directory housing the 8 tool schemas (one file each, plus an `index.ts` barrel) and the shared `ToolDefinition` base if decision 2B is chosen.
- `packages/schemas/src/auditPayloads/` (or similar) — new directory or single file housing the per-variant payload schemas that compose into the discriminated union. The smoke-test variant migrates here.
- `packages/schemas/src/canonicalize.ts` — only if decision 4A is chosen (move the serializer to schemas).
- Test files alongside each new schema, following the pattern from `canonicalSafe.test.ts` / `auditRecord.test.ts` if the latter exists (it does not yet — only `canonicalSafe.test.ts` and the audit-side tests exist).

Sprint 1 packages that remain empty after Sprint 3:

- `packages/agent/src/index.ts` — still just `export const __packageName = "@roguemouse/agent";`. Sprint 4 populates it (planner loop).
- `packages/tools/src/index.ts` — still just the sentinel. Sprint 4 populates it (tool *implementations*, distinct from the tool *schemas* that live in `@roguemouse/schemas`). Important: Sprint 3 does NOT put implementations in `@roguemouse/tools`; only schemas go in `@roguemouse/schemas`. This split mirrors the rule that types/schemas are the contract and implementations are the consumer.
- `packages/broker-mock/src/index.ts`, `packages/runbooks/src/index.ts` — still sentinels.

Sprint 2 locks Sprint 3 must not re-litigate:

- Audit envelope is exactly five fields, top-level `.strict()`.
- Genesis hash `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`.
- Canonicalization algorithm (recursive key sort, no whitespace, JSON-safe value rules per `canonicalSafe.ts`).
- Object key format `audit/{runId}/{ts-safe}-{hash}.json`.
- Envelope discipline (`{ ok, data } | { ok, error }`) on every public surface in `@roguemouse/inference` and `@roguemouse/audit`.
- `AppendInput` excludes chain-controlled fields.
- RFC 8785 migration is deferred (tracked in `tasks/todo.md`); Sprint 3 does not touch this unless a new payload variant needs floats or non-NFC strings (none expected).

---

## Decision 1 — Discriminated union shape for audit record payload

### Approach 1A — Internal "kind" tag inside the payload

Each payload variant carries its own discriminator field (e.g., `kind: "smoke_test:chat_completion"`) inside the payload object. The envelope's `recordType` and the payload's `kind` would be required to match, but the two are formally independent at the type level.

```typescript
const smokeTestPayload = z.object({
  kind: z.literal("smoke_test:chat_completion"),
  model: z.string(),
  // ...
}).strict();

const toolCallPayload = z.object({
  kind: z.literal("tool:call"),
  toolName: z.string(),
  args: z.unknown(),
}).strict();

const payloadUnion = z.discriminatedUnion("kind", [
  smokeTestPayload,
  toolCallPayload,
  // ...
]);

const auditRecordBodySchema = z.object({
  ts: z.string(),
  runId: z.string(),
  recordType: z.string(),
  previousHash: z.string(),
  payload: payloadUnion,
}).strict();
```

Pros:
- Payload schemas are self-contained — a serialized payload identifies its own kind without referring to the envelope.
- Easy to evolve the payload union independently of the envelope.
- Zod's `discriminatedUnion` works directly on the `payload` field.

Cons:
- Redundant tagging: every audit record has both `recordType: "smoke_test:chat_completion"` and `payload.kind: "smoke_test:chat_completion"`. Inconsistent serializations are possible (record where they disagree); detection requires a cross-field refinement.
- Bloats every audit record's JSON by 20-60 bytes (the duplicate tag string). Across 120 records per demo run × 3 scenarios that's ~10 KB of redundant tags — small in absolute terms but conceptually wasteful.
- Two sources of truth for "what kind of record is this": readers must decide whether to trust `recordType` or `payload.kind`.

Complexity: medium. Requires a cross-field refine to enforce `recordType === payload.kind`.

Forces into scope: a cross-field validator (Zod `.superRefine` or a manual check in the writer); documentation of which tag is canonical.

Anti-features: does NOT give compile-time guarantees that the envelope's `recordType` matches the payload variant; only runtime enforcement via the cross-field refine.

### Approach 1B — Envelope-level discriminated union on `recordType`

The entire audit record becomes a `z.discriminatedUnion("recordType", [...])` where each branch is a `.strict()` object preserving the five-field shape, with a hard-coded `z.literal(...)` for `recordType` and a typed `payload`.

```typescript
const smokeTestRecord = z.object({
  ts: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  runId: z.string().min(1),
  recordType: z.literal("smoke_test:chat_completion"),
  previousHash: z.string().regex(HEX_64_REGEX),
  payload: z.object({
    model: z.string(),
    prompt: z.string().max(530),
    // ...
  }).strict(),
}).strict();

const toolCallRecord = z.object({
  ts: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  runId: z.string().min(1),
  recordType: z.literal("tool:call"),
  previousHash: z.string().regex(HEX_64_REGEX),
  payload: z.object({
    toolName: z.string(),
    args: z.unknown(),
    invocationId: z.string(),
  }).strict(),
}).strict();

const auditRecordBodySchema = z.discriminatedUnion("recordType", [
  smokeTestRecord,
  toolCallRecord,
  // ...
]);
```

Pros:
- Single source of truth: `recordType` is the only discriminator anywhere in the system.
- Best Zod ergonomics: `safeParse` narrows the result type — `if (record.recordType === "tool:call") { record.payload.toolName /* known string */ }`.
- Compile-time guarantee that a record with `recordType: "tool:call"` has the `tool:call` payload shape and not some other shape.
- No bloat: payloads carry only the data, not a redundant tag.
- Preserves the five-field envelope: every branch is a five-field `.strict()` object. AC from Sprint 2 ("exactly five envelope fields, no extras") survives.

Cons:
- Repetition in the schema definition: every branch repeats the four envelope fields. Mitigated by a helper `defineAuditRecord(recordType, payloadSchema)` that produces each branch.
- The audit writer's `record: AuditRecordBody = { ... }` literal becomes harder to type — TypeScript may struggle to narrow the union without a `recordType` assertion at construction time. Workaround: the writer constructs the literal as a `Pick`-and-merge and the caller supplies a pre-narrowed `AppendInput`.
- Adding a new `recordType` is a schema change, not a payload-only change. This is actually a feature (centralizes the change surface) but raises the friction of "experimental" record types.

Complexity: medium. The branch helper is a one-screen function; the writer-side typing requires care.

Forces into scope: a `defineAuditRecord` helper for branch construction; explicit handling of the discriminated union in the writer (Zod's `safeParse` Just Works, but TypeScript narrowing of the construction site needs attention).

Anti-features: does NOT support adding payload shapes outside the schema package; does NOT permit a record with `recordType: "tool:call"` but arbitrary payload (which is correct — that's the whole point).

### Approach 1C — Keep `payload: unknown`, define variants externally, defer the union to Sprint 4

The envelope stays `payload: z.unknown()`. Sprint 3 defines per-variant payload schemas (`smokeTestChatCompletionPayloadSchema`, `toolCallPayloadSchema`, etc.) as standalone exports. Callers parse the payload manually after parsing the envelope. The discriminated union is built in Sprint 4 when the planner integration actually needs it.

Pros:
- Smallest Sprint 3 footprint. The envelope schema doesn't change at all.
- Sprint 2 code (smoke runner) doesn't need to migrate.
- Easy to bail out: if the tool schema work runs long, this is the minimum-viable closure of the Day 2 kill-switch ("locked" only means the variant inventory is fixed, not the union itself).

Cons:
- Doesn't actually close the kill-switch in spirit. The kill-switch text says "Tool Schema and Audit Schema locked" — leaving the audit schema with `payload: unknown` is a strictly weaker lock than 1A or 1B.
- Sprint 4 has to do this work anyway, with less context (further from Sprint 2's design intent). The cost-shift is wrong: easier now, harder later.
- Two-step parse at every call site: `auditRecordBodySchema.safeParse(record)` then `toolCallPayloadSchema.safeParse(record.payload)`. Forgetting the second step silently degrades to `unknown` typing.
- No compile-time link between `recordType` and payload shape. Bug-by-construction (record with wrong payload for its recordType) is detectable only by an external linter.

Complexity: small. But the smallness is a tell — we're punting.

Forces into scope: a Sprint 4 follow-up that *will* migrate to 1A or 1B, except now the migration also has to update Sprint 4 code as it lands. Compounding cost.

Anti-features: does NOT give the kill-switch its strong reading; does NOT give Sprint 4 the static guarantees that motivate this sprint.

### Decision 1 summary

| | 1A internal kind | 1B envelope union | 1C deferred |
|---|---|---|---|
| Schema size | medium | medium | small |
| Compile-time recordType ↔ payload link | no (refine only) | yes | no |
| Bloat per record | ~30 bytes | none | none |
| Sprint 4 friction | low | low | high (does the work twice) |
| Closes Day 2 kill-switch strongly | partial | yes | no |

**Recommended: 1B.** Reasoning is in the final recommendation section.

---

## Decision 2 — Tool schema design pattern

The eight agent tools (per `.claude/rules/hackathon.md` countable artifacts: "8 agent tools in the schema") each have input arguments and output results. The pattern question is whether to treat them as eight independent schemas, as instances of one shared shape, or as a hybrid.

Note: the eight tool *names* and their semantics belong to the spec stage, not the brainstorm. This decision is about the *pattern*, not the *inventory*. Below, "tool A through H" stands in for the real names.

### Approach 2A — Eight independent schemas

Each tool gets its own schema file with no shared structural type. Maximum freedom per tool.

```typescript
// tools/marketDataLookup.ts
export const marketDataLookupArgs = z.object({ symbol: z.string(), ... }).strict();
export const marketDataLookupResult = z.object({ price: z.number().int(), ... }).strict();

// tools/runbookSearch.ts  (totally different shape — no shared base)
export const runbookSearchArgs = z.object({ query: z.string(), topK: z.number().int() }).strict();
export const runbookSearchResult = z.array(z.object({ ... }).strict());

// ... 6 more, all bespoke
```

Pros:
- Each tool optimizes its own shape independently.
- Easy to grasp one tool in isolation.
- No abstraction overhead.

Cons:
- No way to dispatch tools generically by name. Every call site has to know which schema to use.
- Audit logging the tool invocation is per-tool-bespoke too. No uniform "tool was called, here are the args, here is the result" shape — every recordType has to invent its own.
- Eight bespoke shapes are eight surface areas to evolve when the contract changes. Refactors propagate.
- The planner code becomes a giant switch statement over tool names.

Complexity: small per tool, large in aggregate.

Forces into scope: a planner-side dispatch table that hand-codes per-tool routing; eight bespoke audit record variants in decision 1.

Anti-features: does NOT enable generic dispatch; does NOT enforce a "tool invocation has name + args + result" invariant.

### Approach 2B — Shared `ToolDefinition` pattern, eight instances

One generic schema describes what a tool *is* (a name plus args schema plus result schema). Eight instances of this pattern populate the registry.

```typescript
// tools/define.ts
export interface ToolDefinition<TArgs, TResult> {
  name: string;
  argsSchema: z.ZodType<TArgs>;
  resultSchema: z.ZodType<TResult>;
}

export function defineTool<TArgs, TResult>(
  name: string,
  argsSchema: z.ZodType<TArgs>,
  resultSchema: z.ZodType<TResult>,
): ToolDefinition<TArgs, TResult> {
  return { name, argsSchema, resultSchema };
}

// tools/marketDataLookup.ts
export const marketDataLookupTool = defineTool(
  "market_data:lookup",
  z.object({ symbol: z.string() }).strict(),
  z.object({ price: z.number().int(), ts: z.string() }).strict(),
);

// tools/registry.ts
export const TOOLS = {
  marketDataLookup: marketDataLookupTool,
  runbookSearch: runbookSearchTool,
  // ... 6 more
} as const;

export type ToolName = (typeof TOOLS)[keyof typeof TOOLS]["name"];
```

Pros:
- Generic dispatch: planner has `dispatchTool(name, args) → result` with no per-tool switch.
- Audit logging is uniform: one `tool:call` recordType, payload `{ toolName, args }`; one `tool:result` recordType, payload `{ toolName, result }` or `{ toolName, error }`.
- Each tool's contract is defined exactly once, in one file, that exports one symbol.
- Composes naturally with decision 1B: audit payloads for tool calls have *one* shape, not eight.
- The `ToolDefinition<TArgs, TResult>` type carries the args/result types end-to-end through the planner.

Cons:
- Slight abstraction cost — readers have to know the pattern to read a tool file. Mitigated by the pattern being a five-line definition function.
- All eight tools have to fit the `{ name, args, result }` mold. Tools that need streaming or partial results don't fit (we don't have any).
- TypeScript's existential-type gymnastics get hairy at the planner layer (`ToolDefinition<unknown, unknown>` in the registry vs `ToolDefinition<TArgs, TResult>` at the call site). Workable but needs care.

Complexity: medium. The `defineTool` helper is trivial; the registry typing requires thought.

Forces into scope: a `ToolRegistry` type or `as const` map that the planner consumes; a generic dispatch function; one `tool:call` and one `tool:result` audit record variant (under decision 1B) rather than 16.

Anti-features: does NOT permit a tool that produces streaming results; does NOT permit a tool whose args are not a JSON object; does NOT permit a tool whose result is not a JSON object.

### Approach 2C — Hybrid: base record + per-tool union

A shared `ToolInvocation` schema captures cross-cutting fields (name, invocationId, ts) at the top level, and a discriminated union over `toolName` carries per-tool args and results.

```typescript
const toolInvocation = z.discriminatedUnion("toolName", [
  z.object({
    toolName: z.literal("market_data:lookup"),
    invocationId: z.string(),
    ts: z.string(),
    args: marketDataLookupArgs,
    result: marketDataLookupResult,
  }).strict(),
  // ... 7 more
]);
```

Pros:
- Combines a fixed envelope with per-tool specifics in a single schema.
- Generic dispatch works (the discriminator narrows the union at the call site).
- One schema describes both the call and its result in one place.

Cons:
- Combines call and result, which actually want to be separate audit records (the call records when the tool was invoked; the result records when it returned, separated in time, possibly by tens of seconds). Coupling them in one schema fights the audit log's natural granularity.
- `invocationId` and `ts` belong on the audit *envelope*, not in the tool payload. The envelope already has `ts`; an `invocationId` field could be added if needed but isn't a tool concept per se.
- Duplicates work that decision 1B's discriminated union already does at the envelope level. Two nested discriminated unions is a Zod-narrowing puzzle even for experienced readers.

Complexity: medium-large. Two layers of `discriminatedUnion` interact awkwardly.

Forces into scope: a separate "invocation" concept distinct from the audit record (or merging the two, which corrupts the envelope).

Anti-features: does NOT separate call from result; does NOT keep the audit envelope as the single discriminator surface.

### Decision 2 summary

| | 2A independent | 2B shared base | 2C hybrid |
|---|---|---|---|
| Generic dispatch | no | yes | yes |
| Uniform audit logging | no | yes | partial |
| Abstraction cost | low | low | medium |
| Per-tool isolation | high | medium | medium |
| Composes with 1B | weak | strong | conflicts |

**Recommended: 2B.** Reasoning is in the final recommendation section.

---

## Decision 3 — Tool result envelope

Every tool execution can succeed or fail. The shape of that success/failure envelope is the question.

### Approach 3A — Same envelope as inference and audit

Tools return `{ ok: true, data, ... } | { ok: false, error: { code, message, retryable } }`, identical to `InferenceResult<T>` and `AppendResult`.

```typescript
type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
};

type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };
```

Pros:
- Codebase-wide consistency. The planner already knows how to handle this shape from inference and audit. No new patterns to learn.
- Drop-in with existing envelope discipline. `if (result.ok) { ... } else { ... }` works everywhere.
- Easy to chain — when a tool calls another tool, the inner failure propagates through the outer call without translation.
- The "tool refused / skipped" state, if needed, becomes an error with `code: "tool_skipped"` (or similar). Not a third envelope state.

Cons:
- "Skipped" or "partially completed" tool states require modeling as errors, which feels semantically off (a skipped tool didn't fail, it just didn't run).
- No tool-specific metadata on the success path (e.g., "tool ran but with a low-confidence flag"). Mitigated by including such flags inside `data`.

Complexity: small. The envelope already exists in two other packages; just import the shape.

### Approach 3B — Tool-specific envelope with explicit states

Tools return a richer envelope that names the outcome states.

```typescript
type ToolResult<T> =
  | { status: "completed"; value: T }
  | { status: "failed"; error: ToolError }
  | { status: "skipped"; reason: string }
  | { status: "deferred"; deferredUntil: string };
```

Pros:
- Expressive about tool-specific outcomes. "Skipped" and "deferred" are first-class.
- Planner code can branch on the status explicitly.

Cons:
- Diverges from inference and audit. Three patterns in the codebase instead of one.
- "Skipped" and "deferred" are concepts we don't need today — YAGNI.
- A degraded-input refusal (the demo's high-trust moment per `.claude/rules/hackathon.md`) is properly an *agent-level* refusal, not a tool-level skip. The tool runs or it doesn't; the agent decides whether to propose.
- Forces the planner to handle four states everywhere, even when three of them are unreachable for a given tool.

Complexity: medium. New envelope, new dispatch logic, new audit record variants per state.

### Approach 3C — Hybrid: 3A plus optional `step?` on errors

Use the inference/audit envelope but add a `step?: string` field on errors (matching `AuditError`'s existing shape). Success branch unchanged.

```typescript
type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
  step?: string;  // which phase of tool execution failed
};

type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };
```

Pros:
- Same consistency as 3A, but with the `step?` that the audit package already uses. Tools that have meaningful internal phases (parse args → query API → transform result) can report which phase failed.
- Zero divergence from existing patterns — `step?` is already in `AuditError`.

Cons:
- The `step?` field is non-essential and may go unused for simple tools. Tolerable.

Complexity: small. Identical to 3A plus one optional field.

### Decision 3 summary

| | 3A pure envelope | 3B tool-specific | 3C envelope + step |
|---|---|---|---|
| Consistency with inference/audit | high | low | high |
| Expressiveness | medium | high | medium |
| YAGNI compliance | yes | no | yes |
| Refusal handling | agent-level (correct) | tool-level (wrong layer) | agent-level (correct) |

**Recommended: 3C.** Reasoning is in the final recommendation section.

---

## Decision 4 — Canonicalization serializer location

Validation rules (`validateCanonicalSafe`, `canonicalSafeSchema`) already live in `@roguemouse/schemas`. The serializer `canonicalize` lives in `@roguemouse/audit`. Today the dependency runs schemas → audit. The question: does the serializer move to schemas?

### Approach 4A — Move `canonicalize` to `@roguemouse/schemas`

Co-locate validation and serialization in schemas. Audit imports `canonicalize` from schemas instead of defining it locally.

Pros:
- Single import path for everything canonicalization-related. `import { canonicalize, validateCanonicalSafe } from "@roguemouse/schemas"`.
- Sprint 4's tool implementations (in `@roguemouse/tools`) and tool schema validators (in `@roguemouse/schemas`) may both want to canonicalize args/results for hashing or comparison. Today this would require `@roguemouse/tools` to depend on `@roguemouse/audit`, which is a backwards dependency (tools should not know about audit storage). Moving canonicalize to schemas breaks that backwards dependency.
- The rules and the serializer share the same JSON-safety contract — they belong in one package.
- Audit's package becomes purely about storage (S3 client, writer, hash chain), not about serialization.

Cons:
- Schemas package grows in responsibility: it's no longer just shapes, it's shapes plus a serializer. Small expansion but real.
- Existing import sites in audit need updating (`./canonicalize.js` → `@roguemouse/schemas`).
- The unit test `packages/audit/src/canonicalize.test.ts` moves to schemas. Mechanical but a tracked change.

Complexity: small. Move 80 lines of code + 120 lines of test, update imports in two places (audit's `index.ts` barrel and the smoke runner's named-import list).

Forces into scope: an explicit re-export from `@roguemouse/audit` (so callers who imported `canonicalize` from audit don't break) OR a search-and-replace across the call sites. There's exactly one external caller today: the smoke runner. Trivial.

Anti-features: does NOT move the SHA-256 helper `sha256Hex` to schemas (that's a hashing concern, separate from canonicalization).

### Approach 4B — Leave the current split

Canonicalize stays in audit. Schemas remains validation-only.

Pros:
- Zero refactor. No risk of breaking the Sprint 2 smoke test in flight.
- Conceptually clean: schemas is "what shape is valid", audit is "how do we hash it for storage".

Cons:
- Sprint 4 tool implementations that need canonicalization (if any — TBD; see open questions) have to import from `@roguemouse/audit`, dragging the S3 client transitively into packages that don't need it.
- The validate/serialize coupling is real but not surfaced in the package boundary: a reader looking at `canonicalSafe.ts` doesn't see that there's a serializer that depends on these exact rules in another package.
- If we later decide to move it, the migration disrupts Sprint 4's import graph after Sprint 4 has already imported from audit.

Complexity: zero.

Forces into scope: nothing.

Anti-features: does NOT enable canonicalization from packages that should not depend on audit.

### Approach 4C — New `@roguemouse/canonical` (or `@roguemouse/integrity`) package

Create a third package housing both `canonicalSafe` and `canonicalize` (and possibly `sha256Hex`, `GENESIS_HASH`). Schemas imports it. Audit imports it. Tools imports it.

Pros:
- Most explicit package boundary. Canonicalization is its own concern with its own package.
- Schemas stays narrowly about shapes; audit stays narrowly about storage.

Cons:
- New workspace package = new `package.json`, new `tsconfig.json`, new build target, new entries in pnpm-workspace.yaml, new TypeScript project reference. Every new package costs ~30 minutes of scaffolding and is a perpetual maintenance line item.
- The Sprint 2 lesson on conditional package exports (`tasks/lessons.md`) shows that workspace package gymnastics can eat hours. Don't add packages unless forced.
- For 6 days of work, adding a package to host two functions is over-engineering.

Complexity: medium (mostly scaffolding).

Forces into scope: new package configuration; conditional-exports decision for the new package; updating workspace tooling.

Anti-features: justified only if a third or fourth consumer for canonicalization appears, which is hypothetical.

### Decision 4 summary

| | 4A move to schemas | 4B leave split | 4C new package |
|---|---|---|---|
| Sprint 4 import-graph cleanliness | best | medium | best |
| Refactor cost | small | zero | medium |
| Future-proofing | good | weak | excellent |
| Hackathon scope discipline | within | within | over |

**Recommended: 4A.** Reasoning is in the final recommendation section.

---

## Decision 5 — Migration of Sprint 2 code

`scripts/smoke-vultr.ts` currently parses the payload with `smokeTestChatCompletionPayloadSchema` directly (line 225) and passes a raw `payload` to `writer.append` (line 256-260). After Sprint 3, the payload shape is part of the discriminated union — does the smoke runner migrate to the new typing surface?

### Approach 5A — Aggressive: rewrite + re-run

Rewrite the smoke runner to use the new typing surface. Run `pnpm smoke` against real Vultr to verify the new schema parses the same payload that Sprint 2 verified.

Pros:
- Live regression test for the entire Sprint 3 refactor. If the smoke runner passes with the new schema, the round-trip integrity story survives the refactor.
- No drift: the smoke variant in the discriminated union is the variant the smoke runner uses, by construction.
- Cost is negligible: prior smoke run cost $0.0000518. Multiple verification runs cost a tenth of a cent total.
- Aligns with the "verify by live run" pattern Sprint 2 established.

Cons:
- Spends a small amount of API credit ($0.0001 absolute).
- Slight risk of breaking the smoke runner during the refactor — but that risk is exactly what the migration is meant to surface.
- Adds time to Sprint 3's `/implement-task` phase (a few minutes for the live run).

Complexity: small. The smoke runner changes are mechanical — replace the standalone `smokeTestChatCompletionPayloadSchema` parse with an envelope-level parse that narrows to the smoke variant.

Forces into scope: a live Vultr smoke run before `/review-task` passes.

### Approach 5B — Minimal: leave smoke runner alone

Sprint 3 introduces the discriminated union but doesn't touch `scripts/smoke-vultr.ts`. The smoke variant is the first member of the union; the smoke runner keeps using the standalone schema; the standalone schema is re-exported as before plus participating in the union.

Pros:
- Zero risk to Sprint 2's smoke runner.
- Faster `/implement-task` phase.
- No API credit spent.

Cons:
- Drift risk: if Sprint 4 evolves the smoke variant's schema inside the union, the smoke runner's local copy of the same schema can fall behind silently.
- Two parse paths for the same payload: the envelope-level union parse (used by writers) and the standalone parse (used by the smoke runner). Confusing for readers.
- Future Claude Code sessions reading the smoke runner will see the standalone parse and ask "why aren't we using the union?" — the answer ("Sprint 3 punted") doesn't age well.

Complexity: minimal.

Forces into scope: a comment in the smoke runner explaining the duality; a tasks/todo.md entry tracking the eventual migration.

### Approach 5C — Bridge: rewrite, skip the live run, verify by typecheck/unit tests

Rewrite the smoke runner to use the union. Verify via `pnpm -r typecheck` and any unit tests added for the union, but don't run the live smoke against real Vultr.

Pros:
- Static verification catches type-level drift.
- No API credit spent.

Cons:
- Static verification is necessary but not sufficient. Sprint 2's smoke runner verified *round-trip* integrity end-to-end — type-checking doesn't replicate that.
- The whole point of having a live smoke is to catch issues that pass typecheck but fail at runtime (e.g., Vultr-side validation; metadata size limits; transient S3 errors).
- A skipped live run is half a verification, which is worse than either no run or a full run because it pretends to verify something it doesn't.

Complexity: small.

Forces into scope: documentation that the live run was deferred and a tasks/todo.md entry to run it before Sprint 4.

### Decision 5 summary

| | 5A aggressive | 5B minimal | 5C bridge |
|---|---|---|---|
| Verification rigor | full | none | partial |
| API credit cost | ~$0.0001 | $0 | $0 |
| Drift risk | none | high | none |
| Aligns with Sprint 2's live-verification pattern | yes | no | partial |

**Recommended: 5A.** Reasoning is in the final recommendation section.

---

## Open questions

These are decisions the operator should make before `/spec-task`, not technical mysteries:

1. **Eight tool inventory.** What are the names and one-line semantics of the eight tools? The brainstorm's recommendations don't depend on the inventory, but the spec stage will need it. Candidates from prior trading-ops context (purely as a starting list to react to): market-data lookup, runbook search, position snapshot, trade history query, anomaly classifier, broker mock (place/cancel), risk-limit check, capital-allocation lookup. Operator should confirm or override the list.

2. **Tool result branching for the "refusal" demo moment.** The hackathon notes call out one deliberate refusal scenario where the agent refuses to propose due to degraded inputs. Is the refusal *expressed at the tool layer* (a tool returns `{ ok: false, error: { code: "low_confidence", ... } }`) or *expressed at the agent layer* (all tools succeed but the agent's synthesizer decides not to propose)? Decision 3's recommendation assumes the latter. Operator should confirm.

3. **Naming convention for recordType strings.** Sprint 2 used `"smoke_test:chat_completion"` (colon-separated namespace + variant). Tool calls and results — `"tool:call"` and `"tool:result"`, or `"tool:<toolName>:call"` per tool, or some other scheme? Decision 2B's recommendation assumes one shared `tool:call` and one shared `tool:result` recordType across all eight tools; an alternative is eight pairs. Operator should pick.

4. **Audit variant inventory beyond smoke and tool calls.** Sprint 4 will need at least: `anomaly:detected`, `tool:call`, `tool:result`, `risk_officer:reasoning`, `ops_engineer:reasoning`, `synthesizer:reasoning`, `proposal:emitted`, `human:approval`, `human:rejection`, `final:committed`. The brainstorm's recommendations don't need the final list, but spec-stage scope will. Operator should review this provisional list and add/remove entries.

5. **Should `canonicalize` and `sha256Hex` move together?** Decision 4A only moves `canonicalize` to schemas. `sha256Hex` is hashing, which is conceptually separate from canonicalization (you can hash any bytes, not just canonical JSON). The recommendation is to leave `sha256Hex` in audit, but the operator may prefer to move both for tidiness. Either is defensible.

---

## Recommendation

I'd recommend the following bundle:

**Decision 1: Approach 1B (envelope-level discriminated union on `recordType`).** The kill-switch text says "Tool Schema and Audit Schema locked"; the strong reading is that the audit schema knows exactly which payload goes with which recordType, at compile time. 1B gives that. 1A duplicates the discriminator and bloats the wire format; 1C punts the work into Sprint 4 where context is thinner. 1B has the highest one-time cost (a `defineAuditRecord` helper plus careful writer-side typing) but the lowest ongoing cost (every future variant slots in with full type narrowing).

**Decision 2: Approach 2B (shared `ToolDefinition` pattern, eight instances).** Generic dispatch is the win — the planner becomes a `dispatchTool(name, args)` function instead of an eight-way switch. Audit logging becomes uniform: one `tool:call` recordType and one `tool:result` recordType regardless of which tool was invoked, which composes cleanly with 1B. The abstraction is a five-line helper, not a framework. 2A loses dispatch; 2C couples call and result in a way that fights the audit log's time-separated granularity.

**Decision 3: Approach 3C (envelope + `step?`).** The envelope discipline is already a load-bearing pattern in inference and audit; adopting it in tools means the planner uses one mental model everywhere. The optional `step?` field matches `AuditError`'s shape and gives tools with internal phases (parse args, call API, transform result) a way to report *where* they failed. The refusal moment in the demo belongs at the agent layer, not the tool layer — a tool either runs or fails, and the synthesizer decides whether to propose; that division is what makes the refusal credible.

**Decision 4: Approach 4A (move `canonicalize` to `@roguemouse/schemas`).** The serializer and its rules share the same JSON-safety contract; they belong in one package. Sprint 4's tool implementations may want canonicalization without dragging in the S3 client; today that's impossible. Moving the function is 80 lines of code plus 120 lines of test plus two import updates — small. A new package (4C) is over-engineering for a 6-day project; leaving the split (4B) blocks Sprint 4's import-graph cleanliness for no gain. Keep `sha256Hex` in audit; hashing and canonicalization are separable.

**Decision 5: Approach 5A (aggressive migration with live re-run).** Sprint 2 established that the smoke runner is the regression test for the entire Vultr-side integration. Refactoring the schemas without re-running the smoke leaves the integration unverified after the change — and the change touches the audit envelope, which is exactly what the smoke verifies. Cost is a tenth of a cent. Drift risk from 5B is real and compounds; 5C's static-only verification doesn't replicate the round-trip integrity check. Run it.

---

**Stop gate.** Brainstorm written. Awaiting operator decisions on the five questions plus the five open questions before `/spec-task`.
