# tool-schema-and-payload-narrowing — Review

Independent verification of Sprint 3 against the spec's 36 acceptance criteria, the project's hard rules in `.claude/rules/*.md` and `CLAUDE.md`, and the live `pnpm smoke` PASS report from Phase 5. Every AC was checked by reading the actual code on disk; per-phase implementation reports were not trusted.

## Acceptance criteria verdict

| AC | Verdict | Evidence |
|---|---|---|
| AC-01 | ✅ PASS | `packages/schemas/src/auditRecord.ts:124` — `export const auditRecordBodySchema = z.discriminatedUnion("recordType", [...])`. The schema is a Zod discriminated union with `"recordType"` as the discriminator. |
| AC-02 | ✅ PASS | `packages/schemas/src/auditRecord.ts:124-137` — exactly 12 `defineAuditRecord(...)` calls inside the union's branches array. The locked recordType names (`smoke_test:chat_completion`, `tool:call`, `tool:result`, `anomaly:detected`, `risk_officer:reasoning`, `ops_engineer:reasoning`, `synthesizer:reasoning`, `synthesizer:proposal`, `synthesizer:refusal`, `human:approval`, `human:rejection`, `final:committed`) appear in spec order. `auditRecord.test.ts:36-48` asserts `RECORD_TYPES` has exactly 12 entries in that order. |
| AC-03 | ✅ PASS | `packages/schemas/src/auditRecord.ts:84-101` — `defineAuditRecord` returns a `z.object({...}).strict()` with exactly five fields (`ts`, `runId`, `recordType`, `previousHash`, `payload`). Every branch is built by this helper, so every branch is `.strict()` with the same five-field shape. `auditRecord.test.ts:99-110` asserts that an extra top-level field is rejected. |
| AC-04 | ✅ PASS | `packages/schemas/src/auditRecord.ts:94` — `recordType: z.literal(recordType)`. The literal type is preserved through the `TRecordType extends RecordTypeName` generic. `auditRecord.test.ts:165-186` (Phase 1) asserts the literal is preserved in the inferred type. |
| AC-05 | ✅ PASS | `packages/schemas/src/auditRecord.ts:87-97` — `ts` uses `ISO_TIMESTAMP_MS_REGEX` (from `primitives.ts:30`) plus a `Date.parse` refine; `runId` uses `z.string().min(1)`; `previousHash` uses `HEX_64_REGEX` (from `primitives.ts:38`). These are byte-identical to Sprint 2's constraints. `auditRecord.test.ts:112-146` asserts each constraint rejects invalid input. |
| AC-06 | ✅ PASS | `packages/schemas/src/auditRecord.test.ts:451-456` — happy-path negative test: `safeParse` of a record with `recordType: "tool:invented_new_kind"` returns `success: false` (Zod's discriminated-union discriminator rejects an unknown value with a structured error). Confirmed PASS in test run. |
| AC-07 | ✅ PASS | `packages/schemas/src/auditRecord.test.ts:459-471` — `recordType: "tool:call"` with a `synthesizer:proposal`-shaped payload is rejected (`success: false`). The Zod issues list names the violating fields. Confirmed PASS. |
| AC-08 | ✅ PASS | `packages/schemas/src/auditRecord.ts:139` — `export type AuditRecordBody = z.infer<typeof auditRecordBodySchema>`. The literal union of recordTypes is derived from the discriminated-union schema. `auditRecord.test.ts:511-523` asserts `AuditRecordBody["recordType"]` is the literal union, not `string`, via `@ts-expect-error`. |
| AC-09 | ✅ PASS | `packages/schemas/src/auditRecord.ts:81-101` (`defineAuditRecord` helper) plus the 12 call sites at lines 125-136. Each branch is one `defineAuditRecord(...)` call. |
| AC-10 | ✅ PASS | `packages/audit/src/types.ts:30` — `export type AppendInput = Omit<AuditRecordBody, "previousHash" \| "runId">`. With `AuditRecordBody` being a discriminated union, `Omit` distributes across the union, so `AppendInput` is a discriminated union too. The writer-side fix at `runAuditWriter.ts:96-103` documents that mismatched literals fail compile-time narrowing (Outcome B). |
| AC-11 | ✅ PASS | All 12 payload schemas in `packages/schemas/src/auditPayloads.ts` use only canonicalization-safe primitives (`z.string()`, `z.number().int()...`, `z.boolean()`, `z.array(...)`, `z.object(...).strict()`) plus `canonicalSafeSchema` for explicit free-form fields (`args`, `result`, `evidence`, `expectedImpact`, `details`, `input`, `riskOfficerInput`, `opsEngineerInput`). No floats, no Dates, no `z.unknown()` without the safety wrapper. |
| AC-12 | ✅ PASS | `packages/audit/src/runAuditWriter.ts:95` (`append(input: AppendInput): Promise<AppendResult>`) and `:178` (`read(key: string): Promise<ReadResult>`). Method names and return types unchanged from Sprint 2. The only internal change is the dropped `: AuditRecordBody` annotation on the local `record` construction (lines 96-110, with explanatory JSDoc). |
| AC-13 | ✅ PASS | `packages/schemas/src/tools/defineTool.ts:51-57` — `defineTool<TName extends string, TArgs, TData>(name, argsSchema, resultDataSchema)` returns `ToolDefinition<TName, TArgs, TData>` preserving the literal and argument types via the generic parameters. |
| AC-14 | ✅ PASS | `packages/schemas/src/tools/registry.ts:29-38` — `TOOLS` has exactly 8 entries: `marketDataLookup`, `runbookSearch`, `positionSnapshot`, `brokerReconcile`, `auditAppend`, `auditSearch`, `scoreExplain`, `policyCheck`. Each tool file's `defineTool(...)` call hardcodes the spec's locked name string (verified in each of the 8 tool files at lines 43-47 / 46-50 / 46-50 / 44-48 / 53-57 / 44-48 / 48-52 / 51-55). `registry.test.ts:32-46` asserts the count and ordering. |
| AC-15 | ✅ PASS | `packages/schemas/src/tools/index.ts:18-24` re-exports `TOOLS`, and `packages/schemas/src/index.ts:35` (`export * from "./tools/index.js"`) lifts it to the package barrel. Verified at runtime via `pnpm exec tsx -e "import { TOOLS }..."` returning the 8 entries. |
| AC-16 | ✅ PASS | `packages/schemas/src/tools/registry.ts:50` — `export type ToolName = ToolsRegistry[keyof ToolsRegistry]["name"]`. Derived from `TOOLS`; `registry.test.ts:48-68` asserts the type via `Expect<Equal<ToolName, ...>>` plus a second test at `registry.test.ts:70-83` asserting `Equal<ToolName, ToolNameLiteral>` (from `primitives.ts`). |
| AC-17 | ✅ PASS | All 8 tool args schemas use `.strict()`: `marketDataLookup.ts:14`, `runbookSearch.ts:19`, `positionSnapshot.ts:16`, `brokerReconcile.ts:15`, `auditAppend.ts:31`, `auditSearch.ts:29`, `scoreExplain.ts:17`, `policyCheck.ts:25`. `registry.test.ts:114-118` asserts extras are rejected on `market_data:lookup`. |
| AC-18 | ✅ PASS | All 8 result-data schemas use `.strict()` and canonicalization-safe primitives: `marketDataLookup.ts:37`, `runbookSearch.ts:40`, `positionSnapshot.ts:40`, `brokerReconcile.ts:38`, `auditAppend.ts:47`, `auditSearch.ts:38`, `scoreExplain.ts:42`, `policyCheck.ts:45`. Numeric fields are all `z.number().int()` with explicit bounds where applicable; free-form payload fields use `canonicalSafeSchema`. The uniform `ToolError` (`toolResult.ts:10-15`) uses only string + boolean + optional string — canonicalization-safe. |
| AC-19 | ✅ PASS | `packages/schemas/src/tools/registry.ts:29-38` — the `TOOLS` object literal with `as const` uses each tool's name only once (8 unique camelCase keys mapping to 8 unique colon-separated `.name` literals). Duplicate keys would be a TypeScript compile error. `registry.test.ts:42-45` asserts `new Set(names).size === 8` at runtime. |
| AC-20 | ✅ PASS | `packages/schemas/src/tools/dispatchTool.ts:37-40` — `export type DispatchTool = <TName extends ToolName>(name: TName, args: ArgsFor<TName>) => Promise<ToolResult<DataFor<TName>>>`. Generic narrows both args and result data via `ArgsFor`/`DataFor` (defined in `registry.ts:67-78`). `registry.test.ts:85-105` asserts `ArgsFor<"market_data:lookup">` and `DataFor<"audit:append">` narrow correctly. Grep for `^(export function|function) dispatchTool` in `dispatchTool.ts` returns no matches — type-only, no runtime function. |
| AC-21 | ✅ PASS | `packages/schemas/src/tools/toolResult.ts:32-34` — `export type ToolResult<TData> = { ok: true; data: TData } \| { ok: false; error: ToolError }`. |
| AC-22 | ✅ PASS | `packages/schemas/src/tools/toolResult.ts:10-15` — `ToolError = { code: string; message: string; retryable: boolean; step?: string }`. Identical to `packages/audit/src/types.ts:78-83` `AuditError`. Same four fields in the same order; `step?` is optional in both. |
| AC-23 | ✅ PASS | Each of the 8 tool files exports a `<toolShortName>ResultDataSchema` (the `T` of `{ ok: true, data: T }`). No tool file defines its own error type — all share `ToolError`. |
| AC-24a | ✅ PASS | The no-throw contract is documented in JSDoc at four locations: `defineTool.ts:17-21` (on `ToolDefinition` interface), `defineTool.ts:39-42` (on the `defineTool` helper), `dispatchTool.ts:26-32` (on the `DispatchTool` type), and `toolResult.ts:18-30` (on the `ToolResult` type). All four explicitly state implementations are required not to throw and that the dispatcher converts throws to `{ ok: false, error: { code: "tool_threw", ... } }`. |
| AC-24b | ✅ PASS | `packages/schemas/src/tools/dispatchTool.ts:40` — `=> Promise<ToolResult<DataFor<TName>>>`. The envelope wrapping is in the return type itself. A future implementation returning `Promise<DataFor<TName>>` (raw data) would fail to satisfy `DispatchTool` at compile time. |
| AC-25 | ✅ PASS | `packages/schemas/src/canonicalize.ts` exists; `packages/schemas/src/index.ts:33` — `export { canonicalize } from "./canonicalize.js"`. Verified at runtime via `pnpm exec tsx -e "import { canonicalize } from '@roguemouse/schemas'..."` in Phase 2 active check. |
| AC-26 | ✅ PASS | `packages/audit/src/index.ts:1-18` (full file) — no line mentions `canonicalize`. The audit barrel exports only `sha256Hex`, `GENESIS_HASH`, `GENESIS_SEED`, `createS3Client`, `RunAuditWriter`, and types. Filesystem check: `packages/audit/src/canonicalize.ts` no longer exists (`git status` shows it deleted). |
| AC-27 | ✅ PASS | The Phase 2 byte-stability check (`pnpm exec tsx -e "...canonicalize({ b: 1, a: { y: 2, x: 1 } })..."`) returned `{"a":{"x":1,"y":2},"b":1}` — same canonical bytes as the Sprint 2 algorithm produced. The Phase 2 `Compare-Object` showed the new `canonicalize.ts` body is byte-identical to the deleted `packages/audit/src/canonicalize.ts` apart from the first-line import path. `canonicalize.test.ts` (23 tests) passes at its new location with identical assertions. |
| AC-28 | ✅ PASS | `packages/audit/src/index.ts:3-4` — `export { sha256Hex } from "./sha256.js"` and `export { GENESIS_HASH, GENESIS_SEED } from "./genesis.js"`. The three symbols remain in `@roguemouse/audit`. |
| AC-29 | ✅ PASS | `scripts/smoke-vultr.ts:21` — `import { canonicalize } from "@roguemouse/schemas"` (no `smokeTestChatCompletionPayloadSchema` import). `packages/schemas/src/smokeTestPayload.ts` deleted (verified by filesystem check + `git status`). `packages/schemas/src/index.ts` (full 35-line file) does not mention the removed schema. Grep of all `**/*.ts` files for `smokeTestChatCompletionPayloadSchema` returns no matches anywhere in the codebase. The smoke runner constructs the payload directly and lets the writer's internal `auditRecordBodySchema.safeParse` validate against the union (`smoke-vultr.ts:218-228` builds payload, `:248-252` passes it to `writer.append`). |
| AC-30 | ✅ PASS | Phase 5 live run: exit code 0, structured PASS report captured. `pnpm smoke` output shows `=== PASS ===` followed by runId, s3 key, recordHash, tokens, and timing. |
| AC-31 | ✅ PASS | Phase 5 PASS report line: "Round-trip integrity verified." Internal `runAuditWriter.ts:113` parse passed; `:301-313` round-trip hash check found `recomputedHash === appendResult.data.hash`. |
| AC-32 | ✅ PASS | Phase 5 PASS report: `previousHash : b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc` and `matches genesis : true`. Identical to Sprint 2's first audit record's `previousHash`. |
| AC-33 | ✅ PASS | Covered by AC-27 + the structural identity of the smoke-test payload schema. The new `smokeTestChatCompletionPayload` in `auditPayloads.ts:46-54` has the same 5-field strict shape, same string-max constraints, same integer non-negative constraints as the deleted `smokeTestChatCompletionPayloadSchema`. Phase 4's cross-over test (now deleted in Phase 5) explicitly verified byte-equality before the standalone was removed. |
| AC-34 | ✅ PASS | `pnpm -r typecheck`: clean across all 8 workspace projects. `pnpm typecheck:scripts`: clean. Zero errors. Sprint 2 baseline was also 0; baseline maintained. |
| AC-35 | ✅ PASS | `pnpm test`: 145 tests pass in `@roguemouse/schemas` (5 test files), 4 tests pass in `@roguemouse/audit` (1 test file). The Sprint 2 `canonicalize.test.ts` (23 tests) now lives in `@roguemouse/schemas` and passes there unchanged. Total workspace test count: 149. |

**36 of 36 ACs PASS.**

---

## Architectural review

### Fail-open paths

**None found.** Sprint 3's only behavioral change to error handling is in `scripts/smoke-vultr.ts:211-228`: the previously-explicit `smokeTestChatCompletionPayloadSchema.safeParse(payload)` step was removed, and the same validation now happens inside `RunAuditWriter.append` via `auditRecordBodySchema.safeParse(record)` on `runAuditWriter.ts:112`. The validation rule is identical (smoke-test branch payload schema = old standalone schema by construction), and the failure path still produces a non-zero exit with a structured error envelope (`{ ok: false, error: { code: "validation_error", step: "validate", ... } }`). No code path silently accepts a malformed payload.

### Audit log integrity

**Preserved.** Specific evidence:

- **Chain invariant**: `runAuditWriter.ts:73` initializes `lastHash = GENESIS_HASH` per writer instance; `:108` uses `this.lastHash` as `previousHash` on every append; `:161` advances `lastHash` only after a successful S3 PUT. The Phase 5 live record's `previousHash` equals `b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc` (genesis), confirming the chain still bootstraps from the same root as Sprint 2.
- **No delete or list API**: `RunAuditWriter` exposes only `append` and `read` (verified by reading the full class definition). No DeleteObject, no ListObjectsV2 anywhere in `packages/audit/src/`.
- **Content-addressed keys prevent overwrite**: `runAuditWriter.ts:32-34` — keys are `audit/{runId}/{ts-safe}-{hash}.json`. The same content produces the same key; different content produces a different key. Modifying a record would change its hash and thus its key.
- **Canonicalization byte-stable across the migration**: AC-27 plus the active byte-check (`{"a":{"x":1,"y":2},"b":1}` for the same input as Sprint 2) confirm no algorithmic drift.

### LLM client and audit writer error handling

**Envelope discipline maintained.** Grep for top-of-line `throw` statements in:

- `packages/inference/src`: **no matches**. All errors from the OpenAI SDK are caught and classified into `InferenceResult` envelopes via `chatCompletion.ts` (verified during Phase 2 re-read).
- `packages/audit/src`: **no matches**. All S3 SDK exceptions are caught and classified via `classifyS3Error` into `AppendResult` / `ReadResult` envelopes.

The one `throw new Error` in the codebase is at `packages/schemas/src/canonicalize.ts:49` — inside `@roguemouse/schemas`, not in the inference or audit packages, and explicitly documented as throwing on invalid input. The audit writer wraps this call in try/catch at `runAuditWriter.ts:126-138` and converts the throw into an envelope error with `code: "canonicalize_error"`. The envelope discipline holds on the writer's public surface.

The new `ToolResult<TData>` envelope (`toolResult.ts:32-34`) extends this pattern to the future `@roguemouse/agent` dispatch surface; the type signature `DispatchTool` (`dispatchTool.ts:37-40`) enforces it at compile time.

### Vercel-specific features

**None found.** Grep for `vercel`, `@vercel`, `edge runtime`, `next/image` (case-insensitive) across `packages/` returns no matches. Sprint 3 did not touch `apps/web/` and introduced no frontend code.

### Code provenance (no Meridian references in source)

**Verified.** Grep for `Meridian|meridian` across `packages/`, `scripts/`, and `apps/` returns no matches. All Sprint 3 source code is original. The Meridian references in `.claude/rules/hackathon.md`, `CLAUDE.md`, and `docs/sprints/workspace-scaffold/spec-and-plan.md` are policy text describing what is forbidden — not source code — and `tasks/todo.md` already tracks the cosmetic pre-submission sweep.

### Schema discipline

**All Zod schemas live in `@roguemouse/schemas`.** Sprint 3 introduced 8 tool args schemas + 8 tool result-data schemas + 12 audit payload schemas + the discriminated union envelope + the `defineTool` and `defineAuditRecord` helpers + the `recordTypeNameSchema` + `toolNameSchema` (inline in auditPayloads, derived from `primitives.TOOL_NAME_LITERALS`) — all in `packages/schemas/src/`. The audit writer (`packages/audit/src/runAuditWriter.ts`) imports `auditRecordBodySchema` from `@roguemouse/schemas` rather than defining a local schema. The smoke runner (`scripts/smoke-vultr.ts`) defines no Zod schemas — it constructs the payload as a plain object and relies on the writer's parse.

### License compliance

**No new direct dependencies in Sprint 3.** `git diff --stat 9767863..HEAD -- 'packages/**/package.json' 'package.json'` returned empty output, meaning zero `package.json` files changed since Sprint 2's commit. The dependency closure is unchanged: `zod`, `@aws-sdk/client-s3`, `openai`, `dotenv`, `tsx`, `typescript`, `vitest`, plus `next`/`react`/`react-dom` for the (untouched) web app. No GPL/AGPL/SSPL additions; no new direct or transitive sponsor-stacking dependencies.

### Workspace integrity

**All 9 typecheck targets clean** (8 workspace projects + the root `tsconfig.scripts.json`):

```
packages/agent typecheck: Done
packages/audit typecheck: Done
packages/broker-mock typecheck: Done
packages/inference typecheck: Done
packages/runbooks typecheck: Done
packages/schemas typecheck: Done
packages/tools typecheck: Done
apps/web typecheck: Done
pnpm typecheck:scripts (root) — clean
```

No errors over the Sprint 2 baseline. Same 8 + 1 = 9 typecheck targets as Sprint 2.

### Character-level integrity

Spot-checked the JSDoc-dense files for hash/asterisk corruption per the `tasks/lessons.md` 2026-05-14 entry:

- `packages/schemas/src/primitives.ts`: JSDoc bullet items use ` *  - `<text>` consistently; no missing asterisks; no `#` characters.
- `packages/schemas/src/tools/defineTool.ts`: AC citations (`AC-24a`) intact; JSDoc bullets at `:15-21` and `:39-42` preserved.
- `packages/schemas/src/tools/dispatchTool.ts`: 33-line JSDoc block; all `*` line prefixes intact; the inline `dispatchTool(...)` example at `:21-22` has all backticks and parentheses.
- `packages/schemas/src/auditPayloads.ts`: 12 JSDoc blocks (one per payload), all intact.
- 8 tool files: per-file JSDoc preserved; unit conventions in `marketDataLookup.ts:21-28` show the bullet list with all asterisks present.

No corruption signs. All files authored via `Write` / `Edit` tools (no operator-paste relay), so the strip-prefix path that affected Sprint 0.5's `.gitignore` does not apply.

### Sprint 3-specific architectural notes

#### `primitives.ts` leaf-module discipline

**Zero sibling imports verified.** `packages/schemas/src/primitives.ts` has no `import` statements at all (verified by grep). It exports plain value declarations (two regex constants + an `as const` string array) and one derived type. The strictest possible leaf — even `zod` is not imported, because the `z.enum` construction over `TOOL_NAME_LITERALS` happens in `auditPayloads.ts` (the consumer) rather than at the constant's home.

The JSDoc header at `primitives.ts:5-10` explicitly states the no-cross-sibling-imports rule for future contributors.

#### Writer-side typing fix (Outcome B)

**Documented in code at `packages/audit/src/runAuditWriter.ts:96-103`:**

```typescript
// The local `record` is intentionally not annotated as
// `AuditRecordBody`. After Sprint 3 Phase 4, `AuditRecordBody`
// is a discriminated union; assembling fields from `input`
// independently loses the recordType ↔ payload correlation, so
// an explicit annotation cannot find a matching branch even
// though the resulting object IS valid. Runtime validation via
// `safeParse` (which accepts `unknown`) remains the source of
// truth.
```

The `: AuditRecordBody` annotation was removed from line 104 and the unused `type AuditRecordBody` import was removed from line 7. The explanatory comment block survives in code for future readers.

#### `audit:append` recursion guard

**JSDoc present at `packages/schemas/src/tools/auditAppend.ts:8-25`:**

```
IMPORTANT RECURSION GUARD: when the planner records its own
`tool:call` and `tool:result` audit entries about other tool
dispatches, it must call the writer (`RunAuditWriter.append`)
DIRECTLY, not invoke this `audit:append` tool — otherwise the
planner would recurse into recording its own recording. Only
agent-initiated audit writes (e.g., an agent voice explicitly
deciding to log a reasoning step or a refusal) go through this
tool's dispatch path.
```

The guard is policy text directed at Sprint 4's planner implementation, not a schema-level enforcement (a schema-level guard would force every other consumer to know the policy). This is a deliberate design choice documented at the brainstorm and locked at the spec's tool inventory.

#### Day 2 kill-switch retroactive closure

The spec's summary commits to: "the moment `/review-task` passes, Tool Schema + Audit Schema are locked and Vector Store RAG stays in scope for Sprint 4+." Both locks are now in place:

- **Tool Schema**: 8 tools with locked names, args, result-data, registry, type-level narrowing.
- **Audit Schema**: 12-branch discriminated union, locked recordType names, locked payload shapes per branch, hash-chained envelope preserved.

The kill-switch criteria from `.claude/rules/hackathon.md` is therefore satisfied as of this review's PASS verdict.

---

## Issues found outside AC scope

- **None blocking.** One informational observation: the Phase 5 live run output included an AWS SDK v3 warning about Node ≥22 being required for SDK versions published after January 2027 (we're on Node 20.10). This is not actionable in Sprint 3 — the project's `engines` field already requires Node ≥20, and the relevant SDK cutoff is well after the hackathon submission deadline (2026-05-19). Capturing the warning here for visibility in case a future sprint touches the runtime baseline.

- **Documentation-only carry-over from Sprint 2**: `tasks/todo.md` still tracks "Pre-submission documentation sweep for Meridian references" (low priority, deferred to pre-submission polish per the operator's note in Phase 6) and the RFC 8785 canonicalization migration trigger (no new triggers introduced in Sprint 3; AC-27 verified the rolled-own algorithm produces byte-identical output, so no migration pressure was added).

---

## Overall verdict

**PASS — ready to commit.**

All 36 acceptance criteria are independently verified against the code on disk. Every architectural rule from `CLAUDE.md` and `.claude/rules/*.md` holds: audit log integrity preserved, envelope discipline maintained on all public surfaces, no Vercel features, no Meridian references in source, all schemas in `@roguemouse/schemas`, zero new direct dependencies, workspace typecheck clean across all 9 targets, all tests pass (149 total), and the live `pnpm smoke` run produced a valid genesis-rooted record (`a35daa82-f0f3-43d8-b945-7f52def87c27`) with round-trip integrity verified.

The Sprint 3 commit is ready to land per the commit-policy section of `plan.md` (single commit per sprint after `/review-task` passes, following Sprint 2's pattern).
