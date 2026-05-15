import { z } from "zod";

const ISO_TIMESTAMP_MS_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX_64_REGEX = /^[0-9a-f]{64}$/;

/**
 * The audit record envelope schema. Every audit record's JSON body must
 * conform to this shape exactly.
 *
 * `.strict()` rejects extra top-level fields — this enforces AC-09 (exactly
 * five envelope fields, no extras). The five fields are locked for the
 * lifetime of the audit log format version (`-v1` of the genesis seed).
 *
 * Sprint 2 leaves `payload` typed as `unknown`. Sprint 3 will narrow this
 * to a discriminated union keyed on `recordType` without breaking the
 * envelope shape.
 */
export const auditRecordBodySchema = z
  .object({
    ts: z
      .string()
      .regex(ISO_TIMESTAMP_MS_REGEX, "ts must be ISO-8601 UTC at millisecond precision")
      .refine((s) => Number.isFinite(Date.parse(s)), {
        message: "ts must parse as a valid Date",
      }),
    runId: z.string().min(1, "runId must be non-empty"),
    recordType: z.string().min(1, "recordType must be non-empty"),
    previousHash: z
      .string()
      .regex(HEX_64_REGEX, "previousHash must be 64-character lowercase hex"),
    payload: z.unknown(),
  })
  .strict();

export type AuditRecordBody = z.infer<typeof auditRecordBodySchema>;
