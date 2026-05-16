# tool-schema-and-payload-narrowing — Plan

## Reference docs

- Spec: `docs/sprints/tool-schema-and-payload-narrowing/spec.md`
- Brainstorm: `docs/sprints/tool-schema-and-payload-narrowing/brainstorm.md`

## Anti-patterns from tasks/lessons.md to avoid

- **2026-05-14 — Markdown wrappers strip leading hash and asterisk from fenced code blocks**.
  How this plan avoids it: every new file Sprint 3 creates is authored via the `Write` / `Edit` tools directly (no operator-paste relay), so the corruption path that lost the leading `#` and `*` characters in Sprint 0.5 does not apply. Discipline reminder for the operator: if any file content arrives via prompt paste (e.g., an operator dictates a JSDoc block verbatim and asks Claude Code to insert it), Claude Code must character-level diff the on-disk result against the dictated text before committing.

- **2026-05-14 — Conditional package exports require invocation discipline**.
  How this plan avoids it: Phase 2 moves `canonicalize` between two packages whose `package.json` `exports` fields are *unconditional* (`{ ".": "./src/index.ts" }` — confirmed by re-reading `packages/schemas/package.json` and `packages/audit/package.json`). Phase 2 does NOT introduce any conditional condition keys (no `development`, `production`, or `browser` branches). The two-line `exports` block stays unchanged in both packages; only barrel re-exports change. This sidesteps the resolution-discipline trap entirely.

## Pre-existing baseline (locked before any Phase 1 work)

- Git: `main`, working tree clean, HEAD at `ad7b041` (the Sprint 2 context-update commit).
- `pnpm -r typecheck`: clean across 8 typecheckable projects (Sprint 2 baseline).
- `pnpm test`: passes (canonicalSafe.test.ts, canonicalize.test.ts, genesis.test.ts).
- Sprint 2's `pnpm smoke` was last verified PASS on 2026-05-15 (audit record `audit/e7ec58ef-…/2026-05-15T07-26-03.694Z-d963304f….json`).

The plan preserves all of these. Any phase that introduces a typecheck regression or test failure is a phase that does not exit.

---

## Phase 1 — Discriminated union infrastructure

### Goal

Lay down the helper machinery (`defineAuditRecord`, `RECORD_TYPES`, `RecordTypeName`) without changing the existing `auditRecordBodySchema` or any consumer behavior. Phase 1 is purely additive: new exports are introduced; nothing is renamed or removed. This means the writer continues to validate against the Sprint 2 envelope schema, and the smoke runner continues to work unchanged through Phase 3.

### Files touched

- `packages/schemas/src/auditRecord.ts` (lines 1-36, modified) — keep the existing `auditRecordBodySchema` and `AuditRecordBody` exports byte-for-byte; alongside them introduce:
  - The `RECORD_TYPES` `as const` array (12 string literals matching the locked inventory).
  - The `RecordTypeName` literal-union type derived from `RECORD_TYPES`.
  - The `recordTypeNameSchema` Zod enum derived from `RECORD_TYPES` (for use by tools that need to parse a recordType name from input — `audit:append`, `audit:search`).
  - The `defineAuditRecord<TRecordType, TPayload>(recordType, payloadSchema)` helper that returns a `.strict()` object schema with the four locked envelope fields plus the typed payload. The helper preserves the literal type of `recordType` in the return type (so `defineAuditRecord("tool:call", …)` is statically known to produce a schema whose `recordType` is `"tool:call"`).
- `packages/schemas/src/auditRecord.test.ts` (new file) — tests covering:
  - `RECORD_TYPES` has exactly 12 entries; the entries match the locked inventory.
  - `recordTypeNameSchema` accepts every locked name and rejects an unknown one.
  - `defineAuditRecord("smoke_test:chat_completion", z.object({}).strict())` produces a schema whose parsed output has the literal `recordType` value and the four envelope fields constrained per Sprint 2's rules (ISO ms regex, hex64, non-empty runId).
  - The helper rejects extra top-level fields (`.strict()` discipline).
  - The helper rejects records whose `recordType` does not equal the locked literal.
- `packages/schemas/src/index.ts` (lines 1-15, modified) — add re-exports for `RECORD_TYPES`, `RecordTypeName`, `recordTypeNameSchema`, and `defineAuditRecord`. The existing exports (`auditRecordBodySchema`, `AuditRecordBody`, `smokeTestChatCompletionPayloadSchema`, `SmokeTestChatCompletionPayload`, `canonicalSafeSchema`, `validateCanonicalSafe`, `CanonicalSafeCheck`) are unchanged.

### Step-by-step

1. Open `packages/schemas/src/auditRecord.ts`. Above the existing `auditRecordBodySchema` definition, add the `RECORD_TYPES` array with the 12 literals from the spec's Data flow section. Use `as const` so TypeScript narrows the element type.
2. Below the array, derive `RecordTypeName` as `(typeof RECORD_TYPES)[number]`.
3. Add `recordTypeNameSchema = z.enum(RECORD_TYPES)`. Because Zod 3.25's `z.enum` accepts a readonly tuple, this works without coercion.
4. Add the `defineAuditRecord` helper. Signature (TypeScript):
   - Accepts `recordType: TRecordType extends RecordTypeName` and `payloadSchema: TPayload extends z.ZodTypeAny`.
   - Returns a `z.ZodObject` whose shape is `{ ts, runId, recordType: z.literal(TRecordType), previousHash, payload: TPayload }` with `.strict()`.
   - The `ts`, `runId`, `previousHash` fields use the same constraints as the existing Sprint 2 envelope (extract the regex constants from the existing file so the helper and the existing schema share the same source).
5. Create `packages/schemas/src/auditRecord.test.ts` with the test cases above. Use `vitest`'s `describe` / `it` / `expect`. Follow the pattern from `canonicalSafe.test.ts`.
6. Update `packages/schemas/src/index.ts` to re-export the new symbols. Sort the exports semantically (audit record envelope first, then helper, then constants).
7. Run `pnpm -r typecheck` — must be clean.
8. Run `pnpm --filter @roguemouse/schemas test` — new file passes; existing tests still pass.

### Test strategy

- New unit tests in `auditRecord.test.ts` (above). 8-12 test cases covering helper behavior and array invariants.
- Existing tests untouched: `canonicalSafe.test.ts`, `canonicalize.test.ts`, `genesis.test.ts` still pass.
- No fixture changes. No live Vultr calls.
- Smoke runner is not invoked in Phase 1 (the runner's path is unchanged because no Sprint 2 export was removed).

### Anti-patterns to avoid

- **Markdown-fenced-block corruption**: all new content is authored via `Write`/`Edit` directly. No operator-paste relay.
- **Conditional package exports**: not invoked — Phase 1 only modifies the barrel `src/index.ts`, not the `package.json` `exports` field.
- **Re-litigating locked artifacts**: Sprint 2's regex constants (`ISO_TIMESTAMP_MS_REGEX`, `HEX_64_REGEX`) and the five-field envelope discipline are reused, not rewritten. The helper builds on top of them.

### Phase 1 exit criteria

- [ ] `pnpm -r typecheck` clean (no new errors over the Sprint 2 baseline).
- [ ] `pnpm --filter @roguemouse/schemas test` passes (new + existing tests).
- [ ] `pnpm test` (full suite) passes.
- [ ] Git working tree contains only the 3 files listed above (no incidental edits).
- [ ] The Sprint 2 smoke runner code path is untouched (a hypothetical `pnpm smoke` would still produce a Sprint-2-shape record via the unchanged `auditRecordBodySchema`).

### Phase 1 rollback

```
git restore packages/schemas/src/index.ts packages/schemas/src/auditRecord.ts
git clean -f packages/schemas/src/auditRecord.test.ts
```

No production state is affected; no records have been written since the baseline.

---

## Phase 2 — Canonicalization migration (audit → schemas)

### Goal

Move `canonicalize` from `@roguemouse/audit` to `@roguemouse/schemas` so the rules (`canonicalSafe`) and the serializer live in the same package. `sha256Hex`, `GENESIS_HASH`, `GENESIS_SEED` stay in audit. The relocation is a pure move — no algorithmic change.

### Files touched

- `packages/audit/src/canonicalize.ts` (lines 1-77, DELETED) — content moves to schemas. The current file imports `validateCanonicalSafe` from `@roguemouse/schemas`; after the move, that import becomes a same-package relative import inside schemas.
- `packages/audit/src/canonicalize.test.ts` (lines 1-122, DELETED) — content moves to schemas.
- `packages/schemas/src/canonicalize.ts` (new file) — receives the content of the deleted audit file with one change: the `import { validateCanonicalSafe } from "@roguemouse/schemas"` becomes `import { validateCanonicalSafe } from "./canonicalSafe.js"` (same-package relative import per the stack rule).
- `packages/schemas/src/canonicalize.test.ts` (new file) — receives the content of the deleted audit test file. The import path changes from `./canonicalize.js` (still relative inside its new package). No test cases change.
- `packages/audit/src/index.ts` (lines 1-20, modified) — remove the `export { canonicalize } from "./canonicalize.js";` line on line 3. Other exports unchanged.
- `packages/schemas/src/index.ts` (modified) — add `export { canonicalize } from "./canonicalize.js";`.
- `scripts/smoke-vultr.ts` (lines 11-17, modified) — change the workspace-import block so `canonicalize` is imported from `@roguemouse/schemas` instead of `@roguemouse/audit`. The other named imports from `@roguemouse/audit` (`GENESIS_HASH`, `RunAuditWriter`, `createS3Client`, `sha256Hex`) stay as they are.

### Step-by-step

1. Copy the body of `packages/audit/src/canonicalize.ts` into a new file at `packages/schemas/src/canonicalize.ts`. Adjust the import on line 1 from `import { validateCanonicalSafe } from "@roguemouse/schemas"` to `import { validateCanonicalSafe } from "./canonicalSafe.js"`.
2. Copy the body of `packages/audit/src/canonicalize.test.ts` into a new file at `packages/schemas/src/canonicalize.test.ts`. The test's `import { canonicalize } from "./canonicalize.js"` stays valid in its new location (same relative path inside the schemas package).
3. Delete `packages/audit/src/canonicalize.ts` and `packages/audit/src/canonicalize.test.ts`.
4. Update `packages/audit/src/index.ts`: remove line 3 (the `canonicalize` re-export).
5. Update `packages/schemas/src/index.ts`: add a `canonicalize` re-export.
6. Update `scripts/smoke-vultr.ts`: in the `@roguemouse/audit` named-import list on lines 11-17, remove `canonicalize`; in the existing `@roguemouse/schemas` named-import block on lines 18-22, add `canonicalize`. Adjust alphabetical ordering if the stack-rule import ordering prefers it.
7. Run `pnpm -r typecheck` — must be clean. The smoke runner now imports `canonicalize` from schemas; the runtime call sites on lines 250 and 297 are unchanged.
8. Run `pnpm test` — `canonicalize.test.ts` runs from its new location; results identical.

### Test strategy

- `packages/schemas/src/canonicalize.test.ts` — 30 tests (the full Sprint 2 suite) must pass at the new location. AC-27 (byte-identical output for any value canonicalizable before) is verified by the very fact that the test suite passes unchanged.
- No new tests needed; this is a pure relocation.
- No live Vultr call.

### Anti-patterns to avoid

- **Conditional package exports**: not invoked — neither package's `exports` field is modified. We only edit the barrel `src/index.ts` files.
- **Markdown-fenced-block corruption**: no operator-paste relay; all edits via tools.
- **Algorithmic drift during relocation**: the only allowed delta is the import path. The function body, parameter list, JSDoc, and helper functions (`toCanonical`) move verbatim. A diff of `old canonicalize.ts` vs `new canonicalize.ts` should show only the first `import` line as changed.
- **Backward-compat shims**: NO re-export of `canonicalize` from `@roguemouse/audit`'s barrel as a transitional alias. The migration is single-step; consumers update their imports.

### Phase 2 exit criteria

- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm test` passes; `canonicalize.test.ts` runs from `@roguemouse/schemas` and produces identical results.
- [ ] `packages/audit/src/index.ts` no longer mentions `canonicalize`.
- [ ] `packages/schemas/src/index.ts` exports `canonicalize`.
- [ ] `scripts/smoke-vultr.ts` typechecks against the new import location.
- [ ] AC-25, AC-26, AC-27, AC-28 all hold by the end of this phase.

### Phase 2 rollback

```
git restore packages/audit/src/index.ts packages/schemas/src/index.ts scripts/smoke-vultr.ts
git checkout HEAD -- packages/audit/src/canonicalize.ts packages/audit/src/canonicalize.test.ts
git clean -f packages/schemas/src/canonicalize.ts packages/schemas/src/canonicalize.test.ts
```

(Or, if the phase is committed independently before rollback: `git revert <phase-2-commit>`.)

No bucket state is affected; no live run was performed.

---

## Phase 3 — Eight tool schemas and registry

### Goal

Create the `defineTool` helper, the 8 tool schemas with their args + result-data shapes, the `TOOLS` registry, the `ToolName` literal-union derivation, the `ToolResult<T>` and `ToolError` types, and the `dispatchTool<TName>` type signature. All artifacts are exported from `@roguemouse/schemas`. No tool implementation logic is written; Sprint 4 owns that.

### Files touched

All new under `packages/schemas/src/tools/`:

- `tools/defineTool.ts` (new) — the `defineTool(name, argsSchema, resultDataSchema)` helper producing a strongly-typed `ToolDefinition<TName, TArgs, TData>`.
- `tools/toolResult.ts` (new) — the `ToolError` type and the `ToolResult<T>` generic discriminated-union type.
- `tools/dispatchTool.ts` (new) — the `DispatchTool` type, `ArgsFor<TName>`, `DataFor<TName>` type helpers.
- `tools/marketDataLookup.ts` (new) — args, result-data, tool definition for `market_data:lookup`.
- `tools/runbookSearch.ts` (new) — args, result-data, tool definition for `runbook:search`.
- `tools/positionSnapshot.ts` (new) — args, result-data, tool definition for `position:snapshot`.
- `tools/brokerReconcile.ts` (new) — args, result-data, tool definition for `broker:reconcile`.
- `tools/auditAppend.ts` (new) — args uses `recordTypeNameSchema` from Phase 1; result-data is `{ key, hash, previousHash }`. JSDoc explicitly notes the recursion guard (planner-initiated `tool:call`/`tool:result` writes go through the writer directly, not via `audit:append`).
- `tools/auditSearch.ts` (new) — args uses `recordTypeNameSchema`; result-data is `{ records: array of audit envelopes, hasMore }`. For the `records` field, the array element schema is `auditRecordBodySchema` (still the Sprint 2 free-form version in Phase 3; Phase 4 tightens it automatically when the discriminated union replaces the existing export).
- `tools/scoreExplain.ts` (new) — args, result-data for `score:explain`.
- `tools/policyCheck.ts` (new) — args, result-data for `policy:check`. The `action.details` field uses `canonicalSafeSchema`.
- `tools/registry.ts` (new) — the `TOOLS` const object (keys = tool short-keys, values = `ToolDefinition`s). Derived types: `ToolName`, `ArgsFor<TName>`, `DataFor<TName>`.
- `tools/index.ts` (new) — barrel for the tools module.
- `tools/defineTool.test.ts` (new) — tests for the helper: produces typed definition; preserves literal name; rejects mis-typed args/result.
- `tools/registry.test.ts` (new) — tests for the registry: exactly 8 entries; names match the locked inventory; names are unique; `ToolName` is the expected literal union.

Top-level:
- `packages/schemas/src/index.ts` (modified) — re-export the public tool symbols. The full barrel grows to expose: `defineTool`, `ToolDefinition` (type), `ToolError`, `ToolResult` (generic type), `DispatchTool` (type), `ArgsFor`, `DataFor`, `ToolName`, `TOOLS`, and any per-tool symbols whose direct imports we want to support (the individual tool definitions; convenience for testing).

### Step-by-step

1. Create `tools/toolResult.ts` first. Define `ToolError` with `code: string`, `message: string`, `retryable: boolean`, `step?: string`. Define `ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError }`. JSDoc cites AC-22 (shape identical to `AuditError`).
2. Create `tools/defineTool.ts`. The helper takes a name literal and two Zod schemas (args + result data); returns a `ToolDefinition<TName, TArgs, TData>` value carrying the name and the two schemas. JSDoc explicitly states the AC-24a contract: implementations must not throw on their public surface; the dispatcher wraps throws into `{ ok: false, error: { code: "tool_threw", … } }` envelopes.
3. Create the 8 tool files (`marketDataLookup.ts` through `policyCheck.ts`). Each file exports the args schema (named `<toolShortName>Args`), the result-data schema (named `<toolShortName>ResultData`), and the tool definition (named `<toolShortName>Tool`). Schemas use `.strict()` on all objects. Numeric fields use the unit conventions from the spec (cents, basis points, signed integers as documented per-tool).
   - `auditAppend.ts`: `args.recordType` uses `recordTypeNameSchema` from Phase 1; `args.payload` is `canonicalSafeSchema`. JSDoc notes the recursion guard.
   - `auditSearch.ts`: `args.recordType` (optional) uses `recordTypeNameSchema`; `result.records` array element uses `auditRecordBodySchema` (Sprint 2 free-form for now; Phase 4 narrows it automatically).
   - `policyCheck.ts`: `args.action.details` uses `canonicalSafeSchema`.
4. Create `tools/registry.ts`. Define `TOOLS` as an `as const` object mapping short keys (`marketDataLookup`, etc.) to the 8 tool definitions. Derive `ToolName = (typeof TOOLS)[keyof typeof TOOLS]["name"]`. Derive `ArgsFor<TName>` and `DataFor<TName>` via mapped types.
5. Create `tools/dispatchTool.ts`. Define `DispatchTool` as a function type with signature `<TName extends ToolName>(name: TName, args: ArgsFor<TName>) => Promise<ToolResult<DataFor<TName>>>`. AC-24b is enforced by the return type. JSDoc states the contract and notes that the implementation lives in `@roguemouse/agent` (Sprint 4).
6. Create `tools/index.ts` barrel re-exporting the public surface of the tools module.
7. Update `packages/schemas/src/index.ts` to re-export from `./tools/index.js`.
8. Create `tools/defineTool.test.ts` and `tools/registry.test.ts` with the test cases above.
9. Run `pnpm -r typecheck`. The cross-package type derivation (`ToolName`, `ArgsFor`, `DataFor`) is the most likely source of trouble; iterate until clean.
10. Run `pnpm --filter @roguemouse/schemas test`. New tool tests pass; existing tests still pass.

### Test strategy

- `defineTool.test.ts` — 4-6 tests: helper accepts a name literal and two schemas; returned definition exposes the schemas; mis-typed payload is a compile error (verified via `// @ts-expect-error` pragma); name literal is preserved.
- `registry.test.ts` — 4-6 tests: `TOOLS` has 8 entries; `Object.values(TOOLS).map(t => t.name)` equals the locked inventory in order; no duplicate names (Set size equals 8); `ToolName` type test via `type _check = Expect<Equal<ToolName, "market_data:lookup" | "runbook:search" | …>>` using a small type-equality helper.
- `audit:search` test data must use records that conform to locked recordType + payload shapes from the spec inventory, NOT free-form examples. Even though Phase 3's `auditRecordBodySchema` accepts more than the discriminated union will (the union is assembled in Phase 4), tests written against valid post-Phase-4 records remain green when Phase 4 tightens the schema. Forward-compatible test data prevents Phase 4 test breakage.
- Per-tool unit tests — DEFERRED to Sprint 4 (implementations come with implementation tests). Sprint 3 only ensures the schemas parse representative valid + invalid inputs. For brevity, do not write per-tool .test.ts files in Sprint 3; the `registry.test.ts` smoke-checks the schemas by parsing one valid example per tool.
- No live Vultr call.

### Anti-patterns to avoid

- **Markdown-fenced-block corruption**: all files created via tools.
- **Conditional package exports**: not invoked.
- **Existential-type leakage**: the registry's value-type loses the per-tool argument types when iterated; the type helpers `ArgsFor<TName>` / `DataFor<TName>` recover the per-tool types at the dispatch call site. Do not let the registry's value type leak into call-site types unbidden — always go through the name-literal-keyed lookups.
- **Implementation bleed**: no runtime dispatch function in Sprint 3. Only the type signature. The `dispatchTool.ts` file exports a type, not a function.

### Phase 3 exit criteria

- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm test` passes (new tool tests + all existing).
- [ ] The 8 tool definitions are exported from `@roguemouse/schemas`.
- [ ] `ToolName` is the expected literal union (verified by type-level test).
- [ ] AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24a, AC-24b all hold.

### Phase 3 rollback

```
git restore packages/schemas/src/index.ts
git clean -fd packages/schemas/src/tools/
```

No production state affected.

---

## Phase 4 — Twelve audit record branches assembled into the union

### Goal

Replace the Sprint 2 `auditRecordBodySchema` (a single free-form `.strict()` object with `payload: z.unknown()`) with a `z.discriminatedUnion("recordType", […12 branches…])`. Each branch is produced by `defineAuditRecord` (Phase 1). The 12 payload schemas are defined in a new `auditPayloads.ts` file. The audit writer's `safeParse` call site continues to work (same export name; narrower union shape underneath). The `AppendInput` type automatically becomes a discriminated union via the `Omit` distribution.

### Files touched

- `packages/schemas/src/auditPayloads.ts` (new) — the 12 payload schemas, exported as named symbols. Each schema is a `.strict()` Zod object whose fields match the spec's Data flow section exactly. Field unit conventions per the spec (basis points, cents, signed integers, etc.).
- `packages/schemas/src/auditRecord.ts` (modified) — change `auditRecordBodySchema` from the single `.strict()` object on lines 18-33 to a `z.discriminatedUnion("recordType", [...])` constructed via 12 calls to `defineAuditRecord`. The inferred type `AuditRecordBody` becomes the discriminated union automatically. The existing `ISO_TIMESTAMP_MS_REGEX` and `HEX_64_REGEX` constants stay (used by `defineAuditRecord`).
- `packages/schemas/src/auditRecord.test.ts` (modified) — extend the Phase 1 test file with 18-24 new test cases covering the union: each of 12 branches parses a valid record; rejects records with the wrong payload shape per branch; rejects an unknown `recordType`; narrowing via `safeParse` produces typed payloads.
- `packages/schemas/src/index.ts` (modified) — add re-exports for the 12 payload schemas (callers may want individual access; the `auditRecordBodySchema` export name is unchanged; the discriminated union behind the name is the breaking change).
- `packages/audit/src/types.ts` (lines 23-30, JSDoc updated only) — the `AppendInput` type definition stays as `Omit<AuditRecordBody, "previousHash" | "runId">`; because `AuditRecordBody` is now a discriminated union, `AppendInput` is too. Update the surrounding JSDoc to mention the union; do not change the type expression itself.
- `packages/audit/src/runAuditWriter.ts` (lines 95-115, MAYBE modified) — the writer's `record: AuditRecordBody = { ts: input.ts, runId: this.runId, recordType: input.recordType, previousHash: this.lastHash, payload: input.payload }` literal on lines 96-102 may need a TypeScript narrowing fix. The discriminated union may reject the construction because the `recordType` is widened to `string` at literal-assembly time. Likely fix: do not annotate the local `record` with the union type; let TypeScript infer it and pass to `auditRecordBodySchema.safeParse` directly. If the inference is still too wide, fall back to a one-line `as AuditRecordBody` assertion immediately before `safeParse` (preserving runtime validation as the source of truth). Decision point — verify during implementation.

### Step-by-step

1. Create `packages/schemas/src/auditPayloads.ts`. Define one Zod schema per branch using the names from the spec:
   - `smokeTestChatCompletionPayload` (model, prompt ≤530, response ≤530, tokens.strict, durationMs)
   - `toolCallPayload` (toolName, invocationId UUID, args canonicalSafe)
   - `toolResultPayload` (toolName, invocationId UUID, result canonicalSafe, durationMs)
   - `anomalyDetectedPayload` (anomalyType, severity 1-100, evidence canonicalSafe, detectedAt ISO ms)
   - `riskOfficerReasoningPayload` (input canonicalSafe, reasoning, confidence 0-10000, durationMs, tokens.strict — the 5-field shape per the AC-24 amendment)
   - `opsEngineerReasoningPayload` (same 5-field shape as riskOfficer)
   - `synthesizerReasoningPayload` (riskOfficerInput, opsEngineerInput, reasoning, durationMs, tokens.strict)
   - `synthesizerProposalPayload` (proposalText, supportingEvidence array, expectedImpact canonicalSafe, confidence 0-10000)
   - `synthesizerRefusalPayload` (reasonCode, reasoningText, degradedInputs array)
   - `humanApprovalPayload` (proposalRunId, approvedBy, approvedAt ISO ms, notes optional)
   - `humanRejectionPayload` (proposalRunId, rejectedBy, rejectedAt ISO ms, reasonCode, notes optional)
   - `finalCommittedPayload` (proposalRunId, committedActions array of `{ type, details canonicalSafe }`, brokerMockId, committedAt ISO ms)
   - All objects use `.strict()`. All numeric fields are integers within JS safe range. `toolName` references `ToolName` literal union (imported from `./tools/index.js`). `invocationId` uses `z.string().uuid()`.
2. Modify `packages/schemas/src/auditRecord.ts`: replace the body of `auditRecordBodySchema` with:
   ```
   z.discriminatedUnion("recordType", [
     defineAuditRecord("smoke_test:chat_completion", smokeTestChatCompletionPayload),
     defineAuditRecord("tool:call", toolCallPayload),
     defineAuditRecord("tool:result", toolResultPayload),
     defineAuditRecord("anomaly:detected", anomalyDetectedPayload),
     defineAuditRecord("risk_officer:reasoning", riskOfficerReasoningPayload),
     defineAuditRecord("ops_engineer:reasoning", opsEngineerReasoningPayload),
     defineAuditRecord("synthesizer:reasoning", synthesizerReasoningPayload),
     defineAuditRecord("synthesizer:proposal", synthesizerProposalPayload),
     defineAuditRecord("synthesizer:refusal", synthesizerRefusalPayload),
     defineAuditRecord("human:approval", humanApprovalPayload),
     defineAuditRecord("human:rejection", humanRejectionPayload),
     defineAuditRecord("final:committed", finalCommittedPayload),
   ])
   ```
   `AuditRecordBody` is `z.infer<typeof auditRecordBodySchema>` — automatically the discriminated union.
3. Extend `auditRecord.test.ts` with one happy-path test per branch (12 tests) plus negative tests:
   - Reject unknown recordType.
   - Reject mismatched payload (e.g., `recordType: "tool:call"` with a `human:approval` payload).
   - Narrowing test: `if (parsed.recordType === "tool:call") { /* parsed.payload.toolName is typed as ToolName */ }`.
4. Update `packages/schemas/src/index.ts` to re-export the 12 payload schemas (for consumers that want to inspect a single branch's payload shape).
5. Update `packages/audit/src/types.ts` JSDoc to mention that `AppendInput` is now a discriminated union.
6. Run `pnpm -r typecheck`. The writer's `record` literal on `runAuditWriter.ts` lines 96-102 is the most likely source of trouble under the new discriminated-union type. Three possible outcomes:

   - **Outcome A (best)**: TypeScript handles the construction cleanly. The destructured `input.recordType` narrows the literal correctly. No fix needed.

   - **Outcome B (likely)**: TypeScript widens `input.recordType` to `string` and rejects the construction against the narrower union. Fix: drop the explicit `: AuditRecordBody` annotation from the local `record` variable on line 96. TypeScript infers the shape from the literal; passing it to `safeParse` is fine because `safeParse` accepts `unknown`.

   - **Outcome C (worst case)**: Even without annotation, the literal can't be widened. Add a one-line `as AuditRecordBody` assertion immediately before the `safeParse` call. Runtime validation remains the source of truth.

   Apply the minimum fix that resolves the typecheck error. Document the outcome in the Phase 4 implementation report.
7. Run `pnpm test`. All existing tests still pass; new branch tests pass.
8. Verify that the existing smoke runner code path (un-migrated) STILL typechecks: it passes `recordType: "smoke_test:chat_completion"` to `writer.append`, which matches the locked branch. The writer's `safeParse` against the discriminated union accepts the smoke-test branch. No runtime failure.

### Test strategy

- 12 happy-path branch tests in `auditRecord.test.ts` (one per recordType).
- 3 negative tests: unknown recordType; mismatched payload; missing required payload field.
- 1 narrowing test using type-level assertions.
- No `RunAuditWriter` unit test is added in Sprint 3. The Phase 4 modification to the writer's construction site (lines 96-102) is minimal — annotation removal or `as` assertion at most, no runtime behavior change. Live smoke (Phase 5) validates writer behavior end-to-end. If Phase 5's live run surfaces a writer issue, a targeted unit test is added retroactively at that point.
- All existing tests pass unchanged.
- Sprint 2's `smokeTestChatCompletionPayloadSchema` (still exported from `smokeTestPayload.ts`) continues to typecheck. Its tests still pass. The smoke runner does not change in this phase.
- No live Vultr call.

### Anti-patterns to avoid

- **Markdown-fenced-block corruption**: all edits via tools.
- **Conditional package exports**: not invoked.
- **Drift between Sprint 2's `smokeTestChatCompletionPayloadSchema` and the new `smokeTestChatCompletionPayload` in `auditPayloads.ts`**: define the schemas with identical field constraints. The cross-over test asserting that `smokeTestChatCompletionPayloadSchema` (standalone) and `smokeTestChatCompletionPayload` (union branch) accept/reject identical inputs is KEPT in Phase 4 and DELETED in Phase 5 when the standalone schema is removed. Rationale: catches drift between the two schemas before the Phase 5 live smoke run. Cost is ~10 lines of test code with a defined deletion point.
- **Backward-compat re-exports of the old envelope under a new name**: NO. The single export name `auditRecordBodySchema` is reused; the union replaces the object schema in-place. No deprecation alias.

### Phase 4 exit criteria

- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm test` passes (12 branch tests + 3 negative + 1 narrowing + all existing).
- [ ] `auditRecordBodySchema` is a `z.discriminatedUnion`.
- [ ] `AuditRecordBody` inferred type is the discriminated union.
- [ ] `AppendInput` is a discriminated union (via `Omit` distribution).
- [ ] The Sprint 2 smoke runner (unchanged) still typechecks against the new types.
- [ ] AC-01 through AC-12 all hold.

### Phase 4 rollback

```
git restore packages/schemas/src/auditRecord.ts packages/schemas/src/index.ts \
            packages/audit/src/types.ts packages/audit/src/runAuditWriter.ts \
            packages/schemas/src/auditRecord.test.ts
git clean -f packages/schemas/src/auditPayloads.ts
```

(Or: `git revert <phase-4-commit>` if committed independently.) No bucket state affected.

---

## Phase 5 — Smoke runner migration + live re-run

### Goal

Migrate `scripts/smoke-vultr.ts` to consume the new discriminated union end-to-end: remove the standalone payload parse, build the record directly, let the writer's internal `safeParse` against the discriminated union do the validation. Remove `smokeTestChatCompletionPayloadSchema` and its source file `smokeTestPayload.ts`. Then run `pnpm smoke` against real Vultr and verify PASS.

### Files touched

- `scripts/smoke-vultr.ts` (lines 22, 213-260, modified):
  - Remove the `import { smokeTestChatCompletionPayloadSchema } from "@roguemouse/schemas"` on line 22.
  - Remove the explicit payload parse block on lines 225-236 (the `payloadParse.safeParse(payload)` and its failure handling).
  - On line 259, change `payload: payloadParse.data` to `payload`.
  - The writer's `safeParse` against the discriminated union (now on `runAuditWriter.ts` line 104) takes over the validation responsibility. If the payload is malformed, the writer's `AppendResult` envelope returns `{ ok: false, error: { code: "validation_error", … } }` instead of the runner short-circuiting at the smokeTestChatCompletionPayloadSchema step. The runner's existing `failNoState("schema_validation", …)` branch handler is reused via the writer's error path.
  - Result: the smoke runner is structurally simpler — no two-step validation, just one parse inside the writer.
- `packages/schemas/src/smokeTestPayload.ts` (lines 1-38, DELETED) — content has been superseded by `auditPayloads.ts`'s `smokeTestChatCompletionPayload`.
- `packages/schemas/src/index.ts` (modified) — remove the `export { smokeTestChatCompletionPayloadSchema, type SmokeTestChatCompletionPayload }` block on lines 5-8.
- `packages/schemas/src/auditRecord.test.ts` (modified) — remove the Phase 4 cross-over test that compared the standalone and union schemas (no longer applicable; the standalone is gone).

### Step-by-step

1. Edit `scripts/smoke-vultr.ts`:
   - Remove the standalone-schema import.
   - Delete the `payloadParse` block (10-12 lines).
   - Inline the payload into the `writer.append` call.
2. Delete `packages/schemas/src/smokeTestPayload.ts`.
3. Update `packages/schemas/src/index.ts` to drop the standalone export.
4. Remove the Phase 4 cross-over test from `auditRecord.test.ts`.
5. Run `pnpm -r typecheck` — must be clean.
6. Run `pnpm test` — all tests pass.
7. Confirm `.env.local` is present at the repo root with the three required variables (`VULTR_INFERENCE_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`).
8. Run `pnpm smoke` against real Vultr. Expected: exit 0, PASS report. The new audit record is written to `audit/<runId>/<ts-safe>-<hash>.json` in `roguemouse-audit-log`.
9. Record the new record's `key`, `hash`, and `runId` in `ROGUEMOUSE_CONTEXT.md` (Phase 6 will document this; for now just note it for the review report).

### Test strategy

- All unit tests pass under the new layout.
- The live `pnpm smoke` run is the regression test for the entire Sprint 3 refactor:
  - PASS exit 0 → AC-30.
  - Round-trip hash verified by the runner's internal step → AC-31.
  - `previousHash` equals genesis → AC-32.
  - The new audit record's canonical body is byte-identical to what a Sprint 2 record would look like for the same input (AC-33). This is implied by AC-27 (the canonicalize relocation is byte-stable) plus the fact that the payload shape for `smoke_test:chat_completion` is unchanged. A unit test in `auditRecord.test.ts` (or a one-off check) compares the canonical bytes of a synthetic smoke payload through both the old (pre-Phase-4) and new (post-Phase-4) code paths; pre-Phase-4 bytes can be captured from a known-good Sprint 2 fixture.

### Anti-patterns to avoid

- **Markdown-fenced-block corruption**: all edits via tools.
- **Conditional package exports**: not invoked.
- **Re-introducing a smoke-only payload schema alias**: forbidden by AC-29's amended text. The smoke runner does not gain a new helper schema to replace `smokeTestChatCompletionPayloadSchema`.
- **Skipping the live run**: not acceptable. AC-30 requires a successful PASS run. Re-run if a transient Vultr error trips the first attempt; do not declare PASS without a real exit-0 report.
- **Committing `.env.local`**: discipline reminder — it is gitignored, but never `git add -f` it.

### Phase 5 exit criteria

- [ ] `pnpm -r typecheck` clean.
- [ ] `pnpm test` passes.
- [ ] `pnpm smoke` against real Vultr: exit 0, PASS report. New audit record written. Round-trip hash verified.
- [ ] The new record's `previousHash` equals the genesis constant `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`.
- [ ] `packages/schemas/src/smokeTestPayload.ts` no longer exists in the working tree.
- [ ] `@roguemouse/schemas` no longer exports `smokeTestChatCompletionPayloadSchema`.
- [ ] AC-29, AC-30, AC-31, AC-32, AC-33 all hold.

### Phase 5 rollback

```
git restore scripts/smoke-vultr.ts packages/schemas/src/index.ts packages/schemas/src/auditRecord.test.ts
git checkout HEAD -- packages/schemas/src/smokeTestPayload.ts
```

The new audit record in the bucket is immutable and harmless (own runId, own chain rooted at genesis). No bucket action required for rollback.

---

## Phase 6 — Review

### Goal

Run `/review-task` against the spec. Produce `docs/sprints/tool-schema-and-payload-narrowing/review.md` mapping every AC (01 through 35, including 24a + 24b) to PASS evidence: test files, code locations, live run output. Identify any partial-PASS or deferred items.

### Files touched

- `docs/sprints/tool-schema-and-payload-narrowing/review.md` (new) — the review report.

### Step-by-step

1. Re-read the spec and confirm the AC count is 36 (AC-01 to AC-35, with AC-24 split).
2. For each AC, identify the evidence: test name + line range, source code symbol + line range, or live run console output (Phase 5).
3. Note any ACs that required manual / live verification (AC-30, 31, 32) and cite the runId + record key from the Phase 5 live run.
4. Write the review document following the convention from Sprint 2's `review.md`.
5. If any AC is partial or has caveats, surface it explicitly; do not paper over.
6. Update `ROGUEMOUSE_CONTEXT.md`:
   - Mark Sprint 3 ✅ Complete with date.
   - Add the locked artifacts: `RecordTypeName` literal union (12 names), `ToolName` literal union (8 names), `TOOLS` registry location, `canonicalize` now in `@roguemouse/schemas`, `ToolResult`/`ToolError` envelope shape.
   - Update commit pointer to Sprint 3's commit.
7. Update `tasks/lessons.md` if the implementation surfaced a new anti-pattern.
8. Commit everything.

### Test strategy

No new tests. The review verifies what already passed.

### Anti-patterns to avoid

- **Hand-waving on partial PASS**: every AC gets a binary verdict + evidence. "Likely passes" is not acceptable.
- **Skipping the context update**: `ROGUEMOUSE_CONTEXT.md` is the state carrier across sessions; not updating it after a sprint is how state decays.

### Phase 6 exit criteria

- [ ] `review.md` exists and ratifies all 36 ACs (or explicitly flags exceptions).
- [ ] `ROGUEMOUSE_CONTEXT.md` reflects Sprint 3 completion + locked artifacts.
- [ ] Day 2 hackathon kill-switch closed retroactively: Tool Schema + Audit Schema locked; Vector Store RAG stays in scope for Sprint 4+.
- [ ] Commit lands on `main` per Sprint 2's "single commit per sprint" precedent (or per the operator's instruction at /review-task time).

### Phase 6 rollback

```
git restore ROGUEMOUSE_CONTEXT.md tasks/lessons.md
git clean -f docs/sprints/tool-schema-and-payload-narrowing/review.md
```

(Or, if committed: `git revert <phase-6-commit>`.) No runtime impact.

---

## Final verification

After all six phases complete:

- [ ] `pnpm -r typecheck` — clean across all packages, zero new errors over Sprint 2 baseline.
- [ ] `pnpm test` — passes including the new tests added in Phases 1, 3, 4.
- [ ] `pnpm smoke` against real Vultr — PASS exit 0 (Phase 5 live run).
- [ ] Every AC (AC-01 through AC-35, with AC-24 split) has documented PASS evidence in `review.md`.
- [ ] No new exports of `smokeTestChatCompletionPayloadSchema`. No new exports of `canonicalize` from `@roguemouse/audit`.
- [ ] `auditRecordBodySchema` is a discriminated union over the 12 locked recordType names.
- [ ] `TOOLS` registry has exactly 8 entries with the locked names.
- [ ] `canonicalize` lives in `@roguemouse/schemas`; `sha256Hex`, `GENESIS_HASH`, `GENESIS_SEED` live in `@roguemouse/audit`.
- [ ] `ROGUEMOUSE_CONTEXT.md` updated with Sprint 3 completion + locked artifacts + Sprint 4 queued.

---

## Commit policy

Sprint 3 follows the Sprint 2 precedent: single commit per sprint after `/review-task` passes. Per-phase commits are NOT used. Rationale: the six phases together produce one coherent deliverable; commit boundaries inside the sprint add log noise and bisect ambiguity without changing rollback capability (each phase's rollback instructions use `git restore` + `git clean`, not `git revert`).

The commit message follows Sprint 2's pattern:

- First line: `feat(schemas): <short summary>` (likely something like `feat(schemas): narrow audit payload to discriminated union, lock 8 tool schemas`).
- Body: structured per Sprint 2's commit-message style, including the new genesis-rooted audit record's key from Phase 5's live run.

## Stop gate

When the plan is approved, proceed to `/implement-task`. Do not begin writing code before approval.
