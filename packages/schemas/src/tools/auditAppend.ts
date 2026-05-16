import { z } from "zod";

import { recordTypeNameSchema } from "../auditRecord.js";
import { canonicalSafeSchema } from "../canonicalSafe.js";
import { HEX_64_REGEX } from "../primitives.js";
import { defineTool } from "./defineTool.js";

/**
 * audit:append — agent-initiated audit writes.
 *
 * IMPORTANT RECURSION GUARD: when the planner records its own
 * `tool:call` and `tool:result` audit entries about other tool
 * dispatches, it must call the writer (`RunAuditWriter.append`)
 * DIRECTLY, not invoke this `audit:append` tool — otherwise the
 * planner would recurse into recording its own recording. Only
 * agent-initiated audit writes (e.g., an agent voice explicitly
 * deciding to log a reasoning step or a refusal) go through this
 * tool's dispatch path.
 *
 * The args schema does NOT enforce the recordType ↔ payload match —
 * that is enforced at the planner call site, which knows the audit
 * record discriminated union. At the schema layer here, `payload` is
 * any canonicalization-safe value. Sprint 4 wires up the call-site
 * check via the discriminated union built in Phase 4.
 */
export const auditAppendArgsSchema = z
  .object({
    recordType: recordTypeNameSchema,
    payload: canonicalSafeSchema,
  })
  .strict();

export type AuditAppendArgs = z.infer<typeof auditAppendArgsSchema>;

/**
 * Result data for `audit:append`. Mirrors `AppendData` from
 * `@roguemouse/audit` (minus `canonicalJson`, which is internal
 * forensic detail not surfaced to agent voices). `hash` and
 * `previousHash` are 64-character lowercase hex strings.
 */
export const auditAppendResultDataSchema = z
  .object({
    key: z.string().min(1),
    hash: z.string().regex(HEX_64_REGEX),
    previousHash: z.string().regex(HEX_64_REGEX),
  })
  .strict();

export type AuditAppendResultData = z.infer<
  typeof auditAppendResultDataSchema
>;

export const auditAppendTool = defineTool(
  "audit:append",
  auditAppendArgsSchema,
  auditAppendResultDataSchema,
);
