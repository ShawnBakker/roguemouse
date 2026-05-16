import { z } from "zod";

import {
  auditRecordBodySchema,
  recordTypeNameSchema,
} from "../auditRecord.js";
import { ISO_TIMESTAMP_MS_REGEX } from "../primitives.js";
import { defineTool } from "./defineTool.js";

/**
 * audit:search — query the audit log.
 *
 * Forward-compatibility note: `result.records` is an array whose
 * element schema is `auditRecordBodySchema`. In Phase 3 this is the
 * Sprint 2 free-form envelope (`payload: z.unknown()`). In Phase 4
 * the same exported name binds to the discriminated union, and the
 * inferred element type of `records` tightens automatically with zero
 * changes to this file. Test data added against this tool in Phase 3
 * must use records that conform to locked recordType + payload shapes
 * so they remain green after Phase 4.
 */
export const auditSearchArgsSchema = z
  .object({
    runId: z.string().min(1).optional(),
    recordType: recordTypeNameSchema.optional(),
    sinceTs: z.string().regex(ISO_TIMESTAMP_MS_REGEX).optional(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

export type AuditSearchArgs = z.infer<typeof auditSearchArgsSchema>;

export const auditSearchResultDataSchema = z
  .object({
    records: z.array(auditRecordBodySchema),
    hasMore: z.boolean(),
  })
  .strict();

export type AuditSearchResultData = z.infer<
  typeof auditSearchResultDataSchema
>;

export const auditSearchTool = defineTool(
  "audit:search",
  auditSearchArgsSchema,
  auditSearchResultDataSchema,
);
