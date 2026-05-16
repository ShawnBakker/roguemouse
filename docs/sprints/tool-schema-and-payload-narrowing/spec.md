# tool-schema-and-payload-narrowing — Spec

## Summary

Sprint 3 narrows the audit record envelope from `payload: unknown` (Sprint 2's locked deferral) to a 12-branch discriminated union keyed on `recordType`, locks the eight agent tool contracts as a shared-pattern registry exported from `@roguemouse/schemas`, and consolidates canonicalization by moving the serializer from `@roguemouse/audit` to `@roguemouse/schemas` so that the rules and the serializer live in one package. This sprint closes the Day 2 hackathon kill-switch retroactively (`.claude/rules/hackathon.md`): the moment `/review-task` passes, Tool Schema + Audit Schema are locked and Vector Store RAG stays in scope for Sprint 4+. The sprint's last act is re-running the Sprint 2 smoke test against real Vultr under the new union to prove the refactor preserves round-trip integrity.

## Acceptance criteria

### Audit record discriminated union

- **AC-01**: The audit record body schema is a discriminated union keyed on the envelope field `recordType`.
- **AC-02**: The union has exactly the 12 branches enumerated in the **Data flow** section, no more and no fewer.
- **AC-03**: Each branch is a `.strict()` object preserving the locked five-field envelope shape (`ts`, `runId`, `recordType`, `previousHash`, `payload`). Adding any sixth top-level field in any branch is rejected at parse time.
- **AC-04**: In each branch, `recordType` is a string literal whose value matches that branch's identifier exactly.
- **AC-05**: In each branch, the four envelope-fixed fields (`ts`, `runId`, `previousHash`, `payload`-position-but-not-shape) follow the same constraints as Sprint 2's locked envelope: `ts` matches the ISO-8601 millisecond regex; `runId` is non-empty; `previousHash` is 64-character lowercase hex.
- **AC-06**: A record whose `recordType` is not one of the 12 literal values is rejected at parse time. The parser returns a structured error naming the offending value, not a thrown exception.
- **AC-07**: A record whose `payload` does not match the shape locked for its `recordType` is rejected at parse time with a structured error naming the violating field.
- **AC-08**: A TypeScript literal union `RecordTypeName` is derived from the discriminated union itself. Adding a branch to the union extends `RecordTypeName` automatically; removing a branch removes the corresponding literal. The two cannot diverge by construction.
- **AC-09**: An audit-record schema construction helper exists. Given a `recordType` literal and a payload schema, it produces a discriminated-union branch with the four locked envelope fields plus the typed payload. Each of the 12 branches is defined via a single call to this helper.
- **AC-10**: `AppendInput` (the writer's input shape) is structurally `Omit<AuditRecordBody, "previousHash" | "runId">`. Because `AuditRecordBody` is a discriminated union, `AppendInput` is also a discriminated union; passing an `{ recordType, payload }` pair whose payload does not match the recordType is a compile-time error at the call site.
- **AC-11**: Every branch's `payload` is canonicalization-safe in the sense of `validateCanonicalSafe`: recursive validation finds no offending node when applied to any payload conforming to the branch's schema.
- **AC-12**: The audit writer's existing public surface (`append`, `read`) is unchanged in name and return shape; the only effective change is that `AppendInput` is now typed via the discriminated union.

### Tool schema pattern

- **AC-13**: A tool-definition helper exists. Given a name string, an args Zod schema, and a result Zod schema, it produces a strongly-typed tool definition that preserves the args and result types end-to-end.
- **AC-14**: Exactly eight tool definitions exist, with names locked to: `market_data:lookup`, `runbook:search`, `position:snapshot`, `broker:reconcile`, `audit:append`, `audit:search`, `score:explain`, `policy:check`. No additional tools are defined in Sprint 3.
- **AC-15**: All eight definitions are exposed in a single registry exported from `@roguemouse/schemas`. The registry is the single source of truth for the tool inventory.
- **AC-16**: A TypeScript literal union `ToolName` is derived from the registry. Adding a tool to the registry extends `ToolName`; removing a tool removes the corresponding literal.
- **AC-17**: Every tool's args schema is a `.strict()` object (or a tagged variant when args are absent — see Data flow). Extra fields in args are rejected at parse time.
- **AC-18**: Every tool's result-`data` schema is a `.strict()` object whose contents are canonicalization-safe. The tool result envelope's error branch is uniform (see AC-22) and is canonicalization-safe by virtue of using only strings and a boolean.
- **AC-19**: Two tools cannot share a name. The registry enforces this by using the literal names as compile-time keys.
- **AC-20**: A generic dispatch type signature exists in `@roguemouse/schemas` describing `dispatchTool<TName extends ToolName>(name: TName, args: ArgsFor<TName>) → Promise<ToolResult<DataFor<TName>>>`. The signature narrows `args` type and result `data` type based on the literal `name` parameter at compile time. (Implementation lives in Sprint 4; only the type-shape contract is locked here.)

### Tool result envelope

- **AC-21**: The tool result type is a discriminated union: `{ ok: true, data: T } | { ok: false, error: ToolError }`.
- **AC-22**: `ToolError` has the fields `code: string`, `message: string`, `retryable: boolean`, and an optional `step?: string`. Field set is identical to `@roguemouse/audit`'s `AuditError` so the two error envelopes are interchangeable at the type level.
- **AC-23**: Each of the eight tool definitions specifies a happy-path `data` shape (the `T` in `{ ok: true, data: T }`). The error branch is uniform across all tools; no tool defines its own error shape.
- **AC-24a**: The schema package documents — via JSDoc on the `defineTool` helper, on the `TOOLS` registry export, and on the `dispatchTool` type signature — that tool implementations are contractually required not to throw on their public dispatch surface. Implementations that throw will be caught by Sprint 4's dispatch wrapping logic and converted to `{ ok: false, error: { code: "tool_threw", ... } }` envelopes.
- **AC-24b**: The `dispatchTool<TName>` type signature returns `Promise<ToolResult<DataFor<TName>>>` — explicitly the envelope-wrapped type, never `Promise<DataFor<TName>>`. A Sprint 4 implementation that returned raw data without the envelope would be a compile-time error at the call site.

### Canonicalization migration

- **AC-25**: The `canonicalize` function is exported from `@roguemouse/schemas` and importable as a public symbol of that package.
- **AC-26**: The `canonicalize` function is no longer exported from `@roguemouse/audit`'s public barrel. Consumers of `canonicalize` import from `@roguemouse/schemas`.
- **AC-27**: For any value V that was canonicalizable before the migration, the canonical output bytes after the migration are byte-identical to before. The migration is a relocation, not a rewrite; the algorithm is unchanged.
- **AC-28**: `sha256Hex`, `GENESIS_HASH`, and `GENESIS_SEED` remain exports of `@roguemouse/audit`. Hashing and the genesis constant stay in the audit package; only the canonicalization serializer moves.

### Sprint 2 migration verification

- **AC-29**: `scripts/smoke-vultr.ts` constructs the audit record using the new discriminated-union schema. The standalone `smokeTestChatCompletionPayloadSchema` is REMOVED from `@roguemouse/schemas`'s public exports. The smoke runner imports the smoke-test branch's payload schema directly from the discriminated union. No alias is retained; the union is the single source of truth.
- **AC-30**: A live `pnpm smoke` run against real Vultr after the refactor succeeds: exit code 0, PASS report printed.
- **AC-31**: The audit record minted by the live re-run passes round-trip integrity: the SHA-256 of the canonicalized read-back body equals the SHA-256 captured at write time.
- **AC-32**: The audit record minted by the live re-run has `previousHash` equal to the genesis constant (unchanged from Sprint 2; the chain-rooted-at-genesis invariant survives the refactor).
- **AC-33**: For a synthetic input matching Sprint 2's smoke-test payload shape, the canonical byte sequence produced by the post-refactor `canonicalize` is byte-identical to a pre-refactor canonical byte sequence for the same input. (Verified by a unit test or fixture, not requiring a re-recorded live run.)

### Codebase hygiene

- **AC-34**: `pnpm -r typecheck` passes with zero new errors over the Sprint 2 baseline after all Sprint 3 code is in place.
- **AC-35**: All Sprint 2 unit tests still pass, including any tests that move from `@roguemouse/audit` to `@roguemouse/schemas` as a consequence of the canonicalization migration.

---

## Data flow

### Numeric unit conventions

All numeric fields across the eight tool schemas and the 12 audit record payload variants are integers within JavaScript's safe-integer range (per the locked canonicalization constraint). The unit per field is fixed as follows so payloads round-trip across processes without unit ambiguity:

- **USD prices** (spot, entry, current): integer cents. `$123.45` is `12345`.
- **Volatility** (implied or realized): integer basis points of a percentage point. `23.5%` is `2350`. This is the standard quant convention for IV/RV display; 0.01% precision is appropriate for demo-scale data.
- **Quantities** (positions, contracts): integer shares or contracts (signed; negative is a short position).
- **Confidence and relevance scores**: integer basis points of confidence, range 0 to 10000 (i.e., 0% to 100% in 0.01% steps).
- **Score values** (composite score outputs of `score:explain`): integer in the closed range -100 to +100.
- **Severities** (`anomaly:detected`): integer in the closed range 1 to 100.
- **Weights and contributions** (`score:explain` components): weight is integer basis points 0 to 10000; contribution is a signed integer with no fixed unit (it is a component's contribution to the score in the same unit as the score itself).

### Audit record envelope — locked invariants from Sprint 2

Every branch of the discriminated union preserves the five-field envelope: `ts`, `runId`, `recordType`, `previousHash`, `payload`. The constraints carried forward from Sprint 2 are:

- `ts`: ISO-8601 UTC timestamp at millisecond precision, matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`.
- `runId`: non-empty opaque string.
- `recordType`: a string literal drawn from the 12 names below (Sprint 3 narrows this from the Sprint 2 free-form string).
- `previousHash`: 64-character lowercase hexadecimal.
- `payload`: a canonicalization-safe value whose shape is fixed per `recordType`.

### Audit record branches (the 12 names)

Each branch fixes its `recordType` literal and its `payload` shape. The payload field lists below are exhaustive — every payload is a `.strict()` object containing exactly the listed fields. Optional fields are marked with `?`.

1. **`smoke_test:chat_completion`** — preserved unchanged from Sprint 2.
   - `model`: string
   - `prompt`: string, at most 530 characters (500 + worst-case truncation suffix)
   - `response`: string, at most 530 characters
   - `tokens`: `.strict()` object with `prompt: integer`, `completion: integer`, `total: integer` (all non-negative)
   - `durationMs`: non-negative integer

2. **`tool:call`** — recorded when the planner dispatches a tool.
   - `toolName`: a literal drawn from `ToolName`
   - `invocationId`: UUIDv4 string (correlates this call with its eventual `tool:result`)
   - `args`: canonicalization-safe value. Shape is narrowed at the planner call site (via `dispatchTool<TName>`), not at the audit schema layer. Rationale: a nested discriminated union across 8 tools × 2 (call/result) is ergonomically painful for marginal benefit; the audit log proves what was called with what JSON, and pre-dispatch validation proves the JSON was shape-correct.

3. **`tool:result`** — recorded when a tool dispatch returns.
   - `toolName`: a literal drawn from `ToolName`
   - `invocationId`: UUIDv4 string (correlates with the `tool:call` record's invocationId)
   - `result`: canonicalization-safe value carrying the tool result envelope as JSON (`{ ok: true, data: ... }` or `{ ok: false, error: ... }`). Shape narrowing follows the same call-site discipline as `tool:call.args`.
   - `durationMs`: non-negative integer

4. **`anomaly:detected`** — recorded when the anomaly detector flags input data.
   - `anomalyType`: string (Sprint 3 leaves this free-form; Sprint 4-5 may narrow to a literal union)
   - `severity`: integer 1 to 100
   - `evidence`: canonicalization-safe value (shape varies by `anomalyType`)
   - `detectedAt`: ISO-8601 UTC timestamp at millisecond precision

5. **`risk_officer:reasoning`** — recorded when the Risk Officer voice produces reasoning.
   - `input`: canonicalization-safe value (what the voice reasoned over)
   - `reasoning`: string (the voice's reasoning text, no truncation enforced in the spec — implementation may cap)
   - `confidence`: integer 0 to 10000 (basis points)
   - `durationMs`: non-negative integer
   - `tokens`: `.strict()` object with `prompt: integer`, `completion: integer`, `total: integer` (all non-negative)

6. **`ops_engineer:reasoning`** — same 5-field `.strict()` payload shape as `risk_officer:reasoning`. Different voice, identical field set.

7. **`synthesizer:reasoning`** — recorded when the Synthesizer voice reconciles the two voices.
   - `riskOfficerInput`: canonicalization-safe value (the Risk Officer's reasoning + confidence as input to synthesis)
   - `opsEngineerInput`: canonicalization-safe value (the Ops Engineer's reasoning + confidence as input)
   - `reasoning`: string
   - `durationMs`: non-negative integer
   - `tokens`: `.strict()` object with `prompt: integer`, `completion: integer`, `total: integer` (all non-negative)

8. **`synthesizer:proposal`** — recorded when the Synthesizer emits a remediation proposal.
   - `proposalText`: string
   - `supportingEvidence`: array of `.strict()` objects, each with `source: string`, `claim: string`
   - `expectedImpact`: canonicalization-safe value (shape varies)
   - `confidence`: integer 0 to 10000 (basis points)

9. **`synthesizer:refusal`** — recorded when the Synthesizer explicitly refuses to propose. This is the demo's high-trust moment.
   - `reasonCode`: string (e.g., `"low_confidence"`, `"circuit_breaker_open"`, `"policy_violation"` — Sprint 4 may narrow to a literal union)
   - `reasoningText`: string
   - `degradedInputs`: array of `.strict()` objects, each with `source: string`, `reason: string`

10. **`human:approval`** — recorded when the operator approves a proposal.
    - `proposalRunId`: string (the `runId` of the run that produced the approved proposal)
    - `approvedBy`: string (operator identifier; for the demo this is a fixed string)
    - `approvedAt`: ISO-8601 UTC timestamp at millisecond precision
    - `notes?`: optional string

11. **`human:rejection`** — recorded when the operator rejects a proposal.
    - `proposalRunId`: string
    - `rejectedBy`: string
    - `rejectedAt`: ISO-8601 UTC timestamp at millisecond precision
    - `reasonCode`: string
    - `notes?`: optional string

12. **`final:committed`** — recorded when the broker mock acknowledges the committed actions.
    - `proposalRunId`: string
    - `committedActions`: array of `.strict()` objects, each with `type: string`, `details: canonicalization-safe value`
    - `brokerMockId`: string (the broker mock's response identifier, proving the deterministic mock processed the action)
    - `committedAt`: ISO-8601 UTC timestamp at millisecond precision

### Tool schemas (the 8 tools)

Each tool has an args schema and a result-`data` schema. The error branch is uniform (see Tool result envelope below) and is not redefined per tool. All schemas are `.strict()` objects whose contents are canonicalization-safe.

1. **`market_data:lookup`**
   - args: `{ symbol: string }`
   - result data: `{ spotPrice: integer cents, impliedVolatility: integer basis points 0 to 10000, realizedVolatility: integer basis points 0 to 10000, surfaceTs: ISO-8601 ms timestamp }`

2. **`runbook:search`**
   - args: `{ query: string, topK: integer 1 to 10 }`
   - result data: `{ matches: array of { path: string, excerpt: string, relevanceScore: integer 0 to 10000 } }`

3. **`position:snapshot`**
   - args: `{ strategy?: string, symbol?: string }` (both optional; absence means "all")
   - result data: `{ positions: array of { strategy: string, symbol: string, quantity: signed integer, avgEntryPrice: integer cents, currentPrice: integer cents, asOf: ISO-8601 ms timestamp } }`

4. **`broker:reconcile`**
   - args: `{ strategy: string }`
   - result data: `{ brokerPositions: array of { symbol: string, quantity: signed integer, brokerAccountId: string, asOf: ISO-8601 ms timestamp } }`

5. **`audit:append`** — for agent-initiated audit writes. Planner-initiated writes (`tool:call`, `tool:result`) call the writer directly to avoid infinite recursion.
   - args: `{ recordType: RecordTypeName, payload: canonicalization-safe value }`. The recordType ↔ payload match is enforced at the planner call site (which knows the audit record discriminated union), not at this tool's args schema.
   - result data: `{ key: string, hash: 64-char lowercase hex, previousHash: 64-char lowercase hex }`

6. **`audit:search`**
   - args: `{ runId?: string, recordType?: RecordTypeName, sinceTs?: ISO-8601 ms timestamp, limit: integer 1 to 100 }`
   - result data: `{ records: array of audit record envelopes, hasMore: boolean }`. Each element of `records` is itself a valid audit record (i.e., it parses against the discriminated union).

7. **`score:explain`**
   - args: `{ strategy: string, scoreValue: integer -100 to +100 }`
   - result data: `{ components: array of { name: string, contribution: signed integer, weight: integer 0 to 10000 }, narrative: string }`

8. **`policy:check`**
   - args: `{ action: { type: string, details: canonicalization-safe value } }`. The `action.details` shape varies by `action.type`; Sprint 3 does not narrow it.
   - result data: `{ allowed: boolean, violations: array of { policyName: string, reason: string } }`

### Tool result envelope (uniform across all 8 tools)

```
ToolResult<T> =
  | { ok: true, data: T }
  | { ok: false, error: { code: string, message: string, retryable: boolean, step?: string } }
```

The error shape is identical to `@roguemouse/audit`'s `AuditError`. The success branch's `T` is the per-tool result data shape from the registry.

### Type derivations

- **`ToolName`** is `(typeof TOOLS)[keyof typeof TOOLS]["name"]` (or an equivalent type-level extraction). Adding a tool to the `TOOLS` registry extends `ToolName` automatically.
- **`RecordTypeName`** is derived from the discriminated union's branches such that `RecordTypeName = AuditRecordBody["recordType"]`. The two are coupled by construction.
- **`ArgsFor<TName>`** and **`DataFor<TName>`** are type-level lookups into the registry: `ArgsFor<"market_data:lookup">` is `{ symbol: string }`, and so on. These types are what makes `dispatchTool<TName>(name, args)` narrow correctly at call sites.

### Discriminated-union narrowing guarantees

After Sprint 3:

- Calling `auditRecordBodySchema.safeParse(record)` where `record.recordType === "tool:call"` narrows the parsed result to the `tool:call` branch — `result.payload.toolName` is a `ToolName` literal, not `unknown`.
- Constructing an `AppendInput` for `recordType: "human:approval"` with a payload missing `approvedBy` is a TypeScript compile error.
- A consumer iterating audit records can `switch` on `record.recordType` and TypeScript narrows the payload type in each branch.

### Hash chain invariant (unchanged from Sprint 2)

Every chain is rooted at the genesis constant. Every subsequent record's `previousHash` equals the SHA-256 of the canonical form of the prior record. Sprint 3 changes neither the genesis constant nor the hashing algorithm nor the canonicalization output for any value that was canonicalizable before; AC-27 and AC-32 enforce these invariants.

---

## Edge cases

- **Case**: A consumer constructs an `AppendInput` literal with `recordType: "tool:call"` but a payload shaped like a `synthesizer:proposal`.
  **Handling**: TypeScript compile error at the call site (the discriminated union's narrowing rejects the mismatched pair). If somehow bypassed (e.g., the value originated from JSON parsing of external input), `auditRecordBodySchema.safeParse` rejects with a structured error naming the violating field.

- **Case**: A consumer writes a record with `recordType: "tool:invented_new_kind"` that is not one of the 12 locked literals.
  **Handling**: Rejected at parse time by the discriminated union's recordType discriminator. Adding a new recordType requires adding a branch to the union (a schema package change).

- **Case**: A tool's args shape is violated at dispatch — e.g., `dispatchTool("market_data:lookup", { sym: "AAPL" })` (note `sym` instead of `symbol`).
  **Handling**: TypeScript compile error at the call site. If the args object originates from JSON parsing of external input, the tool's argsSchema rejects with a structured error before any tool work runs.

- **Case**: A tool's result shape is violated by the implementation — the tool returns `{ ok: true, data: <wrong shape> }`.
  **Handling**: The dispatch layer (Sprint 4) validates result against the tool's resultSchema before returning to the planner. A mismatch surfaces as `{ ok: false, error: { code: "tool_result_validation_failed", ... } }`. Spec-level: the result-validation contract is locked here; enforcement is Sprint 4 work.

- **Case**: Two tools are accidentally registered with the same name.
  **Handling**: Impossible by construction. The registry uses tool names as compile-time keys; a duplicate-name registration is a TypeScript compile error in the registry definition.

- **Case**: The args of a tool contain a float, `NaN`, or another canonicalization-unsafe value.
  **Handling**: Rejected at parse time by the tool's argsSchema (which uses `.strict()` and integer-only numeric constraints). The tool is never invoked.

- **Case**: A new branch is added to the audit record union, but `RecordTypeName` is referenced as a separate hand-written union elsewhere.
  **Handling**: Impossible by construction. `RecordTypeName` is derived from the discriminated union via type-level extraction; there is no hand-written copy to drift.

- **Case**: A payload contains a deeply nested unsafe value (e.g., a float inside an `evidence` object on an `anomaly:detected` record).
  **Handling**: Rejected at parse time by the recursive `validateCanonicalSafe` walk embedded in the payload's schema. The audit record is never minted.

- **Case**: The smoke runner's payload after refactor has the same fields but, due to a Zod schema change, differs in field-order serialization.
  **Handling**: AC-27 and AC-33 forbid this. The canonicalization algorithm sorts keys lexicographically; the output bytes are determined by the input value, not the schema. The canonicalize tests (relocated to schemas) verify this invariant.

- **Case**: The Sprint 2 smoke runner's `smokeTestChatCompletionPayloadSchema` import is removed but a stale call site still references it.
  **Handling**: TypeScript compile error. The migration touches every call site (single-package `@roguemouse/schemas` consumers); `pnpm -r typecheck` catches the dangling reference (AC-34).

- **Case**: The audit:append tool is invoked with a recordType + payload pair that the audit record union does not accept.
  **Handling**: The planner's pre-dispatch validation rejects the call (since the planner knows the discriminated union and narrows the recordType ↔ payload match). If the planner is bypassed (test fixture, direct call), the audit writer's `safeParse` of the resulting envelope rejects with a structured error.

- **Case**: A tool implementation (Sprint 4) throws despite the spec contract forbidding it.
  **Handling**: The dispatch layer wraps tool invocations and converts thrown exceptions into `{ ok: false, error: { code: "tool_threw", message, retryable: false } }`. This is a defense-in-depth fallback; the contract is still that tools must not throw. Enforcement of "do not throw" is review-stage discipline (`/review-task`), not a runtime AC.

- **Case**: The post-migration live smoke run fails because Vultr returned a transient 5xx on PUT.
  **Handling**: Retry the live run. AC-30 requires a single successful PASS run; transient infrastructure failures are not regressions of the Sprint 3 refactor. If the live run fails repeatedly with consistent errors, that is a Sprint 3 regression and is a blocker.

- **Case**: An optional field (`notes?` on `human:approval`/`human:rejection`) is present in one record and absent in another.
  **Handling**: Both records validate. The discriminated-union schema marks `notes` as `.optional()`, which means absent is acceptable and `null` is not (per Zod's `.optional()` semantics).

---

## Out of scope

- **Tool implementations** — Sprint 4 builds the eight tool implementations in `@roguemouse/tools`. Sprint 3 ships only the schemas.
- **Planner code and dispatch implementation** — `dispatchTool<TName>` is a type-shape contract here; the runtime function is Sprint 4 work in `@roguemouse/agent`.
- **Agent voices and reasoning** — Risk Officer, Ops Engineer, and Synthesizer are Sprint 4. The audit record branches (`*:reasoning`, `*:proposal`, `*:refusal`) define their *audit shape*, not their *generation logic*.
- **Audit chain verification utility** — a separate tool that walks a runId's records from S3 and verifies every `previousHash` equals the prior record's hash. Post-hackathon. Sprint 3 verifies one record (the smoke); multi-record chain walks are not exercised.
- **Persistent hash chain HEAD across processes** — `RunAuditWriter` remains in-memory per run. Sprint 4 reconsiders for the Next.js API-route lifetime.
- **Gemini integration** — neither the Risk Officer nor the Synthesizer voice exists yet. The audit record branches for those voices are defined but never written in Sprint 3.
- **Vector Store / RAG retrieval** — the kill-switch closure unblocks this, but the implementation is Sprint 4+.
- **UI integration** — no UI changes in Sprint 3.
- **CI integration of the smoke test** — `pnpm smoke` remains operator-invoked. CI gets a fixture-replay version in a later sprint.
- **Encryption at rest or in transit beyond what Vultr provides** — out of scope per Sprint 2's decision (synthetic data).
- **`THIRD_PARTY_LICENSES.md` regeneration** — deferred to pre-submission polish.
- **Multi-record chain testing** — Sprint 3 writes one record (the post-refactor smoke). Sprint 4 will exercise multi-record chains end-to-end.
- **RFC 8785 canonicalization migration** — deferred per `tasks/todo.md`. The trigger conditions are unchanged.
- **Narrowing of `anomaly:detected.anomalyType`, `synthesizer:refusal.reasonCode`, `human:*.reasonCode`, or `policy:check.action.details`** — these stay free-form / canonicalization-safe in Sprint 3 to keep scope tight. Sprint 4-5 may narrow them.

---

## Rollback plan

Sprint 3 is a refactor on top of Sprint 2's working integration. Every phase has a clean revert path. The only persistent side effect is one additional audit record in the Vultr bucket from Phase 5's live re-run; that record is immutable and harmless by the same logic as Sprint 2's first record.

- **Phase 1 — Discriminated union infrastructure in schemas** (the `defineAuditRecord` helper, plus restructuring the existing `auditRecordBodySchema` so it is ready to be turned into a discriminated union, but no branches added yet). Rollback: revert the affected schema package files; the Sprint 2 envelope schema is restored byte-for-byte. No production state is affected because no new branches exist yet and the writer's surface is unchanged.

- **Phase 2 — Canonicalization migration from audit to schemas** (`canonicalize` moves; tests move with it; `@roguemouse/audit` updates its barrel; `scripts/smoke-vultr.ts` updates its import). Rollback: revert the file moves and barrel changes. AC-27 ensures the algorithm is byte-identical pre/post, so no audit records are invalidated either way; reverting only changes the import path, not any byte that has ever been written.

- **Phase 3 — Eight tool schemas and registry** (`defineTool` helper, eight tool definitions, `TOOLS` registry, `ToolName` derivation, `ToolResult` and `ToolError` types, `dispatchTool` type signature). Rollback: revert the tool-schema files. No consumers exist yet (Sprint 4 is the first consumer). Removing the registry has no runtime effect.

- **Phase 4 — Twelve audit record branches** (each of the 12 branches defined via `defineAuditRecord`; the discriminated union assembled; `RecordTypeName` derived; the writer's `AppendInput` becomes a discriminated union by virtue of the union upstream). Rollback: revert the branch definitions; the union collapses back to Sprint 2's envelope schema. The writer's existing `safeParse` against `auditRecordBodySchema` continues to work in either world because every Sprint 2 record validates against both the pre- and post-Sprint-3 envelope (the post-Sprint-3 union includes a branch for `smoke_test:chat_completion`).

- **Phase 5 — Smoke runner migration and live re-run** (the runner adopts the new union; one live `pnpm smoke` run against real Vultr produces a new audit record in the bucket). Rollback at the code level: revert the runner changes; the runner reverts to its Sprint 2 form. Rollback at the bucket level: nothing to do — the record is immutable and harmless. The chain rooted at that run's runId continues to exist as a one-record chain like every other Sprint 2 smoke run.

- **Phase 6 — Review (`/review-task`)** — produces only a `review.md` document. Rollback: delete the document; revert the sprint folder. No runtime impact.

If the entire sprint must be rolled back: revert every commit on the sprint branch, run `pnpm install`, leave the Phase 5 audit record in the bucket where it is.

---

## Preconditions

The following must be true before Sprint 3 begins:

- Sprint 2's commit `9767863` is on `main`. Subsequent context-update commits (`d5ad7de` cleanup, `ad7b041` context update) are also present.
- Working tree is clean (no uncommitted changes, no untracked files in tracked directories).
- Node 20.x and pnpm 10.27+ are installed; `pnpm install` runs successfully from a clean checkout.
- `.env.local` from Sprint 2 is present at the repo root with `VULTR_INFERENCE_API_KEY`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` populated. (Required for Phase 5's live re-run.)
- Vultr Object Storage subscription `roguemouse-audit` is active; bucket `roguemouse-audit-log` (region `ams1`) exists; the credentials in `.env.local` have read+write permission.
- Vultr Serverless Inference subscription is active and the model `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` is available on the catalog (verify via `GET /v1/models` if in doubt; recorded available 2026-05-14).
- The operator's machine has outbound network access to `https://api.vultrinference.com` and `https://ams1.vultrobjects.com`.
- System clock is within ~5 minutes of true UTC (AWS SDK signature requirement).

---

## Stop gate

When the spec is approved, proceed to `/plan-task`. Do not start implementation before the plan is approved.
