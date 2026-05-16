import { z } from "zod";

import {
  anomalyDetectedPayload,
  finalCommittedPayload,
  humanApprovalPayload,
  humanRejectionPayload,
  opsEngineerReasoningPayload,
  riskOfficerReasoningPayload,
  smokeTestChatCompletionPayload,
  synthesizerProposalPayload,
  synthesizerReasoningPayload,
  synthesizerRefusalPayload,
  toolCallPayload,
  toolResultPayload,
} from "./auditPayloads.js";
import { HEX_64_REGEX, ISO_TIMESTAMP_MS_REGEX } from "./primitives.js";

/**
 * The 12 locked audit record type names. Order matters: this array is the
 * single source of truth from which `RecordTypeName` and the Phase 4
 * discriminated union are both derived, so any divergence between the
 * declared inventory and the union branches is impossible by construction.
 *
 * `as const` narrows each element to its string literal type, which is
 * required for `RecordTypeName` to be a literal union and for `z.enum`
 * to produce a Zod enum whose options are the same literals.
 */
export const RECORD_TYPES = [
  "smoke_test:chat_completion",
  "tool:call",
  "tool:result",
  "anomaly:detected",
  "risk_officer:reasoning",
  "ops_engineer:reasoning",
  "synthesizer:reasoning",
  "synthesizer:proposal",
  "synthesizer:refusal",
  "human:approval",
  "human:rejection",
  "final:committed",
] as const;

/**
 * Literal union of the 12 locked audit record type names. Derived from
 * `RECORD_TYPES`. Adding or removing a name in the array changes this
 * type automatically; the array is the single source of truth.
 */
export type RecordTypeName = (typeof RECORD_TYPES)[number];

/**
 * Zod enum schema for parsing a recordType name from arbitrary input.
 * Used by tools whose args carry a recordType (`audit:append`,
 * `audit:search`). Rejects any string not in `RECORD_TYPES`.
 */
export const recordTypeNameSchema = z.enum(RECORD_TYPES);

/**
 * Construct a discriminated-union branch for one audit record type.
 *
 * Returns a `.strict()` Zod object schema with the four locked envelope
 * fields (`ts`, `runId`, `previousHash`, plus `recordType` as a literal)
 * and the supplied payload schema. The literal type of `recordType` is
 * preserved in the return type via the `TRecordType` type parameter, so
 * `z.infer<typeof returned>["recordType"]` is the literal `TRecordType`,
 * not the widened `string`. This is what enables `z.discriminatedUnion`
 * to narrow correctly in Phase 4 and what enables call-site type
 * narrowing on `record.recordType`.
 *
 * The `ts`, `runId`, `previousHash` constraints are exactly the same
 * regex / non-empty / hex64 checks that Sprint 2's `auditRecordBodySchema`
 * uses, so every branch produced by this helper inherits Sprint 2's
 * envelope invariants unchanged.
 *
 * Constraining `TRecordType extends RecordTypeName` makes it a compile
 * error to construct a branch for a recordType not in the locked
 * inventory. The 12 calls assembled in Phase 4 will each pass one of
 * the locked literals; any future addition requires extending
 * `RECORD_TYPES` first.
 */
export function defineAuditRecord<
  TRecordType extends RecordTypeName,
  TPayload extends z.ZodTypeAny,
>(recordType: TRecordType, payloadSchema: TPayload) {
  return z
    .object({
      ts: z
        .string()
        .regex(ISO_TIMESTAMP_MS_REGEX, "ts must be ISO-8601 UTC at millisecond precision")
        .refine((s) => Number.isFinite(Date.parse(s)), {
          message: "ts must parse as a valid Date",
        }),
      runId: z.string().min(1, "runId must be non-empty"),
      recordType: z.literal(recordType),
      previousHash: z
        .string()
        .regex(HEX_64_REGEX, "previousHash must be 64-character lowercase hex"),
      payload: payloadSchema,
    })
    .strict();
}

/**
 * The audit record envelope schema, as the 12-branch discriminated
 * union keyed on `recordType`. Every audit record's JSON body must
 * conform to exactly one of the 12 branches.
 *
 * Each branch is constructed via `defineAuditRecord` (above), which
 * locks the four envelope-fixed fields (`ts`, `runId`, `previousHash`,
 * and a `recordType` literal) and accepts a per-branch payload schema.
 * `.strict()` on each branch enforces the five-field envelope rule
 * (AC-03): no sixth top-level field is allowed in any branch.
 *
 * The `recordType` field is the discriminator. After
 * `auditRecordBodySchema.safeParse(record).data`, TypeScript narrows
 * the parsed value to the specific branch based on `recordType`, so
 * `if (record.recordType === "tool:call") { record.payload.toolName }`
 * gives a fully-typed payload at the call site — no casts required.
 *
 * Sprint 4 will consume this narrowing in the planner. Sprint 5+ may
 * add new branches; each addition requires extending `RECORD_TYPES`
 * AND adding a `defineAuditRecord(...)` call to the array below.
 */
export const auditRecordBodySchema = z.discriminatedUnion("recordType", [
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
]);

export type AuditRecordBody = z.infer<typeof auditRecordBodySchema>;
